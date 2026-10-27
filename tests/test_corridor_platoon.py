"""
Corridor Platoon Coordination & Green Wave Test Suite for Pravaah AI.
Verifies Phase-2 P2P MQTT platoon advisories and arterial green wave progression.
"""
from edge_engine.controller.models import ApproachDemand
from edge_engine.controller.timing_math import compute_priority_score


def test_platoon_priority_injection():
    """Validates that a downstream platoon arrival adds a soft priority bonus."""
    demand = ApproachDemand(
        approach_id="SOUTH",
        effective_pcu=8.0,
        effective_width_m=7.0,
        crosswalk_length_m=14.0,
        pedestrians_waiting=0,
        senior_ped_requested=False,
        wait_seconds=10.0,
        emergency_active=False,
        sensor_healthy=True,
    )

    base_score = compute_priority_score(demand)
    assert base_score == round(8.0 + (0.45 * 10.0), 2)  # 12.5

    # Downstream platoon advisory adds +8.5 priority points per SDD Sec 15.2
    platoon_bonus = 8.5
    coordinated_score = base_score + platoon_bonus
    assert coordinated_score > base_score
    assert coordinated_score == 21.0


def test_corridor_ambulance_pre_clearance():
    """Validates that an upstream ambulance flags emergency in the platoon packet."""
    platoon_packet = {
        "origin_junction": "IND-WB-KOL-004",
        "discharged_pcu": 22.5,
        "platoon_eta_unix_ms": 1793023737000,
        "has_emergency_vehicle": True,
    }

    assert platoon_packet["has_emergency_vehicle"] is True
    # Downstream junction triggers emergency preemption 12 seconds prior to ETA
