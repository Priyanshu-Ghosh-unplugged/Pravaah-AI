import React, { useState } from "react";
import { ApproachId } from "../types";
import { QrCode, HeartHandshake, AlertCircle, CheckCircle, ShieldCheck, Globe } from "lucide-react";

interface Props {
  junctionId: string;
  onRequestSeniorWalk: (approach: ApproachId) => Promise<boolean>;
  onSubmitIssue: (category: string, approach?: ApproachId, note?: string) => Promise<string | null>;
}

type Language = "en" | "hi" | "bn";

const TRANSLATIONS = {
  en: {
    title: "PRAVAAH CIVIC MOBILITY",
    subtitle: "Pole QR Citizen Portal",
    mode: "Adaptive AI Active (100% Private - No Face/Plate Recording)",
    seniorHeader: "Need Extra Crossing Time? (Senior / PwD)",
    seniorDesc: "Tap your zebra crossing to queue +6 seconds of safe walking time on the next green walk signal.",
    issueHeader: "Report a Signal or Road Issue",
    categories: {
      BULB_OUT: "Red / Amber / Green LED Bulb Not Glowing",
      WATERLOGGING: "Heavy Waterlogging at Pedestrian Crossing",
      OBSTRUCTION: "Fallen Tree / Road Obstacle / Parked Cart",
      BUZZER_SILENT: "Audible Pedestrian Walk Buzzer Silent",
    },
    notePlaceholder: "Optional Note for Traffic ICCC (e.g., North pole #2)...",
    submitBtn: "Submit Ticket to Traffic Control",
    transparencyHeader: "Civic Impact This Week",
    privacyBadge: "DPDP Act 2023 Compliant: Ephemeral RAM Processing Only",
  },
  hi: {
    title: "प्रवाह नागरिक गतिशीलता",
    subtitle: "पोल क्यूआर नागरिक पोर्टल",
    mode: "स्मार्ट एआई सक्रिय (100% गोपनीय - कोई चेहरा/नंबर प्लेट रिकॉर्ड नहीं)",
    seniorHeader: "सड़क पार करने के लिए अतिरिक्त समय चाहिए? (वरिष्ठ नागरिक / दिव्यांग)",
    seniorDesc: "अगले पैदल सिग्नल पर सुरक्षित पार करने के लिए +6 सेकंड अतिरिक्त जोड़ने हेतु जेब्रा क्रॉसिंग चुनें।",
    issueHeader: "सिग्नल या सड़क समस्या की रिपोर्ट करें",
    categories: {
      BULB_OUT: "लाल/पीली/हरी लाइट नहीं जल रही है",
      WATERLOGGING: "पैदल पार पथ पर भारी जलभराव",
      OBSTRUCTION: "गिरा हुआ पेड़ / अवरोध / अवैध ठेला",
      BUZZER_SILENT: "पैदल पार पथ का बीप बजर शांत है",
    },
    notePlaceholder: "अतिरिक्त विवरण (वैकल्पिक)...",
    submitBtn: "ट्रैफिक कंट्रोल को टिकट भेजें",
    transparencyHeader: "इस सप्ताह का नागरिक प्रभाव",
    privacyBadge: "डिजिटल डेटा संरक्षण अधिनियम 2023 अनुपालित: केवल क्षणिक रैम प्रक्रिया",
  },
  bn: {
    title: "প্রবাহ নাগরিক গতিশীলতা",
    subtitle: "পোল কিউআর সিটিজেন পোর্টাল",
    mode: "স্মার্ট এআই সক্রিয় (১০০% ব্যক্তিগত - কোনো মুখ বা নম্বর প্লেট রেকর্ড হয় না)",
    seniorHeader: "রাস্তা পারাপারে অতিরিক্ত সময় প্রয়োজন? (বয়স্ক / বিশেষভাবে সক্ষম)",
    seniorDesc: "পরবর্তী সবুজ সিগন্যালে অতিরিক্ত ৬ সেকেন্ড নিরাপদ হাঁটার সময় পেতে জেব্রা ক্রসিং নির্বাচন করুন।",
    issueHeader: "সিগন্যাল বা রাস্তার ত্রুটি রিপোর্ট করুন",
    categories: {
      BULB_OUT: "লাল/হলুদ/সবুজ আলো জ্বলছে না",
      WATERLOGGING: "জেব্রা ক্রসিংয়ে জল জমে আছে",
      OBSTRUCTION: "গাছ পড়ে রাস্তা বন্ধ / অবৈধ ভেন্ডার ভ্যান",
      BUZZER_SILENT: "শব্দ সংকেত বাজার বাজছে না",
    },
    notePlaceholder: "অতিরিক্ত তথ্য (ঐচ্ছিক)...",
    submitBtn: "ট্র্যাফিক কন্ট্রোলে টিকিট জমা দিন",
    transparencyHeader: "এই সপ্তাহের নাগরিক সুবিধা",
    privacyBadge: "ডিপিডিপি অ্যাক্ট ২০২৩ মেনে পরিচালিত: কোনো তথ্য স্টোরেজ নেই",
  },
};

