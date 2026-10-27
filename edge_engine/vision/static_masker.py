"""
Static Obstruction Masker for Pravaah AI.
Filters parked fruit carts, broken-down auto-rickshaws, and stationary vendor stalls across 3 green cycles.
"""
from typing import List, Tuple
from edge_engine.vision.polygon_roi import DetectedObject


class StaticObstructionMasker:
    """Tracks static candidates across consecutive green phase discharges."""

    def __init__(self, persistence_cycles: int = 3, iou_thresh: float = 0.88):
        self.persistence_cycles = persistence_cycles
        self.iou_thresh = iou_thresh
        self._candidates: List[Tuple[Tuple[int, int, int, int], int]] = []
        self._ignored_boxes: List[Tuple[int, int, int, int]] = []

    @staticmethod
    def _box_iou(box_a: Tuple[int, int, int, int], box_b: Tuple[int, int, int, int]) -> float:
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

    def on_phase_cycle_end(self, current_detections: List[DetectedObject]) -> None:
        new_candidates: List[Tuple[Tuple[int, int, int, int], int]] = []
        for det in current_detections:
            box = det.bbox_xyxy
            matched_count = 1
            for cand_box, count in self._candidates:
                if self._box_iou(box, cand_box) >= self.iou_thresh:
                    matched_count = count + 1
                    break
            new_candidates.append((box, matched_count))

        self._candidates = new_candidates
        self._ignored_boxes = [box for box, count in new_candidates if count >= self.persistence_cycles]

    def is_static(self, bbox: Tuple[int, int, int, int]) -> bool:
        return any(self._box_iou(bbox, ign) >= self.iou_thresh for ign in self._ignored_boxes)

    @property
    def ignored_boxes(self) -> List[Tuple[int, int, int, int]]:
        return list(self._ignored_boxes)
