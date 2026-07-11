import React, { useState, useEffect } from "react";
import { SlsSystemMetrics } from "../types/sls";
import { Activity, ShieldAlert, Heart, Info, RefreshCw, CheckCircle2, AlertTriangle, Zap, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface SlsSystemHealthProps {
  systemMetrics: SlsSystemMetrics;
  setSystemMetrics?: React.Dispatch<React.SetStateAction<SlsSystemMetrics>>;
}

export default function SlsSystemHealth({ systemMetrics, setSystemMetrics }: SlsSystemHealthProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optStep, setOptStep] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState(false);

  const totalAccesses = systemMetrics.totalAccesses;
  const pageFaultCount = systemMetrics.pageFaultCount;
  const uptimeSeconds = systemMetrics.uptimeSeconds;

  // Calculate page fault percentage of total accesses
  const pfRate = totalAccesses > 0 ? (pageFaultCount / totalAccesses) * 100 : 0;

  // Calculate page faults per minute
  const pfPerMin = uptimeSeconds > 0 ? (pageFaultCount / uptimeSeconds) * 60 : 0;

  // Real-time risk score calculation (scaled 5 to 99)
  const baseRisk = 6;
  const pfAccessWeight = pfRate * 2.2;
  const pfFrequencyWeight = Math.min(35, pfPerMin * 0.75);
  const rawScore = baseRisk + pfAccessWeight + pfFrequencyWeight;
  const score = Math.round(Math.min(99, Math.max(5, rawScore)));

  // Uptime impact (nominal stabilizing factor over time)
  const uptimeFactor = Math.min(15, uptimeSeconds / 120);

  // Health Score is inverse of risk with stabilizing factor
  const healthScore = Math.max(1, Math.min(100, Math.round(100 - score + uptimeFactor)));

  // Risk & Health Classification
  let riskLevel: "LOW" | "ELEVATED" | "CRITICAL" = "LOW";
  let statusColor = "text-emerald-400";
  let badgeBg = "bg-emerald-500/10 border-emerald-500/20";
  let pulseColor = "bg-emerald-400";
  let progressColor = "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]";

  if (score > 55) {
    riskLevel = "CRITICAL";
    statusColor = "text-red-500";
    badgeBg = "bg-red-500/10 border-red-500/20";
    pulseColor = "bg-red-500";
    progressColor = "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]";
  } else if (score > 25) {
    riskLevel = "ELEVATED";
    statusColor = "text-amber-500";
    badgeBg = "bg-amber-500/10 border-amber-500/20";
    pulseColor = "bg-amber-500";
    progressColor = "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]";
  }

  // Optimize handler (reduces page fault rate count by flushing back to DRAM cache)
  const handleOptimize = () => {
    if (!setSystemMetrics) return;
    setIsOptimizing(true);
    setSuccessMsg(false);

    const steps = [
      "Locking translation table registers...",
      "Pre-fetching hot L4 archival blocks...",
      "Decompressing LZX sectors into RAM buffer...",
      "Re-allocating uncompressed page frames...",
      "Compacting DRAM page tables...",
      "Verification complete: Parity OK!"
    ];

    let currentStep = 0;
    setOptStep(steps[0]);

    const interval = setInterval(() => {
      currentStep++;
      if (currentStep < steps.length) {
        setOptStep(steps[currentStep]);
      } else {
        clearInterval(interval);
        
        // Success: Reset/improve system metrics
        setSystemMetrics(prev => {
          // Keep same accesses, but scale down page fault counts as if they were optimized or resolved!
          const nextFaults = Math.max(0, Math.floor(prev.pageFaultCount * 0.25));
          return {
            ...prev,
            pageFaultCount: nextFaults,
            l2DramHits: prev.l2DramHits + (prev.pageFaultCount - nextFaults)
          };
        });

        setIsOptimizing(false);
        setSuccessMsg(true);
        setTimeout(() => setSuccessMsg(false), 4000);
      }
    }, 800);
  };

  return (
    <div className="relative" id="sls-system-health-widget">
      {/* Mini badge trigger in Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 border ${badgeBg} hover:bg-white/5 transition-all text-[10px] uppercase font-mono tracking-wider cursor-pointer`}
      >
        <span className="relative flex h-2 w-2">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${pulseColor} opacity-75`}></span>
          <span className={`relative inline-flex rounded-full h-2 w-2 ${pulseColor}`}></span>
        </span>
        <span>
          HEALTH: <strong className={`${statusColor} font-bold`}>{healthScore}%</strong>
        </span>
        <span className="text-white/30">•</span>
        <span>
          RISK: <strong className="text-white font-medium">{riskLevel}</strong>
        </span>
      </button>

      {/* Popover overlay */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop for easy closing */}
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setIsOpen(false)} 
            />

            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="absolute right-0 mt-3 w-80 bg-[#0F1219] border border-white/10 p-5 z-50 shadow-2xl space-y-4"
            >
              {/* Header */}
              <div className="flex justify-between items-center border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <span className="font-serif italic text-sm text-white">Kernel Telemetry</span>
                </div>
                <span className="font-mono text-[9px] text-white/30 uppercase">
                  Uptime: {uptimeSeconds}s
                </span>
              </div>

              {/* Health Score / Risk Score Row */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-white/60 font-light">System Risk Coefficient</span>
                  <span className={`${statusColor} font-mono font-bold`}>{score}/100</span>
                </div>
                <div className="h-1.5 w-full bg-white/5 rounded-none overflow-hidden relative">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${score}%` }}
                    className={`h-full ${progressColor}`}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </div>

              {/* Detailed Metrics */}
              <div className="grid grid-cols-2 gap-3 bg-[#0B0E14] p-3 border border-white/5 font-mono text-[10px]">
                <div>
                  <span className="text-white/30 block">FAULT RATE</span>
                  <span className="text-white font-medium">{pfRate.toFixed(1)}%</span>
                </div>
                <div>
                  <span className="text-white/30 block">FAULT FREQ</span>
                  <span className="text-white font-medium">{pfPerMin.toFixed(1)} PF/m</span>
                </div>
                <div>
                  <span className="text-white/30 block">TOTAL ACCESS</span>
                  <span className="text-white font-medium">{totalAccesses} lines</span>
                </div>
                <div>
                  <span className="text-white/30 block">TOTAL FAULTS</span>
                  <span className="text-white font-medium">{pageFaultCount} faults</span>
                </div>
              </div>

              {/* Status Diagnosis */}
              <div className="text-[11px] leading-relaxed font-light text-white/60 border-t border-white/5 pt-3">
                {riskLevel === "LOW" && (
                  <p className="flex gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Flat memory address space is optimized. Active working set resides securely in fast L1/L2 DRAM tiers.</span>
                  </p>
                )}
                {riskLevel === "ELEVATED" && (
                  <p className="flex gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
                    <span>L3/L4 page fault overhead is delaying CPU instruction cycles. Active memory promoter is actively swapping pages.</span>
                  </p>
                )}
                {riskLevel === "CRITICAL" && (
                  <p className="flex gap-1.5 text-red-300">
                    <ShieldAlert className="w-4 h-4 text-red-500 shrink-0 animate-pulse" />
                    <span>Heavy sector decompression detected! Archival thrashing is occurring. Storage microkernel is stalled.</span>
                  </p>
                )}
              </div>

              {/* Live Action Center */}
              <div className="border-t border-white/10 pt-3">
                {isOptimizing ? (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[10px] font-mono text-cyan-400">
                      <span className="flex items-center gap-1.5">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        {optStep}
                      </span>
                    </div>
                    <div className="h-1 w-full bg-white/5 rounded-none overflow-hidden relative">
                      <div className="h-full bg-cyan-400 animate-pulse" style={{ width: "100%" }} />
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleOptimize}
                    disabled={score < 10}
                    className="w-full bg-[#0F1219] hover:bg-white/5 disabled:opacity-40 border border-cyan-400/30 hover:border-cyan-400 text-cyan-400 py-1.5 font-mono text-[10px] tracking-wider uppercase transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Zap className="w-3 h-3" /> Compact & Optimize Memory
                  </button>
                )}

                {successMsg && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-2 text-emerald-400 font-mono text-[9px] text-center flex items-center justify-center gap-1"
                  >
                    <CheckCircle2 className="w-3 h-3" /> System Health Restored to 100%!
                  </motion.div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
