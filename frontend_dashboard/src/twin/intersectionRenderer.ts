/**
 * Canvas renderer for the 4-way junction digital twin.
 * Keeps a persistent sprite per queued vehicle (matched by vehicle id across snapshots), so
 * vehicles visibly roll up to the stop line, wait on red, and drive through the junction when
 * the controller discharges them on green. Traffic keeps left (Indian roads).
 */
import { ApproachId, LiveJunctionSnapshot, QueuedVehicle, SignalColor, VehicleCounts } from "../types";
import { DrawState, VehicleStyle, drawVehicle, hashId, roundRectPath, styleFor } from "./vehicleArt";

export const SCENE_SIZE = 640;

const APPROACHES: ApproachId[] = ["NORTH", "EAST", "SOUTH", "WEST"];
const C = SCENE_SIZE / 2;
const ROAD_HALF = 78;
const LANE_LAT = [20, 58]; // inner (median side) and outer (kerb side) lane centres
const LANE_SPLIT = 39;
const CROSSWALK_NEAR = ROAD_HALF + 5;
const CROSSWALK_FAR = ROAD_HALF + 23;
const STOP_LINE = ROAD_HALF + 27;
const STOP_DIST = STOP_LINE + 2; // front bumper rest position (distance from junction centre)
const ARM_LEN = C - STOP_DIST;
const QUEUE_GAP = 6;
const AMBER_SEC = 3;
const ALL_RED_SEC = 2;

const QUEUE_VMAX = 95;
const QUEUE_ACCEL = 140;
const QUEUE_DECEL = 220;
const DEPART_VMAX = 175;
const DEPART_ACCEL = 150;

interface Vec {
  x: number;
  y: number;
}
type Turn = "L" | "S" | "R";

// Direction of travel for vehicles entering from each approach
const DIR: Record<ApproachId, Vec> = {
  NORTH: { x: 0, y: 1 },
  SOUTH: { x: 0, y: -1 },
  EAST: { x: -1, y: 0 },
  WEST: { x: 1, y: 0 },
};
// Left-hand traffic: vehicles keep to the left of their direction of travel
const leftOf = (d: Vec): Vec => ({ x: d.y, y: -d.x });
const add = (a: Vec, b: Vec, k = 1): Vec => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const CENTRE: Vec = { x: C, y: C };

const COLORS = {
  GREEN: "#22c55e",
  AMBER: "#f59e0b",
  RED: "#ef4444",
  slate: "#64748b",
  text: "#f8fafc",
  muted: "#94a3b8",
};

interface Path {
  pts: Vec[];
  cum: number[];
  total: number;
}

interface Sprite {
  key: string;
  approach: ApproachId;
  style: VehicleStyle;
  turn: Turn;
  lane: 0 | 1;
  lat: number;
  latTarget: number;
  d: number; // distance of the front bumper behind the stop line
  targetD: number;
  speed: number;
  state: "queued" | "departing" | "vanishing";
  path?: Path;
  s: number;
  alpha: number;
}

function buildPath(points: Vec[]): Path {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return { pts: points, cum, total: cum[cum.length - 1] };
}

function pointOnPath(p: Path, s: number): { pos: Vec; heading: Vec } {
  let i = 1;
  while (i < p.pts.length - 1 && p.cum[i] < s) i++;
  const a = p.pts[i - 1];
  const b = p.pts[i];
  const segLen = p.cum[i] - p.cum[i - 1] || 1;
  const t = Math.min(1, Math.max(0, (s - p.cum[i - 1]) / segLen));
  return {
    pos: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
    heading: { x: (b.x - a.x) / segLen, y: (b.y - a.y) / segLen },
  };
}

