"""Data models for signal colors, phase states, and approach telemetry."""
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional


class SignalLight(str, Enum):
    RED = "RED"
    AMBER = "AMBER"
    GREEN = "GREEN"


class JunctionPhaseState(str, Enum):
    ALL_RED_IDLE = "ALL_RED_IDLE"
    PHASE_GREEN = "PHASE_GREEN"
    PHASE_AMBER = "PHASE_AMBER"
    INTERGREEN_ALL_RED = "INTERGREEN_ALL_RED"
    FALLBACK_FIXED_ROTATION = "FALLBACK_FIXED_ROTATION"


@dataclass
class ApproachDemand:
    approach_id: str
    effective_pcu: float
    effective_width_m: float
    crosswalk_length_m: float
    pedestrians_waiting: int
    senior_ped_requested: bool
    wait_seconds: float
    emergency_active: bool
    sensor_healthy: bool


@dataclass
class ApproachTelemetry:
    approach_id: str
    light: SignalLight
    effective_pcu: float
    occupancy_ratio: float
    wait_seconds: float
    priority_score: float
    is_healthy: bool
    counts: Dict[str, int] = field(default_factory=dict)