export const CitizenQRPortal: React.FC<Props> = ({
  junctionId,
  onRequestSeniorWalk,
  onSubmitIssue,
}) => {
  const [lang, setLang] = useState<Language>("en");
  const [seniorStatus, setSeniorStatus] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("BULB_OUT");
  const [selectedApproach, setSelectedApproach] = useState<ApproachId>("NORTH");
  const [citizenNote, setCitizenNote] = useState<string>("");
  const [ticketResult, setTicketResult] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const t = TRANSLATIONS[lang];

  const handleSeniorWalk = async (app: ApproachId) => {
    setSeniorStatus(`Queueing extra time for ${app} zebra...`);
    const ok = await onRequestSeniorWalk(app);
    if (ok) {
      setSeniorStatus(`✅ Extra +6s queued for ${app} crosswalk on next cycle!`);
      setTimeout(() => setSeniorStatus(null), 6000);
    } else {
      setSeniorStatus(`⚠️ Cooldown active. Please wait for current cycle to clear.`);
      setTimeout(() => setSeniorStatus(null), 4000);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const ticketId = await onSubmitIssue(selectedCategory, selectedApproach, citizenNote);
    setSubmitting(false);
    if (ticketId) {
      setTicketResult(ticketId);
      setCitizenNote("");
      setTimeout(() => setTicketResult(null), 8000);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-xl overflow-hidden max-w-md mx-auto">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-emerald-700 p-4 text-white">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-200">
              <QrCode className="w-3.5 h-3.5" />
              <span>{junctionId}</span>
            </div>
            <h3 className="font-extrabold text-base tracking-tight mt-0.5">{t.title}</h3>
            <p className="text-[11px] text-blue-100">{t.subtitle}</p>
          </div>

          {/* Vernacular Language Switcher */}
          <div className="flex items-center gap-1 bg-black/25 backdrop-blur-sm p-1 rounded-lg border border-white/20">
            <Globe className="w-3.5 h-3.5 text-blue-200 ml-1" />
            <button
              onClick={() => setLang("en")}
              className={`px-1.5 py-0.5 text-xs font-bold rounded ${
                lang === "en" ? "bg-white text-slate-900" : "text-white hover:bg-white/10"
              }`}
            >
              EN
            </button>
            <button
              onClick={() => setLang("hi")}
              className={`px-1.5 py-0.5 text-xs font-bold rounded ${
                lang === "hi" ? "bg-white text-slate-900" : "text-white hover:bg-white/10"
              }`}
            >
              हिं
            </button>
            <button
              onClick={() => setLang("bn")}
              className={`px-1.5 py-0.5 text-xs font-bold rounded ${
                lang === "bn" ? "bg-white text-slate-900" : "text-white hover:bg-white/10"
              }`}
            >
              বাং
            </button>
          </div>
        </div>

        <div className="mt-2 text-[10px] bg-emerald-950/60 text-emerald-200 px-2 py-1 rounded border border-emerald-400/30 flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
          <span>{t.mode}</span>
        </div>
      </div>

      <div className="p-4 space-y-4 text-slate-200">
        {/* Senior Pedestrian Walk Assistance */}
        <div className="bg-slate-800/80 border border-slate-700 p-3.5 rounded-xl">
          <div className="flex items-center gap-2 text-emerald-400 mb-1.5">
            <HeartHandshake className="w-4 h-4" />
            <strong className="text-xs font-bold">{t.seniorHeader}</strong>
          </div>
          <p className="text-[11px] text-slate-400 mb-2.5 leading-relaxed">{t.seniorDesc}</p>

          <div className="grid grid-cols-2 gap-2">
            {(["NORTH", "EAST", "SOUTH", "WEST"] as ApproachId[]).map((app) => (
              <button
                key={app}
                onClick={() => handleSeniorWalk(app)}
                className="py-1.5 px-2 text-xs font-semibold rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 hover:border-emerald-400 transition text-center"
              >
                {app} Zebra
              </button>
            ))}
          </div>

          {seniorStatus && (
            <p className="mt-2 text-[11px] text-emerald-400 font-medium bg-emerald-950/40 p-1.5 rounded border border-emerald-500/20 animate-fade-in">
              {seniorStatus}
            </p>
          )}
        </div>

        {/* 2-Tap Issue Reporting Form */}
        <form onSubmit={handleSubmit} className="bg-slate-800/80 border border-slate-700 p-3.5 rounded-xl space-y-3">
          <div className="flex items-center gap-2 text-blue-400">
            <AlertCircle className="w-4 h-4" />
            <strong className="text-xs font-bold">{t.issueHeader}</strong>
          </div>

          {/* Issue Category Radio/Select */}
          <div className="space-y-1.5">
            {Object.entries(t.categories).map(([catKey, catLabel]) => (
              <label
                key={catKey}
                className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer text-xs border transition ${
                  selectedCategory === catKey
                    ? "bg-blue-600/20 border-blue-500 text-slate-100"
                    : "bg-slate-900/50 border-slate-700/80 text-slate-300 hover:border-slate-600"
                }`}
              >
                <input
                  type="radio"
                  name="issue_category"
                  checked={selectedCategory === catKey}
                  onChange={() => setSelectedCategory(catKey)}
                  className="mt-0.5 accent-blue-500"
                />
                <span>{catLabel}</span>
              </label>
            ))}
          </div>

          <div className="flex gap-2">
            <select
              value={selectedApproach}
              onChange={(e) => setSelectedApproach(e.target.value as ApproachId)}
              className="bg-slate-900 border border-slate-700 text-xs rounded-lg px-2.5 py-1.5 text-slate-200"
            >
              <option value="NORTH">North Approach</option>
              <option value="EAST">East Approach</option>
              <option value="SOUTH">South Approach</option>
              <option value="WEST">West Approach</option>
            </select>

            <input
              type="text"
              placeholder={t.notePlaceholder}
              value={citizenNote}
              onChange={(e) => setCitizenNote(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-700 text-xs rounded-lg px-2.5 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2 px-3 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition flex justify-center items-center gap-1.5 shadow-md shadow-blue-600/20"
          >
            {submitting ? "Submitting..." : t.submitBtn}
          </button>

          {ticketResult && (
            <div className="bg-emerald-950/60 border border-emerald-500/40 p-2.5 rounded-lg flex items-center gap-2 text-xs text-emerald-300">
              <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>
                Ticket Created: <strong>{ticketResult}</strong>. Routed to ICCC Maintenance Queue.
              </span>
            </div>
          )}
        </form>

        {/* Civic Transparency Impact Card */}
        <div className="bg-gradient-to-br from-slate-800/90 to-slate-900 p-3 rounded-xl border border-slate-700/60 text-xs space-y-1.5">
          <strong className="text-slate-300 text-[11px] uppercase tracking-wider block">
            {t.transparencyHeader}
          </strong>
          <div className="grid grid-cols-3 gap-2 text-center pt-1">
            <div className="bg-slate-800/80 p-1.5 rounded">
              <span className="text-[10px] text-slate-400 block">Avg Wait</span>
              <strong className="text-emerald-400 font-mono text-xs">-38.4%</strong>
            </div>
            <div className="bg-slate-800/80 p-1.5 rounded">
              <span className="text-[10px] text-slate-400 block">Fuel Saved</span>
              <strong className="text-amber-400 font-mono text-xs">890 L</strong>
            </div>
            <div className="bg-slate-800/80 p-1.5 rounded">
              <span className="text-[10px] text-slate-400 block">Ambulances</span>
              <strong className="text-rose-400 font-mono text-xs">19 Cleared</strong>
            </div>
          </div>
          <p className="text-[10px] text-slate-400 text-center pt-1">
            {t.privacyBadge}
          </p>
        </div>
      </div>
    </div>
  );
};
