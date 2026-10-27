"""
SQLite WAL Local Database for Pravaah AI.
Stores offline telemetry ring buffer, citizen QR tickets, and hardware watchdog events.
"""
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


class LocalDatabase:
    """Manages high-speed WAL SQLite persistence on the edge unit."""

    def __init__(self, db_path: str = "data/pravaah_edge.db"):
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path) if os.path.dirname(db_path) else ".", exist_ok=True)
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10.0)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._get_connection() as conn:
            conn.executescript("""
            CREATE TABLE IF NOT EXISTS phase_telemetry_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                junction_id TEXT NOT NULL,
                recorded_at_utc TEXT NOT NULL,
                served_approach TEXT NOT NULL,
                allocated_green_sec REAL NOT NULL,
                actual_green_sec REAL NOT NULL,
                initial_pcu REAL NOT NULL,
                max_wait_any_lane_sec REAL NOT NULL,
                skipped_empty_count_delta INTEGER NOT NULL,
                emergency_preempted INTEGER NOT NULL DEFAULT 0,
                estimated_wait_saved_veh_sec REAL NOT NULL,
                estimated_fuel_saved_litres REAL NOT NULL,
                synced_to_cloud INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS citizen_qr_reports (
                ticket_id TEXT PRIMARY KEY,
                junction_id TEXT NOT NULL,
                created_at_utc TEXT NOT NULL,
                issue_category TEXT NOT NULL,
                approach_hint TEXT,
                citizen_note TEXT,
                gps_verified INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'OPEN'
            );

            CREATE TABLE IF NOT EXISTS sensor_watchdog_events (
                event_id INTEGER PRIMARY KEY AUTOINCREMENT,
                junction_id TEXT NOT NULL,
                occurred_at_utc TEXT NOT NULL,
                approach_id TEXT NOT NULL,
                failure_reason TEXT NOT NULL,
                blur_variance REAL,
                mean_luminance REAL,
                resolved_at_utc TEXT
            );
            """)

    def log_phase_telemetry(
        self,
        junction_id: str,
        served_approach: str,
        allocated_green_sec: float,
        actual_green_sec: float,
        initial_pcu: float,
        max_wait_any_lane_sec: float,
        skipped_empty_count_delta: int,
        emergency_preempted: bool,
        estimated_wait_saved_veh_sec: float,
        estimated_fuel_saved_litres: float,
    ) -> int:
        now_utc = datetime.now(timezone.utc).isoformat()
        with self._get_connection() as conn:
            cur = conn.execute(
                """
                INSERT INTO phase_telemetry_log (
                    junction_id, recorded_at_utc, served_approach, allocated_green_sec,
                    actual_green_sec, initial_pcu, max_wait_any_lane_sec,
                    skipped_empty_count_delta, emergency_preempted,
                    estimated_wait_saved_veh_sec, estimated_fuel_saved_litres
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    junction_id,
                    now_utc,
                    served_approach,
                    allocated_green_sec,
                    actual_green_sec,
                    initial_pcu,
                    max_wait_any_lane_sec,
                    skipped_empty_count_delta,
                    1 if emergency_preempted else 0,
                    estimated_wait_saved_veh_sec,
                    estimated_fuel_saved_litres,
                ),
            )
            return cur.lastrowid

    def add_citizen_ticket(
        self,
        ticket_id: str,
        junction_id: str,
        issue_category: str,
        approach_hint: Optional[str],
        citizen_note: Optional[str],
        gps_verified: bool = True,
    ) -> None:
        now_utc = datetime.now(timezone.utc).isoformat()
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO citizen_qr_reports (
                    ticket_id, junction_id, created_at_utc, issue_category,
                    approach_hint, citizen_note, gps_verified, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN')
                """,
                (
                    ticket_id,
                    junction_id,
                    now_utc,
                    issue_category,
                    approach_hint,
                    citizen_note,
                    1 if gps_verified else 0,
                ),
            )

    def list_citizen_tickets(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            rows = conn.execute(
                """
                SELECT ticket_id, junction_id, created_at_utc, issue_category,
                       approach_hint, citizen_note, gps_verified, status
                FROM citizen_qr_reports
                ORDER BY created_at_utc DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            return [dict(r) for r in rows]

    def log_watchdog_event(
        self,
        junction_id: str,
        approach_id: str,
        failure_reason: str,
        blur_variance: Optional[float] = None,
        mean_luminance: Optional[float] = None,
    ) -> int:
        now_utc = datetime.now(timezone.utc).isoformat()
        with self._get_connection() as conn:
            cur = conn.execute(
                """
                INSERT INTO sensor_watchdog_events (
                    junction_id, occurred_at_utc, approach_id, failure_reason,
                    blur_variance, mean_luminance
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (junction_id, now_utc, approach_id, failure_reason, blur_variance, mean_luminance),
            )
            return cur.lastrowid
