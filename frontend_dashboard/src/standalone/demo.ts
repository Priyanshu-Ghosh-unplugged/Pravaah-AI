/**
 * Entry point for the zero-install traffic_demo.html.
 * Bundled inline into that page by scripts/build_standalone_demo.mjs (npm run build:demo).
 */
import { ApproachId, LiveJunctionSnapshot } from "../types";
import { IntersectionRenderer } from "../twin/intersectionRenderer";
import { APPROACH_ORDER, JunctionSimulator, LaneField, PresetName } from "../twin/junctionSim";

const sim = new JunctionSimulator();
const renderer = new IntersectionRenderer(document.getElementById("simCanvas") as HTMLCanvasElement);
let snapshot: LiveJunctionSnapshot = sim.snapshot();

const $ = (id: string) => document.getElementById(id)!;

const SLIDERS: { field: LaneField; label: string; max: number; countKey: "two_wheeler" | "car_lmv" | "bus_truck_hmv" }[] = [
  { field: "bikes", label: "🛵 Bikes", max: 24, countKey: "two_wheeler" },
  { field: "cars", label: "🚗 Cars/Autos", max: 20, countKey: "car_lmv" },
  { field: "buses", label: "🚌 Buses/Trucks", max: 6, countKey: "bus_truck_hmv" },
];

function buildControls(): void {
  const grid = $("laneGrid");
  grid.innerHTML = "";
  for (const app of APPROACH_ORDER) {
    const card = document.createElement("div");
    card.className = "lane-card";
    card.id = `card-${app}`;
    card.innerHTML = `
      <div class="lane-head">
        <strong>${app} APPROACH</strong>
        <span id="status-${app}" style="font-size:12px;font-weight:700;">RED</span>
      </div>
      ${SLIDERS.map(
        (s) => `
        <div class="slider-row">
          <span>${s.label} (<span id="val-${s.field}-${app}">0</span>)</span>
          <input id="in-${s.field}-${app}" type="range" min="0" max="${s.max}" />
        </div>`,
      ).join("")}
      <div class="metrics-mini">
        <div>PCU Load<strong id="m-pcu-${app}">0</strong></div>
        <div>Wait Clock<strong id="m-wait-${app}">0s</strong></div>
        <div>Priority<strong id="m-prio-${app}">0</strong></div>
      </div>`;
    grid.appendChild(card);
    for (const s of SLIDERS) {
      const input = card.querySelector<HTMLInputElement>(`#in-${s.field}-${app}`)!;
      input.addEventListener("input", () => {
        sim.setLaneCounts(app, { [s.field]: parseInt(input.value, 10) });
        refresh();
      });
    }
  }
}

function refresh(): void {
  snapshot = sim.snapshot();
  renderer.setSnapshot(snapshot);
  const fsm = snapshot.fsm;

  for (const app of APPROACH_ORDER) {
    const vis = snapshot.vision[app];
    const light = fsm.lights[app];
    for (const s of SLIDERS) {
      $(`val-${s.field}-${app}`).textContent = String(vis.counts[s.countKey]);
      const input = $(`in-${s.field}-${app}`) as HTMLInputElement;
      if (document.activeElement !== input) input.value = String(vis.counts[s.countKey]);
    }
    $(`m-pcu-${app}`).textContent = `${vis.effective_pcu.toFixed(1)} PCU`;
    $(`m-wait-${app}`).textContent = `${Math.round(fsm.wait_timers[app])}s`;
    $(`m-prio-${app}`).textContent = vis.effective_pcu === 0 && light === "RED" ? "SKIP" : fsm.priority_scores[app].toFixed(1);

    const card = $(`card-${app}`);
    const st = $(`status-${app}`);
    card.classList.remove("active-green", "skipped", "next-up");
    if (light === "GREEN") {
      st.textContent = `🟢 GREEN (${Math.ceil(fsm.remaining_sec)}s)`;
      st.style.color = "#22c55e";
      card.classList.add("active-green");
    } else if (light === "AMBER") {
      st.textContent = `🟡 AMBER (${Math.ceil(fsm.remaining_sec)}s)`;
      st.style.color = "#f59e0b";
    } else if (vis.effective_pcu === 0) {
      st.textContent = "⚪ EMPTY — SKIP (0s)";
      st.style.color = "#94a3b8";
      card.classList.add("skipped");
    } else if (fsm.next_approach === app) {
      st.textContent = "🔵 NEXT GREEN";
      st.style.color = "#38bdf8";
      card.classList.add("next-up");
    } else {
      st.textContent = "🔴 RED (QUEUED)";
      st.style.color = "#ef4444";
    }
  }

  const amb = snapshot.vision.EAST.emergency_visual;
  $("btnAmb").classList.toggle("active", amb);
  $("btnAmb").textContent = amb ? "🚨 Preempting (East Ambulance)" : "🚑 Trigger East Ambulance";
  const badge = $("modeBadge");
  badge.textContent = amb ? "🚨 EMERGENCY AMBULANCE PREEMPTION (EAST)" : "EDGE-AI ADAPTIVE ACTIVE";
  badge.classList.toggle("emerg", amb);

  const kpis = snapshot.impact_kpis;
  $("kpiWait").textContent = `${kpis.wait_reduction_pct.toFixed(1)}%`;
  $("kpiSkips").textContent = String(fsm.skipped_phases_count);
  $("kpiFuel").textContent = `${kpis.fuel_saved_litres.toFixed(2)} L`;
  $("kpiEmerg").textContent = String(fsm.emergency_preemptions_count);
}

declare global {
  interface Window {
    applyPreset: (name: PresetName) => void;
    toggleAmbulance: () => void;
    forceStepPhase: () => void;
    forceApproach: (app: ApproachId | null) => void;
  }
}

window.applyPreset = (name) => {
  sim.applyPreset(name);
  refresh();
};
window.toggleAmbulance = () => {
  sim.setAmbulance("EAST", !snapshot.vision.EAST.emergency_visual);
  refresh();
};
window.forceStepPhase = () => sim.endCurrentGreen();
window.forceApproach = (app) => sim.forceApproach(app);

buildControls();
refresh();
renderer.start();
let tick = 0;
setInterval(() => {
  sim.step(0.1);
  if (++tick % 2 === 0) refresh();
}, 100);
