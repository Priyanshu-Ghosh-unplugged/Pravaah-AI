"""
Mathematical Timing & Priority Module for Pravaah AI.
Implements IRC:106 PCU calculations, IRC:93 dynamic green durations, and anti-starvation aging.
"""
import math
from typing import Dict, Optional
from edge_engine.controller.models import ApproachDemand

STARVATION_CAP_SEC = 95.0  # Hard ceiling after which a waiting approach jumps the service order


def compute_irc93_saturation_rate_pcu_per_sec(effective_width_m: float) -> float:
    """IRC:93 empirical formula: S = 525 * Width (PCU/hour), converted to PCU/sec."""
    s_per_hour = 525.0 * max(3.5, effective_width_m)
    # Apply 0.85 conservative urban friction factor for roadside friction
    return (s_per_hour * 0.85) / 3600.0


def compute_dynamic_green_seconds(
    demand: ApproachDemand,
    startup_lost_sec: float = 4.5,
    min_green_sec: float = 10.0,
    max_green_sec: float = 60.0,
    ped_walk_speed_mps: float = 1.2,
    fallback_fixed_sec: float = 40.0,
) -> int:
    """Computes safety-clamped green allocation in integer seconds; returns 0 for empty skip."""
    if not demand.sensor_healthy:
        return int(fallback_fixed_sec)

    has_ped_demand = (demand.pedestrians_waiting > 0) or demand.senior_ped_requested
    if demand.effective_pcu <= 0.0 and not has_ped_demand and not demand.emergency_active:
        return 0  # Instantaneous Phase Skip!

    # IRC:93 minimum pedestrian clearance floor when pedestrians are present
    ped_floor_sec = 0.0
    if has_ped_demand:
        ped_floor_sec = 7.0 + (demand.crosswalk_length_m / ped_walk_speed_mps)
        if demand.senior_ped_requested:
            ped_floor_sec += 6.0  # Proactive senior/PwD walk buffer

    effective_min = max(min_green_sec, math.ceil(ped_floor_sec))
    sat_rate = compute_irc93_saturation_rate_pcu_per_sec(demand.effective_width_m)
    raw_green = startup_lost_sec + (demand.effective_pcu / sat_rate)

    clamped = max(effective_min, min(int(max_green_sec), round(raw_green)))
    return int(clamped)


def compute_priority_score(
    demand: ApproachDemand,
    alpha_aging: float = 0.45,
    starvation_cap_sec: float = STARVATION_CAP_SEC,
) -> float:
    """Anti-starvation fairness function: P_k = PCU_k + alpha * W_k + HardCapBoost."""
    if demand.emergency_active:
        return 10_000.0 + demand.wait_seconds

    if not demand.sensor_healthy:
        # Degraded camera still gets fair periodic service via wait-time aging
        return 12.0 + (alpha_aging * demand.wait_seconds)

    has_any_demand = (
        demand.effective_pcu > 0.0
        or demand.pedestrians_waiting > 0
        or demand.senior_ped_requested
    )
    if not has_any_demand:
        return -1.0  # Eligible for 0s skip

    starvation_boost = 500.0 if demand.wait_seconds >= starvation_cap_sec else 0.0
    ped_bonus = 4.0 if (demand.pedestrians_waiting > 0 or demand.senior_ped_requested) else 0.0
    return round(
        demand.effective_pcu + ped_bonus + (alpha_aging * demand.wait_seconds) + starvation_boost,
        2,
    )


def select_next_approach(
    demands: Dict[str, ApproachDemand],
    current_active: Optional[str],
    alpha_aging: float = 0.45,
    starvation_cap_sec: float = STARVATION_CAP_SEC,
) -> Optional[str]:
    """Selects highest-priority waiting approach; returns None if entire intersection is empty."""
    scored = []
    for app_id, dem in demands.items():
        score = compute_priority_score(dem, alpha_aging, starvation_cap_sec)
        if score >= 0.0:
            # Slight hysteresis penalty (-0.1) on current_active so equal ties rotate cleanly
            tie_adj = -0.1 if app_id == current_active else 0.0
            scored.append((score + tie_adj, dem.wait_seconds, app_id))

    if not scored:
        return None
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return scored[0][2]
