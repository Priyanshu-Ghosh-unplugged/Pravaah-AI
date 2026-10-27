"""
Zero-Lag Threaded RTSP & Synthetic Stream Capture for Pravaah AI.
Continuously drains frame buffer so inference always evaluates t=now frames without lag.
"""
import threading
import time
from typing import Optional, Tuple
import cv2
import numpy as np


class ZeroLagStreamReader:
    """Continuously drains RTSP/USB capture buffer so inference always sees t=now."""

    def __init__(self, approach_id: str, source: str | int, reconnect_sec: float = 3.0):
        self.approach_id = approach_id
        self.source = source
        self.reconnect_sec = reconnect_sec
        self._lock = threading.Lock()
        self._latest_frame: Optional[np.ndarray] = None
        self._latest_ts: float = 0.0
        self._connected: bool = False
        self._stop_event = threading.Event()
        self._is_synthetic = isinstance(source, str) and source.startswith("synthetic://")
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._thread.join(timeout=2.0)

    def _open_capture(self) -> Optional[cv2.VideoCapture]:
        if self._is_synthetic:
            return None
        try:
            cap = cv2.VideoCapture(self.source)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            return cap
        except Exception:
            return None

    def _generate_synthetic_frame(self, t: float) -> np.ndarray:
        """Generates a realistic 1280x720 road frame for simulation / dry-run testing."""
        frame = np.full((720, 1280, 3), (35, 38, 48), dtype=np.uint8)

        # Draw road asphalt
        cv2.rectangle(frame, (180, 0), (1100, 720), (55, 60, 70), -1)

        # Draw lane markings
        for y in range(0, 720, 60):
            cv2.line(frame, (640, y), (640, y + 35), (20, 200, 220), 3)

        # Draw zebra crossing
        for x in range(200, 1080, 45):
            cv2.rectangle(frame, (x, 620), (x + 30, 690), (220, 225, 230), -1)

        # Approach label
        cv2.putText(
            frame,
            f"Approach: {self.approach_id} | Stream: {self.source}",
            (30, 50),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (255, 255, 255),
            2,
        )

        return frame

    def _capture_loop(self) -> None:
        if self._is_synthetic:
            self._connected = True
            while not self._stop_event.is_set():
                frame = self._generate_synthetic_frame(time.monotonic())
                with self._lock:
                    self._latest_frame = frame
                    self._latest_ts = time.monotonic()
                time.sleep(0.066)  # ~15 FPS
            return

        cap = self._open_capture()
        while not self._stop_event.is_set():
            if cap is None or not cap.isOpened():
                self._connected = False
                if cap is not None:
                    cap.release()
                time.sleep(self.reconnect_sec)
                cap = self._open_capture()
                continue

            grabbed = cap.grab()
            if not grabbed:
                # Loop local demo video files seamlessly; reconnect live RTSP streams
                if isinstance(self.source, str) and self.source.endswith((".mp4", ".avi", ".mkv")):
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                self._connected = False
                cap.release()
                time.sleep(self.reconnect_sec)
                cap = self._open_capture()
                continue

            ok, frame = cap.retrieve()
            if ok and frame is not None:
                with self._lock:
                    self._latest_frame = frame
                    self._latest_ts = time.monotonic()
                    self._connected = True
            else:
                time.sleep(0.005)
        if cap is not None:
            cap.release()

    def get_latest_frame(self, max_age_sec: float = 2.0) -> Tuple[Optional[np.ndarray], bool]:
        """Returns (frame_copy, is_fresh). Never exposes internal mutable buffer."""
        with self._lock:
            if not self._connected or self._latest_frame is None:
                return None, False
            age = time.monotonic() - self._latest_ts
            if age > max_age_sec:
                return None, False
            return self._latest_frame.copy(), True
