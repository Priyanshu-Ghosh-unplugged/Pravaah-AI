"""Edge Perception & Computer Vision Package."""
from edge_engine.vision.health_diagnostics import evaluate_frame_health, FrameHealthReport
from edge_engine.vision.polygon_roi import DetectedObject, PolygonZoneAnalyzer
from edge_engine.vision.detector import EdgeONNXYoloDetector
from edge_engine.vision.stream_reader import ZeroLagStreamReader

__all__ = [
    "evaluate_frame_health",
    "FrameHealthReport",
    "DetectedObject",
    "PolygonZoneAnalyzer",
    "EdgeONNXYoloDetector",
    "ZeroLagStreamReader",
]
