"""
Emergency Ambulance Preemption Verification for Pravaah AI.
Verifies multi-modal emergency preemption with mandatory Amber and All-Red transitions.
"""
from edge_engine.controller.models import SignalLight, ApproachDemand
from edge_engine.controller.state_machine import AdaptiveJunctionStateMachine


def _make_demand(app: str, pcu: float, emergency: bool = False) -> ApproachDemand:
    return ApproachDemand(
        approach_id=app,
        effective_pcu=pcu,
        effective_width_m=7.0,
        crosswalk_length_m=12.0,
        pedestrians_waiting=0,
        senior_ped_requested=False,
        wait_seconds=0.0,
        emergency_active=emergency,
        sensor_healthy=True,
    )


def test_emergency_preemption_executes_safe_amber_and_all_red():
    """Validates that emergency preemption never bypasses IRC:93 amber and all-red clearance."""
    fsm = AdaptiveJunctionStateMachine(amber_sec=3.0, all_red_sec=2.0)

    # 1. Start normal traffic with NORTH receiving Green
    for _ in range(80):  # 8.0 seconds of North Green
        demands = {
            "NORTH": _make_demand("NORTH", 15.0),
            "EAST": _make_demand("EAST", 6.0),
            "SOUTH": _make_demand("SOUTH", 4.0),
            "WEST": _make_demand("WEST", 5.0),
        }
        snap = fsm.step(0.1, demands)

    assert snap["active_approach"] == "NORTH"
    assert snap["phase_state"] == "PHASE_GREEN"

    # 2. Inject ambulance emergency on SOUTH
    ambulance_demands = {
        "NORTH": _make_demand("NORTH", 15.0),
        "EAST": _make_demand("EAST", 6.0),
        "SOUTH": _make_demand("SOUTH", 18.0, emergency=True),  # Ambulance approaching!
        "WEST": _make_demand("WEST", 5.0),
    }

    # Step immediately: NORTH must switch to AMBER
    amber_snap = fsm.step(0.1, ambulance_demands)
    assert amber_snap["phase_state"] == "PHASE_AMBER"
    assert amber_snap["active_approach"] == "NORTH"
    assert amber_snap["lights"]["NORTH"] == SignalLight.AMBER.value
    assert amber_snap["lights"]["SOUTH"] == SignalLight.RED.value

    # Wait out 3 seconds of amber
    for _ in range(30):
        snap = fsm.step(0.1, ambulance_demands)

    # Must be in INTERGREEN_ALL_RED for 2 seconds
    assert snap["phase_state"] == "INTERGREEN_ALL_RED"
    for app, col in snap["lights"].items():
        assert col == SignalLight.RED.value

    for _ in range(20):
        snap = fsm.step(0.1, ambulance_demands)

    # Now SOUTH receives EMERGENCY_GREEN
    assert snap["phase_state"] == "PHASE_GREEN"
    assert snap["active_approach"] == "SOUTH"
    assert snap["lights"]["SOUTH"] == SignalLight.GREEN.value
    assert snap["lights"]["NORTH"] == SignalLight.RED.value
    assert fsm.emergency_preemptions_count >= 1
