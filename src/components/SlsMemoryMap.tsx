import React, { useState, useEffect } from "react";
import { SlsObject, MemoryPage, StorageTier, SlsObjectType, SlsUser, SlsSystemMetrics } from "../types/sls";
import { Cpu, HardDrive, Layers, Database, ArrowDown, ArrowUp, RefreshCw, AlertTriangle, CpuIcon } from "lucide-react";
import SlsStorageThroughput from "./SlsStorageThroughput";
import SlsTierConfigPanel from "./SlsTierConfigPanel";

interface SlsMemoryMapProps {
  objects: SlsObject[];
  memoryPages: MemoryPage[];
  onMigrateObjectTier: (objectId: string, targetTier: StorageTier) => void;
  onAccessAddress: (address: string) => { hit: boolean; latency: number; pageFault: boolean };
  onSelectObject: (objectId: string) => void;
  systemMetrics: SlsSystemMetrics;
  autoTierEnabled: boolean;
  setAutoTierEnabled: (val: boolean) => void;
  ssdThreshold: number;
  setSsdThreshold: (val: number) => void;
  archiveThreshold: number;
  setArchiveThreshold: (val: number) => void;
}

export default function SlsMemoryMap({
  objects,
  memoryPages,
  onMigrateObjectTier,
  onAccessAddress,
  onSelectObject,
  systemMetrics,
  autoTierEnabled,
  setAutoTierEnabled,
  ssdThreshold,
  setSsdThreshold,
  archiveThreshold,
  setArchiveThreshold
}: SlsMemoryMapProps) {
  const [selectedPage, setSelectedPage] = useState<MemoryPage | null>(null);
  const [dereferencedData, setDereferencedData] = useState<any | null>(null);
  const [accessLog, setAccessLog] = useState<{ address: string; status: string; latency: number; fault: boolean }[]>([]);
  const [isMigrating, setIsMigrating] = useState(false);

  const getTierColor = (tier: StorageTier) => {
    switch (tier) {
      case StorageTier.L1_CACHE:
        return "bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.6)] text-black";
      case StorageTier.L2_DRAM:
        return "bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)] text-white";
      case StorageTier.L3_SSD:
        return "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)] text-black";
      case StorageTier.L4_ARCHIVE:
        return "bg-fuchsia-600 shadow-[0_0_8px_rgba(192,38,211,0.6)] text-white";
      default:
        return "bg-zinc-800 text-zinc-400 border border-zinc-700";
    }
  };

  const getTierLabel = (tier: StorageTier) => {
    switch (tier) {
      case StorageTier.L1_CACHE: return "Level 1: CPU Fast Cache (SRAM)";
      case StorageTier.L2_DRAM: return "Level 2: Main Memory (DRAM)";
      case StorageTier.L3_SSD: return "Level 3: Persistent Flash (SSD)";
      case StorageTier.L4_ARCHIVE: return "Level 4: Compressed Archive";
    }
  };

  const handlePageClick = (page: MemoryPage) => {
    setSelectedPage(page);
    setDereferencedData(null);
  };

  const handleDereference = () => {
    if (!selectedPage) return;
    
    // Simulate pointer access latency and check page faults
    const result = onAccessAddress(selectedPage.address);
    
    let statusText = "Cache Hit";
    if (result.pageFault) {
      // Cold/archived data — slower to retrieve, and gets promoted back to
      // L2_DRAM shortly after (see App.tsx's handleAccessAddress). Previously
      // this triggered a full-screen animated "PAGE FAULT" overlay; dropped
      // since it read as an actual error to users rather than normal cold
      // storage access.
      statusText = "Cold Archive Access - Restoring to DRAM";
    } else if (selectedPage.objectId) {
      statusText = `Direct Memory Translation Success`;
    } else {
      statusText = "Raw Address Read (Unallocated)";
    }

    setAccessLog(prev => [
      {
        address: selectedPage.address,
        status: statusText,
        latency: result.latency,
        fault: result.pageFault
      },
      ...prev.slice(0, 4)
    ]);

    if (selectedPage.objectId) {
      const obj = objects.find(o => o.id === selectedPage.objectId);
      if (obj) {
        setDereferencedData({
          name: obj.name,
          type: obj.type,
          owner: obj.owner,
          sizePages: obj.sizePages,
          payload: obj.data,
          currentTier: obj.tier,
          compression: obj.isCompressed ? `${systemMetrics.compressionRatio}:1 Compressed` : "None"
        });
        onSelectObject(obj.id);
      }
    } else {
      setDereferencedData({
        name: "Empty Virtual Segment",
        type: SlsObjectType.RAW_SEGMENT,
        owner: SlsUser.SYSTEM_KERNEL,
        sizePages: 1,
        payload: { raw_byte_signature: "0x00 0x00 0x00 0x00 ... (NULL)" },
        currentTier: StorageTier.L2_DRAM,
        compression: "None"
      });
    }
  };

  // Keep selectedPage and dereferencedData in sync with parent props
  useEffect(() => {
    if (selectedPage) {
      const updatedPage = memoryPages.find(p => p.address === selectedPage.address);
      if (updatedPage && updatedPage.tier !== selectedPage.tier) {
        setSelectedPage(updatedPage);
      }
    }
  }, [memoryPages]);

  useEffect(() => {
    if (dereferencedData && selectedPage?.objectId) {
      const obj = objects.find(o => o.id === selectedPage.objectId);
      if (obj && obj.tier !== dereferencedData.currentTier) {
        setDereferencedData((prev: any) => prev ? {
          ...prev,
          currentTier: obj.tier,
          compression: obj.isCompressed ? `${systemMetrics.compressionRatio}:1 Compressed` : "None"
        } : null);
      }
    }
  }, [objects]);

  const handleManualMigrate = (tier: StorageTier) => {
    if (!selectedPage || !selectedPage.objectId) return;
    setIsMigrating(true);
    setTimeout(() => {
      onMigrateObjectTier(selectedPage.objectId!, tier);
      setIsMigrating(false);
      
      // Refresh dereference details if active
      const obj = objects.find(o => o.id === selectedPage.objectId);
      if (obj) {
        setDereferencedData((prev: any) => prev ? {
          ...prev,
          currentTier: tier,
          compression: tier === StorageTier.L4_ARCHIVE ? `${systemMetrics.compressionRatio}:1 Compressed` : "None"
        } : null);
        
        setSelectedPage(prev => prev ? {
          ...prev,
          tier: tier
        } : null);
      }
    }, 600);
  };

  // Find the selected page's associated object
  const selectedObj = selectedPage?.objectId ? objects.find(o => o.id === selectedPage.objectId) : null;

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8" id="sls-memory-dashboard">
      
      {/* LEFT & CENTER: FLAT ADDRESS SPACE GRID */}
      <div className="lg:col-span-2 bg-[#0B0E14] p-8 border border-white/10 flex flex-col justify-between relative overflow-hidden">
        <div>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/10 pb-4 mb-6">
            <div>
              <span className="font-mono text-[10px] tracking-widest text-cyan-400 uppercase">Interactive Address Map</span>
              <h3 className="text-2xl font-serif italic text-white mt-1">
                64-Bit Single Level Storage Space
              </h3>
            </div>
            <span className="text-[10px] bg-[#0F1219] border border-white/10 px-3 py-1.5 text-white/50 font-mono tracking-tight">
              BASE ADDR: 0x0000_1000_0000_0000
            </span>
          </div>

          <p className="text-white/60 text-xs font-light leading-relaxed mb-6">
            Click on any segment below to trace the pointer. In a Single Level Store, there are no files—all objects (tables, executables, database states) live directly in this flat virtualized matrix.
          </p>

          {/* 8x8 Visual Memory Page Grid */}
          <div className="grid grid-cols-8 gap-3 my-6 bg-[#0F1219] p-6 border border-white/10 relative overflow-hidden">
            {memoryPages.map((page, index) => {
              const isSelected = selectedPage?.address === page.address;
              const hasObj = page.objectId !== null;
              
              return (
                <button
                  key={page.address}
                  onClick={() => handlePageClick(page)}
                  className={`aspect-square flex flex-col justify-between p-2 text-left transition-all duration-200 cursor-pointer text-xs group relative ${
                    hasObj ? getTierColor(page.tier) : "bg-[#0B0E14] hover:bg-white/5 border border-white/5"
                  } ${isSelected ? "ring-2 ring-cyan-400 scale-[1.05] z-10" : ""}`}
                  title={`${page.address} - ${page.objectName || "Free Memory Page"}`}
                >
                  {/* Visual grid segment indexing */}
                  <div className="text-[9px] font-mono opacity-40 select-none">
                    {index.toString(16).toUpperCase().padStart(2, "0")}
                  </div>

                  {/* Micro dirty indicator */}
                  {page.isDirty && (
                    <div className="absolute top-2 right-2 w-2 h-2 bg-red-450 rounded-full animate-pulse shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
                  )}

                  {/* Dynamic mini-icon overlay */}
                  <div className="flex justify-end opacity-30 group-hover:opacity-70 transition-opacity">
                    {page.tier === StorageTier.L1_CACHE && <CpuIcon className="w-3.5 h-3.5" />}
                    {page.tier === StorageTier.L2_DRAM && <Cpu className="w-3.5 h-3.5" />}
                    {page.tier === StorageTier.L3_SSD && <HardDrive className="w-3.5 h-3.5" />}
                    {page.tier === StorageTier.L4_ARCHIVE && <Database className="w-3.5 h-3.5" />}
                  </div>
                </button>
              );
            })}

            {/* Previously rendered a full-screen animated "CRITICAL L4 PAGE
                FAULT" swap sequence (fault -> fetch -> decompress -> write
                -> done) with a red flash overlay below when dereferencing an
                archived object. Removed: it read as an actual system error
                to users rather than normal cold-archive access. Cold-tier
                access is now just a "Cold Archive Access" log entry (see
                handleDereference above) plus the same quiet automatic
                promotion L2/L3 hits already get (see App.tsx's
                handleAccessAddress). */}
          </div>
        </div>

        {/* Legend - Clean Editorial labels with subtle line dividers */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-[#0F1219] p-4 border border-white/10 text-[10px] font-mono uppercase tracking-wider">
          <div className="flex items-start gap-2.5">
            <span className="w-3 h-3 bg-cyan-500 shrink-0"></span>
            <div>
              <p className="font-bold text-white">L1 SRAM Cache</p>
              <p className="text-[9px] text-white/40 mt-0.5">Latency ~0.01ms</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5 border-l border-white/5 pl-4">
            <span className="w-3 h-3 bg-indigo-500 shrink-0"></span>
            <div>
              <p className="font-bold text-white">L2 DRAM RAM</p>
              <p className="text-[9px] text-white/40 mt-0.5">Latency ~0.10ms</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5 border-l border-white/5 pl-4">
            <span className="w-3 h-3 bg-amber-500 shrink-0"></span>
            <div>
              <p className="font-bold text-white">L3 SSD Store</p>
              <p className="text-[9px] text-white/40 mt-0.5">Latency ~1.50ms</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5 border-l border-white/5 pl-4">
            <span className="w-3 h-3 bg-fuchsia-600 shrink-0"></span>
            <div>
              <p className="font-bold text-white">L4 Compressed</p>
              <p className="text-[9px] text-white/40 mt-0.5">Latency ~10.0ms</p>
            </div>
          </div>
        </div>

      </div>

      {/* RIGHT PANEL: INTERACTIVE SEGMENT DEREFERENCER & TIER MANAGER */}
      <div className="bg-[#0B0E14] p-8 border border-white/10 flex flex-col justify-between">
        <div>
          <span className="font-mono text-[10px] tracking-widest text-orange-500 uppercase">Core Address Diagnostic</span>
          <h3 className="text-xl font-serif italic text-white mt-1 border-b border-white/10 pb-4 mb-6">
            Hardware Inspector
          </h3>

          {selectedPage ? (
            <div className="space-y-6">
              {/* Virtual Pointer Metadata */}
              <div className="bg-[#0F1219] p-5 border border-white/10 font-mono space-y-3 text-xs">
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-white/40">POINTER:</span>
                  <span className="text-white font-semibold text-right break-all">{selectedPage.address}</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-white/40">BLOCK OBJECT:</span>
                  <span className="text-cyan-400 font-semibold text-right">
                    {selectedPage.objectName ? `${selectedPage.objectName}` : "Unallocated Segment"}
                  </span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-white/40">PHYSICAL LOCATION:</span>
                  <span className="text-indigo-300 font-semibold text-right text-[11px]">
                    {getTierLabel(selectedPage.tier)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">STATE REGISTER:</span>
                  <span className={`font-semibold text-right ${selectedPage.isDirty ? "text-red-400" : "text-emerald-400"}`}>
                    {selectedPage.isDirty ? "DIRTY / modified" : "CLEAN / synchronous"}
                  </span>
                </div>
              </div>

              {/* Seamless Pointer-based access button */}
              <button
                onClick={handleDereference}
                className="w-full bg-cyan-400 hover:bg-cyan-300 text-[#0B0E14] font-mono text-xs font-bold py-3 uppercase tracking-wider cursor-pointer transition-all active:scale-[0.98]"
              >
                Dereference Pointer (LOAD)
              </button>

              {/* Dereferenced Data Output */}
              {dereferencedData && (
                <div className="bg-[#0F1219] p-5 border border-white/10 animate-fadeIn space-y-4">
                  <div className="flex justify-between items-center text-[10px] font-mono uppercase tracking-wider">
                    <span className="bg-[#0B0E14] border border-white/10 px-2 py-0.5 text-cyan-400">
                      {dereferencedData.type}
                    </span>
                    <span className="text-white/40">
                      ID: {dereferencedData.owner}
                    </span>
                  </div>
                  
                  <h4 className="text-base font-serif italic text-white">{dereferencedData.name}</h4>
                  
                  {/* Visual memory representation of structured table rows / binary data */}
                  <div className="text-xs bg-[#0B0E14] p-4 border border-white/10 font-mono text-white/70 max-h-36 overflow-y-auto space-y-1 scrollbar-thin">
                    <p className="text-[10px] text-white/30 mb-2 border-b border-white/5 pb-1">// dereferenced memory payload</p>
                    {Object.entries(dereferencedData.payload).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-[11px] gap-2">
                        <span className="text-cyan-400 shrink-0">{k}:</span>
                        <span className="text-emerald-400 text-right truncate">{JSON.stringify(v)}</span>
                      </div>
                    ))}
                  </div>

                  {/* Tiering options for this object */}
                  {selectedObj && (
                    <div className="pt-3 border-t border-white/5">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-white/50 mb-2.5">Storage Tiering Directive:</p>
                      <div className="grid grid-cols-2 gap-2 text-[10px] font-mono uppercase">
                        <button
                          disabled={selectedPage.tier === StorageTier.L1_CACHE || isMigrating}
                          onClick={() => handleManualMigrate(StorageTier.L1_CACHE)}
                          className="flex items-center justify-center gap-1.5 py-2 border border-white/10 hover:border-cyan-400/50 bg-[#0B0E14] hover:bg-cyan-950/20 text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                        >
                          <ArrowUp className="w-3.5 h-3.5 text-cyan-400" /> Promotion (L1)
                        </button>
                        <button
                          disabled={selectedPage.tier === StorageTier.L4_ARCHIVE || isMigrating}
                          onClick={() => handleManualMigrate(StorageTier.L4_ARCHIVE)}
                          className="flex items-center justify-center gap-1.5 py-2 border border-white/10 hover:border-fuchsia-400/50 bg-[#0B0E14] hover:bg-[#0B0E14]/70 text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                        >
                          <ArrowDown className="w-3.5 h-3.5 text-fuchsia-400" /> Demotion (L4)
                        </button>
                      </div>
                      {isMigrating && (
                        <div className="mt-3 text-[10px] text-amber-400 flex items-center gap-1.5 justify-center font-mono uppercase tracking-wider animate-pulse">
                          <RefreshCw className="w-3 h-3 animate-spin" /> Swapping Physical Sectors...
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="border border-dashed border-white/10 p-8 text-center text-white/40 text-xs font-light">
              <Layers className="w-8 h-8 text-white/20 mx-auto mb-3" />
              Click any 4KB segment in the memory space matrix to inspect underlying pointers.
            </div>
          )}
        </div>

        {/* Real-time memory translation latency log */}
        <div className="mt-6 border-t border-white/10 pt-5">
          <p className="text-[10px] font-mono uppercase tracking-wider text-white/50 mb-3.5 flex justify-between">
            <span>Kernel Pointer Execution Trace</span>
            {systemMetrics.pageFaultCount > 0 && (
              <span className="text-amber-400 flex items-center gap-1 font-mono animate-pulse">
                <AlertTriangle className="w-3 h-3" /> Page Faults: {systemMetrics.pageFaultCount}
              </span>
            )}
          </p>
          <div className="space-y-2 max-h-28 overflow-y-auto font-mono text-[10px] scrollbar-thin">
            {accessLog.length > 0 ? (
              accessLog.map((log, i) => (
                <div key={i} className={`flex justify-between p-2.5 ${log.fault ? "bg-red-950/20 border border-red-900/30 text-red-400" : "bg-[#0F1219] border border-white/5 text-white/70"}`}>
                  <span className="truncate max-w-[120px]">{log.address}</span>
                  <span className="truncate text-right max-w-[160px]">{log.status}</span>
                  <span className="font-semibold text-white shrink-0">{log.latency.toFixed(2)}ms</span>
                </div>
              ))
            ) : (
              <p className="text-white/20 italic font-mono">[ Execution pipeline quiet. Direct pointers ready for dereference ]</p>
            )}
          </div>
        </div>
      </div>
    </div>

      <SlsTierConfigPanel
        autoTierEnabled={autoTierEnabled}
        setAutoTierEnabled={setAutoTierEnabled}
        ssdThreshold={ssdThreshold}
        setSsdThreshold={setSsdThreshold}
        archiveThreshold={archiveThreshold}
        setArchiveThreshold={setArchiveThreshold}
        objects={objects}
      />

      <SlsStorageThroughput systemMetrics={systemMetrics} />
    </>
  );
}
