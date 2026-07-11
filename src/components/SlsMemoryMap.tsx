import React, { useState, useEffect } from "react";
import { SlsObject, MemoryPage, StorageTier, SlsObjectType, SlsUser, SlsSystemMetrics } from "../types/sls";
import { Cpu, HardDrive, Layers, Database, ArrowDown, ArrowUp, RefreshCw, AlertTriangle, CpuIcon, Check } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
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

  const [swapState, setSwapState] = useState<{
    address: string;
    objectName: string;
    step: "idle" | "fault" | "fetch" | "decompress" | "write" | "done";
  }>({
    address: "",
    objectName: "",
    step: "idle"
  });

  useEffect(() => {
    if (swapState.step === "idle") return;

    let timer: any;
    if (swapState.step === "fault") {
      timer = setTimeout(() => {
        setSwapState(prev => ({ ...prev, step: "fetch" }));
      }, 1000);
    } else if (swapState.step === "fetch") {
      timer = setTimeout(() => {
        setSwapState(prev => ({ ...prev, step: "decompress" }));
      }, 1200);
    } else if (swapState.step === "decompress") {
      timer = setTimeout(() => {
        setSwapState(prev => ({ ...prev, step: "write" }));
      }, 1200);
    } else if (swapState.step === "write") {
      timer = setTimeout(() => {
        setSwapState(prev => ({ ...prev, step: "done" }));
      }, 1000);
    } else if (swapState.step === "done") {
      timer = setTimeout(() => {
        setSwapState(prev => ({ ...prev, step: "idle" }));
      }, 1200);
    }

    return () => clearTimeout(timer);
  }, [swapState.step]);

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
      statusText = "PAGE FAULT - Swapping from Disk";
      
      if (selectedPage.tier === StorageTier.L4_ARCHIVE) {
        // Trigger L4 Page Fault Swap Animation
        setSwapState({
          address: selectedPage.address,
          objectName: selectedPage.objectName || "System Block",
          step: "fault"
        });
      }
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

            {/* Visual Overlay for Page Swap Process */}
            <AnimatePresence>
              {swapState.step !== "idle" && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="absolute inset-0 z-20 bg-[#0B0E14]/95 flex flex-col items-center justify-center p-6 text-center backdrop-blur-sm"
                >
                  {/* Outer glowing frame based on step */}
                  <div className={`absolute inset-0 border-2 pointer-events-none transition-colors duration-500 ${
                    swapState.step === "fault" ? "border-red-500 shadow-[inset_0_0_20px_rgba(239,68,68,0.3)] animate-pulse" :
                    swapState.step === "fetch" ? "border-fuchsia-500 shadow-[inset_0_0_20px_rgba(192,38,211,0.2)]" :
                    swapState.step === "decompress" ? "border-amber-500 shadow-[inset_0_0_20px_rgba(245,158,11,0.2)]" :
                    swapState.step === "write" ? "border-indigo-500 shadow-[inset_0_0_20px_rgba(99,102,241,0.2)]" :
                    "border-emerald-500 shadow-[inset_0_0_20px_rgba(16,185,129,0.3)]"
                  }`} />

                  {/* Step Content */}
                  {swapState.step === "fault" && (
                    <motion.div
                      key="fault"
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.95, opacity: 0 }}
                      className="space-y-4 max-w-md"
                    >
                      <div className="relative mx-auto w-16 h-16 flex items-center justify-center">
                        <motion.div 
                          animate={{ scale: [1, 1.25, 1] }} 
                          transition={{ repeat: Infinity, duration: 0.8 }}
                          className="absolute inset-0 bg-red-500/20 rounded-full" 
                        />
                        <AlertTriangle className="w-10 h-10 text-red-500 relative z-10" />
                      </div>
                      <div className="space-y-1">
                        <span className="font-mono text-[9px] tracking-widest text-red-500 uppercase font-bold animate-pulse">Hardware Interrupt 0x0E</span>
                        <h4 className="text-lg font-serif italic text-white uppercase tracking-wide">CPU Page Fault Detected</h4>
                      </div>
                      <p className="text-[11px] text-white/60 leading-relaxed font-light">
                        Virtual descriptor points to a compressed block inside cold offline archival storage. Stalling instruction pipeline.
                      </p>
                      <div className="bg-red-950/30 border border-red-500/20 p-2 text-[10px] font-mono text-red-400">
                        ADDR: {swapState.address} | OBJ: {swapState.objectName}
                      </div>
                    </motion.div>
                  )}

                  {swapState.step === "fetch" && (
                    <motion.div
                      key="fetch"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="space-y-4 w-full max-w-md"
                    >
                      {/* Interactive Schema: L4 -> RAM */}
                      <div className="flex items-center justify-around bg-[#0F1219] p-4 border border-white/5 relative rounded-none">
                        <div className="flex flex-col items-center">
                          <Database className="w-8 h-8 text-fuchsia-500 animate-pulse" />
                          <span className="font-mono text-[9px] text-fuchsia-400 mt-1">L4 ARCHIVE</span>
                        </div>
                        
                        <div className="flex-1 px-4 relative flex items-center justify-center">
                          {/* Animated flow dots */}
                          <div className="w-full h-0.5 bg-white/10 relative overflow-hidden">
                            <motion.div 
                              animate={{ x: [-100, 200] }}
                              transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
                              className="absolute top-0 bottom-0 w-12 bg-gradient-to-r from-transparent via-fuchsia-400 to-transparent"
                            />
                          </div>
                        </div>

                        <div className="flex flex-col items-center">
                          <Layers className="w-8 h-8 text-indigo-400 animate-pulse" />
                          <span className="font-mono text-[9px] text-indigo-300 mt-1">SWAP BUFFER</span>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <span className="font-mono text-[9px] tracking-widest text-fuchsia-400 uppercase font-semibold">Step 1 of 3: Sector Fetch</span>
                        <h4 className="text-lg font-serif italic text-white">Retrieving Archival Blocks</h4>
                      </div>
                      <p className="text-[11px] text-white/60 leading-relaxed font-light">
                        Reading compressed sectors from L4 block storage into the kernel memory buffer area.
                      </p>
                    </motion.div>
                  )}

                  {swapState.step === "decompress" && (
                    <motion.div
                      key="decompress"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="space-y-4 max-w-md"
                    >
                      <div className="relative mx-auto w-14 h-14 flex items-center justify-center">
                        <motion.div 
                          animate={{ rotate: 360 }}
                          transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                        >
                          <RefreshCw className="w-10 h-10 text-amber-400" />
                        </motion.div>
                      </div>

                      <div className="space-y-1">
                        <span className="font-mono text-[9px] tracking-widest text-amber-400 uppercase font-semibold">Step 2 of 3: Decompressing</span>
                        <h4 className="text-lg font-serif italic text-white">LZX Pipeline Decompression</h4>
                      </div>
                      <p className="text-[11px] text-white/60 leading-relaxed font-light">
                        Rebuilding the raw 4KB page structure from compressed format. Restoring uncompressed memory descriptors.
                      </p>
                      <div className="flex justify-center gap-4 text-[10px] font-mono text-amber-400/80 uppercase">
                        <span>Ratio: 4.2:1</span>
                        <span>•</span>
                        <span>Size: 4,096 Bytes</span>
                      </div>
                    </motion.div>
                  )}

                  {swapState.step === "write" && (
                    <motion.div
                      key="write"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-4 w-full max-w-md"
                    >
                      {/* Physical RAM Write schematic */}
                      <div className="flex items-center justify-around bg-[#0F1219] p-4 border border-white/5">
                        <div className="flex flex-col items-center opacity-40">
                          <Database className="w-8 h-8 text-fuchsia-500" />
                          <span className="font-mono text-[9px] text-fuchsia-400 mt-1">L4 ARCHIVE</span>
                        </div>
                        
                        <div className="flex-1 px-4 relative flex items-center justify-center">
                          <div className="w-full h-0.5 bg-white/10 relative overflow-hidden">
                            <motion.div 
                              animate={{ x: [-100, 200] }}
                              transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
                              className="absolute top-0 bottom-0 w-12 bg-gradient-to-r from-transparent via-indigo-400 to-transparent"
                            />
                          </div>
                        </div>

                        <div className="flex flex-col items-center">
                          <Cpu className="w-8 h-8 text-indigo-500 animate-pulse" />
                          <span className="font-mono text-[9px] text-indigo-400 mt-1">L2 DRAM RAM</span>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <span className="font-mono text-[9px] tracking-widest text-indigo-400 uppercase font-semibold">Step 3 of 3: Physical Swap</span>
                        <h4 className="text-lg font-serif italic text-white">Writing cache lines to DRAM</h4>
                      </div>
                      <p className="text-[11px] text-white/60 leading-relaxed font-light">
                        Allocating a free L2 DRAM physical sector and mapping the virtual translation table pointer registers.
                      </p>
                    </motion.div>
                  )}

                  {swapState.step === "done" && (
                    <motion.div
                      key="done"
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 1.05, opacity: 0 }}
                      className="space-y-4 max-w-md"
                    >
                      <div className="relative mx-auto w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center border border-emerald-500/30">
                        <Check className="w-8 h-8 text-emerald-400" />
                      </div>

                      <div className="space-y-1">
                        <span className="font-mono text-[9px] tracking-widest text-emerald-400 uppercase font-semibold animate-pulse">Interrupt Cleared</span>
                        <h4 className="text-lg font-serif italic text-white">Translation Parity Complete</h4>
                      </div>
                      <p className="text-[11px] text-white/60 leading-relaxed font-light">
                        Page successfully swapped back to L2 DRAM. The CPU can now execute immediate direct-pointer dereferencing.
                      </p>
                      <div className="bg-emerald-950/30 border border-emerald-500/20 p-2 text-[10px] font-mono text-emerald-400">
                        LATENCY STALL RESOLVED: ~12.50ms ➔ 0.10ms
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
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

        {/* Visual red flash overlay triggering on L4 cold storage page fault */}
        <AnimatePresence>
          {swapState.step === "fault" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ 
                opacity: [0, 0.95, 0.15, 0.85, 0.05, 0.6, 0.02, 0.4, 0],
                backgroundColor: [
                  "rgba(239, 68, 68, 0)", 
                  "rgba(239, 68, 68, 0.65)", 
                  "rgba(239, 68, 68, 0.15)", 
                  "rgba(239, 68, 68, 0.55)", 
                  "rgba(239, 68, 68, 0.05)", 
                  "rgba(239, 68, 68, 0.4)", 
                  "rgba(239, 68, 68, 0.02)", 
                  "rgba(239, 68, 68, 0.25)", 
                  "rgba(239, 68, 68, 0)"
                ]
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.2, ease: "easeInOut" }}
              className="absolute inset-0 pointer-events-none z-30 border-2 border-red-500/60 shadow-[inset_0_0_60px_rgba(239,68,68,0.65)] flex items-center justify-center mix-blend-screen"
            >
              <div className="absolute inset-0 bg-gradient-to-t from-red-600/10 via-transparent to-red-600/10 animate-pulse pointer-events-none" />
              <div className="font-mono text-[10px] tracking-[0.2em] font-black uppercase text-red-400 bg-red-950/90 border border-red-500/40 px-4 py-2 shadow-2xl animate-bounce select-none">
                CRITICAL L4 PAGE FAULT // SWAPPING FROM COLD SECTOR
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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
