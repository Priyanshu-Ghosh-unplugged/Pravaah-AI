"""
Script exporting YOLOv8n.pt -> INT8 ONNX with calibration for Indian traffic conditions.
"""
import os
import sys

def export_edge_int8_model(weights_pt: str = "yolov8n.pt", data_yaml: str = "indian_traffic.yaml") -> None:
    """Exports YOLOv8-Nano to INT8 ONNX calibrated against Indian daylight/night intersection frames."""
    try:
        from ultralytics import YOLO
        model = YOLO(weights_pt)
        model.export(
            format="onnx",
            imgsz=640,
            int8=True,
            data=data_yaml,
            simplify=True,
            opset=17,
            dynamic=False,
        )
        print("Successfully exported INT8 ONNX model.")
    except ImportError:
        print("ultralytics package not installed. Skipping direct export.")

if __name__ == "__main__":
    export_edge_int8_model()
