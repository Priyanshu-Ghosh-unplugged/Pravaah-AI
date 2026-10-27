"""
Formal Property & Invariant Test Suite for Pravaah AI.
Verifies zero conflicting greens across 50,000 randomized ticks, empty lane skip, and starvation bound.
"""
import random
from edge_engine.controller.models import SignalLight, ApproachDemand
from edge_engine.controller.state_machine import APPROACH_ORDER, AdaptiveJunctionStateMachine


def _make_demand(app: str, pcu: float, healthy: bool = True, emergency: bool = False) -> ApproachDemand:
    return ApproachDemand(
        approach_id=app,
        effective_pcu=pcu,
        effective_width_m=7.0,
        crosswalk_length_m=12.0,
        pedestrians_waiting=0,
        senior_ped_requested=False,
        wait_seconds=0.0,
        emergency_active=emergency,
        sensor_healthy=healthy,
    )


def test_zero_conflicting_greens_over_50000_adversarial_ticks():
    """Formally asserts that at no tick can two conflicting approaches hold non-red signals."""
    fsm = AdaptiveJunctionStateMachine()
    rng = random.Random(2026)

    for _ in range(50_000):
        demands = {
            app: _make_demand(
                app,
                pcu=rng.choice([0.0, 0.5, 4.0, 18.5, 42.0]),
                healthy=rng.random() > 0.05,
                emergency=rng.random() < 0.01,
            )
            for app in APPROACH_ORDER
        }
        fsm.step(0.1, demands)
        lights = fsm.get_light_states()
        non_red = [a for a, col in lights.items() if col != SignalLight.RED]
        assert len(non_red) <= 1, f"Conflicting active lights detected: {lights}"


def test_empty_approaches_are_skipped_immediately():
    """Proves that approaches with 0 PCU are immediately bypassed without wasting green time."""
    fsm = AdaptiveJunctionStateMachine(amber_sec=3.0, all_red_sec=2.0, min_green_sec=10.0)
    # Only NORTH and WEST have vehicles; EAST and SOUTH are completely empty (0 PCU)
    for _ in range(300):  # 30 seconds
        demands = {
            "NORTH": _make_demand("NORTH", 8.0),
            "EAST": _make_demand("EAST", 0.0),
            "SOUTH": _make_demand("SOUTH", 0.0),
            "WEST": _make_demand("WEST", 6.0),
        }
        snap = fsm.step(0.1, demands)
        assert snap["active_approach"] not in ("EAST", "SOUTH")
    assert fsm.skipped_phases_count >= 1


def test_side_street_never_starves_beyond_cap():
    """Verifies that mathematical wait-time aging prioritizes a lone car on a collector road."""
    fsm = AdaptiveJunctionStateMachine(max_green_sec=45.0)
    east_served = False
    for tick in range(1500):  # 150 seconds simulated
        demands = {
            "NORTH": _make_demand("NORTH", 38.0),  # Saturated highway
            "SOUTH": _make_demand("SOUTH", 35.0),  # Saturated highway
            "EAST": _make_demand("EAST", 1.0),     # Single waiting car on side lane
            "WEST": _make_demand("WEST", 0.0),
        }
        snap = fsm.step(0.1, demands)
        if snap["active_approach"] == "EAST" and snap["phase_state"] == "PHASE_GREEN":
            east_served = True
            assert tick * 0.1 <= 145.0
            break
    assert east_served, "Anti-starvation aging failed to serve lone side-street vehicle!"
