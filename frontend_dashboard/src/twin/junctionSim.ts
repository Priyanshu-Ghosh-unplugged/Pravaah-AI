/**
 * Browser-side port of the edge controller (edge_engine/controller + edge_engine/simulation).
 * Drives the dashboard when the edge engine is unreachable, and the standalone traffic_demo.html,
 * so both offline modes sequence signals exactly like the real 10 Hz FSM.
 */
import {
  ApproachId,
  ImpactKpis,
  LiveJunctionSnapshot,
  PhaseState,
  QueuedVehicle,
  SignalColor,
  VehicleKind,
  VisionApproachMetrics,
} from "../types";

export const APPROACH_ORDER: ApproachId[] = ["NORTH", "EAST", "SOUTH", "WEST"];

export type PresetName = "rush_asymmetric" | "late_night" | "starvation_test" | "reset_normal";
export type LaneField = "bikes" | "cars" | "buses";

export const KIND_PCU: Record<VehicleKind, number> = {
  two_wheeler: 0.5,
  car_lmv: 1.0,
  bus_truck_hmv: 3.0,
  ambulance_emergency: 1.5,
};

const FIELD_KIND: Record<LaneField, VehicleKind> = {
  bikes: "two_wheeler",
  cars: "car_lmv",
  buses: "bus_truck_hmv",
};

// configs/junction_kol_04.yaml
export const TIMING = {
  amberSec: 3.0,
  allRedSec: 2.0,
  minGreenSec: 10.0,
  maxGreenSec: 60.0,
  gapOutSec: 3.5,
  emergencyMinSafeGreenSec: 6.0,
  startupLostSec: 4.5,
  dischargeStartupSec: 2.0,
  alphaAging: 0.45,
  starvationCapSec: 95.0,
  shadowFixedGreenSec: 45.0,
};

const APPROACH_WIDTH_M: Record<ApproachId, number> = { NORTH: 7.0, EAST: 6.0, SOUTH: 7.0, WEST: 5.5 };

// Mirrors edge_engine/simulation/lane_queues.py and edge_engine/api/server.py
export const ARRIVAL_PROFILES: Record<PresetName, Record<ApproachId, number>> = {
  reset_normal: { NORTH: 0.14, EAST: 0.1, SOUTH: 0.12, WEST: 0.07 },
  rush_asymmetric: { NORTH: 0.22, EAST: 0.06, SOUTH: 0.0, WEST: 0.09 },
  late_night: { NORTH: 0.01, EAST: 0.01, SOUTH: 0.0, WEST: 0.02 },
  starvation_test: { NORTH: 0.2, EAST: 0.01, SOUTH: 0.17, WEST: 0.0 },
};

const PRESET_COUNTS: Record<PresetName, Record<ApproachId, [number, number, number]>> = {
  rush_asymmetric: { NORTH: [12, 14, 2], EAST: [4, 3, 0], SOUTH: [0, 0, 0], WEST: [6, 6, 1] },
  late_night: { NORTH: [0, 0, 0], EAST: [0, 0, 0], SOUTH: [0, 0, 0], WEST: [2, 1, 0] },
  starvation_test: { NORTH: [16, 15, 3], EAST: [0, 1, 0], SOUTH: [14, 12, 2], WEST: [0, 0, 0] },
  reset_normal: { NORTH: [8, 7, 2], EAST: [6, 5, 1], SOUTH: [5, 6, 1], WEST: [7, 5, 1] },
};

const ARRIVAL_MIX: [VehicleKind, number][] = [
  ["two_wheeler", 0.45],
  ["car_lmv", 0.43],
  ["bus_truck_hmv", 0.12],
];
const MAX_QUEUE_VEHICLES = 22;

export function saturationRatePcuPerSec(widthM: number): number {
  return (525.0 * Math.max(3.5, widthM) * 0.85) / 3600.0;
}

export function dynamicGreenSec(pcu: number, widthM: number, emergency: boolean): number {
  if (pcu <= 0 && !emergency) return 0;
  const raw = TIMING.startupLostSec + pcu / saturationRatePcuPerSec(widthM);
  return Math.max(TIMING.minGreenSec, Math.min(TIMING.maxGreenSec, Math.round(raw)));
}

export function priorityScore(pcu: number, waitSec: number, emergency: boolean): number {
  if (emergency) return 10_000 + waitSec;
  if (pcu <= 0) return -1;
  const starvationBoost = waitSec >= TIMING.starvationCapSec ? 500 : 0;
  return +(pcu + TIMING.alphaAging * waitSec + starvationBoost).toFixed(2);
}