/** Builds an ordered queue from bare counts when the backend sends no per-vehicle queue (camera mode). */
export function queueFromCounts(app: ApproachId, counts: VehicleCounts, emergency: boolean): QueuedVehicle[] {
  const items: { v: QueuedVehicle; order: number }[] = [];
  const spread = (kind: QueuedVehicle["kind"], n: number) => {
    for (let i = 0; i < n; i++) items.push({ v: { id: `${app}-${kind}-${i}`, kind }, order: (i + 0.5) / n });
  };
  spread("two_wheeler", counts.two_wheeler);
  spread("car_lmv", counts.car_lmv);
  spread("bus_truck_hmv", counts.bus_truck_hmv);
  items.sort((a, b) => a.order - b.order);
  const queue = items.map((i) => i.v);
  if (emergency) queue.unshift({ id: `${app}-ambulance`, kind: "ambulance_emergency" });
  return queue;
}

export class IntersectionRenderer {
  private ctx: CanvasRenderingContext2D;
  private staticLayer: HTMLCanvasElement;
  private dpr: number;
  private sprites = new Map<string, Sprite>();
  private snapshot: LiveJunctionSnapshot | null = null;
  private initialised = false;
  private rafId = 0;
  private lastTs = 0;
  private timeSec = 0;
  private overflow: Record<ApproachId, number> = { NORTH: 0, EAST: 0, SOUTH: 0, WEST: 0 };

