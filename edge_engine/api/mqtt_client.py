"""
Resilient MQTT Telemetry Publisher for Pravaah AI.
Publishes IUDX-compatible traffic telemetry and corridor platoon coordination packets.
"""
import json
import logging
from typing import Any, Dict, Optional

logger = logging.getLogger("pravaah.mqtt")


class MqttTelemetryPublisher:
    """Publishes IUDX telemetry with offline buffering and auto-reconnection."""

    def __init__(
        self,
        broker_host: str = "localhost",
        broker_port: int = 1883,
        junction_id: str = "IND-WB-KOL-004",
        city: str = "kolkata",
    ):
        self.broker_host = broker_host
        self.broker_port = broker_port
        self.junction_id = junction_id
        self.city = city
        self.topic = f"iudx/mobility/{city}/{junction_id}/telemetry"
        self._client = None
        self._connected = False
        self._offline_queue: list[Dict[str, Any]] = []

    def connect(self) -> None:
        try:
            import paho.mqtt.client as mqtt
            self._client = mqtt.Client(client_id=f"pravaah_{self.junction_id}")
            self._client.on_connect = self._on_connect
            self._client.on_disconnect = self._on_disconnect
            self._client.connect_async(self.broker_host, self.broker_port, keepalive=60)
            self._client.loop_start()
        except ImportError:
            logger.info("paho-mqtt not installed. MQTT client running in mock log mode.")
        except Exception as e:
            logger.warning(f"Could not connect to MQTT broker {self.broker_host}:{self.broker_port}: {e}")

    def _on_connect(self, client, userdata, flags, rc) -> None:
        if rc == 0:
            self._connected = True
            logger.info(f"Connected to MQTT broker at {self.broker_host}:{self.broker_port}")
            # Flush offline queue
            while self._offline_queue:
                payload = self._offline_queue.pop(0)
                self.publish_telemetry(payload)
        else:
            self._connected = False

    def _on_disconnect(self, client, userdata, rc) -> None:
        self._connected = False
        logger.warning("Disconnected from MQTT broker.")

    def publish_telemetry(self, payload: Dict[str, Any]) -> None:
        if self._client and self._connected:
            try:
                self._client.publish(self.topic, json.dumps(payload), qos=1)
            except Exception as e:
                logger.error(f"Failed to publish MQTT message: {e}")
                self._offline_queue.append(payload)
        else:
            if len(self._offline_queue) < 1000:
                self._offline_queue.append(payload)

    def publish_platoon_advisory(self, target_junction: str, approach: str, packet: Dict[str, Any]) -> None:
        topic = f"pravaah/corridor/platoon/{target_junction}/{approach}"
        if self._client and self._connected:
            self._client.publish(topic, json.dumps(packet), qos=1)
        else:
            logger.debug(f"[Platoon Advisory] {topic}: {packet}")
