/**
 * Top-down vehicle illustrations for the digital twin canvas.
 * Every vehicle is drawn in local space centred on (0, 0) with its nose pointing towards -y;
 * the caller translates/rotates the context to place it on the road.
 */
import { VehicleKind } from "../types";

export type VehicleModel = "bike" | "car" | "taxi" | "auto" | "bus" | "truck" | "ambulance";

export interface VehicleStyle {
  model: VehicleModel;
  length: number;
  width: number;
  body: string;
  accent: string;
  rider?: string;
  pillion?: boolean;
}

export interface DrawState {
  braking: boolean;
  moving: boolean;
  timeSec: number;
}

const CAR_COLORS = ["#e2e8f0", "#94a3b8", "#dc2626", "#2563eb", "#1f2937", "#0f766e", "#7c3aed", "#f8fafc", "#b91c1c"];
const BIKE_COLORS = ["#ef4444", "#1d4ed8", "#111827", "#f97316", "#0ea5e9", "#a3a3a3"];
const JACKET_COLORS = ["#334155", "#7c2d12", "#1e3a8a", "#166534", "#6b21a8", "#525252", "#9f1239"];
const BUS_LIVERIES: [string, string][] = [
  ["#1d4ed8", "#e0f2fe"],
  ["#b91c1c", "#fde68a"],
  ["#15803d", "#ecfccb"],
  ["#c2410c", "#fef3c7"],
];
const TRUCK_LIVERIES: [string, string][] = [
  ["#f59e0b", "#1d4ed8"],
  ["#ea580c", "#15803d"],
  ["#dc2626", "#0f766e"],
  ["#facc15", "#7c2d12"],
];

export function hashId(id: number | string): number {
  const s = String(id);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic look for a vehicle so it keeps the same paint job for its whole life. */
export function styleFor(kind: VehicleKind, id: number | string): VehicleStyle {
  const h = hashId(id);
  const pick = <T,>(arr: T[], salt: number) => arr[(h >>> salt) % arr.length];
  switch (kind) {
    case "two_wheeler":
      return {
        model: "bike",
        length: 20,
        width: 9,
        body: pick(BIKE_COLORS, 3),
        accent: pick(["#facc15", "#f8fafc", "#ef4444", "#22c55e", "#111827"], 7),
        rider: pick(JACKET_COLORS, 11),
        pillion: (h >>> 15) % 4 === 0,
      };
    case "bus_truck_hmv": {
      if ((h >>> 5) % 2 === 0) {
        const [body, accent] = pick(BUS_LIVERIES, 9);
        return { model: "bus", length: 62, width: 24, body, accent };
      }
      const [cab, tarp] = pick(TRUCK_LIVERIES, 9);
      return { model: "truck", length: 56, width: 23, body: cab, accent: tarp };
    }
    case "ambulance_emergency":
      return { model: "ambulance", length: 42, width: 21, body: "#f8fafc", accent: "#dc2626" };
    default: {
      const roll = (h >>> 4) % 10;
      if (roll < 3) return { model: "auto", length: 28, width: 17, body: "#16a34a", accent: "#facc15" };
      if (roll < 5) return { model: "taxi", length: 38, width: 20, body: "#facc15", accent: "#111827" };
      return { model: "car", length: 38, width: 20, body: pick(CAR_COLORS, 8), accent: "#0f172a" };
    }
  }
}

const MODEL_KIND: Record<VehicleModel, VehicleKind> = {
  bike: "two_wheeler",
  car: "car_lmv",
  taxi: "car_lmv",
  auto: "car_lmv",
  bus: "bus_truck_hmv",
  truck: "bus_truck_hmv",
  ambulance: "ambulance_emergency",
};

/** A representative style of the given model (used by the legend). */
export function sampleStyle(model: VehicleModel): VehicleStyle {
  for (let id = 0; id < 500; id++) {
    const style = styleFor(MODEL_KIND[model], `sample-${id}`);
    if (style.model === model) return style;
  }
  return styleFor(MODEL_KIND[model], 0);
}

// ------------------------------------------------------------------ colour + shape helpers

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `rgb(${r},${g},${b})`;
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** Paint gradient across the width gives the body a rounded, lit-from-above 3D look. */
function bodyGradient(ctx: CanvasRenderingContext2D, w: number, color: string) {
  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  g.addColorStop(0, shade(color, -0.45));
  g.addColorStop(0.22, shade(color, -0.05));
  g.addColorStop(0.5, shade(color, 0.22));
  g.addColorStop(0.78, shade(color, -0.05));
  g.addColorStop(1, shade(color, -0.45));
  return g;
}

function glassGradient(ctx: CanvasRenderingContext2D, y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, "#0b1220");
  g.addColorStop(0.55, "#1e293b");
  g.addColorStop(1, "#475569");
  return g;
}

