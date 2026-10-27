"""
Master Edge Orchestrator for Pravaah AI.
Unites multi-camera capture, image diagnostics, deterministic 10 Hz FSM control,
hardware watchdog pulsing, Shadow KPI tracking, and FastAPI/WebSocket server.
"""
import asyncio
import logging
import random
import time
from typing import Dict
import uvicorn
import yaml

from edge_engine.api.mqtt_client import MqttTelemetryPublisher
from edge_engine.api.server import RUNTIME_CONTEXT, app
from edge_engine.controller.models import ApproachDemand
from edge_engine.controller.shadow_fixed import ShadowFixedTimerComparator
from edge_engine.controller.state_machine import APPROACH_ORDER, AdaptiveJunctionStateMachine
from edge_engine.controller.timing_math import compute_irc93_saturation_rate_pcu_per_sec
from edge_engine.hardware.relay_interface import HardwareRelayDriver
from edge_engine.simulation.lane_queues import (
    ARRIVAL_PROFILES,
    DISCHARGE_STARTUP_SEC,
    discharge_front,
    lane_pcu,
    make_lane,
    spawn_arrivals,
    sync_queue,
)
from edge_engine.storage.local_db import LocalDatabase
from edge_engine.vision.detector import EdgeONNXYoloDetector
from edge_engine.vision.health_diagnostics import evaluate_frame_health
from edge_engine.vision.polygon_roi import PolygonZoneAnalyzer
from edge_engine.vision.stream_reader import ZeroLagStreamReader

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("pravaah.main")


