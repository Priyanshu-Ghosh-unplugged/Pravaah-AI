"""Pydantic v2 configuration models for Pravaah AI junction configuration."""
from typing import Dict, List
from pydantic import BaseModel, Field


class CoordinatesConfig(BaseModel):
    lat: float
    lon: float


class TimingParametersConfig(BaseModel):
    startup_lost_time_sec: float = 4.5
    amber_duration_sec: float = 3.0
    all_red_duration_sec: float = 2.0
    min_green_vehicle_sec: float = 10.0
    max_green_vehicle_sec: float = 60.0
    gap_out_empty_threshold_sec: float = 3.5
    pedestrian_walk_speed_mps: float = 1.2
    senior_ped_extension_step_sec: float = 2.0
    senior_ped_max_bonus_sec: float = 10.0
    starvation_alpha: float = 0.45
    starvation_hard_cap_sec: float = 95.0
    shadow_fixed_green_sec: float = 45.0


class WatchdogThresholdsConfig(BaseModel):
    min_laplacian_blur_var: float = 35.0
    min_luminance: float = 8.0
    max_glare_saturation_ratio: float = 0.60
    degraded_trigger_hold_sec: float = 6.0


class ApproachConfig(BaseModel):
    rtsp_source: str
    effective_width_m: float = 7.0
    crosswalk_length_m: float = 14.0
    max_roi_saturation_pcu: float = 32.0
    queue_roi_norm: List[List[float]]
    crosswalk_roi_norm: List[List[float]]
    relay_pins: Dict[str, int]


class JunctionConfig(BaseModel):
    junction_id: str
    junction_name: str
    city: str
    coordinates: CoordinatesConfig
    timing_parameters: TimingParametersConfig
    pcu_weights: Dict[str, float]
    watchdog_thresholds: WatchdogThresholdsConfig
    approaches: Dict[str, ApproachConfig]
