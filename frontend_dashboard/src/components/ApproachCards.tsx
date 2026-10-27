import React from "react";
import { ApproachId, LiveJunctionSnapshot } from "../types";

interface Props {
  snapshot: LiveJunctionSnapshot;
  onLaneCountChange?: (approach: ApproachId, field: "bikes" | "cars" | "buses", val: number) => void;
}

const APPROACHES: ApproachId[] = ["NORTH", "EAST", "SOUTH", "WEST"];

export const ApproachCards: React.FC<Props> = ({ snapshot, onLaneCountChange }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
      {APPROACHES.map((appId) => {
        const vis = snapshot.vision[appId];
        const light = snapshot.fsm.lights[appId] || "RED";
        const isGreen = light === "GREEN";
        const isAmber = light === "AMBER";
        const waitTime = Math.round(snapshot.fsm.wait_timers[appId] || 0);
        const prio = snapshot.fsm.priority_scores[appId] ?? 0;
        const pcu = vis ? vis.effective_pcu : 0;
        const counts = vis?.counts || { two_wheeler: 0, car_lmv: 0, auto_rickshaw: 0, bus_truck_hmv: 0, ambulance_emergency: 0 };
        const isSkipped = pcu === 0 && !isGreen && !isAmber;

        let statusText = "🔴 RED (QUEUED)";
        let statusClass = "text-rose-400";
        let cardBorder = "border-slate-800 bg-slate-900/90";

        if (isGreen) {
          statusText = `🟢 GREEN (${Math.ceil(snapshot.fsm.remaining_sec)}s)`;
          statusClass = "text-emerald-400";
          cardBorder = "border-emerald-500/80 bg-slate-900 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/40";
        } else if (isAmber) {
          statusText = `🟡 AMBER (${Math.ceil(snapshot.fsm.remaining_sec)}s)`;
          statusClass = "text-amber-400";
          cardBorder = "border-amber-500/80 bg-slate-900 ring-1 ring-amber-500/40";
        } else if (isSkipped) {
          statusText = "⚪ SKIP (0s)";
          statusClass = "text-slate-400";
          cardBorder = "border-dashed border-slate-700 bg-slate-900/60 opacity-80";
        } else if (snapshot.fsm.next_approach === appId) {
          statusText = "🔵 NEXT GREEN";
          statusClass = "text-sky-400";
          cardBorder = "border-sky-500/60 bg-slate-900/90 ring-1 ring-sky-500/30";
        }

        return (
          <div
            key={appId}
            className={`p-3.5 rounded-xl border transition-all duration-200 ${cardBorder}`}
          >
            {/* Header */}
            <div className="flex justify-between items-center mb-2.5">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-slate-100">{appId} APPROACH</span>
                {vis?.emergency_visual && (
                  <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase bg-rose-600/30 text-rose-300 border border-rose-500 rounded-full animate-pulse">
                    🚑 Ambulance
                  </span>
                )}
              </div>
              <span className={`text-xs font-bold tracking-wide ${statusClass}`}>
                {statusText}
              </span>
            </div>

            {/* Sliders */}
            <div className="space-y-1.5 text-xs text-slate-300">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">🛵 Bikes (0.5 PCU):</span>
                <span className="font-mono text-slate-200 font-semibold">{counts.two_wheeler}</span>
              </div>
              <input
                type="range"
                min="0"
                max="24"
                value={counts.two_wheeler}
                onChange={(e) => onLaneCountChange?.(appId, "bikes", parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />

              <div className="flex justify-between items-center">
                <span className="text-slate-400">🚗 Cars / Autos (1.0 PCU):</span>
                <span className="font-mono text-slate-200 font-semibold">{counts.car_lmv}</span>
              </div>
              <input
                type="range"
                min="0"
                max="20"
                value={counts.car_lmv}
                onChange={(e) => onLaneCountChange?.(appId, "cars", parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />

              <div className="flex justify-between items-center">
                <span className="text-slate-400">🚌 Buses / Trucks (3.0 PCU):</span>
                <span className="font-mono text-slate-200 font-semibold">{counts.bus_truck_hmv}</span>
              </div>
              <input
                type="range"
                min="0"
                max="6"
                value={counts.bus_truck_hmv}
                onChange={(e) => onLaneCountChange?.(appId, "buses", parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
            </div>

            {/* Metrics Footer */}
            <div className="mt-3 pt-2.5 border-t border-slate-800 grid grid-cols-3 gap-2 text-center text-[11px]">
              <div className="bg-slate-800/60 p-1.5 rounded">
                <span className="text-slate-400 block text-[10px]">Queue Load</span>
                <strong className="text-slate-100 font-mono text-xs">{pcu.toFixed(1)} PCU</strong>
              </div>
              <div className="bg-slate-800/60 p-1.5 rounded">
                <span className="text-slate-400 block text-[10px]">Wait Clock</span>
                <strong className={`font-mono text-xs ${waitTime > 80 ? "text-amber-400" : "text-slate-100"}`}>
                  {waitTime}s
                </strong>
              </div>
              <div className="bg-slate-800/60 p-1.5 rounded">
                <span className="text-slate-400 block text-[10px]">Priority Score</span>
                <strong className="text-blue-400 font-mono text-xs">
                  {pcu === 0 ? "SKIP" : prio > 0 ? prio.toFixed(1) : "0.0"}
                </strong>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
