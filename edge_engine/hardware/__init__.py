"""Hardware Abstraction Layer & PLC Relay Driver Package."""
from edge_engine.hardware.relay_interface import HardwareRelayDriver
from edge_engine.hardware.watchdog_heartbeat import WatchdogHeartbeat

__all__ = ["HardwareRelayDriver", "WatchdogHeartbeat"]
