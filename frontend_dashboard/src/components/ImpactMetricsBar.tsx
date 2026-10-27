import React from "react";
import { ImpactKpis } from "../types";
import { TrendingDown, Zap, Fuel, Leaf, ShieldAlert } from "lucide-react";

interface Props {
  kpis: ImpactKpis;
  skippedPhases: number;
  emergencyClears: number;
}

export const ImpactMetricsBar: React.FC<Props> = ({ kpis, skippedPhases, emergencyClears }) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-xl flex items-center gap-3">
        <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <TrendingDown className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] text-slate-400 font-medium block">Wait Time Saved</span>
          <strong className="text-lg font-bold text-emerald-400 font-mono">
            {kpis.wait_reduction_pct.toFixed(1)}%
          </strong>
        </div>
      </div>

      <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-xl flex items-center gap-3">
        <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
          <Zap className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] text-slate-400 font-medium block">Empty Skips (0s)</span>
          <strong className="text-lg font-bold text-blue-400 font-mono">
            {skippedPhases}
          </strong>
        </div>
      </div>

      <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-xl flex items-center gap-3">
        <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <Fuel className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] text-slate-400 font-medium block">Fuel Saved Today</span>
          <strong className="text-lg font-bold text-amber-400 font-mono">
            {kpis.fuel_saved_litres.toFixed(2)} L
          </strong>
        </div>
      </div>

      <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-xl flex items-center gap-3">
        <div className="p-2.5 rounded-lg bg-teal-500/10 text-teal-400 border border-teal-500/20">
          <Leaf className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] text-slate-400 font-medium block">CO₂ Avoided</span>
          <strong className="text-lg font-bold text-teal-400 font-mono">
            {kpis.co2_avoided_kg.toFixed(1)} kg
          </strong>
        </div>
      </div>

      <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-xl flex items-center gap-3">
        <div className="p-2.5 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] text-slate-400 font-medium block">Ambulance Flushes</span>
          <strong className="text-lg font-bold text-rose-400 font-mono">
            {emergencyClears}
          </strong>
        </div>
      </div>
    </div>
  );
};
