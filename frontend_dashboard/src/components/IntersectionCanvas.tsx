import React, { useEffect, useRef } from "react";
import { ApproachId, LiveJunctionSnapshot } from "../types";
import { IntersectionRenderer } from "../twin/intersectionRenderer";
import { VehicleModel, drawVehicle, sampleStyle } from "../twin/vehicleArt";

interface Props {
  snapshot: LiveJunctionSnapshot;
  onLaneClick?: (approach: ApproachId) => void;
}

const APPROACHES: ApproachId[] = ["NORTH", "EAST", "SOUTH", "WEST"];

const PHASE_LABEL: Record<string, string> = {
  PHASE_GREEN: "GREEN",
  PHASE_AMBER: "AMBER",
  INTERGREEN_ALL_RED: "ALL-RED CLEARANCE",
  ALL_RED_IDLE: "ALL-RED REST (junction empty)",
  FALLBACK_FIXED_ROTATION: "FIXED-TIME FALLBACK",
};

const LEGEND: { label: string; model: VehicleModel }[] = [
  { label: "Two-wheeler · 0.5 PCU", model: "bike" },
  { label: "Car / Taxi · 1.0", model: "taxi" },
  { label: "Auto-rickshaw · 1.0", model: "auto" },
  { label: "Bus · 3.0", model: "bus" },
  { label: "Truck · 3.0", model: "truck" },
  { label: "Ambulance · priority", model: "ambulance" },
];

const LegendIcon: React.FC<{ model: VehicleModel }> = ({ model }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = 70 * dpr;
    canvas.height = 30 * dpr;
    ctx.scale(dpr, dpr);
    const style = sampleStyle(model);
    ctx.translate(35, 15);
    ctx.rotate(Math.PI / 2);
    const scale = Math.min(1, 62 / style.length);
    ctx.scale(scale, scale);
    drawVehicle(ctx, style, { braking: false, moving: false, timeSec: 0 });
  }, [model]);
  return <canvas ref={ref} style={{ width: 70, height: 30 }} />;
};

export const IntersectionCanvas: React.FC<Props> = ({ snapshot }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<IntersectionRenderer | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const renderer = new IntersectionRenderer(canvasRef.current);
    rendererRef.current = renderer;
    renderer.setSnapshot(snapshot);
    renderer.start();
    return () => renderer.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rendererRef.current?.setSnapshot(snapshot);
  }, [snapshot]);

  const fsm = snapshot.fsm;
  const served = new Set(fsm.cycle_served ?? []);
  const phaseColor =
    fsm.phase_state === "PHASE_GREEN"
      ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
      : fsm.phase_state === "PHASE_AMBER"
      ? "text-amber-400 border-amber-500/40 bg-amber-500/10"
      : "text-rose-400 border-rose-500/40 bg-rose-500/10";

  return (
    <div className="relative flex flex-col gap-3 p-3 bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl">
      {/* Live phase + service-cycle strip */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 text-xs font-bold tracking-wider uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full">
            Live Digital Twin
          </span>
          <span className={`px-2.5 py-1 text-xs font-bold rounded-full border ${phaseColor}`}>
            {fsm.active_approach && (fsm.phase_state === "PHASE_GREEN" || fsm.phase_state === "PHASE_AMBER")
              ? `${fsm.active_approach} · ${PHASE_LABEL[fsm.phase_state]} · ${Math.ceil(fsm.remaining_sec)}s`
              : PHASE_LABEL[fsm.phase_state] ?? fsm.phase_state}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-slate-400 mr-1">Cycle:</span>
          {APPROACHES.map((app) => {
            const light = fsm.lights[app];
            const isActive = light === "GREEN" || light === "AMBER";
            const isNext = fsm.next_approach === app && !isActive;
            const empty = (snapshot.vision[app]?.effective_pcu ?? 0) === 0 && !isActive;
            let cls = "border-slate-700 text-slate-400 bg-slate-800/60";
            if (isActive) cls = light === "GREEN" ? "border-emerald-500 text-emerald-300 bg-emerald-500/15" : "border-amber-500 text-amber-300 bg-amber-500/15";
            else if (isNext) cls = "border-sky-500 text-sky-300 bg-sky-500/15";
            else if (empty) cls = "border-dashed border-slate-700 text-slate-500";
            else if (served.has(app)) cls = "border-slate-600 text-slate-300 bg-slate-700/50";
            return (
              <span key={app} className={`px-2 py-0.5 rounded-md border font-semibold ${cls}`} title={
                isActive ? "Green now" : isNext ? "Next green" : empty ? "Empty – skipped" : served.has(app) ? "Served this cycle" : "Waiting"
              }>
                {app[0]}
                {isActive ? " ●" : isNext ? " ▸" : served.has(app) ? " ✓" : ""}
              </span>
            );
          })}
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="w-full max-w-[640px] mx-auto aspect-square rounded-lg border border-slate-700/60 shadow-inner"
      />

      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
        {LEGEND.map((item) => (
          <div key={item.label} className="flex items-center gap-1 text-[10px] text-slate-400">
            <LegendIcon model={item.model} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
