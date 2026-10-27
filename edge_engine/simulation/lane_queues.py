"""
FIFO lane queues for the simulated digital twin.
Each approach keeps an ordered queue of vehicles (front of queue first) with stable IDs, so the
dashboard can animate exactly which vehicle discharges on green and which one just arrived.
Counts (bikes / cars / buses) are always derived from, and kept consistent with, the queue.
"""
import itertools
import random
from typing import Dict, List, Optional

KIND_PCU: Dict[str, float] = {
    "two_wheeler": 0.5,
    "car_lmv": 1.0,
    "bus_truck_hmv": 3.0,
    "ambulance_emergency": 1.5,
}
COUNT_FIELD_KIND: Dict[str, str] = {"bikes": "two_wheeler", "cars": "car_lmv", "buses": "bus_truck_hmv"}
ARRIVAL_MIX = (("two_wheeler", 0.45), ("car_lmv", 0.43), ("bus_truck_hmv", 0.12))
MAX_QUEUE_VEHICLES = 22
DISCHARGE_STARTUP_SEC = 2.0  # Queue reaction delay after the signal turns green

# Vehicles arriving per second on each approach, per demo scenario
ARRIVAL_PROFILES: Dict[str, Dict[str, float]] = {
    "reset_normal": {"NORTH": 0.14, "EAST": 0.10, "SOUTH": 0.12, "WEST": 0.07},
    "rush_asymmetric": {"NORTH": 0.22, "EAST": 0.06, "SOUTH": 0.0, "WEST": 0.09},
    "late_night": {"NORTH": 0.01, "EAST": 0.01, "SOUTH": 0.0, "WEST": 0.02},
    "starvation_test": {"NORTH": 0.20, "EAST": 0.01, "SOUTH": 0.17, "WEST": 0.0},
}

_vehicle_ids = itertools.count(1)


def make_lane(
    bikes: int,
    cars: int,
    buses: int,
    pedestrians: int = 0,
    ambulance: bool = False,
    previous: Optional[dict] = None,
) -> dict:
    """Builds a lane with the requested counts, reusing vehicles already queued in `previous`."""
    lane = {
        "bikes": bikes,
        "cars": cars,
        "buses": buses,
        "pedestrians": pedestrians,
        "ambulance": ambulance,
        "queue": list(previous.get("queue", [])) if previous else [],
    }
    sync_queue(lane)
    return lane


def sync_queue(lane: dict) -> None:
    """Adds vehicles at the back / removes the rear-most ones until the queue matches the counts."""
    queue: List[dict] = lane.setdefault("queue", [])
    for field, kind in COUNT_FIELD_KIND.items():
        want = max(0, int(lane.get(field, 0)))
        have = sum(1 for v in queue if v["kind"] == kind)
        while have < want:
            queue.append({"id": next(_vehicle_ids), "kind": kind})
            have += 1
        while have > want:
            for i in range(len(queue) - 1, -1, -1):
                if queue[i]["kind"] == kind:
                    del queue[i]
                    break
            have -= 1

    has_amb = any(v["kind"] == "ambulance_emergency" for v in queue)
    if lane.get("ambulance") and not has_amb:
        queue.insert(0, {"id": next(_vehicle_ids), "kind": "ambulance_emergency"})
    elif not lane.get("ambulance") and has_amb:
        lane["queue"] = [v for v in queue if v["kind"] != "ambulance_emergency"]


def lane_pcu(lane: dict) -> float:
    return round(sum(KIND_PCU[v["kind"]] for v in lane.get("queue", [])), 2)


def spawn_arrivals(lane: dict, rate_per_sec: float, dt_sec: float, rng: random.Random) -> None:
    """Poisson-style arrivals appended to the back of the queue."""
    if rate_per_sec <= 0.0 or len(lane["queue"]) >= MAX_QUEUE_VEHICLES:
        return
    if rng.random() >= rate_per_sec * dt_sec:
        return
    roll = rng.random()
    kind = ARRIVAL_MIX[-1][0]
    for candidate, share in ARRIVAL_MIX:
        if roll < share:
            kind = candidate
            break
        roll -= share
    lane["queue"].append({"id": next(_vehicle_ids), "kind": kind})
    _recount(lane)


def discharge_front(lane: dict, credit_pcu: float) -> float:
    """
    Releases vehicles from the front of the queue while the accumulated saturation-flow credit
    covers their PCU. Returns the unused credit. Clears the ambulance flag once it has passed.
    """
    queue = lane["queue"]
    while queue and credit_pcu >= KIND_PCU[queue[0]["kind"]]:
        vehicle = queue.pop(0)
        credit_pcu -= KIND_PCU[vehicle["kind"]]
        if vehicle["kind"] == "ambulance_emergency":
            lane["ambulance"] = False
    _recount(lane)
    return credit_pcu if queue else 0.0


def _recount(lane: dict) -> None:
    for field, kind in COUNT_FIELD_KIND.items():
        lane[field] = sum(1 for v in lane["queue"] if v["kind"] == kind)