  constructor(private canvas: HTMLCanvasElement) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = SCENE_SIZE * this.dpr;
    canvas.height = SCENE_SIZE * this.dpr;
    this.ctx = canvas.getContext("2d")!;
    this.staticLayer = document.createElement("canvas");
    this.staticLayer.width = canvas.width;
    this.staticLayer.height = canvas.height;
    const sctx = this.staticLayer.getContext("2d")!;
    sctx.scale(this.dpr, this.dpr);
    drawStaticScene(sctx);
  }

  start(): void {
    const loop = () => {
      const ts = performance.now();
      // Sub-step long gaps (background tab, slow device) so vehicles catch up with the controller
      let remaining = this.lastTs ? Math.min(3, (ts - this.lastTs) / 1000) : 0;
      this.lastTs = ts;
      while (remaining > 0) {
        const dt = Math.min(0.05, remaining);
        this.timeSec += dt;
        this.update(dt);
        remaining -= dt;
      }
      this.draw();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
  }

  setSnapshot(snapshot: LiveJunctionSnapshot): void {
    this.snapshot = snapshot;
    this.reconcile();
  }

  // ------------------------------------------------------------------ queue reconciliation

  private reconcile(): void {
    const snap = this.snapshot;
    if (!snap) return;
    for (const app of APPROACHES) {
      const vis = snap.vision[app];
      if (!vis) continue;
      const queue = vis.queue ?? queueFromCounts(app, vis.counts, vis.emergency_visual);
      const present = new Set<string>();
      const laneLen = [0, 0];
      const openBikeSlot: (Sprite | null)[] = [null, null];

      for (const v of queue) {
        const key = `${app}:${v.id}`;
        present.add(key);
        let sp = this.sprites.get(key);
        const isNew = !sp;
        if (!sp) {
          const h = hashId(v.id);
          const roll = (h >>> 3) % 20;
          const turn: Turn = v.kind === "ambulance_emergency" ? "S" : roll < 5 ? "L" : roll < 8 ? "R" : "S";
          // Left turners keep to the kerb lane, right turners to the median lane
          const lane: 0 | 1 = turn === "L" ? 1 : turn === "R" ? 0 : laneLen[0] <= laneLen[1] ? 0 : 1;
          sp = {
            key,
            approach: app,
            style: styleFor(v.kind, v.id),
            turn,
            lane,
            lat: LANE_LAT[lane],
            latTarget: LANE_LAT[lane],
            d: 0,
            targetD: 0,
            speed: 0,
            state: "queued",
            s: 0,
            alpha: 1,
          };
          this.sprites.set(key, sp);
        }
        if (sp.state !== "queued") continue;

        const lane = sp.lane;
        const slot = openBikeSlot[lane];
        if (sp.style.model === "bike" && slot) {
          // Two-wheelers filter in side by side
          sp.targetD = slot.targetD;
          slot.latTarget = LANE_LAT[lane] - 8;
          sp.latTarget = LANE_LAT[lane] + 8;
          openBikeSlot[lane] = null;
        } else {
          sp.targetD = laneLen[lane];
          sp.latTarget = LANE_LAT[lane];
          laneLen[lane] += sp.style.length + QUEUE_GAP;
          openBikeSlot[lane] = sp.style.model === "bike" ? sp : null;
        }

        if (isNew) {
          // New arrivals drive in from the edge of the scene; the very first frame starts settled
          sp.d = this.initialised ? Math.max(sp.targetD, ARM_LEN + 10) : sp.targetD;
          sp.speed = this.initialised ? QUEUE_VMAX * 0.8 : 0;
          sp.lat = sp.latTarget;
        }
      }

      this.overflow[app] = queue.filter((v) => {
        const sp = this.sprites.get(`${app}:${v.id}`);
        return sp && sp.targetD + sp.style.length > ARM_LEN;
      }).length;

      const light = snap.fsm.lights[app];
      for (const sp of this.sprites.values()) {
        if (sp.approach !== app || sp.state !== "queued" || present.has(sp.key)) continue;
        if (light === "GREEN" || light === "AMBER" || sp.d < 30) this.depart(sp);
        else sp.state = "vanishing";
      }
    }
    this.initialised = true;
  }

  private depart(sp: Sprite): void {
    const dir = DIR[sp.approach];
    const L = leftOf(dir);
    const start = this.queuedCentre(sp);
    let pts: Vec[];
    if (sp.turn === "S") {
      pts = [start, add(add(CENTRE, dir, C + 90), L, sp.lat)];
    } else {
      const dir2 = sp.turn === "L" ? L : { x: -L.x, y: -L.y };
      const lat2 = sp.turn === "L" ? LANE_LAT[1] : LANE_LAT[0];
      const entry = add(add(CENTRE, dir, -ROAD_HALF), L, sp.lat);
      const exit = add(add(CENTRE, dir2, ROAD_HALF), leftOf(dir2), lat2);
      const ctrl = add(entry, dir, dot({ x: exit.x - entry.x, y: exit.y - entry.y }, dir));
      pts = [start, entry];
      for (let i = 1; i <= 14; i++) {
        const t = i / 14;
        const u = 1 - t;
        pts.push({
          x: u * u * entry.x + 2 * u * t * ctrl.x + t * t * exit.x,
          y: u * u * entry.y + 2 * u * t * ctrl.y + t * t * exit.y,
        });
      }
      pts.push(add(exit, dir2, C + 90));
    }
    sp.path = buildPath(pts);
    sp.s = 0;
    sp.state = "departing";
  }

  private queuedCentre(sp: Sprite): Vec {
    const dir = DIR[sp.approach];
    return add(add(CENTRE, dir, -(STOP_DIST + sp.d + sp.style.length / 2)), leftOf(dir), sp.lat);
  }

  // ------------------------------------------------------------------ animation

  private update(dt: number): void {
    for (const sp of this.sprites.values()) {
      if (sp.state === "queued") {
        if (sp.d > sp.targetD) {
          const vStop = Math.sqrt(2 * QUEUE_DECEL * (sp.d - sp.targetD));
          sp.speed = Math.min(QUEUE_VMAX, sp.speed + QUEUE_ACCEL * dt, vStop);
          sp.d = Math.max(sp.targetD, sp.d - sp.speed * dt);
          if (sp.d === sp.targetD) sp.speed = 0;
        } else {
          sp.d += (sp.targetD - sp.d) * Math.min(1, dt * 3);
          sp.speed = 0;
        }
        sp.lat += (sp.latTarget - sp.lat) * Math.min(1, dt * 4);
      } else if (sp.state === "departing" && sp.path) {
        sp.speed = Math.min(DEPART_VMAX, sp.speed + DEPART_ACCEL * dt);
        sp.s += sp.speed * dt;
        if (sp.s >= sp.path.total) this.sprites.delete(sp.key);
      } else if (sp.state === "vanishing") {
        sp.alpha -= dt * 2.5;
        if (sp.alpha <= 0) this.sprites.delete(sp.key);
      }
    }
  }

  private draw(): void {
    const ctx = this.ctx;
    const snap = this.snapshot;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.staticLayer, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!snap) return;

    for (const app of APPROACHES) this.drawApproachWash(app, snap.fsm.lights[app] ?? "RED");

    const queued: Sprite[] = [];
    const moving: Sprite[] = [];
    for (const sp of this.sprites.values()) (sp.state === "departing" ? moving : queued).push(sp);
    for (const sp of queued) this.drawSprite(sp);
    for (const sp of moving) this.drawSprite(sp);

    for (const app of APPROACHES) this.drawSignal(app, snap);
    for (const app of APPROACHES) this.drawOverflow(app);
    for (const app of APPROACHES) this.drawInfoCard(app, snap);
  }

  private drawSprite(sp: Sprite): void {
    const ctx = this.ctx;
    let pos: Vec;
    let heading: Vec;
    if (sp.state === "departing" && sp.path) {
      ({ pos, heading } = pointOnPath(sp.path, sp.s));
    } else {
      pos = this.queuedCentre(sp);
      heading = DIR[sp.approach];
    }
    if (pos.x < -80 || pos.x > SCENE_SIZE + 80 || pos.y < -80 || pos.y > SCENE_SIZE + 80) return;
    const state: DrawState = {
      braking: sp.state !== "departing" && sp.speed < 25,
      moving: sp.speed > 5,
      timeSec: this.timeSec,
    };
    ctx.save();
    ctx.globalAlpha = Math.max(0, sp.alpha);
    ctx.translate(pos.x, pos.y);
    ctx.rotate(Math.atan2(heading.y, heading.x) + Math.PI / 2);
    drawVehicle(ctx, sp.style, state);
    ctx.restore();
  }

  /** Coloured wash over the waiting lanes so the active green is obvious at a glance. */
  private drawApproachWash(app: ApproachId, light: SignalColor): void {
    const ctx = this.ctx;
    const dir = DIR[app];
    const L = leftOf(dir);
    const near = add(CENTRE, dir, -STOP_LINE);
    const far = add(CENTRE, dir, -C);
    const rgb = light === "GREEN" ? "34,197,94" : light === "AMBER" ? "245,158,11" : "239,68,68";
    const strength = light === "RED" ? 0.1 : 0.28;
    const g = ctx.createLinearGradient(near.x, near.y, far.x, far.y);
    g.addColorStop(0, `rgba(${rgb},${strength})`);
    g.addColorStop(light === "RED" ? 0.3 : 0.85, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    const corners = [add(near, L, 2), add(near, L, ROAD_HALF - 2), add(far, L, ROAD_HALF - 2), add(far, L, 2)];
    ctx.moveTo(corners[0].x, corners[0].y);
    for (const p of corners.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fill();

    // Glowing stop line in the signal colour
    const a = add(add(CENTRE, dir, -STOP_LINE), L, 2);
    const b = add(add(CENTRE, dir, -STOP_LINE), L, ROAD_HALF - 2);
    ctx.save();
    ctx.strokeStyle = COLORS[light];
    ctx.shadowColor = COLORS[light];
    ctx.shadowBlur = light === "RED" ? 4 : 12;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  private drawSignal(app: ApproachId, snap: LiveJunctionSnapshot): void {
    const ctx = this.ctx;
    const light = snap.fsm.lights[app] ?? "RED";
    const dir = DIR[app];
    const L = leftOf(dir);
    const pole = add(add(CENTRE, dir, -(STOP_LINE + 8)), L, ROAD_HALF + 16);
    const armEnd = add(add(CENTRE, dir, -(STOP_LINE + 8)), L, 10);
    const lampOverRoad = add(add(CENTRE, dir, -(STOP_LINE + 8)), L, LANE_SPLIT);

    // Overhead mast arm with a lamp above the lanes it controls
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(pole.x + 2, pole.y + 3);
    ctx.lineTo(armEnd.x + 2, armEnd.y + 3);
    ctx.stroke();
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(pole.x, pole.y);
    ctx.lineTo(armEnd.x, armEnd.y);
    ctx.stroke();
    ctx.translate(lampOverRoad.x, lampOverRoad.y);
    ctx.rotate(Math.atan2(dir.y, dir.x) + Math.PI / 2);
    ctx.fillStyle = "#0b0f17";
    roundRectPath(ctx, -9, -4, 18, 8, 2);
    ctx.fill();
    ctx.fillStyle = COLORS[light];
    ctx.shadowColor = COLORS[light];
    ctx.shadowBlur = 10;
    roundRectPath(ctx, -6.5, -2, 13, 4, 1.5);
    ctx.fill();
    ctx.restore();

    // Kerb-side 3-aspect signal head (red / amber / green) facing the approach
    const w = 20;
    const h = 50;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRectPath(ctx, pole.x - w / 2 + 2, pole.y - h / 2 + 3, w, h, 5);
    ctx.fill();
    ctx.fillStyle = "#0b0f17";
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1.2;
    roundRectPath(ctx, pole.x - w / 2, pole.y - h / 2, w, h, 5);
    ctx.fill();
    ctx.stroke();
    const lamps: [SignalColor, string][] = [
      ["RED", "#3b0d0d"],
      ["AMBER", "#3b2a06"],
      ["GREEN", "#062b14"],
    ];
    lamps.forEach(([color, dim], i) => {
      const ly = pole.y - 15 + i * 15;
      const lit = light === color;
      ctx.save();
      if (lit) {
        ctx.shadowColor = COLORS[color];
        ctx.shadowBlur = 16;
      }
      const g = ctx.createRadialGradient(pole.x - 1.5, ly - 1.5, 0.5, pole.x, ly, 6);
      g.addColorStop(0, lit ? "#ffffff" : dim);
      g.addColorStop(0.35, lit ? COLORS[color] : dim);
      g.addColorStop(1, lit ? COLORS[color] : "#0b0f17");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pole.x, ly, 5.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    ctx.restore();

    // Countdown display beside the head
    const text = this.countdownText(app, snap);
    if (text) {
      const off = Math.abs(L.x) > 0.5 ? { x: L.x * 30, y: 0 } : { x: 0, y: L.y * 40 };
      const cx = pole.x + off.x;
      const cy = pole.y + off.y;
      ctx.save();
      ctx.fillStyle = "#05070a";
      ctx.strokeStyle = "#334155";
      roundRectPath(ctx, cx - 15, cy - 9, 30, 18, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = COLORS[text.color];
      ctx.shadowColor = COLORS[text.color];
      ctx.shadowBlur = 6;
      ctx.font = "bold 12px 'JetBrains Mono', ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text.value, cx, cy + 0.5);
      ctx.restore();
    }
  }

  private countdownText(app: ApproachId, snap: LiveJunctionSnapshot): { value: string; color: SignalColor } | null {
    const fsm = snap.fsm;
    const light = fsm.lights[app] ?? "RED";
    if (light !== "RED") return { value: String(Math.ceil(fsm.remaining_sec)).padStart(2, "0"), color: light };
    const eta = this.etaToGreen(app, snap);
    return eta === null ? null : { value: String(Math.ceil(eta)).padStart(2, "0"), color: "RED" };
  }

  /** Seconds until this approach turns green, if it is the one the controller will serve next. */
  private etaToGreen(app: ApproachId, snap: LiveJunctionSnapshot): number | null {
    const fsm = snap.fsm;
    if (fsm.next_approach !== app) return null;
    if (fsm.phase_state === "PHASE_GREEN") return fsm.remaining_sec + AMBER_SEC + ALL_RED_SEC;
    if (fsm.phase_state === "PHASE_AMBER") return fsm.remaining_sec + ALL_RED_SEC;
    if (fsm.phase_state === "INTERGREEN_ALL_RED") return fsm.remaining_sec;
    return 0;
  }

  private drawOverflow(app: ApproachId): void {
    const n = this.overflow[app];
    if (!n) return;
    const ctx = this.ctx;
    const dir = DIR[app];
    const p = add(add(CENTRE, dir, -(C - 34)), leftOf(dir), LANE_SPLIT);
    ctx.save();
    ctx.fillStyle = "rgba(2,6,23,0.85)";
    ctx.strokeStyle = "#f59e0b";
    roundRectPath(ctx, p.x - 26, p.y - 10, 52, 20, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fbbf24";
    ctx.font = "bold 10px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`+${n} more`, p.x, p.y + 0.5);
    ctx.restore();
  }

  private drawInfoCard(app: ApproachId, snap: LiveJunctionSnapshot): void {
    const ctx = this.ctx;
    const fsm = snap.fsm;
    const vis = snap.vision[app];
    const light = fsm.lights[app] ?? "RED";
    const pcu = vis?.effective_pcu ?? 0;
    const counts = vis?.counts;
    const total = counts ? counts.two_wheeler + counts.car_lmv + counts.bus_truck_hmv + counts.ambulance_emergency : 0;
    const wait = Math.round(fsm.wait_timers[app] ?? 0);
    const prio = fsm.priority_scores[app] ?? 0;
    const isNext = fsm.next_approach === app && light === "RED";
    const empty = pcu === 0 && light === "RED";

    const W = 160;
    const H = 76;
    const pos: Record<ApproachId, Vec> = {
      NORTH: { x: SCENE_SIZE - W - 10, y: 10 },
      EAST: { x: SCENE_SIZE - W - 10, y: SCENE_SIZE - H - 10 },
      SOUTH: { x: 10, y: SCENE_SIZE - H - 10 },
      WEST: { x: 10, y: 10 },
    };
    const { x, y } = pos[app];
    const accent = light === "RED" ? (isNext ? "#38bdf8" : empty ? COLORS.slate : "#7f1d1d") : COLORS[light];

    ctx.save();
    if (light !== "RED") {
      ctx.shadowColor = accent;
      ctx.shadowBlur = 14;
    }
    ctx.fillStyle = "rgba(8,13,26,0.93)";
    roundRectPath(ctx, x, y, W, H, 9);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = accent;
    ctx.lineWidth = light === "RED" ? 1.2 : 2;
    ctx.stroke();

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.text;
    ctx.font = "800 12px Inter, system-ui, sans-serif";
    ctx.fillText(app, x + 10, y + 18);

    const chip = light === "RED" ? (empty ? "SKIP" : isNext ? "NEXT" : "RED") : light;
    const chipColor = light === "RED" ? (empty ? COLORS.slate : isNext ? "#38bdf8" : COLORS.RED) : COLORS[light];
    ctx.font = "800 9px Inter, system-ui, sans-serif";
    const chipW = ctx.measureText(chip).width + 12;
    ctx.fillStyle = chipColor + "33";
    roundRectPath(ctx, x + W - chipW - 8, y + 7, chipW, 15, 7.5);
    ctx.fill();
    ctx.fillStyle = chipColor;
    ctx.fillText(chip, x + W - chipW - 2, y + 18);

    ctx.font = "600 10.5px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(`${pcu.toFixed(1)} PCU  ·  ${total} vehicles`, x + 10, y + 35);

    let status: string;
    if (light === "GREEN") status = `Discharging · ${Math.ceil(fsm.remaining_sec)}s of ${Math.round(fsm.allocated_green_sec)}s`;
    else if (light === "AMBER") status = `Clearing · amber ${Math.ceil(fsm.remaining_sec)}s`;
    else if (empty) status = "Empty lane · 0s skip";
    else if (isNext) status = `Green in ~${Math.ceil(this.etaToGreen(app, snap) ?? 0)}s · P ${prio.toFixed(1)}`;
    else status = `Waiting ${wait}s · P ${prio.toFixed(1)}`;
    ctx.fillStyle = light === "RED" ? (isNext ? "#7dd3fc" : empty ? COLORS.muted : "#fca5a5") : COLORS[light];
    ctx.font = "700 10.5px Inter, system-ui, sans-serif";
    ctx.fillText(status, x + 10, y + 51);

    if (counts) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = "500 9.5px Inter, system-ui, sans-serif";
      ctx.fillText(
        `Bikes ${counts.two_wheeler} · Cars ${counts.car_lmv} · HMV ${counts.bus_truck_hmv}`,
        x + 10,
        y + 66,
      );
    }

    if (light === "GREEN" && fsm.allocated_green_sec > 0) {
      const frac = Math.max(0, Math.min(1, fsm.remaining_sec / fsm.allocated_green_sec));
      ctx.fillStyle = "rgba(34,197,94,0.18)";
      ctx.fillRect(x + 8, y + H - 5, W - 16, 2.5);
      ctx.fillStyle = COLORS.GREEN;
      ctx.fillRect(x + 8, y + H - 5, (W - 16) * frac, 2.5);
    }
    ctx.restore();
  }
}

// ------------------------------------------------------------------ static scenery

function drawStaticScene(ctx: CanvasRenderingContext2D): void {
  const S = SCENE_SIZE;
  const roadMin = C - ROAD_HALF;
  const roadMax = C + ROAD_HALF;
  const SIDEWALK = 14;

  // Pavement everywhere, then grass blocks in the four corners
  ctx.fillStyle = "#1f2937";
  ctx.fillRect(0, 0, S, S);
  const quadrants: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (const [sx, sy] of quadrants) {
    const x0 = sx < 0 ? 0 : roadMax + SIDEWALK;
    const y0 = sy < 0 ? 0 : roadMax + SIDEWALK;
    const w = roadMin - SIDEWALK;
    const g = ctx.createLinearGradient(x0, y0, x0 + w, y0 + w);
    g.addColorStop(0, "#0f2219");
    g.addColorStop(1, "#0c1b15");
    ctx.fillStyle = g;
    roundRectPath(ctx, x0, y0, w, w, 0);
    ctx.fill();
    drawQuadrantDecor(ctx, sx, sy);
  }

  // Asphalt
  const asphalt = "#1a202c";
  ctx.fillStyle = asphalt;
  ctx.fillRect(roadMin, 0, ROAD_HALF * 2, S);
  ctx.fillRect(0, roadMin, S, ROAD_HALF * 2);

  // Rounded kerb corners
  const R = 16;
  for (const [sx, sy] of quadrants) {
    const cx = C + sx * ROAD_HALF;
    const cy = C + sy * ROAD_HALF;
    ctx.fillStyle = asphalt;
    ctx.fillRect(sx < 0 ? cx - R : cx, sy < 0 ? cy - R : cy, R, R);
    ctx.fillStyle = "#1f2937";
    ctx.beginPath();
    ctx.arc(cx + sx * R, cy + sy * R, R, 0, Math.PI * 2);
    ctx.fill();
  }

  // Kerb edges
  ctx.strokeStyle = "#4b5563";
  ctx.lineWidth = 1.5;
  for (const [sx, sy] of quadrants) {
    const ex = C + sx * ROAD_HALF;
    const ey = C + sy * ROAD_HALF;
    ctx.beginPath();
    ctx.moveTo(ex, sy < 0 ? 0 : S);
    ctx.lineTo(ex, ey + sy * R);
    ctx.arcTo(ex, ey, ex + sx * R, ey, R);
    ctx.lineTo(sx < 0 ? 0 : S, ey);
    ctx.stroke();
  }

  for (const app of APPROACHES) {
    const dir = DIR[app];
    const L = leftOf(dir);
    const along = (dist: number, lat: number) => add(add(CENTRE, dir, -dist), L, lat);
    const line = (a: Vec, b: Vec) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    };

    // Double yellow centre line
    ctx.strokeStyle = "#eab308";
    ctx.lineWidth = 1.6;
    line(along(CROSSWALK_FAR + 2, 2), along(C, 2));
    line(along(CROSSWALK_FAR + 2, -2), along(C, -2));

    // Dashed lane dividers (inbound + outbound halves)
    ctx.strokeStyle = "rgba(226,232,240,0.55)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([12, 12]);
    line(along(STOP_LINE + 24, LANE_SPLIT), along(C, LANE_SPLIT));
    line(along(CROSSWALK_FAR + 2, -LANE_SPLIT), along(C, -LANE_SPLIT));
    ctx.setLineDash([]);
    // Solid divider on the approach to the stop line (no lane changing)
    line(along(STOP_LINE, LANE_SPLIT), along(STOP_LINE + 24, LANE_SPLIT));

    // Zebra crossing across the full carriageway
    ctx.fillStyle = "rgba(241,245,249,0.82)";
    for (let lat = -ROAD_HALF + 5; lat < ROAD_HALF - 4; lat += 11) {
      const p1 = along(CROSSWALK_NEAR, lat);
      const p2 = along(CROSSWALK_FAR, lat);
      const p3 = along(CROSSWALK_FAR, lat + 6);
      const p4 = along(CROSSWALK_NEAR, lat + 6);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.lineTo(p4.x, p4.y);
      ctx.closePath();
      ctx.fill();
    }

    // Painted lane arrows: kerb lane straight+left, median lane straight+right
    drawLaneArrow(ctx, along(STOP_LINE + 42, LANE_LAT[1]), dir, "L");
    drawLaneArrow(ctx, along(STOP_LINE + 42, LANE_LAT[0]), dir, "R");
  }

  // Subtle vignette
  const v = ctx.createRadialGradient(C, C, S * 0.3, C, C, S * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, S, S);
}

function drawLaneArrow(ctx: CanvasRenderingContext2D, at: Vec, dir: Vec, branch: "L" | "R") {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(Math.atan2(dir.y, dir.x) + Math.PI / 2);
  ctx.strokeStyle = "rgba(241,245,249,0.5)";
  ctx.fillStyle = "rgba(241,245,249,0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 12);
  ctx.lineTo(0, -8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.lineTo(-4, -7);
  ctx.lineTo(4, -7);
  ctx.closePath();
  ctx.fill();
  // Turn branch (vehicle-left is screen -x in local space)
  const s = branch === "L" ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.quadraticCurveTo(0, -2, s * 6, -2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s * 10, -2);
  ctx.lineTo(s * 5, -6);
  ctx.lineTo(s * 5, 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawQuadrantDecor(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
  // Local quadrant coordinates: u grows away from the vertical road, v away from the horizontal road
  const edge = ROAD_HALF + 14;
  const P = (u: number, v: number): Vec => ({ x: C + sx * (edge + u), y: C + sy * (edge + v) });

  // Building block with a lit roof
  const a = P(48, 52);
  const b = P(128, 132);
  const bx = Math.min(a.x, b.x);
  const by = Math.min(a.y, b.y);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  roundRectPath(ctx, bx + 5, by + 6, 80, 80, 4);
  ctx.fill();
  const roof = ctx.createLinearGradient(bx, by, bx + 80, by + 80);
  roof.addColorStop(0, "#334155");
  roof.addColorStop(1, "#1e293b");
  ctx.fillStyle = roof;
  roundRectPath(ctx, bx, by, 80, 80, 4);
  ctx.fill();
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#475569";
  roundRectPath(ctx, bx + 12, by + 12, 22, 14, 2);
  ctx.fill();
  roundRectPath(ctx, bx + 46, by + 50, 20, 18, 2);
  ctx.fill();

  const trees: [number, number, number][] = [
    [24, 160, 13],
    [150, 26, 12],
    [196, 62, 14],
    [22, 22, 0],
    [170, 120, 11],
  ];
  for (const [u, v, r] of trees) {
    if (!r) continue;
    const p = P(u, v);
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.arc(p.x + 3, p.y + 4, r, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.35, 1, p.x, p.y, r);
    g.addColorStop(0, "#2f7a45");
    g.addColorStop(0.7, "#1b4d2c");
    g.addColorStop(1, "#123820");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
