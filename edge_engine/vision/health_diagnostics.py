"""Camera image quality, occlusion, blur, and glare diagnostics."""
from dataclasses import dataclass
import cv2
import numpy as np


@dataclass(frozen=True)
class FrameHealthReport:
    is_healthy: bool
    blur_variance: float
    mean_luminance: float
    glare_ratio: float
    failure_reason: str = "NONE"


def evaluate_frame_health(
    frame_bgr: np.ndarray,
    roi_mask: np.ndarray,
    min_blur_var: float = 35.0,
    min_luminance: float = 8.0,
    max_glare_ratio: float = 0.60,
) -> FrameHealthReport:
    """Executes in <3.2ms on 640x360 grayscale ROI to catch mud, fog, dead sensor, or high-beam glare."""
    if frame_bgr is None or frame_bgr.size == 0:
        return FrameHealthReport(False, 0.0, 0.0, 0.0, "EMPTY_FRAME")

    small = cv2.resize(frame_bgr, (320, 180), interpolation=cv2.INTER_AREA)
    small_mask = cv2.resize(roi_mask, (320, 180), interpolation=cv2.INTER_NEAREST)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

    roi_pixels = gray[small_mask > 0]
    if roi_pixels.size == 0:
        # Fall back to whole frame if ROI mask empty
        roi_pixels = gray.ravel()

    mean_lum = float(np.mean(roi_pixels))
    if mean_lum < min_luminance:
        return FrameHealthReport(False, 0.0, mean_lum, 0.0, "SENSOR_BLACKOUT_OR_UNLIT")

    glare_ratio = float(np.sum(roi_pixels >= 248) / roi_pixels.size)
    if glare_ratio > max_glare_ratio:
        return FrameHealthReport(False, 0.0, mean_lum, glare_ratio, "SEVERE_HEADLAMP_OR_SUN_GLARE")

    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    roi_lap = laplacian[small_mask > 0] if np.any(small_mask > 0) else laplacian.ravel()
    blur_var = float(np.var(roi_lap))
    # Night scenes naturally have sparser edges; relax blur threshold slightly at low luminance
    effective_blur_min = min_blur_var * (0.55 if mean_lum < 45.0 else 1.0)
    if blur_var < effective_blur_min:
        return FrameHealthReport(False, blur_var, mean_lum, glare_ratio, "LENS_BLUR_FOG_OR_OCCLUSION")

    return FrameHealthReport(True, blur_var, mean_lum, glare_ratio, "NONE")
