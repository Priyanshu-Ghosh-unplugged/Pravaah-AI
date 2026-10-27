import React from "react";
import { ApproachId } from "../types";
import { Radio, AlertTriangle, RefreshCw, Shield, Siren } from "lucide-react";

interface Props {
  ambulanceActive: boolean;
  onApplyPreset: (name: "rush_asymmetric" | "late_night" | "starvation_test" | "ambulance_east" | "reset_normal") => void;
  onToggleAmbulance: () => void;
  onForceApproach: (approach: ApproachId) => void;
  onClearOverride: () => void;
}

export const PoliceOverrideBar: React.FC<Props> = ({
  ambulanceActive,
  onApplyPreset,
  onToggleAmbulance,
  onForceApproach,
  onClearOverride,
}) => {
  return (
    <div className="bg-slate-900/90 border border-slate-800 p-4 rounded-xl space-y-3">
      {/* Preset Buttons */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Radio className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            Live Scenario Demonstrator (Preserved for Demo / Pitch)
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onApplyPreset("rush_asymmetric")}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 transition"
          >
            1. Rush Hour (Empty South)
          </button>
          <button
            onClick={() => onApplyPreset("late_night")}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700 transition"
          >
            2. Late Night (3 Empty Lanes)
          </button>
          <button
            onClick={() => onApplyPreset("starvation_test")}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700 transition"
          >
            3. Side-Lane Anti-Starvation
          </button>
          <button
            onClick={onToggleAmbulance}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg border flex items-center gap-1.5 transition ${
              ambulanceActive
                ? "bg-rose-600 text-white border-rose-500 shadow-lg shadow-rose-600/30 animate-pulse"
                : "bg-rose-500/10 text-rose-300 border-rose-500/30 hover:bg-rose-500/20"
            }`}
          >
            <Siren className="w-3.5 h-3.5" />
            {ambulanceActive ? "🚨 Preempting (East Lane)" : "🚑 Trigger East Ambulance"}
          </button>
          <button
            onClick={() => onApplyPreset("reset_normal")}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Police Override Buttons */}
      <div className="pt-2 border-t border-slate-800/80">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            Traffic Police Manual Override Terminal (Authenticated)
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["NORTH", "EAST", "SOUTH", "WEST"] as ApproachId[]).map((app) => (
            <button
              key={app}
              onClick={() => onForceApproach(app)}
              className="px-2.5 py-1 text-xs font-medium rounded-md bg-slate-800/80 text-slate-300 border border-slate-700 hover:border-blue-500 hover:text-blue-300 transition"
            >
              Force {app}
            </button>
          ))}
          <button
            onClick={onClearOverride}
            className="px-2.5 py-1 text-xs font-medium rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 transition flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            Clear Override
          </button>
        </div>
      </div>
    </div>
  );
};
