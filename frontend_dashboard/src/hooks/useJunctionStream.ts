import { useEffect, useRef, useState } from "react";
import { LiveJunctionSnapshot } from "../types";

export function useJunctionStream(wsUrl: string) {
  const [snapshot, setSnapshot] = useState<LiveJunctionSnapshot | null>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const retryDelayRef = useRef<number>(1000);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;
    let reconnectTimer: number | undefined;

    const connect = () => {
      if (cancelled) return;
      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setConnected(true);
          retryDelayRef.current = 1000;
        };

        ws.onmessage = (evt) => {
          try {
            const parsed: LiveJunctionSnapshot = JSON.parse(evt.data);
            setSnapshot(parsed);
          } catch {
            // Ignore malformed transient frames
          }
        };

        ws.onclose = () => {
          setConnected(false);
          if (!cancelled) {
            reconnectTimer = window.setTimeout(() => {
              retryDelayRef.current = Math.min(8000, retryDelayRef.current * 1.5);
              connect();
            }, retryDelayRef.current);
          }
        };

        ws.onerror = () => {
          setConnected(false);
        };
      } catch {
        setConnected(false);
      }
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [wsUrl]);

  return { snapshot, connected };
}