async def control_and_perception_loop(cfg: dict, dry_run: bool = True) -> None:
    detector = EdgeONNXYoloDetector(onnx_path="models/yolov8n_indian_traffic_int8.onnx")
    fsm = AdaptiveJunctionStateMachine(
        amber_sec=cfg["timing_parameters"]["amber_duration_sec"],
        all_red_sec=cfg["timing_parameters"]["all_red_duration_sec"],
        min_green_sec=cfg["timing_parameters"]["min_green_vehicle_sec"],
        max_green_sec=cfg["timing_parameters"]["max_green_vehicle_sec"],
        gap_out_sec=cfg["timing_parameters"]["gap_out_empty_threshold_sec"],
    )
    RUNTIME_CONTEXT["fsm"] = fsm

    db = LocalDatabase(db_path="data/pravaah_edge.db")
    RUNTIME_CONTEXT["db"] = db

    mqtt_pub = MqttTelemetryPublisher(
        junction_id=cfg["junction_id"],
        city=cfg.get("city", "kolkata"),
    )
    mqtt_pub.connect()

    shadow = ShadowFixedTimerComparator(
        fixed_green_sec=cfg["timing_parameters"]["shadow_fixed_green_sec"]
    )
    relay = HardwareRelayDriver(
        pin_map={k: v["relay_pins"] for k, v in cfg["approaches"].items()},
        dry_run=dry_run,
    )

    readers: Dict[str, ZeroLagStreamReader] = {}
    analyzers: Dict[str, PolygonZoneAnalyzer] = {}
    unhealthy_streak_sec: Dict[str, float] = {k: 0.0 for k in APPROACH_ORDER}

    latest_vision: Dict[str, dict] = {
        k: {
            "effective_pcu": 0.0,
            "discrete_pcu": 0.0,
            "pedestrians_in_crosswalk": 0,
            "emergency_visual": False,
            "counts": {"two_wheeler": 0, "car_lmv": 0, "auto_rickshaw": 0, "bus_truck_hmv": 0, "ambulance_emergency": 0},
            "occupancy_ratio": 0.0,
            "healthy": True,
        }
        for k in APPROACH_ORDER
    }

    # Default initial traffic distribution for live digital twin out of the box
    RUNTIME_CONTEXT["simulation_overrides"] = {
        "NORTH": make_lane(bikes=8, cars=7, buses=2),
        "EAST": make_lane(bikes=6, cars=5, buses=1),
        "SOUTH": make_lane(bikes=5, cars=6, buses=1),
        "WEST": make_lane(bikes=7, cars=5, buses=1),
    }
    RUNTIME_CONTEXT["arrival_rates"] = dict(ARRIVAL_PROFILES["reset_normal"])
    traffic_rng = random.Random(2026)
    discharge_credit: Dict[str, float] = {k: 0.0 for k in APPROACH_ORDER}
    sat_rate = {
        k: compute_irc93_saturation_rate_pcu_per_sec(cfg["approaches"][k]["effective_width_m"])
        for k in APPROACH_ORDER
    }

    for app_id in APPROACH_ORDER:
        acfg = cfg["approaches"][app_id]
        reader = ZeroLagStreamReader(app_id, acfg["rtsp_source"])
        reader.start()
        readers[app_id] = reader
        analyzers[app_id] = PolygonZoneAnalyzer(
            frame_width=1280,
            frame_height=720,
            queue_poly_norm=acfg["queue_roi_norm"],
            crosswalk_poly_norm=acfg["crosswalk_roi_norm"],
            pcu_weights=cfg["pcu_weights"],
            max_roi_saturation_pcu=acfg["max_roi_saturation_pcu"],
        )

    tick_dt = 0.1  # 10 Hz deterministic control cadence
    tick_counter = 0
    prev_phase_state = None
    prev_active_app = None

    logger.info("Pravaah AI 10 Hz Control & Perception Loop started.")

    while True:
        loop_start = time.monotonic()
        tick_counter += 1

        # Check vision frame health and run detection
        in_decision_window = (
            fsm.allocated_green_sec - fsm.phase_elapsed_sec <= 4.0
        )
        should_scan_vision = in_decision_window or (tick_counter % 2 == 0)

        if should_scan_vision:
            for app_id in APPROACH_ORDER:
                frame, is_fresh = readers[app_id].get_latest_frame()
                if not is_fresh or frame is None:
                    unhealthy_streak_sec[app_id] += tick_dt * 2
                else:
                    health = evaluate_frame_health(frame, analyzers[app_id].queue_mask)
                    if not health.is_healthy:
                        unhealthy_streak_sec[app_id] += tick_dt * 2
                    else:
                        unhealthy_streak_sec[app_id] = 0.0
                        dets = detector.infer(frame)
                        metrics = analyzers[app_id].evaluate_detections(dets)
                        metrics["healthy"] = True
                        latest_vision[app_id] = metrics

                if unhealthy_streak_sec[app_id] >= cfg["watchdog_thresholds"]["degraded_trigger_hold_sec"]:
                    latest_vision[app_id]["healthy"] = False

        # Continuous traffic arrivals (per-approach Poisson rates set by the active scenario)
        overrides = RUNTIME_CONTEXT.get("simulation_overrides", {})
        arrival_rates = RUNTIME_CONTEXT.get("arrival_rates", {})
        for app_id in APPROACH_ORDER:
            sim_data = overrides.get(app_id)
            if sim_data is not None:
                spawn_arrivals(sim_data, arrival_rates.get(app_id, 0.0), tick_dt, traffic_rng)

        # Discharge the front of the green approach's queue at the IRC:93 saturation flow rate
        green_app = fsm.active_approach if fsm.phase_state.value == "PHASE_GREEN" else None
        for app_id in APPROACH_ORDER:
            sim_data = overrides.get(app_id)
            if app_id != green_app or sim_data is None:
                discharge_credit[app_id] = 0.0
                continue
            if fsm.phase_elapsed_sec >= DISCHARGE_STARTUP_SEC:
                discharge_credit[app_id] += sat_rate[app_id] * tick_dt
                discharge_credit[app_id] = discharge_front(sim_data, discharge_credit[app_id])
        if not overrides.get("EAST", {}) or not overrides["EAST"].get("ambulance"):
            RUNTIME_CONTEXT["ambulance_east"] = False

        # Apply simulation or manual UI overrides seamlessly if active
        for app_id in APPROACH_ORDER:
            sim_data = overrides.get(app_id)
            if sim_data is not None:
                sync_queue(sim_data)
                bikes = sim_data.get("bikes", 0)
                cars = sim_data.get("cars", 0)
                buses = sim_data.get("buses", 0)
                is_amb = bool(sim_data.get("ambulance", False))
                pcu = lane_pcu(sim_data)
                occ = round(min(1.0, (bikes * 0.02 + cars * 0.05 + buses * 0.12)), 3)

                latest_vision[app_id] = {
                    "effective_pcu": pcu,
                    "discrete_pcu": pcu,
                    "pedestrians_in_crosswalk": sim_data.get("pedestrians", 0),
                    "emergency_visual": is_amb,
                    "counts": {
                        "two_wheeler": bikes,
                        "car_lmv": cars,
                        "auto_rickshaw": max(0, int(cars * 0.3)),
                        "bus_truck_hmv": buses,
                        "ambulance_emergency": 1 if is_amb else 0,
                    },
                    "queue": [dict(v) for v in sim_data["queue"]],
                    "occupancy_ratio": occ,
                    "healthy": True,
                }

        demands: Dict[str, ApproachDemand] = {}
        for app_id in APPROACH_ORDER:
            acfg = cfg["approaches"][app_id]
            vis = latest_vision[app_id]
            demands[app_id] = ApproachDemand(
                approach_id=app_id,
                effective_pcu=vis["effective_pcu"],
                effective_width_m=acfg["effective_width_m"],
                crosswalk_length_m=acfg["crosswalk_length_m"],
                pedestrians_waiting=vis["pedestrians_in_crosswalk"],
                senior_ped_requested=RUNTIME_CONTEXT["senior_walk_flags"].get(app_id, False),
                wait_seconds=fsm.wait_timers[app_id],
                emergency_active=vis["emergency_visual"],
                sensor_healthy=vis["healthy"],
            )

        fsm_snapshot = fsm.step(tick_dt, demands)
        relay.apply_signal_state(fsm.get_light_states())
        if tick_counter % 2 == 0:
            relay.pulse_watchdog()  # 5 Hz physical watchdog heartbeat

        kpis = shadow.update(
            tick_dt,
            {k: latest_vision[k]["effective_pcu"] for k in APPROACH_ORDER},
            fsm.active_approach if fsm_snapshot["phase_state"] == "PHASE_GREEN" else None,
        )

        RUNTIME_CONTEXT["latest_snapshot"] = {
            "junction_id": cfg["junction_id"],
            "fsm": fsm_snapshot,
            "vision": latest_vision,
            "impact_kpis": kpis,
        }

        # Periodic / Phase transition logging & MQTT publishing
        curr_state = fsm_snapshot["phase_state"]
        curr_app = fsm_snapshot["active_approach"]
        if curr_state != prev_phase_state or (tick_counter % 50 == 0):
            prev_phase_state = curr_state
            prev_active_app = curr_app
            mqtt_payload = {
                "schema_version": "1.0",
                "junction_id": cfg["junction_id"],
                "observed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "controller_mode": "ADAPTIVE_AI",
                "phase_state": curr_state,
                "active_approach": curr_app,
                "remaining_phase_sec": fsm_snapshot["remaining_sec"],
                "approaches": {
                    app_id: {
                        "light": fsm_snapshot["lights"][app_id],
                        "pcu": latest_vision[app_id]["effective_pcu"],
                        "occ": latest_vision[app_id]["occupancy_ratio"],
                        "wait_s": fsm_snapshot["wait_timers"][app_id],
                        "prio": fsm_snapshot["priority_scores"][app_id],
                        "healthy": latest_vision[app_id]["healthy"],
                    }
                    for app_id in APPROACH_ORDER
                },
                "cumulative_kpis_today": {
                    "empty_phases_skipped": fsm_snapshot["skipped_phases_count"],
                    "emergency_corridors_cleared": fsm_snapshot["emergency_preemptions_count"],
                    "avg_wait_reduction_pct": kpis["wait_reduction_pct"],
                    "fuel_saved_litres": kpis["fuel_saved_litres"],
                    "co2_avoided_kg": kpis["co2_avoided_kg"],
                },
                "privacy_attestation": "ZERO_PII_RAM_ONLY",
            }
            mqtt_pub.publish_telemetry(mqtt_payload)

        elapsed = time.monotonic() - loop_start
        await asyncio.sleep(max(0.005, tick_dt - elapsed))


async def main() -> None:
    with open("configs/junction_kol_04.yaml", "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    server = uvicorn.Server(uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="info"))
    await asyncio.gather(
        control_and_perception_loop(cfg, dry_run=True),
        server.serve(),
    )


if __name__ == "__main__":
    asyncio.run(main())
