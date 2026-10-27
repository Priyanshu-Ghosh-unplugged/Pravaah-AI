"""
Cycle Sequencing Verification for Pravaah AI.
Verifies every occupied approach is served once per cycle (ordered by density) and that an
empty junction rests on all-red instead of handing green time to empty roads.
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


def _green_sequence(fsm: AdaptiveJunctionStateMachine, pcu: dict, ticks: int) -> list:
    sequence = []
    for _ in range(ticks):
        snap = fsm.step(0.1, {app: _make_demand(app, val) for app, val in pcu.items()})
        if snap["phase_state"] == "PHASE_GREEN" and (not sequence or sequence[-1] != snap["active_approach"]):
            sequence.append(snap["active_approach"])
    return sequence


def test_every_occupied_approach_served_once_per_cycle_in_density_order():
    """A heavy approach must not be re-served before every other waiting approach has had green."""
    fsm = AdaptiveJunctionStateMachine(max_green_sec=30.0)
    pcu = {"NORTH": 30.0, "EAST": 4.0, "SOUTH": 18.0, "WEST": 9.0}
    sequence = _green_sequence(fsm, pcu, 3000)

    assert sequence[:4] == ["NORTH", "SOUTH", "WEST", "EAST"], sequence
    for start in range(0, len(sequence) - 3, 4):
        assert sorted(sequence[start:start + 4]) == ["EAST", "NORTH", "SOUTH", "WEST"], sequence


def test_empty_junction_rests_on_all_red_and_wakes_on_arrival():
    fsm = AdaptiveJunctionStateMachine()
    empty = {"NORTH": 0.0, "EAST": 0.0, "SOUTH": 0.0, "WEST": 0.0}
    assert _green_sequence(fsm, empty, 300) == []
    assert fsm.phase_state.value == "ALL_RED_IDLE"

    snap = fsm.step(0.1, {app: _make_demand(app, 1.0 if app == "WEST" else 0.0) for app in empty})
    assert snap["phase_state"] == "PHASE_GREEN"
    assert snap["active_approach"] == "WEST"
