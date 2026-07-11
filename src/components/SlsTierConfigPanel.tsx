import React, { useState, useEffect } from "react";
import { SlsObject, StorageTier } from "../types/sls";
import { Cpu, HardDrive, Database, Layers, Activity, RefreshCw, Server, Flame, AlertCircle, Settings2, Sparkles, Sliders, Timer, ArrowDownToLine, ZapOff } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface SlsTierConfigPanelProps {
  autoTierEnabled: boolean;
  setAutoTierEnabled: (val: boolean) => void;
  ssdThreshold: number;
  setSsdThreshold: (val: number) => void;
  archiveThreshold: number;
  setArchiveThreshold: (val: number) => void;
  objects: SlsObject[];
}

export default function SlsTierConfigPanel({
  autoTierEnabled,
  setAutoTierEnabled,
  ssdThreshold,
  setSsdThreshold,
  archiveThreshold,
  setArchiveThreshold,
  objects
}: SlsTierConfigPanelProps) {
  const [now, setNow] = useState(Date.now());

  // Periodically tick the current time to recalculate real-time inactivity of objects
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 500);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="bg-[#0B0E14] border border-white/10 p-8 flex flex-col xl:flex-row gap-8 mt-8" id="sls-tier-config-dashboard">
      
      {/* Left Column: Interactive Controls */}
      <div className="flex-1 space-y-6">
        <div className="border-b border-white/10 pb-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] tracking-widest text-cyan-400 uppercase font-semibold">Microkernel Resource Scheduler</span>
            <span className={`border text-[8px] px-1.5 py-0.5 font-mono uppercase tracking-widest ${autoTierEnabled ? "bg-cyan-400/10 text-cyan-400 border-cyan-400/20" : "bg-white/5 text-white/40 border-white/10"}`}>
              {autoTierEnabled ? "Daemon Active" : "Daemon Suspended"}
            </span>
          </div>
          <h3 className="text-xl font-serif italic text-white mt-1">
            Automated Tier-Migration Thresholds
          </h3>
          <p className="text-white/60 text-xs font-light leading-relaxed mt-2">
            The SLS microkernel runs a low-overhead background thread that sweeps the flat address catalog, measuring inactivity intervals on active objects. Demoting cold segments preserves fast SRAM/DRAM page registers for active execution lines.
          </p>
        </div>

        {/* Global Daemon Toggle */}
        <div className="bg-[#0F1219] border border-white/5 p-4 flex items-center justify-between">
          <div className="space-y-1">
            <h4 className="font-serif italic text-sm text-white flex items-center gap-2">
              <RefreshCw className={`w-4 h-4 text-cyan-400 ${autoTierEnabled ? "animate-spin" : ""}`} />
              Background Demotion Sweeper
            </h4>
            <p className="text-[11px] text-white/50 font-light">
              Toggle continuous background page scans & automatic LZX compression.
            </p>
          </div>
          <button
            onClick={() => {
              const next = !autoTierEnabled;
              setAutoTierEnabled(next);
              localStorage.setItem("sls_auto_tier_enabled", String(next));
            }}
            className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition-colors cursor-pointer border ${
              autoTierEnabled
                ? "bg-cyan-400 text-[#0B0E14] font-bold border-cyan-400"
                : "border-white/10 text-white/40 hover:text-white"
            }`}
          >
            {autoTierEnabled ? "Active" : "Disabled"}
          </button>
        </div>

        {/* Sliders for custom thresholds */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* L3 SSD Demotion Slider */}
          <div className="bg-[#0F1219] border border-white/5 p-5 space-y-4">
            <div className="flex justify-between items-center">
              <span className="font-mono text-[10px] tracking-widest text-amber-400 uppercase font-bold flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5" /> DRAM ➔ SSD Demotion
              </span>
              <span className="font-mono text-xs text-white font-semibold">
                {ssdThreshold}s Idle
              </span>
            </div>
            <p className="text-[11px] text-white/50 leading-relaxed font-light">
              Move volatile RAM objects to PCIe Flash storage when unaccessed for this period.
            </p>
            <div className="space-y-2 pt-2">
              <input
                type="range"
                min={5}
                max={60}
                step={5}
                value={ssdThreshold}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setSsdThreshold(val);
                  localStorage.setItem("sls_ssd_threshold", String(val));
                  // Ensure archive threshold stays logical
                  if (archiveThreshold < val) {
                    setArchiveThreshold(val + 5);
                    localStorage.setItem("sls_archive_threshold", String(val + 5));
                  }
                }}
                disabled={!autoTierEnabled}
                className="w-full accent-amber-400 h-1.5 bg-white/5 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              />
              <div className="flex justify-between font-mono text-[9px] text-white/30">
                <span>5 Seconds</span>
                <span>30s</span>
                <span>60 Seconds</span>
              </div>
            </div>
          </div>

          {/* L4 Archive Demotion Slider */}
          <div className="bg-[#0F1219] border border-white/5 p-5 space-y-4">
            <div className="flex justify-between items-center">
              <span className="font-mono text-[10px] tracking-widest text-fuchsia-400 uppercase font-bold flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" /> SSD ➔ Compressed Archive
              </span>
              <span className="font-mono text-xs text-white font-semibold">
                {archiveThreshold}s Idle
              </span>
            </div>
            <p className="text-[11px] text-white/50 leading-relaxed font-light">
              Apply structural LZX compression and move cold SSD blocks to deep archival sectors.
            </p>
            <div className="space-y-2 pt-2">
              <input
                type="range"
                min={Math.max(10, ssdThreshold + 5)}
                max={120}
                step={5}
                value={archiveThreshold}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setArchiveThreshold(val);
                  localStorage.setItem("sls_archive_threshold", String(val));
                }}
                disabled={!autoTierEnabled}
                className="w-full accent-fuchsia-400 h-1.5 bg-white/5 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              />
              <div className="flex justify-between font-mono text-[9px] text-white/30">
                <span>{ssdThreshold + 5} Seconds</span>
                <span>60s</span>
                <span>120 Seconds</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Right Column: Real-time Object Scanner Trackers */}
      <div className="w-full xl:w-96 shrink-0 bg-[#0F1219]/40 border-l xl:border-l border-t xl:border-t-0 border-white/10 pt-6 xl:pt-0 xl:pl-8 flex flex-col justify-between">
        <div className="space-y-5">
          <div>
            <span className="font-mono text-[9px] tracking-widest text-cyan-400 uppercase font-bold">Active Memory Indexer</span>
            <h4 className="text-base font-serif italic text-white mt-0.5">Automated Demotion Monitor</h4>
          </div>

          <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1 scrollbar-thin">
            {objects.map((obj) => {
              const inactiveSec = Math.max(0, Math.floor((now - new Date(obj.lastAccessTime).getTime()) / 1000));
              
              // Calculate migration target state
              let pctToSsd = 0;
              let pctToArchive = 0;

              if (obj.tier === StorageTier.L1_CACHE || obj.tier === StorageTier.L2_DRAM) {
                pctToSsd = Math.min(100, (inactiveSec / ssdThreshold) * 100);
              } else if (obj.tier === StorageTier.L3_SSD) {
                pctToSsd = 100;
                pctToArchive = Math.min(100, (inactiveSec / archiveThreshold) * 100);
              } else {
                pctToSsd = 100;
                pctToArchive = 100;
              }

              return (
                <div key={obj.id} className="bg-[#0B0E14] border border-white/5 p-3.5 space-y-2">
                  <div className="flex justify-between items-start">
                    <div className="min-w-0">
                      <span className="text-white font-mono text-[11px] block truncate">{obj.name}</span>
                      <span className="text-white/30 font-mono text-[9px] uppercase tracking-wider block">
                        Tier: <strong className="text-cyan-400">{obj.tier}</strong>
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[10px] font-mono text-white/40 block">INACTIVE FOR</span>
                      <span className="text-white font-mono text-xs font-bold block">{inactiveSec}s</span>
                    </div>
                  </div>

                  {/* Progress Line */}
                  <div className="space-y-1">
                    {obj.tier !== StorageTier.L4_ARCHIVE ? (
                      <>
                        <div className="flex justify-between text-[8px] font-mono text-white/30">
                          {obj.tier === StorageTier.L3_SSD ? (
                            <>
                              <span>To Archive Threshold ({archiveThreshold}s)</span>
                              <span>{Math.round(pctToArchive)}%</span>
                            </>
                          ) : (
                            <>
                              <span>To SSD Threshold ({ssdThreshold}s)</span>
                              <span>{Math.round(pctToSsd)}%</span>
                            </>
                          )}
                        </div>
                        <div className="h-1 w-full bg-white/5 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              obj.tier === StorageTier.L3_SSD ? "bg-fuchsia-400" : "bg-amber-400"
                            }`}
                            style={{ width: `${obj.tier === StorageTier.L3_SSD ? pctToArchive : pctToSsd}%` }}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-1 text-emerald-400 font-mono text-[9px] uppercase">
                        <ArrowDownToLine className="w-3.5 h-3.5 shrink-0" /> Stable in Deep Archival Storage
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {objects.length === 0 && (
              <p className="text-white/20 italic font-mono text-[10px] text-center py-6">
                No active heap objects allocated.
              </p>
            )}
          </div>
        </div>

        {/* Informative Help Alert */}
        <div className="pt-4 border-t border-white/10 mt-4">
          <p className="text-[10px] text-white/40 font-mono leading-relaxed flex gap-2">
            <Timer className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>
              If you dereference address lines, objects return instantly to DRAM registers. Once idle, they demote per these rule coordinates.
            </span>
          </p>
        </div>
      </div>

    </div>
  );
}
