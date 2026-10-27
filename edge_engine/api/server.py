"""
FastAPI REST & WebSocket Interface for Pravaah AI.
Provides real-time Digital Twin telemetry, Police Override controls, and Citizen QR participatory services.
"""
import asyncio
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from edge_engine.simulation.lane_queues import ARRIVAL_PROFILES, make_lane, sync_queue

app = FastAPI(
    title="Pravaah AI Edge & Civic API",
    description="Edge-Native Adaptive Traffic Signal Control & Civic Telemetry Platform",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class CitizenIssueSubmission(BaseModel):
    junction_id: str = Field(..., examples=["IND-WB-KOL-004"])
    issue_category: str = Field(..., pattern="^(BULB_OUT|WATERLOGGING|OBSTRUCTION|BUZZER_SILENT)$")
    approach_hint: Optional[str] = Field(None, pattern="^(NORTH|EAST|SOUTH|WEST)$")
    citizen_note: Optional[str] = Field(None, max_length=240)
    pole_verification_pin: str = Field(..., min_length=3, max_length=6)


class SeniorWalkExtensionRequest(BaseModel):
    junction_id: str
    crosswalk_approach: str = Field(..., pattern="^(NORTH|EAST|SOUTH|WEST)$")
    pole_verification_pin: str


class PoliceManualCommand(BaseModel):
    command: str = Field(..., pattern="^(FORCE_APPROACH|CLEAR_OVERRIDE|FALLBACK_FIXED)$")
    target_approach: Optional[str] = Field(None, pattern="^(NORTH|EAST|SOUTH|WEST)$")
    officer_badge_id: str


class SimulationPresetCommand(BaseModel):
    preset_name: str = Field(
        ..., pattern="^(rush_asymmetric|late_night|starvation_test|ambulance_east|ambulance_clear|reset_normal)$"
    )


class SimulationLaneUpdate(BaseModel):
    approach: str = Field(..., pattern="^(NORTH|EAST|SOUTH|WEST)$")
    bikes: int = Field(..., ge=0, le=40)
    cars: int = Field(..., ge=0, le=30)
    buses: int = Field(..., ge=0, le=10)
    pedestrians: int = Field(0, ge=0, le=20)
    ambulance: bool = False


# Shared state injected by edge_engine/main.py runtime orchestrator
RUNTIME_CONTEXT: Dict[str, Any] = {
    "latest_snapshot": {},
    "senior_walk_flags": {"NORTH": False, "EAST": False, "SOUTH": False, "WEST": False},
    "last_walk_req_ts": {"NORTH": 0.0, "EAST": 0.0, "SOUTH": 0.0, "WEST": 0.0},
    "tickets": [],
    "pole_pin": "409",
    "fsm": None,
    "db": None,
    "simulation_overrides": {
        "NORTH": None,
        "EAST": None,
        "SOUTH": None,
        "WEST": None,
    },
    "ambulance_east": False,
    "arrival_rates": dict(ARRIVAL_PROFILES["reset_normal"]),
}


@app.get("/api/v1/health")
async def health_check() -> Dict[str, Any]:
    return {
        "status": "ONLINE",
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "snapshot": RUNTIME_CONTEXT.get("latest_snapshot", {}),
    }


@app.post("/api/v1/citizen/senior-walk")
async def request_senior_crossing(req: SeniorWalkExtensionRequest) -> Dict[str, Any]:
    if req.pole_verification_pin != RUNTIME_CONTEXT["pole_pin"]:
        raise HTTPException(status_code=403, detail="Invalid pole verification PIN.")
    now_ts = asyncio.get_event_loop().time()
    last_ts = RUNTIME_CONTEXT["last_walk_req_ts"].get(req.crosswalk_approach, 0.0)
    if now_ts - last_ts < 120.0:
        raise HTTPException(status_code=429, detail="Extended walk already queued for this cycle.")

    RUNTIME_CONTEXT["senior_walk_flags"][req.crosswalk_approach] = True
    RUNTIME_CONTEXT["last_walk_req_ts"][req.crosswalk_approach] = now_ts
    return {
        "accepted": True,
        "crosswalk": req.crosswalk_approach,
        "bonus_seconds_queued": 6,
        "message": "Extra crossing time queued for next pedestrian green signal.",
    }


@app.post("/api/v1/citizen/report-issue")
async def submit_citizen_issue(issue: CitizenIssueSubmission) -> Dict[str, Any]:
    if issue.pole_verification_pin != RUNTIME_CONTEXT["pole_pin"]:
        raise HTTPException(status_code=403, detail="Invalid pole verification PIN.")
    ticket = {
        "ticket_id": f"PRV-{uuid.uuid4().hex[:8].upper()}",
        "junction_id": issue.junction_id,
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "issue_category": issue.issue_category,
        "approach_hint": issue.approach_hint,
        "citizen_note": issue.citizen_note,
        "status": "OPEN",
    }
    RUNTIME_CONTEXT["tickets"].append(ticket)
    db = RUNTIME_CONTEXT.get("db")
    if db is not None:
        try:
            db.add_citizen_ticket(
                ticket_id=ticket["ticket_id"],
                junction_id=issue.junction_id,
                issue_category=issue.issue_category,
                approach_hint=issue.approach_hint,
                citizen_note=issue.citizen_note,
            )
        except Exception as e:
            print(f"[API] DB insert error: {e}")
    return {"submitted": True, "ticket": ticket}


@app.get("/api/v1/citizen/tickets")
async def list_citizen_tickets() -> Dict[str, Any]:
    db = RUNTIME_CONTEXT.get("db")
    if db is not None:
        try:
            tickets = db.list_citizen_tickets()
            if tickets:
                return {"tickets": tickets}
        except Exception:
            pass
    return {"tickets": RUNTIME_CONTEXT["tickets"]}


@app.post("/api/v1/police/override")
async def trigger_police_override(cmd: PoliceManualCommand) -> Dict[str, Any]:
    fsm = RUNTIME_CONTEXT.get("fsm")
    if fsm is None:
        raise HTTPException(status_code=503, detail="Signal FSM initializing.")
    if cmd.command == "FORCE_APPROACH":
        fsm.manual_override_target = cmd.target_approach
    elif cmd.command == "CLEAR_OVERRIDE":
        fsm.manual_override_target = None
    elif cmd.command == "FALLBACK_FIXED":
        fsm.manual_override_target = None
    return {"applied": True, "active_override": fsm.manual_override_target}


# Vehicle counts (bikes, cars, buses, pedestrians) each scenario starts from
PRESET_COUNTS: Dict[str, Dict[str, tuple]] = {
    "rush_asymmetric": {"NORTH": (12, 14, 2, 0), "EAST": (4, 3, 0, 1), "SOUTH": (0, 0, 0, 0), "WEST": (6, 6, 1, 0)},
    "late_night": {"NORTH": (0, 0, 0, 0), "EAST": (0, 0, 0, 0), "SOUTH": (0, 0, 0, 0), "WEST": (2, 1, 0, 0)},
    "starvation_test": {"NORTH": (16, 15, 3, 0), "EAST": (0, 1, 0, 0), "SOUTH": (14, 12, 2, 0), "WEST": (0, 0, 0, 0)},
    "reset_normal": {"NORTH": (8, 7, 2, 0), "EAST": (6, 5, 1, 0), "SOUTH": (5, 6, 1, 0), "WEST": (7, 5, 1, 0)},
}


@app.post("/api/v1/simulation/preset")
async def apply_simulation_preset(preset: SimulationPresetCommand) -> Dict[str, Any]:
    name = preset.preset_name
    overrides = RUNTIME_CONTEXT["simulation_overrides"]
    if name in PRESET_COUNTS:
        for app_id, (bikes, cars, buses, peds) in PRESET_COUNTS[name].items():
            overrides[app_id] = make_lane(bikes, cars, buses, peds, previous=overrides.get(app_id))
        RUNTIME_CONTEXT["arrival_rates"] = dict(ARRIVAL_PROFILES[name])
        RUNTIME_CONTEXT["ambulance_east"] = False
    elif name in ("ambulance_east", "ambulance_clear"):
        active = name == "ambulance_east"
        east = overrides.get("EAST") or make_lane(bikes=2, cars=3, buses=0)
        east["ambulance"] = active
        sync_queue(east)
        overrides["EAST"] = east
        RUNTIME_CONTEXT["ambulance_east"] = active

    return {"preset_applied": name, "overrides": overrides}


@app.post("/api/v1/simulation/set-lane")
async def update_simulation_lane(update: SimulationLaneUpdate) -> Dict[str, Any]:
    overrides = RUNTIME_CONTEXT["simulation_overrides"]
    overrides[update.approach] = make_lane(
        update.bikes,
        update.cars,
        update.buses,
        update.pedestrians,
        update.ambulance,
        previous=overrides.get(update.approach),
    )
    if update.approach == "EAST" and update.ambulance:
        RUNTIME_CONTEXT["ambulance_east"] = True
    return {"updated": update.approach, "data": overrides[update.approach]}


@app.get("/simulator")
async def get_simulator_html():
    if os.path.exists("traffic_demo.html"):
        return FileResponse("traffic_demo.html", media_type="text/html")
    raise HTTPException(status_code=404, detail="Simulator file not found")


@app.websocket("/ws/live-twin")
async def websocket_digital_twin(ws: WebSocket) -> None:
    await ws.accept()
    try:
        while True:
            snapshot = RUNTIME_CONTEXT.get("latest_snapshot", {})
            if snapshot:
                await ws.send_json(snapshot)
            await asyncio.sleep(0.2)  # 5 Hz crisp telemetry push
    except WebSocketDisconnect:
        return
    except Exception:
        return


# Serve production build of frontend dashboard if dist exists
dist_dir = os.path.join(os.path.dirname(__file__), "..", "..", "frontend_dashboard", "dist")
if os.path.exists(dist_dir):
    from fastapi.staticfiles import StaticFiles
    app.mount("/assets", StaticFiles(directory=os.path.join(dist_dir, "assets")), name="assets")

    @app.get("/")
    async def serve_index():
        return FileResponse(os.path.join(dist_dir, "index.html"))
else:
    @app.get("/")
    async def serve_default_simulator():
        if os.path.exists("traffic_demo.html"):
            return FileResponse("traffic_demo.html", media_type="text/html")
        return {"status": "Pravaah AI API is running", "docs": "/docs"}
