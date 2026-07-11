import React, { useState } from "react";
import { SlsObject, Transaction, WalLogEntry, StorageTier } from "../types/sls";
import { Database, AlertOctagon, RefreshCw, CheckCircle, ArrowRight, Play, Check, Trash, Zap, Download, Plus, Terminal, Save, ShieldAlert, HelpCircle } from "lucide-react";
import { generateChecksum } from "../lib/slsEngine";

interface SlsTransactionConsoleProps {
  objects: SlsObject[];
  activeTx: Transaction | null;
  onBeginTx: () => void;
  onAddTxWrite: (objectId: string, key: string, newValue: any) => void;
  onCommitTx: () => void;
  onAbortTx: () => void;
  walLogs: WalLogEntry[];
  onCrashSystem: () => void;
  onRebootAndRecover: () => { redoneCount: number; undoneCount: number; auditLogs: string[] };
  systemState: "RUNNING" | "CRASHED" | "RECOVERING";
  onDirectWrite: (objectId: string, key: string, newValue: any) => void;
}

export default function SlsTransactionConsole({
  objects,
  activeTx,
  onBeginTx,
  onAddTxWrite,
  onCommitTx,
  onAbortTx,
  walLogs,
  onCrashSystem,
  onRebootAndRecover,
  systemState,
  onDirectWrite
}: SlsTransactionConsoleProps) {
  // Local state for preparing a write operation
  const [selectedObjectId, setSelectedObjectId] = useState<string>("db_cust");
  const [writeKey, setWriteKey] = useState<string>("row_0_balance");
  const [writeValue, setWriteValue] = useState<string>("16500.00");
  const [auditSteps, setAuditSteps] = useState<string[]>([]);
  const [recoveryMetrics, setRecoveryMetrics] = useState<{ redone: number; undone: number } | null>(null);

  // New Data Entry Mode States for Simulated Database Record Screen
  const [entryMode, setEntryMode] = useState<"preset" | "custom">("preset");
  const [customKey, setCustomKey] = useState<string>("");
  const [customValue, setCustomValue] = useState<string>("");
  const [customDataType, setCustomDataType] = useState<"number" | "string" | "boolean">("number");

  const selectedObj = objects.find(o => o.id === selectedObjectId);

  const getActiveWriteData = () => {
    let key = "";
    let rawVal = "";
    let parsedVal: any = null;

    if (entryMode === "preset") {
      key = writeKey;
      rawVal = writeValue;
      if (!isNaN(Number(writeValue))) {
        parsedVal = Number(writeValue);
      } else {
        parsedVal = writeValue;
      }
    } else {
      key = customKey.trim().toLowerCase().replace(/\s+/g, "_");
      rawVal = customValue;
      if (customDataType === "number") {
        parsedVal = isNaN(Number(customValue)) ? 0 : Number(customValue);
      } else if (customDataType === "boolean") {
        parsedVal = customValue.toLowerCase() === "true";
      } else {
        parsedVal = customValue;
      }
    }

    return { key, rawVal, parsedVal };
  };

  const handleAddWrite = () => {
    if (!activeTx || !selectedObj) return;
    const { key, parsedVal } = getActiveWriteData();
    if (!key) return;
    onAddTxWrite(selectedObj.id, key, parsedVal);
    // Reset custom fields if added successfully
    if (entryMode === "custom") {
      setCustomKey("");
      setCustomValue("");
    }
  };

  const handleDirectWriteImmediate = () => {
    if (!selectedObj) return;
    const { key, parsedVal } = getActiveWriteData();
    if (!key) return;
    onDirectWrite(selectedObj.id, key, parsedVal);
    // Reset custom fields if added successfully
    if (entryMode === "custom") {
      setCustomKey("");
      setCustomValue("");
    }
  };

  const triggerRecover = () => {
    const result = onRebootAndRecover();
    setAuditSteps(result.auditLogs);
    setRecoveryMetrics({ redone: result.redoneCount, undone: result.undoneCount });
  };

  const handleExportAudit = () => {
    if (auditSteps.length === 0) return;

    const reportLines = [
      "==================================================================",
      "             SINGLE LEVEL STORAGE (SLS) KERNEL MONITOR            ",
      "                     RECOVERY AUDIT LOG REPORT                    ",
      "==================================================================",
      `Generated At: ${new Date().toISOString()}`,
      "Device Type: PCIe Gen 5 x4 NVMe Enterprise SSD Array",
      `System State during Export: ${systemState}`,
      "------------------------------------------------------------------",
      "RECOVERY SESSION METRICS:",
      "------------------------------------------------------------------",
      `Total REDO Operations (Committed Tx Replayed) : ${recoveryMetrics?.redone ?? 0}`,
      `Total UNDO Operations (Uncommitted Tx Rolled Back): ${recoveryMetrics?.undone ?? 0}`,
      `System Integrity Status                       : 100% SECURE / RESTORED`,
      "------------------------------------------------------------------",
      "RECOVERY LOG SCAN TRAIL & ACTION LOGS:",
      "------------------------------------------------------------------",
      ...auditSteps.map((step, idx) => `[${(idx + 1).toString().padStart(3, "0")}] ${step}`),
      "------------------------------------------------------------------",
      "                       END OF AUDIT LOG REPORT                     ",
      "=================================================================="
    ];

    const blob = new Blob([reportLines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sls-recovery-audit-${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* 3-COLUMN CORE TRANSACTION & AUDIT TRACKER */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8" id="sls-transaction-dashboard">
        
        {/* 1. TRANSACTION CONTROLLER & WRITE EMULATOR */}
        <div className="bg-[#0B0E14] p-8 border border-white/10 flex flex-col justify-between">
          <div>
            <span className="font-mono text-[10px] tracking-widest text-amber-400 uppercase font-semibold">Heap Integrity Engine</span>
            <h3 className="text-2xl font-serif italic text-white mt-1 border-b border-white/10 pb-4 mb-6">
              Transactional Memory Controller
            </h3>
            <p className="text-white/60 text-xs font-light leading-relaxed mb-6">
              Single Level Storage implements atomic transactional heap zones. In-memory pointers are staged and recorded to the Write-Ahead Log (WAL) before physical commit.
            </p>

            {systemState === "CRASHED" ? (
              <div className="bg-red-950/20 border border-red-900/40 p-6 text-center space-y-4">
                <AlertOctagon className="w-10 h-10 text-red-500 mx-auto animate-pulse" />
                <h4 className="text-sm font-mono tracking-widest uppercase text-red-400">OPERATING SYSTEM CRASHED</h4>
                <p className="text-[11px] text-white/50 font-mono leading-relaxed">
                  Power failure simulated. Volatile RAM (DRAM, L1 Cache) wiped out. Transaction tables are locked. Log audit required.
                </p>
                <button
                  onClick={triggerRecover}
                  className="w-full bg-amber-400 hover:bg-amber-300 text-[#0B0E14] font-mono text-xs font-bold py-3 uppercase tracking-wider cursor-pointer"
                >
                  Trigger Automated Recovery Audit
                </button>
              </div>
            ) : systemState === "RECOVERING" ? (
              <div className="bg-amber-950/20 border border-amber-900/40 p-6 text-center space-y-4 animate-pulse">
                <RefreshCw className="w-8 h-8 text-amber-500 mx-auto animate-spin" />
                <h4 className="text-sm font-mono tracking-widest uppercase text-amber-400">VERIFYING LOG INTEGRITY...</h4>
                <p className="text-[11px] text-white/50 font-mono leading-relaxed">
                  Scanning disk sectors, validating block checksums, and replaying uncommitted data pools.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Active Transaction State */}
                {activeTx ? (
                  <div className="bg-[#0F1219] border border-white/10 p-5 space-y-4">
                    <div className="flex justify-between items-center border-b border-white/5 pb-2.5">
                      <span className="text-[10px] bg-amber-400/10 border border-amber-400/25 text-amber-400 px-2 py-0.5 font-mono uppercase tracking-widest font-bold">
                        TX ACTIVE
                      </span>
                      <span className="text-[10px] font-mono text-white/40">ID: {activeTx.id}</span>
                    </div>

                    {/* Prepare Pointer Mutation */}
                    <div className="space-y-4 pt-1">
                      <p className="text-[10px] text-white/50 font-mono uppercase tracking-widest">Stage In-Memory Modification:</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[9px] text-white/40 font-mono uppercase tracking-wider block mb-1">Heap Object:</label>
                          <select
                            value={selectedObjectId}
                            onChange={(e) => {
                              setSelectedObjectId(e.target.value);
                              // Autofill appropriate keys
                              if (e.target.value === "db_cust") {
                                setWriteKey("row_0_balance");
                                setWriteValue("16500.00");
                              } else if (e.target.value === "db_prod") {
                                setWriteKey("item_0_stock");
                                setWriteValue("50");
                              } else {
                                setWriteKey("");
                                setWriteValue("");
                              }
                            }}
                            className="w-full bg-[#0B0E14] border border-white/10 p-2.5 rounded-none text-[11px] text-white font-mono focus:outline-none"
                          >
                            {objects.map(obj => (
                              <option key={obj.id} value={obj.id}>{obj.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[9px] text-white/40 font-mono uppercase tracking-wider block mb-1">Key Offset:</label>
                          <select
                            value={writeKey}
                            onChange={(e) => setWriteKey(e.target.value)}
                            className="w-full bg-[#0B0E14] border border-white/10 p-2.5 rounded-none text-[11px] text-white font-mono focus:outline-none"
                          >
                            {selectedObjectId === "db_cust" ? (
                              <>
                                <option value="row_0_balance">row_0_balance (Alice)</option>
                                <option value="row_1_balance">row_1_balance (Bob)</option>
                                <option value="row_2_balance">row_2_balance (Carol)</option>
                              </>
                            ) : selectedObjectId === "db_prod" ? (
                              <>
                                <option value="item_0_stock">item_0_stock (Processor)</option>
                                <option value="item_1_stock">item_1_stock (DRAM Cell)</option>
                              </>
                            ) : (
                              Object.keys(selectedObj?.data || {}).map(k => (
                                <option key={k} value={k}>{k}</option>
                              ))
                            )}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="text-[9px] text-white/40 font-mono uppercase tracking-wider block mb-1">New Data Block Value:</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={writeValue}
                            onChange={(e) => setWriteValue(e.target.value)}
                            className="flex-1 bg-[#0B0E14] border border-white/10 p-2.5 text-[11px] text-white font-mono focus:outline-none focus:border-amber-400 rounded-none"
                          />
                          <button
                            onClick={handleAddWrite}
                            className="bg-[#0B0E14] hover:bg-[#0B0E14]/75 text-white text-[10px] font-mono font-bold px-4 py-2 border border-white/10 cursor-pointer uppercase tracking-wider transition-colors"
                          >
                            Stage Write
                          </button>
                        </div>
                      </div>

                      {/* Pending Writes List */}
                      {activeTx.updatedKeys.length > 0 && (
                        <div className="border border-white/10 bg-[#0B0E14] p-3 font-mono text-[10px] max-h-24 overflow-y-auto space-y-1 scrollbar-thin">
                          <p className="text-[9px] text-white/30 mb-2 border-b border-white/5 pb-1">// staged heap writes (uncommitted)</p>
                          {activeTx.updatedKeys.map((item, idx) => (
                            <div key={idx} className="flex justify-between">
                              <span className="text-white/40">{item.key}:</span>
                              <span className="text-amber-400 font-semibold">
                                {item.oldValue} ➔ {item.newValue}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Commit/Abort actions */}
                      <div className="grid grid-cols-2 gap-3 pt-3">
                        <button
                          onClick={onCommitTx}
                          className="bg-emerald-500 hover:bg-emerald-400 text-[#0B0E14] font-mono text-xs font-bold py-2.5 uppercase tracking-wider flex items-center justify-center gap-1 cursor-pointer transition-colors"
                        >
                          Commit WAL
                        </button>
                        <button
                          onClick={onAbortTx}
                          className="bg-[#0B0E14] hover:bg-[#0B0E14]/75 text-white/70 hover:text-white border border-white/10 font-mono text-xs font-bold py-2.5 uppercase tracking-wider flex items-center justify-center gap-1 cursor-pointer transition-colors"
                        >
                          Abort Tx
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="border border-dashed border-white/10 p-6 text-center space-y-4">
                    <Play className="w-6 h-6 text-white/20 mx-auto" />
                    <p className="text-[11px] text-white/40 font-mono uppercase tracking-wider">[ No active transaction context exists ]</p>
                    <button
                      onClick={onBeginTx}
                      className="w-full bg-amber-400 hover:bg-amber-300 text-[#0B0E14] font-mono text-xs font-bold py-3 uppercase tracking-wider cursor-pointer transition-all active:scale-[0.98]"
                    >
                      Start ACID Transaction Context
                    </button>
                  </div>
                )}

                {/* Catastrophic OS Crash Trigger */}
                <div className="border border-red-950/40 bg-red-950/5 p-5 space-y-3">
                  <div className="flex items-center gap-2 text-red-400 text-xs font-mono uppercase tracking-wider font-semibold">
                    <Zap className="w-4 h-4 text-red-500 animate-pulse" />
                    Hardware Crash Simulation
                  </div>
                  <p className="text-[10px] text-white/50 leading-relaxed font-light">
                    Inject immediate power loss to volatile RAM. Uncommitted changes will evaporate, and the recovery engine must audit log parity upon reboot.
                  </p>
                  <button
                    onClick={onCrashSystem}
                    className="w-full bg-red-950/40 hover:bg-red-950/70 border border-red-800/40 text-red-200 font-mono text-xs font-bold py-2.5 uppercase tracking-wider cursor-pointer transition-colors"
                  >
                    Trigger Volatile Memory Wipe
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Database state indicators */}
          <div className="pt-4 mt-6 border-t border-white/10 text-[9px] font-mono text-white/30 tracking-widest uppercase flex justify-between">
            <span>CATALOG_CRC: F3E2901B</span>
            <span className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${systemState === "RUNNING" ? "bg-emerald-400" : "bg-red-400 animate-ping"}`} />
              OS STATUS: {systemState}
            </span>
          </div>
        </div>

        {/* 2. AUTOMATED RECOVERY LOG AUDIT SERVICE */}
        <div className="bg-[#0B0E14] p-8 border border-white/10 flex flex-col justify-between">
          <div>
            <span className="font-mono text-[10px] tracking-widest text-amber-400 uppercase font-semibold">Recovery Module</span>
            <h3 className="text-2xl font-serif italic text-white mt-1 border-b border-white/10 pb-4 mb-6">
              Recovery Log Audit
            </h3>
            <p className="text-white/60 text-xs font-light leading-relaxed mb-6">
              Auditing sector checksums and replaying write transactions allows the kernel to verify absolute consistency across hardware reboots.
            </p>

            {auditSteps.length > 0 ? (
              <div className="space-y-4">
                {/* Recovery Summary */}
                {recoveryMetrics && (
                  <div className="bg-emerald-950/20 border border-emerald-900/40 p-4 flex items-center gap-3">
                    <CheckCircle className="w-8 h-8 text-emerald-400 shrink-0" />
                    <div className="text-xs">
                      <h4 className="font-mono font-bold text-emerald-400 uppercase tracking-wide">INTEGRITY 100% RESTORED</h4>
                      <p className="text-[10px] text-white/60 leading-relaxed mt-1">
                        Successfully Redid <strong className="text-white font-semibold">{recoveryMetrics.redone}</strong> committed transactions, and Undid <strong className="text-white font-semibold">{recoveryMetrics.undone}</strong> uncommitted write segments.
                      </p>
                    </div>
                  </div>
                )}

                {/* Step-by-Step Scan Process */}
                <div className="bg-[#0F1219] border border-white/10 p-4 h-52 overflow-y-auto font-mono text-[10px] space-y-2 scrollbar-thin">
                  <p className="text-[9px] text-white/30 mb-2 border-b border-white/5 pb-1">// recovery log scan trail</p>
                  {auditSteps.map((step, idx) => (
                    <div key={idx} className="flex items-start gap-1.5">
                      <ArrowRight className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <span className="text-white/70 leading-normal">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-white/10 p-10 text-center text-white/30 text-xs font-mono">
                [ Waiting for Log Verification trigger... ]
                <p className="text-[10px] text-white/20 mt-3 leading-relaxed">
                  Simulate a power failure, then run recovery to see the step-by-step redone/undone integrity audit trail.
                </p>
              </div>
            )}
          </div>

          {/* Actions button */}
          {auditSteps.length > 0 && (
            <div className="grid grid-cols-2 gap-3 mt-6">
              <button
                onClick={handleExportAudit}
                className="bg-amber-400 hover:bg-amber-300 text-[#0B0E14] py-2.5 font-mono text-xs font-bold uppercase tracking-wider cursor-pointer transition-all flex items-center justify-center gap-1.5"
              >
                <Download className="w-4 h-4" /> Export Audit
              </button>
              <button
                onClick={() => {
                  setAuditSteps([]);
                  setRecoveryMetrics(null);
                }}
                className="border border-white/10 bg-[#0B0E14] hover:bg-white/5 text-white/60 hover:text-white py-2.5 font-mono text-xs uppercase tracking-wider cursor-pointer transition-all flex items-center justify-center gap-1.5"
              >
                <Trash className="w-4 h-4" /> Clear Output
              </button>
            </div>
          )}
        </div>

        {/* 3. LIVE WRITE-AHEAD LOG (WAL) MONITORS */}
        <div className="bg-[#0B0E14] p-8 border border-white/10 flex flex-col justify-between">
          <div className="flex flex-col h-full justify-between">
            <div>
              <span className="font-mono text-[10px] tracking-widest text-orange-500 uppercase font-semibold font-mono">Disk Buffer Area</span>
              <h3 className="text-2xl font-serif italic text-white mt-1 border-b border-white/10 pb-4 mb-6">
                Write-Ahead Log (WAL)
              </h3>
              <p className="text-white/60 text-xs font-light leading-relaxed mb-6">
                Real-time sector recordings storing operations, virtual transaction bounds, and checksum CRC keys.
              </p>
            </div>

            <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1 scrollbar-thin">
              {walLogs.map((log) => (
                <div
                  key={log.index}
                  className="bg-[#0F1219] border border-white/10 p-4 font-mono text-[10px] space-y-2"
                >
                  <div className="flex justify-between border-b border-white/5 pb-1.5 text-white/30">
                    <span>ENTRY #{log.index.toString().padStart(4, "0")}</span>
                    <span>{log.checksum}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-bold ${
                      log.action.startsWith("TX_COMMIT") ? "bg-emerald-950/40 text-emerald-400 border border-emerald-900/40" :
                      log.action.startsWith("TX_START") ? "bg-blue-950/40 text-blue-400 border border-blue-900/40" :
                      log.action.startsWith("TX_ABORT") ? "bg-red-950/40 text-red-400 border border-red-900/40" :
                      "bg-white/5 text-white/50 border border-white/10"
                    }`}>
                      {log.action}
                    </span>
                    <span className="text-white/40">{log.txId ? `TX: ${log.txId}` : "KERNEL_BUS"}</span>
                  </div>
                  <p className="text-white/70 leading-normal mt-1">{log.details}</p>
                  <div className="flex justify-between items-center text-[9px] text-white/20 border-t border-white/5 pt-1.5">
                    <span>Stamp: {new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span className="flex items-center gap-0.5 text-emerald-500">
                      <Check className="w-3 h-3" /> Integrity Ok
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 4. HIGH-FIDELITY SIMULATED DATABASE DATA ENTRY BOARD */}
      <div className="bg-[#0B0E14] border border-white/10 p-8" id="sls-database-data-entry-screen">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-white/10 pb-4 mb-6">
          <div>
            <span className="font-mono text-[10px] tracking-widest text-cyan-400 uppercase font-semibold">03.B // High-Fidelity Simulator Overlay</span>
            <h3 className="text-2xl font-serif italic text-white mt-1">
              Persistent Database Segment Data Entry Screen
            </h3>
          </div>
          <div className="bg-[#0F1219] border border-white/10 p-3 flex gap-2 items-center max-w-lg">
            <HelpCircle className="w-5 h-5 text-cyan-400 shrink-0" />
            <p className="text-[10px] text-white/50 font-mono leading-relaxed">
              In SLS, databases reside in global memory segments mapped to persistent storage sectors.
              Below, select a mapped segment to enter and inspect records in real-time.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Side: Entry Form Controls (col-span-5) */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-[#0F1219] border border-white/10 p-5 space-y-4">
              <span className="font-mono text-[9px] tracking-widest text-cyan-400 uppercase font-bold">// write preparation form</span>
              
              {/* Select target DB object */}
              <div>
                <label className="text-[10px] text-white/50 font-mono uppercase tracking-wider block mb-1">Target Segment (Database Table):</label>
                <select
                  value={selectedObjectId}
                  onChange={(e) => {
                    setSelectedObjectId(e.target.value);
                    if (e.target.value === "db_cust") {
                      setWriteKey("row_0_balance");
                      setWriteValue("16500.00");
                    } else if (e.target.value === "db_prod") {
                      setWriteKey("item_0_stock");
                      setWriteValue("50");
                    } else {
                      setWriteKey("");
                      setWriteValue("");
                    }
                  }}
                  className="w-full bg-[#0B0E14] border border-white/10 p-2.5 text-xs text-white font-mono focus:outline-none"
                >
                  {objects.map(obj => (
                    <option key={obj.id} value={obj.id}>
                      {obj.name} ({obj.type}) @ {obj.startAddress}
                    </option>
                  ))}
                </select>
              </div>

              {/* Mode toggle (Preset records vs. Fresh New Record) */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-[#0B0E14] border border-white/5">
                <button
                  type="button"
                  onClick={() => setEntryMode("preset")}
                  className={`py-1.5 font-mono text-[10px] uppercase tracking-wider transition-all cursor-pointer ${
                    entryMode === "preset" ? "bg-cyan-400/15 text-cyan-400 border border-cyan-400/20 font-bold" : "text-white/40 hover:text-white"
                  }`}
                >
                  Preset Schema Fields
                </button>
                <button
                  type="button"
                  onClick={() => setEntryMode("custom")}
                  className={`py-1.5 font-mono text-[10px] uppercase tracking-wider transition-all cursor-pointer ${
                    entryMode === "custom" ? "bg-cyan-400/15 text-cyan-400 border border-cyan-400/20 font-bold" : "text-white/40 hover:text-white"
                  }`}
                >
                  [+] Add Custom Record Key
                </button>
              </div>

              {entryMode === "preset" ? (
                /* PRESET MODE */
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] text-white/50 font-mono uppercase tracking-wider block mb-1">Select Row Field Key:</label>
                    <select
                      value={writeKey}
                      onChange={(e) => {
                        setWriteKey(e.target.value);
                        // Autofill values for realistic feel
                        if (e.target.value === "row_0_balance") setWriteValue("16500.00");
                        else if (e.target.value === "row_1_balance") setWriteValue("820.50");
                        else if (e.target.value === "row_2_balance") setWriteValue("12400.00");
                        else if (e.target.value === "item_0_stock") setWriteValue("120");
                        else if (e.target.value === "item_1_stock") setWriteValue("450");
                      }}
                      className="w-full bg-[#0B0E14] border border-white/10 p-2.5 text-xs text-white font-mono focus:outline-none"
                    >
                      {selectedObjectId === "db_cust" ? (
                        <>
                          <option value="row_0_balance">row_0_balance (Alice's Ledger Balance)</option>
                          <option value="row_1_balance">row_1_balance (Bob's Ledger Balance)</option>
                          <option value="row_2_balance">row_2_balance (Carol's Ledger Balance)</option>
                        </>
                      ) : selectedObjectId === "db_prod" ? (
                        <>
                          <option value="item_0_stock">item_0_stock (Processor Hardware Unit)</option>
                          <option value="item_1_stock">item_1_stock (DRAM Cell Module)</option>
                        </>
                      ) : (
                        Object.keys(selectedObj?.data || {}).map(k => (
                          <option key={k} value={k}>{k}</option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] text-white/50 font-mono uppercase tracking-wider block mb-1">Enter Update Value:</label>
                    <input
                      type="text"
                      value={writeValue}
                      onChange={(e) => setWriteValue(e.target.value)}
                      placeholder="e.g. 5000.00"
                      className="w-full bg-[#0B0E14] border border-white/10 p-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                </div>
              ) : (
                /* CUSTOM MODE: Full Data Entry Screen */
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] text-white/50 font-mono uppercase tracking-wider block mb-1">New Record Key (Column/Field ID):</label>
                    <input
                      type="text"
                      value={customKey}
                      onChange={(e) => setCustomKey(e.target.value)}
                      placeholder="e.g. row_3_balance or status_code"
                      className="w-full bg-[#0B0E14] border border-white/10 p-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                    />
                    <span className="text-[9px] text-white/30 font-mono mt-1 block leading-tight">
                      * Auto-formatted: spaces replaced with underscores, lowercase.
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-white/50 font-mono uppercase tracking-wider block mb-1">Data Value Type:</label>
                      <select
                        value={customDataType}
                        onChange={(e: any) => setCustomDataType(e.target.value)}
                        className="w-full bg-[#0B0E14] border border-white/10 p-2.5 text-xs text-white font-mono focus:outline-none"
                      >
                        <option value="number">Numeric Float</option>
                        <option value="string">Text String</option>
                        <option value="boolean">Boolean Flag</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-white/50 font-mono uppercase tracking-wider block mb-1">Value input:</label>
                      <input
                        type="text"
                        value={customValue}
                        onChange={(e) => setCustomValue(e.target.value)}
                        placeholder={
                          customDataType === "number" ? "e.g. 995.50" :
                          customDataType === "boolean" ? "true or false" : "e.g. Premium"
                        }
                        className="w-full bg-[#0B0E14] border border-white/10 p-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Action Buttons with rich explanation */}
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Option A: Safe Transactional write */}
                  <button
                    type="button"
                    onClick={handleAddWrite}
                    disabled={systemState !== "RUNNING"}
                    className={`w-full py-3 px-4 font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      !activeTx 
                        ? "bg-amber-400/10 border border-amber-400/20 text-amber-400 hover:bg-amber-400/20" 
                        : "bg-amber-400 text-[#0B0E14] hover:bg-amber-300 active:scale-[0.98]"
                    }`}
                  >
                    <Save className="w-3.5 h-3.5" /> 
                    {activeTx ? "Stage in WAL" : "Start Tx to Stage"}
                  </button>

                  {/* Option B: Direct bypassing write */}
                  <button
                    type="button"
                    onClick={handleDirectWriteImmediate}
                    disabled={systemState !== "RUNNING"}
                    className="w-full bg-[#0B0E14] hover:bg-red-500/10 border border-red-500/30 text-red-400 py-3 px-4 font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-[0.98]"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" /> Direct Heap Bypass
                  </button>
                </div>

                {!activeTx ? (
                  <p className="text-[10px] text-white/40 leading-relaxed font-mono bg-[#0B0E14]/60 p-3 border border-white/5">
                    💡 <strong className="text-amber-400">Transaction recommended</strong>: If you write directly via <span className="text-red-400">"Direct Heap Bypass"</span>, your record commits instantly without crash-safety buffers. If the OS crashes, these direct writes are un-logged and may lead to pointer misalignment or data decay!
                  </p>
                ) : (
                  <p className="text-[10px] text-white/40 leading-relaxed font-mono bg-amber-500/5 p-3 border border-amber-500/20">
                    Staging writes into active Transaction context. Remember to press <strong className="text-emerald-400 font-bold">"Commit WAL"</strong> in the controller above to write these changes to the virtual memory blocks permanently!
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Right Side: Live Table Memory Visualizer (col-span-7) */}
          <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
            <div className="bg-[#0F1219] border border-white/10 p-6 flex-1 flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-center border-b border-white/10 pb-3 mb-4">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-cyan-400" />
                    <span className="font-mono text-xs font-bold text-white uppercase">Live Memory Segment Heap Dump</span>
                  </div>
                  <span className="font-mono text-[9px] text-white/40 bg-white/5 px-2 py-0.5 rounded border border-white/10">
                    SEGMENT ADDRESS: {selectedObj?.startAddress || "0x0000"}
                  </span>
                </div>

                <p className="text-[11px] text-white/50 font-mono leading-relaxed mb-4">
                  Below is the live structured view inside persistent object <strong className="text-white">[{selectedObj?.name || "NULL"}]</strong>. As memory offsets are mutated, values here update in real-time.
                </p>

                {/* Table Schema Dump */}
                <div className="border border-white/10 bg-[#0B0E14] rounded-none overflow-hidden font-mono text-xs">
                  <div className="grid grid-cols-12 bg-white/5 border-b border-white/10 px-4 py-2 text-[10px] font-bold text-white/50 uppercase tracking-wider">
                    <div className="col-span-4 border-r border-white/5">Address Offset</div>
                    <div className="col-span-4 px-2 border-r border-white/5">Row/Attribute Key</div>
                    <div className="col-span-4 px-2">Live Value Block</div>
                  </div>

                  <div className="divide-y divide-white/5 max-h-[220px] overflow-y-auto scrollbar-thin">
                    {selectedObj && Object.entries(selectedObj.data).map(([k, v], idx) => {
                      const offsetAddress = `${selectedObj.startAddress}+0x${(idx * 32).toString(16).toUpperCase().padStart(3, "0")}`;
                      const isStagedInActiveTx = activeTx?.updatedKeys.some(u => u.objectId === selectedObj.id && u.key === k);
                      
                      return (
                        <div key={idx} className={`grid grid-cols-12 px-4 py-2 text-[11px] hover:bg-white/5 transition-colors ${isStagedInActiveTx ? "bg-amber-400/5" : ""}`}>
                          <div className="col-span-4 font-mono text-cyan-400/70 border-r border-white/5">{offsetAddress}</div>
                          <div className="col-span-4 px-2 font-mono text-white/85 border-r border-white/5 truncate">{k}</div>
                          <div className="col-span-4 px-2 font-mono flex items-center justify-between">
                            <span className={
                              isStagedInActiveTx ? "text-amber-400 font-bold" :
                              typeof v === "number" ? "text-emerald-400" :
                              typeof v === "boolean" ? "text-purple-400" : "text-amber-100"
                            }>
                              {String(v)}
                            </span>
                            {isStagedInActiveTx && (
                              <span className="text-[9px] bg-amber-400/10 border border-amber-400/25 text-amber-400 px-1 rounded uppercase tracking-widest font-bold scale-90">
                                Staged
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {!selectedObj || Object.keys(selectedObj.data).length === 0 ? (
                      <div className="p-8 text-center text-white/30 text-xs">
                        [ No records allocated inside this segment heap space ]
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Memory block specs */}
              <div className="border-t border-white/10 pt-4 mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4 text-[10px] font-mono uppercase tracking-wider text-white/40">
                <div>
                  <span className="text-white/20 block mb-0.5">Physical Segment Tier</span>
                  <span className="text-white font-semibold flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${
                      selectedObj?.tier === StorageTier.L1_CACHE ? "bg-red-400" :
                      selectedObj?.tier === StorageTier.L2_DRAM ? "bg-orange-400" :
                      selectedObj?.tier === StorageTier.L3_SSD ? "bg-blue-400" : "bg-purple-500"
                    }`} />
                    {selectedObj?.tier}
                  </span>
                </div>
                <div>
                  <span className="text-white/20 block mb-0.5">Heap Address Space</span>
                  <span className="text-white font-semibold">{selectedObj?.startAddress}</span>
                </div>
                <div>
                  <span className="text-white/20 block mb-0.5">Heap Segment Size</span>
                  <span className="text-white font-semibold">{selectedObj?.sizePages} Pages</span>
                </div>
                <div>
                  <span className="text-white/20 block mb-0.5">Compression Status</span>
                  <span className={selectedObj?.isCompressed ? "text-cyan-400 font-bold" : "text-white/60"}>
                    {selectedObj?.isCompressed ? "LZ4 COMPRESSED" : "RAW BYTE FLUSH"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