function dropShadow(ctx: CanvasRenderingContext2D, w: number, l: number, r: number) {
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  roundRectPath(ctx, -w / 2 + 2, -l / 2 + 3, w + 1, l + 1, r);
  ctx.fill();
}

function wheels(ctx: CanvasRenderingContext2D, w: number, axlesY: number[], tyreLen = 7, tyreW = 3.2) {
  ctx.fillStyle = "#05070a";
  for (const y of axlesY) {
    roundRectPath(ctx, -w / 2 - 1.2, y - tyreLen / 2, tyreW, tyreLen, 1.2);
    ctx.fill();
    roundRectPath(ctx, w / 2 - tyreW + 1.2, y - tyreLen / 2, tyreW, tyreLen, 1.2);
    ctx.fill();
  }
}

function headlights(ctx: CanvasRenderingContext2D, w: number, l: number, inset = 3.5) {
  ctx.fillStyle = "#fef9c3";
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sx * (w / 2 - inset), -l / 2 + 1.6, 2.2, 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function taillights(ctx: CanvasRenderingContext2D, w: number, l: number, braking: boolean, inset = 3.5) {
  ctx.fillStyle = braking ? "#ff3b3b" : "#7f1d1d";
  for (const sx of [-1, 1]) {
    roundRectPath(ctx, sx * (w / 2 - inset) - 2.2, l / 2 - 2.2, 4.4, 1.8, 0.8);
    ctx.fill();
  }
  if (braking) {
    const g = ctx.createRadialGradient(0, l / 2 + 2, 0, 0, l / 2 + 2, w * 0.7);
    g.addColorStop(0, "rgba(255,40,40,0.35)");
    g.addColorStop(1, "rgba(255,40,40,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-w * 0.7, l / 2 - 2, w * 1.4, w * 0.7);
  }
}

function headlightBeams(ctx: CanvasRenderingContext2D, w: number, l: number) {
  const reach = l * 0.9;
  const g = ctx.createLinearGradient(0, -l / 2, 0, -l / 2 - reach);
  g.addColorStop(0, "rgba(254,249,195,0.22)");
  g.addColorStop(1, "rgba(254,249,195,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 2, -l / 2);
  ctx.lineTo(w / 2 - 2, -l / 2);
  ctx.lineTo(w / 2 + 7, -l / 2 - reach);
  ctx.lineTo(-w / 2 - 7, -l / 2 - reach);
  ctx.closePath();
  ctx.fill();
}

// ------------------------------------------------------------------ models

function drawCar(ctx: CanvasRenderingContext2D, s: VehicleStyle, st: DrawState) {
  const { width: w, length: l } = s;
  dropShadow(ctx, w, l, 6);
  wheels(ctx, w, [-l * 0.3, l * 0.3]);

  ctx.fillStyle = bodyGradient(ctx, w, s.body);
  roundRectPath(ctx, -w / 2, -l / 2, w, l, 6);
  ctx.fill();
  ctx.strokeStyle = shade(s.body, -0.55);
  ctx.lineWidth = 0.7;
  ctx.stroke();

  // Bonnet crease lines
  ctx.strokeStyle = shade(s.body, -0.25);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(-w * 0.18, -l / 2 + 2);
  ctx.lineTo(-w * 0.22, -l / 2 + 9);
  ctx.moveTo(w * 0.18, -l / 2 + 2);
  ctx.lineTo(w * 0.22, -l / 2 + 9);
  ctx.stroke();

  // Windscreen
  const wsTop = -l / 2 + 9.5;
  const wsBot = -l / 2 + 15.5;
  ctx.fillStyle = glassGradient(ctx, wsTop, wsBot);
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 4.2, wsTop);
  ctx.lineTo(w / 2 - 4.2, wsTop);
  ctx.lineTo(w / 2 - 2.4, wsBot);
  ctx.lineTo(-w / 2 + 2.4, wsBot);
  ctx.closePath();
  ctx.fill();

  // Roof
  const roofTop = wsBot;
  const roofLen = l * 0.34;
  const roof = ctx.createLinearGradient(0, roofTop, 0, roofTop + roofLen);
  roof.addColorStop(0, shade(s.body, 0.28));
  roof.addColorStop(1, shade(s.body, 0.05));
  ctx.fillStyle = roof;
  roundRectPath(ctx, -w / 2 + 2.6, roofTop, w - 5.2, roofLen, 3);
  ctx.fill();

  // Side windows (thin glass strips either side of the roof)
  ctx.fillStyle = "rgba(15,23,42,0.85)";
  ctx.fillRect(-w / 2 + 1.4, roofTop + 1, 1.3, roofLen - 2);
  ctx.fillRect(w / 2 - 2.7, roofTop + 1, 1.3, roofLen - 2);

  // Rear window
  const rwTop = roofTop + roofLen;
  ctx.fillStyle = glassGradient(ctx, rwTop + 4.5, rwTop);
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 2.6, rwTop);
  ctx.lineTo(w / 2 - 2.6, rwTop);
  ctx.lineTo(w / 2 - 4.2, rwTop + 4.5);
  ctx.lineTo(-w / 2 + 4.2, rwTop + 4.5);
  ctx.closePath();
  ctx.fill();

  // Wing mirrors
  ctx.fillStyle = shade(s.body, -0.3);
  ctx.fillRect(-w / 2 - 2.2, wsTop + 1, 2.4, 2.2);
  ctx.fillRect(w / 2 - 0.2, wsTop + 1, 2.4, 2.2);

  if (s.model === "taxi") {
    ctx.fillStyle = "#111827";
    roundRectPath(ctx, -4.5, roofTop + roofLen / 2 - 2.5, 9, 5, 1.2);
    ctx.fill();
    ctx.fillStyle = "#facc15";
    ctx.font = "bold 3.6px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("TAXI", 0, roofTop + roofLen / 2 + 0.2);
  }

  headlights(ctx, w, l);
  taillights(ctx, w, l, st.braking);
}

function drawAuto(ctx: CanvasRenderingContext2D, s: VehicleStyle, st: DrawState) {
  const { width: w, length: l } = s;
  dropShadow(ctx, w, l, 6);
  // Single front wheel, two rear wheels
  ctx.fillStyle = "#05070a";
  roundRectPath(ctx, -1.6, -l / 2 - 0.5, 3.2, 6, 1.2);
  ctx.fill();
  wheels(ctx, w, [l * 0.3], 6.5, 3);

  // Tapered lower body
  ctx.fillStyle = bodyGradient(ctx, w, s.body);
  ctx.beginPath();
  ctx.moveTo(-3.5, -l / 2 + 1);
  ctx.lineTo(3.5, -l / 2 + 1);
  ctx.lineTo(w / 2, -l / 2 + 9);
  ctx.lineTo(w / 2, l / 2 - 2);
  ctx.quadraticCurveTo(w / 2, l / 2, w / 2 - 2, l / 2);
  ctx.lineTo(-w / 2 + 2, l / 2);
  ctx.quadraticCurveTo(-w / 2, l / 2, -w / 2, l / 2 - 2);
  ctx.lineTo(-w / 2, -l / 2 + 9);
  ctx.closePath();
  ctx.fill();

  // Canvas canopy
  const canopy = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  canopy.addColorStop(0, shade(s.accent, -0.45));
  canopy.addColorStop(0.5, shade(s.accent, 0.15));
  canopy.addColorStop(1, shade(s.accent, -0.45));
  ctx.fillStyle = canopy;
  roundRectPath(ctx, -w / 2 + 0.8, -l / 2 + 8, w - 1.6, l - 10, 5);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 2, -l / 2 + 15);
  ctx.lineTo(w / 2 - 2, -l / 2 + 15);
  ctx.stroke();

  // Windscreen
  ctx.fillStyle = glassGradient(ctx, -l / 2 + 4, -l / 2 + 8.5);
  ctx.beginPath();
  ctx.moveTo(-4, -l / 2 + 4);
  ctx.lineTo(4, -l / 2 + 4);
  ctx.lineTo(w / 2 - 2, -l / 2 + 8.5);
  ctx.lineTo(-w / 2 + 2, -l / 2 + 8.5);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#fef9c3";
  ctx.beginPath();
  ctx.arc(0, -l / 2 + 1.8, 1.5, 0, Math.PI * 2);
  ctx.fill();
  taillights(ctx, w, l, st.braking, 3);
}