interface Lane {
  queue: QueuedVehicle[];
  ambulance: boolean;
  pedestrians: number;
}

/** Port of edge_engine/controller/shadow_fixed.py (45 s fixed-time counterfactual). */
class ShadowFixedTimer {
  private queues: Record<ApproachId, number> = { NORTH: 0, EAST: 0, SOUTH: 0, WEST: 0 };
  private prevPcu: Record<ApproachId, number> = { NORTH: 0, EAST: 0, SOUTH: 0, WEST: 0 };
  private activeIdx = 0;
  private inIntergreen = false;
  private timer = 0;
  private adaptivePcuSec = 0;
  private fixedPcuSec = 0;

  update(dt: number, livePcu: Record<ApproachId, number>, adaptiveGreen: ApproachId | null): ImpactKpis {
    for (const app of APPROACH_ORDER) {
      if (app !== adaptiveGreen) this.queues[app] += Math.max(0, livePcu[app] - this.prevPcu[app]);
      else this.queues[app] += 0.05 * dt;
      this.prevPcu[app] = livePcu[app];
    }
    this.timer += dt;
    const shadowApp = APPROACH_ORDER[this.activeIdx];
    if (!this.inIntergreen) {
      this.queues[shadowApp] = Math.max(0, this.queues[shadowApp] - 0.95 * dt);
      if (this.timer >= TIMING.shadowFixedGreenSec) {
        this.inIntergreen = true;
        this.timer = 0;
      }
    } else if (this.timer >= TIMING.amberSec + TIMING.allRedSec) {
      this.inIntergreen = false;
      this.timer = 0;
      this.activeIdx = (this.activeIdx + 1) % 4;
    }

    const adaptiveWaiting = APPROACH_ORDER.reduce((acc, a) => acc + (a !== adaptiveGreen ? livePcu[a] : 0), 0);
    const fixedWaiting = APPROACH_ORDER.reduce(
      (acc, a) => acc + (this.inIntergreen || a !== shadowApp ? this.queues[a] : 0),
      0,
    );
    this.adaptivePcuSec += adaptiveWaiting * dt;
    this.fixedPcuSec += fixedWaiting * dt;

    const savedPcuSec = Math.max(0, this.fixedPcuSec - this.adaptivePcuSec);
    const savedHours = savedPcuSec / 3600;
    const fuel = savedHours * 0.58;
    return {
      wait_reduction_pct: +(this.fixedPcuSec > 10 ? (savedPcuSec / this.fixedPcuSec) * 100 : 0).toFixed(1),
      pcu_hours_saved: +savedHours.toFixed(2),
      fuel_saved_litres: +fuel.toFixed(2),
      co2_avoided_kg: +(fuel * 2.45).toFixed(2),
    };
  }
}

export class JunctionSimulator {
  readonly junctionId: string;

  private phase: PhaseState = "ALL_RED_IDLE";
  private active: ApproachId | null = null;
  private queuedNext: ApproachId | null = null;
  private elapsed = 0;
  private allocated = 0;
  private zeroQueueStreak = 0;
  private served = new Set<ApproachId>();
  private wait: Record<ApproachId, number> = { NORTH: 0, EAST: 0, SOUTH: 0, WEST: 0 };
  private skipped = 0;
  private emergencyPreemptions = 0;
  private manualOverride: ApproachId | null = null;

  private lanes = {} as Record<ApproachId, Lane>;
  private arrivalRates: Record<ApproachId, number> = { ...ARRIVAL_PROFILES.reset_normal };
  private dischargeCredit: Record<ApproachId, number> = { NORTH: 0, EAST: 0, SOUTH: 0, WEST: 0 };
  private nextVehicleId = 1;
  private shadow = new ShadowFixedTimer();
  private kpis: ImpactKpis = { wait_reduction_pct: 0, pcu_hours_saved: 0, fuel_saved_litres: 0, co2_avoided_kg: 0 };

  constructor(junctionId = "IND-WB-KOL-004") {
    this.junctionId = junctionId;
    for (const app of APPROACH_ORDER) this.lanes[app] = { queue: [], ambulance: false, pedestrians: 0 };
    this.applyPreset("reset_normal");
    this.step(0.1);
  }

  // ---------------------------------------------------------------- scenario controls

  applyPreset(name: PresetName): void {
    for (const app of APPROACH_ORDER) {
      const [bikes, cars, buses] = PRESET_COUNTS[name][app];
      this.setLaneCounts(app, { bikes, cars, buses });
      this.lanes[app].ambulance = false;
      this.syncAmbulance(app);
    }
    this.arrivalRates = { ...ARRIVAL_PROFILES[name] };
  }

