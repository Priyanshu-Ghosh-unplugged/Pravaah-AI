export type ApproachId = "NORTH" | "EAST" | "SOUTH" | "WEST";
export type SignalColor = "RED" | "AMBER" | "GREEN";
export type PhaseState =
  | "ALL_RED_IDLE"
  | "PHASE_GREEN"
  | "PHASE_AMBER"
  | "INTERGREEN_ALL_RED"
  | "FALLBACK_FIXED_ROTATION";

export interface VehicleCounts {
  two_wheeler: number;
  car_lmv: number;
  auto_rickshaw: number;
  bus_truck_hmv: number;
  ambulance_emergency: number;
}

export type VehicleKind = "two_wheeler" | "car_lmv" | "bus_truck_hmv" | "ambulance_emergency";

/** One vehicle waiting at the stop line; queue arrays are ordered front-of-queue first. */
export interface QueuedVehicle {
  id: number | string;
  kind: VehicleKind;
}

export interface VisionApproachMetrics {
  counts: VehicleCounts;
  queue?: QueuedVehicle[];
  discrete_pcu: number;
  occupancy_ratio: number;
  effective_pcu: number;
  pedestrians_in_crosswalk: number;
  emergency_visual: boolean;
  healthy: boolean;
}

export interface FsmStateSnapshot {
  phase_state: PhaseState;
  active_approach: ApproachId | null;
  next_approach?: ApproachId | null;
  cycle_served?: ApproachId[];
  lights: Record<ApproachId, SignalColor>;
  remaining_sec: number;
  allocated_green_sec: number;
  wait_timers: Record<ApproachId, number>;
  priority_scores: Record<ApproachId, number>;
  skipped_phases_count: number;
  emergency_preemptions_count: number;
}

export interface ImpactKpis {
  wait_reduction_pct: number;
  pcu_hours_saved: number;
  fuel_saved_litres: number;
  co2_avoided_kg: number;
}

export interface LiveJunctionSnapshot {
  junction_id: string;
  fsm: FsmStateSnapshot;
  vision: Record<ApproachId, VisionApproachMetrics>;
  impact_kpis: ImpactKpis;
}

export interface CitizenTicket {
  ticket_id: string;
  junction_id: string;
  created_at_utc: string;
  issue_category: "BULB_OUT" | "WATERLOGGING" | "OBSTRUCTION" | "BUZZER_SILENT";
  approach_hint?: ApproachId;
  citizen_note?: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
}
