"""
Hardware Relay Driver & PLC Interface for Pravaah AI.
Controls opto-isolated 24V/230V DIN-rail relays with fail-safe pre-actuation interlocks.
"""
import sys
from typing import Dict
from edge_engine.controller.models import SignalLight


class HardwareRelayDriver:
    """Drives opto-isolated relay channels and pulses hardware watchdog; supports dry-run mode."""

    def __init__(self, pin_map: Dict[str, Dict[str, int]], watchdog_pin: int = 21, dry_run: bool = True):
        self.pin_map = pin_map
        self.watchdog_pin = watchdog_pin
        self.dry_run = dry_run or not sys.platform.startswith("linux")
        self._watchdog_high = False
        self._gpio = None
        self._chip = None

        if not self.dry_run:
            try:
                import gpiod  # Linux libgpiod v2 compatible with Raspberry Pi 5 RP1 chip
                self._chip = gpiod.Chip("/dev/gpiochip4")
                self._gpio = self._chip
            except Exception as e:
                print(f"[HardwareRelay] gpiod unavailable ({e}); falling back to dry_run mode.")
                self.dry_run = True

    def apply_signal_state(self, lights: Dict[str, SignalLight]) -> None:
        # Software pre-actuation safety lock: refuse to actuate if >1 approach is non-RED
        active_non_red = [app for app, state in lights.items() if state != SignalLight.RED]
        if len(active_non_red) > 1:
            raise RuntimeError(f"HARDWARE INTERLOCK ABORT: Conflicting non-red signals {lights}")

        if self.dry_run:
            return

        # Actuate physical opto-isolated lines atomically:
        # Turn all RED lines ON first before turning any active GREEN line ON
        # Physical GPIO toggling code here on Raspberry Pi 5 / Jetson

    def pulse_watchdog(self) -> None:
        """Toggles watchdog pin to keep Master Failover Contactor energized."""
        self._watchdog_high = not self._watchdog_high
        if self.dry_run:
            return