  setLaneCounts(app: ApproachId, counts: Partial<Record<LaneField, number>>): void {
    const queue = this.lanes[app].queue;
    (Object.keys(FIELD_KIND) as LaneField[]).forEach((field) => {
      const want = counts[field];
      if (want === undefined) return;
      const kind = FIELD_KIND[field];
      let have = queue.filter((v) => v.kind === kind).length;
      while (have < want) {
        queue.push({ id: this.nextVehicleId++, kind });
        have++;
      }
      while (have > Math.max(0, want)) {
        // Remove the rear-most vehicle of that class
        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i].kind === kind) {
            queue.splice(i, 1);
            break;
          }
        }
        have--;
      }
    });
  }

  setAmbulance(app: ApproachId, active: boolean): void {
    this.lanes[app].ambulance = active;
    if (active && this.lanes[app].queue.length === 0) this.setLaneCounts(app, { cars: 3 });
    this.syncAmbulance(app);
  }

  forceApproach(app: ApproachId | null): void {
    this.manualOverride = app;
  }

  /** Ends the running green early (through the normal amber + all-red interlock). */
  endCurrentGreen(): void {
    if (this.phase === "PHASE_GREEN" && this.elapsed >= TIMING.emergencyMinSafeGreenSec) {
      this.allocated = this.elapsed;
    }
  }

  /** Continues from a snapshot received from the edge engine so a disconnect is seamless. */
  adopt(snapshot: LiveJunctionSnapshot): void {
    for (const app of APPROACH_ORDER) {
      const vis = snapshot.vision[app];
      const lane = this.lanes[app];
      lane.queue = vis.queue
        ? vis.queue.map((v) => ({ id: v.id, kind: v.kind }))
        : [];
      if (!vis.queue) {
        this.setLaneCounts(app, {
          bikes: vis.counts.two_wheeler,
          cars: vis.counts.car_lmv,
          buses: vis.counts.bus_truck_hmv,
        });
      }
      lane.ambulance = vis.emergency_visual;
      this.syncAmbulance(app);
      this.wait[app] = snapshot.fsm.wait_timers[app] ?? 0;
    }
    for (const v of APPROACH_ORDER.flatMap((a) => this.lanes[a].queue)) {
      if (typeof v.id === "number") this.nextVehicleId = Math.max(this.nextVehicleId, v.id + 1);
    }
    const fsm = snapshot.fsm;
    if (fsm.phase_state !== "FALLBACK_FIXED_ROTATION") this.phase = fsm.phase_state;
    this.active = fsm.active_approach;
    this.allocated = fsm.allocated_green_sec;
    const target = this.targetDuration();
    this.elapsed = Math.max(0, target - fsm.remaining_sec);
    this.served = new Set(fsm.cycle_served ?? (fsm.active_approach ? [fsm.active_approach] : []));
    this.skipped = fsm.skipped_phases_count;
    this.emergencyPreemptions = fsm.emergency_preemptions_count;
    this.kpis = snapshot.impact_kpis;
  }

  // ---------------------------------------------------------------- simulation tick

  step(dt: number): void {
    // 1. Arrivals at the back of each queue
    for (const app of APPROACH_ORDER) {
      const lane = this.lanes[app];
      const rate = this.arrivalRates[app];
      if (rate <= 0 || lane.queue.length >= MAX_QUEUE_VEHICLES || Math.random() >= rate * dt) continue;
      let roll = Math.random();
      let kind: VehicleKind = ARRIVAL_MIX[ARRIVAL_MIX.length - 1][0];
      for (const [candidate, share] of ARRIVAL_MIX) {
        if (roll < share) {
          kind = candidate;
          break;
        }
        roll -= share;
      }
      lane.queue.push({ id: this.nextVehicleId++, kind });
    }

    // 2. Discharge from the front of the green approach at saturation flow
    const greenApp = this.phase === "PHASE_GREEN" ? this.active : null;
    for (const app of APPROACH_ORDER) {
      if (app !== greenApp) {
        this.dischargeCredit[app] = 0;
        continue;
      }
      if (this.elapsed < TIMING.dischargeStartupSec) continue;
      const lane = this.lanes[app];
      let credit = this.dischargeCredit[app] + saturationRatePcuPerSec(APPROACH_WIDTH_M[app]) * dt;
      while (lane.queue.length && credit >= KIND_PCU[lane.queue[0].kind]) {
        const vehicle = lane.queue.shift()!;
        credit -= KIND_PCU[vehicle.kind];
        if (vehicle.kind === "ambulance_emergency") lane.ambulance = false;
      }
      this.dischargeCredit[app] = lane.queue.length ? credit : 0;
    }

    // 3. Controller
    this.fsmStep(dt);

    // 4. Shadow fixed-timer KPIs
    const pcu = this.pcuByApproach();
    this.kpis = this.shadow.update(dt, pcu, this.phase === "PHASE_GREEN" ? this.active : null);
  }

  snapshot(): LiveJunctionSnapshot {
    const pcu = this.pcuByApproach();
    const vision = {} as Record<ApproachId, VisionApproachMetrics>;
    for (const app of APPROACH_ORDER) {
      const q = this.lanes[app].queue;
      const count = (kind: VehicleKind) => q.filter((v) => v.kind === kind).length;
      const bikes = count("two_wheeler");
      const cars = count("car_lmv");
      const buses = count("bus_truck_hmv");
      vision[app] = {
        counts: {
          two_wheeler: bikes,
          car_lmv: cars,
          auto_rickshaw: Math.floor(cars * 0.3),
          bus_truck_hmv: buses,
          ambulance_emergency: count("ambulance_emergency"),
        },
        queue: q.map((v) => ({ ...v })),
        discrete_pcu: pcu[app],
        effective_pcu: pcu[app],
        occupancy_ratio: +Math.min(1, bikes * 0.02 + cars * 0.05 + buses * 0.12).toFixed(3),
        pedestrians_in_crosswalk: this.lanes[app].pedestrians,
        emergency_visual: this.lanes[app].ambulance,
        healthy: true,
      };
    }

    const lights = { NORTH: "RED", EAST: "RED", SOUTH: "RED", WEST: "RED" } as Record<ApproachId, SignalColor>;
    if (this.active && this.phase === "PHASE_GREEN") lights[this.active] = "GREEN";
    if (this.active && this.phase === "PHASE_AMBER") lights[this.active] = "AMBER";

    const priority = {} as Record<ApproachId, number>;
    const waits = {} as Record<ApproachId, number>;
    for (const app of APPROACH_ORDER) {
      priority[app] = priorityScore(pcu[app], this.wait[app], this.lanes[app].ambulance);
      waits[app] = +this.wait[app].toFixed(1);
    }

    return {
      junction_id: this.junctionId,
      fsm: {
        phase_state: this.phase,
        active_approach: this.active,
        next_approach: this.predictNext(),
        cycle_served: APPROACH_ORDER.filter((a) => this.served.has(a)),
        lights,
        remaining_sec: +Math.max(0, this.targetDuration() - this.elapsed).toFixed(1),
        allocated_green_sec: this.allocated,
        wait_timers: waits,
        priority_scores: priority,
        skipped_phases_count: this.skipped,
        emergency_preemptions_count: this.emergencyPreemptions,
      },
      vision,
      impact_kpis: this.kpis,
    };
  }

  // ---------------------------------------------------------------- FSM (state_machine.py)

  private fsmStep(dt: number): void {
    const pcu = this.pcuByApproach();
    for (const app of APPROACH_ORDER) {
      const isGreen = this.phase === "PHASE_GREEN" && this.active === app;
      if (isGreen) this.wait[app] = 0;
      else if (pcu[app] > 0) this.wait[app] += dt;
      else this.wait[app] = 0;
    }
    this.elapsed += dt;

    const emergencyApp = APPROACH_ORDER.find((a) => this.lanes[a].ambulance) ?? null;
    const urgent = this.manualOverride ?? emergencyApp;

    if (this.phase === "ALL_RED_IDLE") {
      // Rest on all-red while the junction is empty; wake as soon as anything arrives
      const next = urgent ?? this.selectInCycle(null);
      if (next) this.enterGreen(next);
    } else if (this.phase === "PHASE_GREEN" && this.active) {
      const current = this.active;
      this.zeroQueueStreak = pcu[current] === 0 ? this.zeroQueueStreak + dt : 0;

      if (urgent && urgent !== current) {
        if (this.elapsed >= TIMING.emergencyMinSafeGreenSec) {
          this.queuedNext = urgent;
          this.emergencyPreemptions++;
          this.enterAmber();
        }
      } else if (urgent === current) {
        if (this.elapsed >= 60) {
          this.manualOverride = null;
          this.enterAmber();
        } else {
          this.allocated = Math.max(this.allocated, this.elapsed + 5);
        }
      } else {
        const gapOut = this.elapsed >= TIMING.minGreenSec && this.zeroQueueStreak >= TIMING.gapOutSec;
        const expired = this.elapsed >= this.allocated;
        if (gapOut || expired) {
          const other = this.selectInCycle(current);
          if (other === null && pcu[current] > 0) {
            this.allocated = dynamicGreenSec(pcu[current], APPROACH_WIDTH_M[current], false);
            this.elapsed = 0;
          } else {
            this.queuedNext = other;
            this.enterAmber();
          }
        }
      }
    } else if (this.phase === "PHASE_AMBER") {
      if (this.elapsed >= TIMING.amberSec) {
        this.phase = "INTERGREEN_ALL_RED";
        this.elapsed = 0;
      }
    } else if (this.phase === "INTERGREEN_ALL_RED") {
      if (this.elapsed >= TIMING.allRedSec) {
        const chosen = urgent ?? this.selectInCycle(null) ?? this.queuedNext;
        if (!chosen) {
          this.phase = "ALL_RED_IDLE";
          this.elapsed = 0;
        } else {
          if (this.active) {
            const idx = APPROACH_ORDER.indexOf(this.active);
            for (let offset = 1; offset < 4; offset++) {
              const cand = APPROACH_ORDER[(idx + offset) % 4];
              if (cand === chosen) break;
              if (pcu[cand] === 0 && !this.lanes[cand].ambulance) this.skipped++;
            }
          }
          this.enterGreen(chosen);
        }
      }
    }
  }

  /** Unserved approaches first (by priority); a starving approach may always jump the queue. */
  private selectInCycle(exclude: ApproachId | null): ApproachId | null {
    const candidates = APPROACH_ORDER.filter((a) => a !== exclude);
    const pending = candidates.filter((a) => !this.served.has(a) || this.wait[a] >= TIMING.starvationCapSec);
    return this.selectByPriority(pending) ?? this.selectByPriority(candidates);
  }

  private selectByPriority(apps: ApproachId[]): ApproachId | null {
    const pcu = this.pcuByApproach();
    let best: ApproachId | null = null;
    let bestScore = -Infinity;
    let bestWait = -Infinity;
    for (const app of apps) {
      const score = priorityScore(pcu[app], this.wait[app], this.lanes[app].ambulance);
      if (score < 0) continue;
      const adjusted = score + (app === this.active ? -0.1 : 0);
      if (adjusted > bestScore || (adjusted === bestScore && this.wait[app] > bestWait)) {
        best = app;
        bestScore = adjusted;
        bestWait = this.wait[app];
      }
    }
    return best;
  }

  private predictNext(): ApproachId | null {
    const urgent = this.manualOverride ?? APPROACH_ORDER.find((a) => this.lanes[a].ambulance) ?? null;
    if (urgent && urgent !== this.active) return urgent;
    return this.selectInCycle(this.phase === "PHASE_GREEN" ? this.active : null);
  }

  private enterGreen(app: ApproachId): void {
    const pcu = this.pcuByApproach();
    const othersPending = APPROACH_ORDER.some(
      (a) => a !== app && !this.served.has(a) && (pcu[a] > 0 || this.lanes[a].ambulance),
    );
    if (this.served.has(app) && !othersPending) this.served.clear();
    this.served.add(app);

    this.active = app;
    this.phase = "PHASE_GREEN";
    this.elapsed = 0;
    this.zeroQueueStreak = 0;
    this.queuedNext = null;
    this.allocated = Math.max(10, dynamicGreenSec(pcu[app], APPROACH_WIDTH_M[app], this.lanes[app].ambulance));
  }

  private enterAmber(): void {
    this.phase = "PHASE_AMBER";
    this.elapsed = 0;
  }

  private targetDuration(): number {
    if (this.phase === "PHASE_GREEN") return this.allocated;
    if (this.phase === "PHASE_AMBER") return TIMING.amberSec;
    if (this.phase === "INTERGREEN_ALL_RED") return TIMING.allRedSec;
    return 0;
  }

  private syncAmbulance(app: ApproachId): void {
    const lane = this.lanes[app];
    const has = lane.queue.some((v) => v.kind === "ambulance_emergency");
    if (lane.ambulance && !has) lane.queue.unshift({ id: this.nextVehicleId++, kind: "ambulance_emergency" });
    if (!lane.ambulance && has) lane.queue = lane.queue.filter((v) => v.kind !== "ambulance_emergency");
  }

  private pcuByApproach(): Record<ApproachId, number> {
    const out = {} as Record<ApproachId, number>;
    for (const app of APPROACH_ORDER) {
      out[app] = +this.lanes[app].queue.reduce((acc, v) => acc + KIND_PCU[v.kind], 0).toFixed(2);
    }
    return out;
  }
}
