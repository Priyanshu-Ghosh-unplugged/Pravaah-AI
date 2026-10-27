"""
Anti-Starvation Mathematical Verification for Pravaah AI.
Verifies that low-volume collector streets never wait past statutory ceilings.
"""
from edge_engine.controller.models import ApproachDemand
from edge_engine.controller.state_machine import AdaptiveJunctionStateMachine


def _make_demand(app: str, pcu: float) -> ApproachDemand:
    return ApproachDemand(
        approach_id=app,
        effective_pcu=pcu,
        effective_width_m=7.0,
        crosswalk_length_m=12.0,
        pedestrians_waiting=0,
        senior_ped_requested=False,
        wait_seconds=0.0,
        emergency_active=False,
        sensor_healthy=True,
    )


def test_anti_starvation_under_20_to_1_skew():
    """North is an 8-lane expressway with 42 PCU, West is a colony lane with 1 scooter."""
    fsm = AdaptiveJunctionStateMachine(min_green_sec=10.0, max_green_sec=45.0)

    west_served = False
    max_west_wait = 0.0

    for tick in range(1200):  # 120 seconds simulated
        demands = {
            "NORTH": _make_demand("NORTH", 42.0),
            "EAST": _make_demand("EAST", 0.0),
            "SOUTH": _make_demand("SOUTH", 38.0),
            "WEST": _make_demand("WEST", 0.5),  # 1 scooter (0.5 PCU)
        }
        snap = fsm.step(0.1, demands)
        max_west_wait = max(max_west_wait, snap["wait_timers"]["WEST"])

        if snap["active_approach"] == "WEST" and snap["phase_state"] == "PHASE_GREEN":
            west_served = True
            break

    assert west_served, "West scooter was starved by heavy North/South traffic!"
    # Per PRD FR-SIG-04: max wait is bounded by W_starve_cap (95s) + 1 active phase (<= 155s worst-case saturated gridlock)
    assert max_west_wait <= 155.0, f"West waited {max_west_wait}s, violating 155s worst-case saturation cap!"
