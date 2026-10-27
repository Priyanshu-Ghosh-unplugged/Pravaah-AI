"""
Polygon ROI Ray-Casting, Static Obstruction Masking & Hybrid PCU Engine.
Applies IRC:106 Passenger Car Unit weights, point-in-polygon tests, and area-density fallback.
"""
from collections import deque
from dataclasses import dataclass
from typing import Dict, List, Tuple
import cv2
import numpy as np


@dataclass
class DetectedObject:
    class_name: str
    confidence: float
    bbox_xyxy: Tuple[int, int, int, int]  # (x1, y1, x2, y2)

    @property
    def ground_anchor(self) -> Tuple[float, float]:
        """Bottom-center tire/foot contact point avoids perspective height drift of tall vehicles."""
        x1, y1, x2, y2 = self.bbox_xyxy
        return ((x1 + x2) * 0.5, float(y2))


class PolygonZoneAnalyzer:
    """Computes point-in-polygon queue inclusion, static hawker/breakdown filtering, and hybrid PCU."""

    def __init__(
        self,
        frame_width: int,
        frame_height: int,
        queue_poly_norm: List[List[float]],
        crosswalk_poly_norm: List[List[float]],
        pcu_weights: Dict[str, float],
        max_roi_saturation_pcu: float,
        smoothing_window: int = 5,
    ):
        self.w = frame_width
        self.h = frame_height
        self.pcu_weights = pcu_weights
        self.max_roi_saturation_pcu = max_roi_saturation_pcu

        self.queue_poly = np.array(
            [[int(x * frame_width), int(y * frame_height)] for x, y in queue_poly_norm],
            dtype=np.int32,
        )
        self.crosswalk_poly = np.array(
            [[int(x * frame_width), int(y * frame_height)] for x, y in crosswalk_poly_norm],
            dtype=np.int32,
        )

        self.queue_mask = np.zeros((frame_height, frame_width), dtype=np.uint8)
        cv2.fillPoly(self.queue_mask, [self.queue_poly], 255)
        self.queue_area_px = max(1, int(np.count_nonzero(self.queue_mask)))

        self._history_pcu: deque[float] = deque(maxlen=smoothing_window)
        self._static_candidates: List[Tuple[Tuple[int, int, int, int], int]] = []
        self.ignored_static_boxes: List[Tuple[int, int, int, int]] = []

    @staticmethod
    def _iou(box_a: Tuple[int, int, int, int], box_b: Tuple[int, int, int, int]) -> float:
        x_a = max(box_a[0], box_b[0])
        y_a = max(box_a[1], box_b[1])
        x_b = min(box_a[2], box_b[2])
        y_b = min(box_a[3], box_b[3])
        inter = max(0, x_b - x_a) * max(0, y_b - y_a)
        if inter == 0:
            return 0.0
        area_a = (box_a[2] - box_a[0]) * (box_a[3] - box_a[1])
        area_b = (box_b[2] - box_b[0]) * (box_b[3] - box_b[1])
        return inter / float(area_a + area_b - inter)

    def notify_green_discharge_complete(self, end_of_green_detections: List[DetectedObject]) -> None:
        """Called at the end of a green phase: tracks unmoving carts/parked cars across 3 green cycles."""
        updated_candidates: List[Tuple[Tuple[int, int, int, int], int]] = []
        current_in_roi = [
            d.bbox_xyxy for d in end_of_green_detections
            if d.class_name in self.pcu_weights and self._in_polygon(self.queue_poly, d.ground_anchor)
        ]

        for box in current_in_roi:
            matched_cycles = 1
            for prev_box, prev_count in self._static_candidates:
                if self._iou(box, prev_box) >= 0.90:
                    matched_cycles = prev_count + 1
                    break
            updated_candidates.append((box, matched_cycles))

        self._static_candidates = updated_candidates
        self.ignored_static_boxes = [box for box, cycles in updated_candidates if cycles >= 3]

    def _is_static_obstruction(self, bbox: Tuple[int, int, int, int]) -> bool:
        return any(self._iou(bbox, ign) >= 0.88 for ign in self.ignored_static_boxes)

    @staticmethod
    def _in_polygon(poly: np.ndarray, pt: Tuple[float, float]) -> bool:
        return cv2.pointPolygonTest(poly, pt, measureDist=False) >= 0.0

    def evaluate_detections(self, detections: List[DetectedObject]) -> Dict[str, object]:
        counts = {k: 0 for k in self.pcu_weights}
        pedestrians_in_crosswalk = 0
        emergency_present = False
        occupancy_canvas = np.zeros((self.h, self.w), dtype=np.uint8)

        for det in detections:
            anchor = det.ground_anchor
            if det.class_name == "pedestrian":
                if self._in_polygon(self.crosswalk_poly, anchor):
                    pedestrians_in_crosswalk += 1
                continue

            if det.class_name not in self.pcu_weights:
                continue

            if not self._in_polygon(self.queue_poly, anchor):
                continue

            if det.class_name != "ambulance_emergency" and self._is_static_obstruction(det.bbox_xyxy):
                continue

            counts[det.class_name] += 1
            if det.class_name == "ambulance_emergency" and det.confidence >= 0.72:
                emergency_present = True

            x1, y1, x2, y2 = det.bbox_xyxy
            # Project lower 45% of bounding box as ground footprint to avoid tall bus roof over-counting
            foot_y1 = int(y1 + 0.55 * (y2 - y1))
            cv2.rectangle(occupancy_canvas, (x1, foot_y1), (x2, y2), 255, thickness=-1)

        masked_occ = cv2.bitwise_and(occupancy_canvas, self.queue_mask)
        occupancy_ratio = float(np.count_nonzero(masked_occ) / self.queue_area_px)

        discrete_pcu = sum(counts[cls_name] * weight for cls_name, weight in self.pcu_weights.items())
        # Hybrid density floor rescues severe occlusion when occupancy > 55%
        area_inferred_pcu = (
            occupancy_ratio * self.max_roi_saturation_pcu if occupancy_ratio > 0.55 else 0.0
        )
        raw_effective_pcu = round(max(discrete_pcu, area_inferred_pcu), 2)

        self._history_pcu.append(raw_effective_pcu)
        smoothed_pcu = float(np.median(self._history_pcu))
        if raw_effective_pcu == 0.0 and list(self._history_pcu)[-2:] == [0.0, 0.0]:
            smoothed_pcu = 0.0

        return {
            "counts": counts,
            "discrete_pcu": round(discrete_pcu, 2),
            "occupancy_ratio": round(occupancy_ratio, 3),
            "effective_pcu": round(smoothed_pcu, 2),
            "pedestrians_in_crosswalk": pedestrians_in_crosswalk,
            "emergency_visual": emergency_present,
            "static_obstructions_masked": len(self.ignored_static_boxes),
        }
