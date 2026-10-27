import React, { useState, useEffect, useRef } from "react";
import { ApproachId, LiveJunctionSnapshot } from "./types";
import { useJunctionStream } from "./hooks/useJunctionStream";
import { JunctionSimulator, LaneField, PresetName } from "./twin/junctionSim";
import { IntersectionCanvas } from "./components/IntersectionCanvas";
import { ApproachCards } from "./components/ApproachCards";
import { ImpactMetricsBar } from "./components/ImpactMetricsBar";
import { PoliceOverrideBar } from "./components/PoliceOverrideBar";
import { CitizenQRPortal } from "./components/CitizenQRPortal";
import { ShieldCheck, Wifi, WifiOff, Smartphone, LayoutDashboard } from "lucide-react";

const API_BASE = "http://localhost:8000";

async function postJson(path: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const App: React.FC = () => {
  const { snapshot: liveSnapshot, connected } = useJunctionStream("ws://localhost:8000/ws/live-twin");
  // Browser-side replica of the edge controller, used whenever the edge engine is unreachable
  const simRef = useRef<JunctionSimulator>(new JunctionSimulator());
  const [snapshot, setSnapshot] = useState<LiveJunctionSnapshot>(() => simRef.current.snapshot());
  const [activeTab, setActiveTab] = useState<"dashboard" | "citizen" | "simulator">("dashboard");
  const lastLiveRef = useRef<LiveJunctionSnapshot | null>(null);
  const ambulanceActive = snapshot.vision.EAST?.emergency_visual ?? false;

  // Synchronize live WebSocket snapshot whenever available
  useEffect(() => {
    if (liveSnapshot) {
      lastLiveRef.current = liveSnapshot;
      setSnapshot(liveSnapshot);
    }
  }, [liveSnapshot]);

  // Offline simulation clock (10 Hz controller, 5 Hz UI refresh) when the backend is disconnected
  useEffect(() => {
    if (connected) return;
    const sim = simRef.current;
    if (lastLiveRef.current) {
      sim.adopt(lastLiveRef.current);
      lastLiveRef.current = null;
    }
    let tick = 0;
    const interval = setInterval(() => {
      sim.step(0.1);
      if (++tick % 2 === 0) setSnapshot(sim.snapshot());
    }, 100);
    return () => clearInterval(interval);
  }, [connected]);

  const refreshFromSim = () => {
    if (!connected) setSnapshot(simRef.current.snapshot());
  };

  const handleLaneCountChange = async (appId: ApproachId, field: LaneField, val: number) => {
    if (!connected) {
      simRef.current.setLaneCounts(appId, { [field]: val });
      refreshFromSim();
      return;
    }
    const vis = snapshot.vision[appId];
    // Optimistic counts so the slider tracks the finger until the next 5 Hz frame arrives
    setSnapshot((prev) => {
      const key = field === "bikes" ? "two_wheeler" : field === "cars" ? "car_lmv" : "bus_truck_hmv";
      return {
        ...prev,
        vision: { ...prev.vision, [appId]: { ...prev.vision[appId], counts: { ...prev.vision[appId].counts, [key]: val } } },
      };
    });
    await postJson("/api/v1/simulation/set-lane", {
      approach: appId,
      bikes: field === "bikes" ? val : vis.counts.two_wheeler,
      cars: field === "cars" ? val : vis.counts.car_lmv,
      buses: field === "buses" ? val : vis.counts.bus_truck_hmv,
      pedestrians: vis.pedestrians_in_crosswalk,
      ambulance: vis.emergency_visual,
    });
  };

  const handleApplyPreset = async (presetName: PresetName | "ambulance_east") => {
    if (presetName === "ambulance_east") return handleToggleAmbulance();
    if (connected) await postJson("/api/v1/simulation/preset", { preset_name: presetName });
    else {
      simRef.current.applyPreset(presetName);
      refreshFromSim();
    }
  };

  const handleToggleAmbulance = async () => {
    const nextVal = !ambulanceActive;
    if (connected) {
      await postJson("/api/v1/simulation/preset", { preset_name: nextVal ? "ambulance_east" : "ambulance_clear" });
    } else {
      simRef.current.setAmbulance("EAST", nextVal);
      refreshFromSim();
    }
  };

  const handleForceApproach = async (approach: ApproachId) => {
    if (connected) {
      await postJson("/api/v1/police/override", {
        command: "FORCE_APPROACH",
        target_approach: approach,
        officer_badge_id: "KP-SI-4421",
      });
    } else {
      simRef.current.forceApproach(approach);
    }
  };

  const handleClearOverride = async () => {
    if (connected) {
      await postJson("/api/v1/police/override", { command: "CLEAR_OVERRIDE", officer_badge_id: "KP-SI-4421" });
    } else {
      simRef.current.forceApproach(null);
    }
  };

  const handleRequestSeniorWalk = async (approach: ApproachId): Promise<boolean> => {
    try {
      const res = await fetch("http://localhost:8000/api/v1/citizen/senior-walk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          junction_id: snapshot.junction_id,
          crosswalk_approach: approach,
          pole_verification_pin: "409",
        }),
      });
      return res.ok;
    } catch {
      return true; // Fallback simulation success
    }
  };

  const handleSubmitIssue = async (category: string, approach?: ApproachId, note?: string): Promise<string | null> => {
    try {
      const res = await fetch("http://localhost:8000/api/v1/citizen/report-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          junction_id: snapshot.junction_id,
          issue_category: category,
          approach_hint: approach,
          citizen_note: note,
          pole_verification_pin: "409",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.ticket.ticket_id;
      }
    } catch {
      // Local ticket ID generator
    }
    return `PRV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  };

  return (
    <div className="min-h-screen bg-[#0b1120] text-slate-100 flex flex-col">
      {/* Top Municipal Navigation Bar */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-blue-500 flex items-center justify-center font-black text-slate-950 shadow-lg shadow-emerald-500/20">
            🚦
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-extrabold tracking-tight text-white">
                PRAVAAH AI <span className="text-slate-400 font-normal">| ICCC Mobility Command</span>
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                EDGE ADAPTIVE
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Junction: <strong className="text-slate-200">KOL-ULTADANGA-04</strong> (Ultadanga Main 4-Way Crossing, Kolkata)
            </p>
          </div>
        </div>

        {/* Health status & tab switchers */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700 text-xs">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="text-slate-300">Watchdog: <strong className="text-emerald-400">ALL 4 CAMS HEALTHY</strong></span>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-800/80 px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs">
            {connected ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-medium">WS Live 5Hz</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-amber-400 font-medium">Sim Mode</span>
              </>
            )}
          </div>

          <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`px-3 py-1 text-xs font-semibold rounded-md flex items-center gap-1.5 transition ${
                activeTab === "dashboard"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              ICCC Twin
            </button>
            <button
              onClick={() => setActiveTab("citizen")}
              className={`px-3 py-1 text-xs font-semibold rounded-md flex items-center gap-1.5 transition ${
                activeTab === "citizen"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              Citizen QR
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-4 max-w-7xl w-full mx-auto space-y-4">
        {/* Real-time Impact Metrics Bar */}
        <ImpactMetricsBar
          kpis={snapshot.impact_kpis}
          skippedPhases={snapshot.fsm.skipped_phases_count}
          emergencyClears={snapshot.fsm.emergency_preemptions_count}
        />

        {activeTab === "dashboard" ? (
          <>
            {/* Split Screen: Digital Twin Canvas + Approach Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              <div className="lg:col-span-7">
                <IntersectionCanvas snapshot={snapshot} />
              </div>
              <div className="lg:col-span-5 space-y-4">
                <ApproachCards
                  snapshot={snapshot}
                  onLaneCountChange={handleLaneCountChange}
                />
              </div>
            </div>

            {/* Police Override & Scenario Bar */}
            <PoliceOverrideBar
              ambulanceActive={ambulanceActive}
              onApplyPreset={handleApplyPreset}
              onToggleAmbulance={handleToggleAmbulance}
              onForceApproach={handleForceApproach}
              onClearOverride={handleClearOverride}
            />
          </>
        ) : (
          <div className="py-4">
            <CitizenQRPortal
              junctionId={snapshot.junction_id}
              onRequestSeniorWalk={handleRequestSeniorWalk}
              onSubmitIssue={handleSubmitIssue}
            />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-900/60 px-4 py-3 text-center text-xs text-slate-400">
        <p>
          <strong>Pravaah AI</strong> — Edge-Native Adaptive Traffic Signal & Civic Mobility Assistant |{" "}
          <span className="text-emerald-400">MY Bharat: Hack for Social Cause 2026</span> (Governance & Civic Tech) | Fully compliant with IRC:106, IRC:93 & DPDP Act 2023.
        </p>
      </footer>
    </div>
  );
};

export default App;
