# Models Directory — Pravaah AI

This directory houses the INT8-quantized YOLOv8-Nano models calibrated for Indian traffic scenarios (IDD, UVH-26, and custom CCTV pole frames).

## Files:
- `export_int8.py`: Post-training quantization calibration script converting `yolov8n.pt` into `yolov8n_indian_traffic_int8.onnx`.
- `yolov8n_indian_traffic_int8.onnx`: Exported INT8 ONNX graph with static input shapes (640x640) for Raspberry Pi 5 / Jetson Orin Nano edge execution.

## Export Recipe:
```bash
python -m models.export_int8
```
When running in testing or edge simulation mode without physical model weights, the engine seamlessly switches to synthetic traffic detection mode so formal tests and UI twins function 100% offline.
