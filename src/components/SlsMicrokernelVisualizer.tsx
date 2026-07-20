import React, { useState } from "react";
import { MicrokernelService } from "../types/sls";
import { Cpu, Server, Play, AlertTriangle, RefreshCw, Activity, Terminal, ShieldAlert } from "lucide-react";

interface SlsMicrokernelVisualizerProps {
  services: MicrokernelService[];
  onCrashService: (serviceId: string) => void;
  systemMetrics: {
    uptimeSeconds: number;
  };
}

export default function SlsMicrokernelVisualizer({
  services,
  onCrashService,
  systemMetrics
}: SlsMicrokernelVisualizerProps) {
  const [activeLogs, setActiveLogs] = useState<{ timestamp: string; level: "INFO" | "WARN" | "ERROR" | "SUCCESS"; message: string }[]>([
    { timestamp: new Date().toLocaleTimeString(), level: "SUCCESS", message: "Microkernel booted successfully. Ring-0 primitives online." },
    { timestamp: new Date().toLocaleTimeString(), level: "INFO", message: "IPC Message Passing interface configured (Port bounds 0x1000 - 0x1FFF)." },
    { timestamp: new Date().toLocaleTimeString(), level: "INFO", message: "Fault Isolation Daemon active. Standard poll interval: 100ms." }
  ]);

  const handleCrash = (srv: MicrokernelService) => {
    onCrashService(srv.id);
    
    // Append logs
    const timestamp = new Date().toLocaleTimeString();
    setActiveLogs(prev => [
      { timestamp, level: "ERROR", message: `IPC FAULT: Service ${srv.name} (PID ${srv.pid}) collapsed! Thread terminated abnormally.` },
      { timestamp, level: "WARN", message: `FAULT ISOLATION: Isolating PID ${srv.pid} address space to prevent dirty memory cascades.` },
      ...prev
    ]);

    // Simulate microkernel autorecovery logging
    setTimeout(() => {
      const ts = new Date().toLocaleTimeString();
      setActiveLogs(prev => [
        { timestamp: ts, level: "WARN", message: `WATCHDOG: Autorestarting service ${srv.name}. Allocating fresh user-space process bounds.` },
        ...prev
      ]);
    }, 1200);

    setTimeout(() => {
      const ts = new Date().toLocaleTimeString();
      setActiveLogs(prev => [
        { timestamp: ts, level: "SUCCESS", message: `RECOVERY COMPLETE: Service ${srv.name} is fully ONLINE (re-bound to address ${srv.memoryAddress}). State verified.` },
        ...prev
      ]);
    }, 2400);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8" id="sls-microkernel-dashboard">
      
      {/* LEFT & CENTER: ACTIVE SERVICE GRID */}
      <div className="lg:col-span-2 bg-[#0B0E14] p-8 border border-white/10 flex flex-col justify-between">
        <div>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/10 pb-4 mb-6">
            <div>
              <span className="font-mono text-[10px] tracking-widest text-emerald-400 uppercase font-semibold">Fault Isolation Architecture</span>
              <h3 className="text-2xl font-serif italic text-white mt-1">
                Microkernel Service Isolation Map
              </h3>
            </div>
            <span className="text-[10px] bg-[#0F1219] border border-white/10 text-emerald-400 px-3 py-1.5 font-mono tracking-wide uppercase">
              IPC MODE: DIRECT CHANNEL (NO_COPY)
            </span>
          </div>

          <p className="text-white/60 text-xs font-light leading-relaxed mb-6">
            Monolithic OS kernels run drivers and storage in privileged Ring-0, where single faults crash the computer. Our Microkernel runs OS services in isolated User-space processes.
          </p>

          {/* Active Services List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
            {services.map((srv) => {
              const isFailed = srv.state === "FAILED";
              const isRebooting = srv.state === "REBOOTING";

              return (
                <div
                  key={srv.id}
                  className={`border p-5 transition-all duration-300 relative ${
                    isFailed ? "bg-red-950/20 border-red-500/70" :
                    isRebooting ? "bg-[#0F1219] border-amber-500/70 animate-pulse" :
                    "bg-[#0F1219] border-white/10 hover:border-white/20"
                  }`}
                >
                  {/* Service Header */}
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h4 className="text-sm font-serif italic text-white flex items-center gap-2">
                        <Server className={`w-4 h-4 ${
                          isFailed ? "text-red-500" :
                          isRebooting ? "text-amber-500" : "text-emerald-400"
                        }`} />
                        {srv.name}
                      </h4>
                      <span className="text-[9px] font-mono text-white/40 uppercase tracking-wider block mt-1">
                        PID: {srv.pid} | ADDR: {srv.memoryAddress}
                      </span>
                    </div>

                    {/* Status badge */}
                    <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-none uppercase ${
                      isFailed ? "bg-red-500/10 text-red-400 border border-red-500/30 animate-pulse" :
                      isRebooting ? "bg-amber-500/10 text-amber-400 border border-amber-500/30" :
                      "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                    }`}>
                      {srv.state}
                    </span>
                  </div>

                  <p className="text-white/60 text-xs font-light leading-relaxed mb-4 min-h-[32px]">{srv.description}</p>

                  {/* Metrics and Controls */}
                  <div className="flex justify-between items-center border-t border-white/5 pt-3.5 text-xs">
                    <div className="flex gap-4 font-mono text-[10px] text-white/45">
                      <div>
                        <span>LATENCY: </span>
                        <strong className="text-white font-medium">{srv.latencyMs.toFixed(2)}ms</strong>
                      </div>
                      <div>
                        <span>REBOOTS: </span>
                        <strong className={srv.restarts > 0 ? "text-amber-400 font-medium" : "text-white/40 font-medium"}>
                          {srv.restarts}
                        </strong>
                      </div>
                    </div>

                    {/* Inject failure */}
                    <button
                      disabled={isFailed || isRebooting}
                      onClick={() => handleCrash(srv)}
                      className={`text-[9px] font-mono font-bold px-3 py-1.5 cursor-pointer border flex items-center gap-1 uppercase tracking-wider transition-all ${
                        isFailed || isRebooting
                          ? "bg-[#0B0E14] border-white/5 text-white/20 cursor-not-allowed"
                          : "bg-red-950/20 hover:bg-red-950 border-red-900/40 hover:border-red-600 text-red-350"
                      }`}
                    >
                      <AlertTriangle className="w-3 h-3 text-red-400" />
                      Crash Module
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Microkernel Performance Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-[#0F1219] p-5 border border-white/10 mt-4 text-xs font-mono uppercase tracking-wider">
          <div>
            <p className="text-white/40 text-[9px] mb-1">IPC Passing Latency</p>
            <p className="text-white font-bold text-sm flex items-center gap-1 mt-0.5">
              <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" /> 0.85μs
            </p>
          </div>
          <div>
            <p className="text-white/40 text-[9px] mb-1">System Uptime</p>
            <p className="text-white font-bold text-sm mt-0.5">{systemMetrics.uptimeSeconds}s</p>
          </div>
          <div>
            <p className="text-white/40 text-[9px] mb-1">Address Isolation</p>
            <p className="text-emerald-400 font-bold text-sm mt-0.5">Hardware-Direct</p>
          </div>
          <div>
            <p className="text-white/40 text-[9px] mb-1">Fault Resilience</p>
            <p className="text-emerald-400 font-bold text-sm mt-0.5">99.999% Isolated</p>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL: LIVE MICROKERNEL SYSTEM TERMINAL */}
      <div className="bg-[#0B0E14] p-8 border border-white/10 flex flex-col justify-between">
        <div className="flex flex-col h-full justify-between">
          <div className="mb-4">
            <span className="font-mono text-[10px] tracking-widest text-emerald-400 uppercase font-semibold">Bus Event Tracer</span>
            <h3 className="text-xl font-serif italic text-white mt-1 border-b border-white/10 pb-4 mb-6">
              Microkernel System Bus Log
            </h3>
            <p className="text-white/60 text-xs font-light leading-relaxed">
              Active kernel monitor listening to inter-process communication (IPC) packets and process lifecycles.
            </p>
          </div>

          <div className="bg-[#0F1219] border border-white/10 p-4 h-96 overflow-y-auto font-mono text-[10px] space-y-3.5 scrollbar-thin flex flex-col-reverse justify-end">
            {activeLogs.map((log, i) => (
              <div key={i} className="flex gap-2.5 leading-relaxed border-b border-white/5 pb-2.5 last:border-b-0 last:pb-0">
                <span className="text-white/30 shrink-0">[{log.timestamp}]</span>
                <span className={`font-bold shrink-0 uppercase text-[9px] ${
                  log.level === "ERROR" ? "text-red-400" :
                  log.level === "WARN" ? "text-amber-400" :
                  log.level === "SUCCESS" ? "text-emerald-400" : "text-blue-400"
                }`}>
                  [{log.level}]
                </span>
                <span className="text-white/80">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