function drawBike(ctx: CanvasRenderingContext2D, s: VehicleStyle, st: DrawState) {
  const l = s.length;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(1.5, 2.5, 5.5, l / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tyres
  ctx.fillStyle = "#05070a";
  roundRectPath(ctx, -1.6, -l / 2, 3.2, 6.5, 1.5);
  ctx.fill();
  roundRectPath(ctx, -1.7, l / 2 - 6.5, 3.4, 6.5, 1.5);
  ctx.fill();

  // Frame / tank / seat
  ctx.fillStyle = bodyGradient(ctx, 6, s.body);
  roundRectPath(ctx, -3, -l / 2 + 4, 6, l - 8, 2.5);
  ctx.fill();
  ctx.fillStyle = "#111827";
  roundRectPath(ctx, -2.2, -l / 2 + 10, 4.4, 6, 1.5);
  ctx.fill();

  // Handlebar with grips and mirrors
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-5.5, -l / 2 + 5);
  ctx.lineTo(5.5, -l / 2 + 5);
  ctx.stroke();
  ctx.fillStyle = "#111827";
  ctx.fillRect(-6.2, -l / 2 + 4.2, 1.6, 1.6);
  ctx.fillRect(4.6, -l / 2 + 4.2, 1.6, 1.6);

  // Rider: shoulders + helmet with visor highlight
  const riders = s.pillion ? [1.5, 6.5] : [2];
  riders.forEach((y, i) => {
    ctx.fillStyle = i === 0 ? s.rider ?? "#334155" : shade(s.rider ?? "#334155", 0.25);
    ctx.beginPath();
    ctx.ellipse(0, y, 4.8, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    const helmet = ctx.createRadialGradient(-0.8, y - 2.2, 0.3, 0, y - 1.2, 3.2);
    helmet.addColorStop(0, shade(s.accent, 0.5));
    helmet.addColorStop(1, shade(s.accent, -0.25));
    ctx.fillStyle = helmet;
    ctx.beginPath();
    ctx.arc(0, y - 1.2, 2.7, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#fef9c3";
  ctx.beginPath();
  ctx.arc(0, -l / 2 + 0.8, 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = st.braking ? "#ff3b3b" : "#7f1d1d";
  ctx.fillRect(-1.2, l / 2 - 1.2, 2.4, 1.2);
}

function drawBus(ctx: CanvasRenderingContext2D, s: VehicleStyle, st: DrawState) {
  const { width: w, length: l } = s;
  dropShadow(ctx, w, l, 4);
  wheels(ctx, w, [-l * 0.32, l * 0.28, l * 0.38], 7.5, 3.4);

  ctx.fillStyle = bodyGradient(ctx, w, s.body);
  roundRectPath(ctx, -w / 2, -l / 2, w, l, 4);
  ctx.fill();

  // Roof panel in the secondary livery colour
  const roof = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  roof.addColorStop(0, shade(s.accent, -0.2));
  roof.addColorStop(0.5, s.accent);
  roof.addColorStop(1, shade(s.accent, -0.2));
  ctx.fillStyle = roof;
  roundRectPath(ctx, -w / 2 + 3, -l / 2 + 7, w - 6, l - 10, 3);
  ctx.fill();

  // Windows seen along the roof edges
  ctx.fillStyle = "rgba(15,23,42,0.9)";
  for (let y = -l / 2 + 9; y < l / 2 - 6; y += 6.2) {
    ctx.fillRect(-w / 2 + 0.9, y, 1.8, 4.6);
    ctx.fillRect(w / 2 - 2.7, y, 1.8, 4.6);
  }

  // Roof hatches + AC unit
  ctx.fillStyle = shade(s.accent, -0.3);
  roundRectPath(ctx, -4.5, -l / 2 + 14, 9, 6, 1.2);
  ctx.fill();
  roundRectPath(ctx, -4.5, l / 2 - 16, 9, 6, 1.2);
  ctx.fill();
  ctx.fillStyle = "#cbd5e1";
  roundRectPath(ctx, -6.5, -2.5, 13, 9, 1.5);
  ctx.fill();
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 0.6;
  for (let x = -5; x <= 5; x += 2.5) {
    ctx.beginPath();
    ctx.moveTo(x, -1.5);
    ctx.lineTo(x, 5.5);
    ctx.stroke();
  }

  // Front windscreen
  ctx.fillStyle = glassGradient(ctx, -l / 2 + 1, -l / 2 + 6.5);
  roundRectPath(ctx, -w / 2 + 2, -l / 2 + 1.2, w - 4, 5.2, 1.5);
  ctx.fill();

  headlights(ctx, w, l, 3);
  taillights(ctx, w, l, st.braking, 3);
}

function drawTruck(ctx: CanvasRenderingContext2D, s: VehicleStyle, st: DrawState) {
  const { width: w, length: l } = s;
  const cabLen = 14;
  dropShadow(ctx, w, l, 3);
  wheels(ctx, w, [-l / 2 + 8, l * 0.2, l * 0.36], 7.5, 3.4);

  // Load bed: wooden side boards with a roped tarpaulin
  const bedTop = -l / 2 + cabLen + 1.5;
  ctx.fillStyle = "#78350f";
  roundRectPath(ctx, -w / 2, bedTop, w, l / 2 - bedTop, 2);
  ctx.fill();
  const tarp = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  tarp.addColorStop(0, shade(s.accent, -0.4));
  tarp.addColorStop(0.5, shade(s.accent, 0.18));
  tarp.addColorStop(1, shade(s.accent, -0.4));
  ctx.fillStyle = tarp;
  roundRectPath(ctx, -w / 2 + 1.6, bedTop + 1.6, w - 3.2, l / 2 - bedTop - 3.2, 4);
  ctx.fill();
  ctx.strokeStyle = "rgba(254,243,199,0.55)";
  ctx.lineWidth = 0.6;
  for (let y = bedTop + 6; y < l / 2 - 3; y += 7) {
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 1.6, y);
    ctx.lineTo(w / 2 - 1.6, y);
    ctx.stroke();
  }

  // Cab
  ctx.fillStyle = bodyGradient(ctx, w, s.body);
  roundRectPath(ctx, -w / 2 + 0.5, -l / 2, w - 1, cabLen, 4);
  ctx.fill();
  ctx.fillStyle = glassGradient(ctx, -l / 2 + 2, -l / 2 + 6);
  roundRectPath(ctx, -w / 2 + 2.5, -l / 2 + 2, w - 5, 4, 1.2);
  ctx.fill();
  ctx.fillStyle = shade(s.body, 0.3);
  roundRectPath(ctx, -w / 2 + 3, -l / 2 + 7, w - 6, cabLen - 8.5, 2);
  ctx.fill();
  ctx.fillStyle = shade(s.body, -0.3);
  ctx.fillRect(-w / 2 - 2.2, -l / 2 + 3, 2.4, 2.4);
  ctx.fillRect(w / 2 - 0.2, -l / 2 + 3, 2.4, 2.4);

  headlights(ctx, w, l, 3.2);
  taillights(ctx, w, l, st.braking, 3);
}

function drawAmbulance(ctx: CanvasRenderingContext2D, s: VehicleStyle, st: DrawState) {
  const { width: w, length: l } = s;
  // Flashing red / blue beacon glow on the road
  const phase = Math.floor(st.timeSec * 6) % 2 === 0;
  const glow = ctx.createRadialGradient(0, -l * 0.2, 2, 0, -l * 0.2, l * 0.95);
  glow.addColorStop(0, phase ? "rgba(239,68,68,0.45)" : "rgba(59,130,246,0.45)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(-l, -l * 1.2, l * 2, l * 2);

  dropShadow(ctx, w, l, 5);
  wheels(ctx, w, [-l * 0.3, l * 0.3]);
  ctx.fillStyle = bodyGradient(ctx, w, s.body);
  roundRectPath(ctx, -w / 2, -l / 2, w, l, 5);
  ctx.fill();

  ctx.fillStyle = s.accent;
  ctx.fillRect(-w / 2 + 0.3, -l / 2 + 12, 1.6, l - 16);
  ctx.fillRect(w / 2 - 1.9, -l / 2 + 12, 1.6, l - 16);

  ctx.fillStyle = glassGradient(ctx, -l / 2 + 4, -l / 2 + 10);
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 4, -l / 2 + 4);
  ctx.lineTo(w / 2 - 4, -l / 2 + 4);
  ctx.lineTo(w / 2 - 2.2, -l / 2 + 10);
  ctx.lineTo(-w / 2 + 2.2, -l / 2 + 10);
  ctx.closePath();
  ctx.fill();

  // Light bar
  ctx.fillStyle = phase ? "#ef4444" : "#7f1d1d";
  roundRectPath(ctx, -w / 2 + 3, -l / 2 + 11, w / 2 - 3, 3, 1);
  ctx.fill();
  ctx.fillStyle = phase ? "#1e3a8a" : "#3b82f6";
  roundRectPath(ctx, 0, -l / 2 + 11, w / 2 - 3, 3, 1);
  ctx.fill();

  // Red cross on the roof
  ctx.fillStyle = s.accent;
  ctx.fillRect(-1.8, 2, 3.6, 11);
  ctx.fillRect(-5.5, 5.7, 11, 3.6);

  headlights(ctx, w, l);
  taillights(ctx, w, l, st.braking);
}

export function drawVehicle(ctx: CanvasRenderingContext2D, style: VehicleStyle, state: DrawState): void {
  if (state.moving && style.model !== "bike") headlightBeams(ctx, style.width, style.length);
  switch (style.model) {
    case "bike":
      return drawBike(ctx, style, state);
    case "auto":
      return drawAuto(ctx, style, state);
    case "bus":
      return drawBus(ctx, style, state);
    case "truck":
      return drawTruck(ctx, style, state);
    case "ambulance":
      return drawAmbulance(ctx, style, state);
    default:
      return drawCar(ctx, style, state);
  }
}
