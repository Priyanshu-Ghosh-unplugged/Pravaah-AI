"""
Hardware Watchdog Heartbeat for Pravaah AI.
Generates a 5 Hz pulse train to maintain the monostable watchdog relay state.
"""
import threading
import time
from typing import Callable, Optional


class WatchdogHeartbeat:
    """Independent supervisor thread pulsing the failover contactor at 5 Hz."""

    def __init__(self, pulse_fn: Callable[[], None], frequency_hz: float = 5.0):
        self.pulse_fn = pulse_fn
        self.interval = 1.0 / frequency_hz
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=1.0)

    def _run(self) -> None:
        while not self._stop_event.is_set():
            try:
                self.pulse_fn()
            except Exception as e:
                print(f"[WatchdogHeartbeat] Pulse failed: {e}")
            time.sleep(self.interval)
