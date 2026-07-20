/**
 * SlsWorkflowBuilder — Phase H: Multi-step agent pipeline builder.
 * Pipelines sequential agent calls via a shared DB_TABLE state object.
 */
import React, { useState, useEffect } from "react";
import {
  GitBranch, Plus, Play, Trash2, RefreshCw, CheckCircle, AlertTriangle, ChevronRight
} from "lucide-react";
import { authHeaders, authFetch } from "../lib/apiFetch";

interface WorkflowInfo {
  name: string;
  state: string;
  step_count: number;
  current_step: number;
}

interface StepDraft {
  agent:     string;
  input_key: string;
  out_key:   string;
}

export default function SlsWorkflowBuilder() {
  const [workflows,   setWorkflows]   = useState<WorkflowInfo[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [fetchError,  setFetchError]  = useState<string | null>(null);

  // Create form
  const [showCreate,    setShowCreate]    = useState(false);
  const [createName,    setCreateName]    = useState("");
  const [sharedTable,   setSharedTable]   = useState("");
  const [steps,         setSteps]         = useState<StepDraft[]>([
    { agent: "", input_key: "input", out_key: "step0_out" },
  ]);
  const [createStatus,  setCreateStatus]  = useState<string | null>(null);

  // Run form
  const [showRun,     setShowRun]     = useState(false);
  const [runWorkflow, setRunWorkflow] = useState("");
  const [runInput,    setRunInput]    = useState("");
  const [runLoading,  setRunLoading]  = useState(false);
  const [runResult,   setRunResult]   = useState<string | null>(null);

  // authHeaders imported from ../lib/apiFetch (was a local re-declaration).

  const fetchWorkflows = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await authFetch("/api/workflows");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setWorkflows(data.workflows || []);
    } catch (e: any) {
      setFetchError(`Could not reach kernel API: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchWorkflows(); }, []);

  const handleCreate = async () => {
    if (!createName.trim() || steps.length === 0) return;
    setCreateStatus("Creating…");
    try {
      const body: Record<string, string | number> = {
        name:         createName,
        shared_table: sharedTable || `${createName}_state`,
        step_count:   steps.length,
      };
      steps.forEach((s, i) => {
        body[`step${i}_agent`] = s.agent;
        body[`step${i}_in`]    = s.input_key;
        body[`step${i}_out`]   = s.out_key;
      });
      const res = await fetch("/api/workflow/create", {
        method: "POST", headers: authHeaders, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok === "true") {
        setCreateStatus(`Workflow '${createName}' created with ${data.steps} step(s).`);
        setCreateName(""); setSharedTable("");
        setSteps([{ agent: "", input_key: "input", out_key: "step0_out" }]);
        setShowCreate(false);
        fetchWorkflows();
      } else {
        setCreateStatus(`Error: ${data.error ?? "unknown"}`);
      }
    } catch (e: any) {
      setCreateStatus(`Error: ${e.message}`);
    }
  };

  const handleRun = async () => {
    if (!runWorkflow || !runInput.trim()) return;
    setRunLoading(true);
    setRunResult(null);
    try {
      const res = await fetch("/api/workflow/run", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ name: runWorkflow, input: runInput }),
      });
      const data = await res.json();
      setRunResult(
        data.ok === "true"
          ? `Pipeline '${runWorkflow}' completed.`
          : `Error: ${data.error ?? "failed"}`,
      );
      fetchWorkflows();
    } catch (e: any) {
      setRunResult(`Error: ${e.message}`);
    } finally {
      setRunLoading(false);
    }
  };

  const addStep = () => {
    const i = steps.length;
    setSteps(prev => [...prev, { agent: "", input_key: `step${i - 1}_out`, out_key: `step${i}_out` }]);
  };

  const removeStep = (idx: number) => setSteps(prev => prev.filter((_, i) => i !== idx));

  const updateStep = (idx: number, field: keyof StepDraft, value: string) =>
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));

  return (
    <div className="p-6 space-y-6 font-mono">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <GitBranch className="w-5 h-5 text-violet-400" />
          <h2 className="text-sm font-bold tracking-widest uppercase text-white">Workflow Builder</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchWorkflows}
            className="flex items-center gap-1.5 text-[10px] text-white/50 hover:text-white border border-white/10 px-3 py-1.5 transition-colors">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
          <button onClick={() => { setShowCreate(true); setCreateStatus(null); }}
            className="flex items-center gap-1.5 text-[10px] bg-violet-400 text-[#0B0E14] font-bold px-3 py-1.5 hover:bg-violet-300 transition-colors">
            <Plus className="w-3 h-3" /> New Workflow
          </button>
          <button onClick={() => { setShowRun(true); setRunResult(null); }}
            className="flex items-center gap-1.5 text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold px-3 py-1.5 hover:bg-emerald-500/30 transition-colors">
            <Play className="w-3 h-3" /> Run Pipeline
          </button>
        </div>
      </div>

      {fetchError && (
        <div className="flex items-center gap-2 text-xs text-red-400 border border-red-500/30 bg-red-500/10 px-4 py-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {fetchError}
        </div>
      )}

      {/* ── Workflow table ──────────────────────────────────────────────────── */}
      <div className="border border-white/10">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-white/10 text-white/40 uppercase tracking-wider">
              <th className="text-left px-4 py-2">Name</th>
              <th className="text-left px-4 py-2">State</th>
              <th className="text-left px-4 py-2">Steps</th>
              <th className="text-left px-4 py-2">Progress</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-white/30">Loading from kernel…</td></tr>
            )}
            {!loading && workflows.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-white/30">No pipelines defined. Create one to get started.</td></tr>
            )}
            {workflows.map(wf => (
              <tr key={wf.name} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="px-4 py-2.5 text-violet-400 font-bold">{wf.name}</td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 text-[9px] font-bold uppercase ${
                    wf.state === "DONE"    ? "bg-emerald-500/20 text-emerald-400" :
                    wf.state === "RUNNING" ? "bg-amber-500/20  text-amber-400"   :
                    wf.state === "ERROR"   ? "bg-red-500/20    text-red-400"     :
                                            "bg-white/5        text-white/50"
                  }`}>{wf.state}</span>
                </td>
                <td className="px-4 py-2.5 text-white/70">{wf.step_count}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1">
                    {Array.from({ length: wf.step_count }).map((_, i) => (
                      <div key={i} className={`w-5 h-1.5 ${
                        i < wf.current_step                              ? "bg-emerald-400"          :
                        i === wf.current_step && wf.state === "RUNNING"  ? "bg-amber-400 animate-pulse" :
                                                                           "bg-white/15"
                      }`} />
                    ))}
                    <span className="text-white/30 ml-1">{wf.current_step}/{wf.step_count}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Create Workflow panel ───────────────────────────────────────────── */}
      {showCreate && (
        <div className="border border-violet-400/20 bg-[#0F1219] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white uppercase tracking-wider">Define Pipeline</span>
            <button onClick={() => setShowCreate(false)} className="text-white/30 hover:text-white">✕</button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1">Pipeline Name</label>
              <input value={createName} onChange={e => setCreateName(e.target.value)}
                className="w-full bg-transparent border border-white/20 text-white text-xs px-3 py-2 focus:border-violet-400/50 outline-none font-mono"
                placeholder="my_pipeline" />
            </div>
            <div>
              <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1">Shared State Table</label>
              <input value={sharedTable} onChange={e => setSharedTable(e.target.value)}
                className="w-full bg-transparent border border-white/20 text-white text-xs px-3 py-2 focus:border-violet-400/50 outline-none font-mono"
                placeholder="auto-named if empty" />
            </div>
          </div>

          {/* Step editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] text-white/40 uppercase tracking-wider">Steps</label>
              <button onClick={addStep}
                className="text-[10px] text-violet-400 hover:text-violet-300 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add Step
              </button>
            </div>
            <div className="space-y-2">
              {/* Column headers */}
              <div className="flex items-center gap-2 px-2 text-[9px] text-white/25 uppercase tracking-wider">
                <span className="w-4"></span>
                <span className="w-3 flex-shrink-0"></span>
                <span className="flex-1">Agent name</span>
                <span className="w-24">Input key</span>
                <span className="w-3 text-center">→</span>
                <span className="w-24">Output key</span>
                <span className="w-4"></span>
              </div>
              {steps.map((s, i) => (
                <div key={i} className="flex items-center gap-2 bg-white/[0.02] border border-white/8 p-2">
                  <span className="text-[9px] text-violet-400/50 w-4 text-right shrink-0">{i}</span>
                  <ChevronRight className="w-3 h-3 text-white/20 shrink-0" />
                  <input value={s.agent} onChange={e => updateStep(i, "agent", e.target.value)}
                    className="flex-1 bg-transparent border border-white/15 text-white text-[10px] px-2 py-1 outline-none font-mono focus:border-violet-400/40"
                    placeholder="agent name" />
                  <input value={s.input_key} onChange={e => updateStep(i, "input_key", e.target.value)}
                    className="w-24 bg-transparent border border-white/15 text-white/70 text-[10px] px-2 py-1 outline-none font-mono focus:border-violet-400/40"
                    placeholder="in_key" />
                  <span className="text-white/20 text-[10px] shrink-0">→</span>
                  <input value={s.out_key} onChange={e => updateStep(i, "out_key", e.target.value)}
                    className="w-24 bg-transparent border border-white/15 text-white/70 text-[10px] px-2 py-1 outline-none font-mono focus:border-violet-400/40"
                    placeholder="out_key" />
                  {steps.length > 1 && (
                    <button onClick={() => removeStep(i)} className="text-red-400/40 hover:text-red-400 shrink-0">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button onClick={handleCreate}
              className="bg-violet-400 text-[#0B0E14] text-xs font-bold px-5 py-2 hover:bg-violet-300 transition-colors">
              Create Pipeline
            </button>
            {createStatus && (
              <span className={`text-[10px] ${createStatus.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>
                {createStatus}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Run Workflow panel ──────────────────────────────────────────────── */}
      {showRun && (
        <div className="border border-emerald-500/20 bg-[#0F1219] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white uppercase tracking-wider">Execute Pipeline</span>
            <button onClick={() => setShowRun(false)} className="text-white/30 hover:text-white">✕</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1">Pipeline</label>
              <select value={runWorkflow} onChange={e => setRunWorkflow(e.target.value)}
                className="w-full bg-[#0B0E14] border border-white/20 text-white text-xs px-3 py-2 focus:border-emerald-400/50 outline-none font-mono">
                <option value="">Select pipeline…</option>
                {workflows.map(wf => (
                  <option key={wf.name} value={wf.name}>{wf.name} ({wf.step_count} step{wf.step_count !== 1 ? "s" : ""})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1">Initial Input</label>
              <input value={runInput} onChange={e => setRunInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleRun()}
                className="w-full bg-transparent border border-white/20 text-white text-xs px-3 py-2 focus:border-emerald-400/50 outline-none font-mono"
                placeholder="Starting message or query…" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleRun} disabled={runLoading}
              className="flex items-center gap-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-bold px-5 py-2 hover:bg-emerald-500/30 transition-colors disabled:opacity-50">
              {runLoading
                ? <><span className="animate-spin inline-block w-3 h-3 border border-emerald-400 border-t-transparent rounded-full" /> Executing pipeline…</>
                : <><Play className="w-3 h-3" /> Execute</>}
            </button>
            {runResult && !runLoading && (
              <span className={`text-[10px] flex items-center gap-1 ${runResult.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>
                {runResult.startsWith("Error") ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                {runResult}
              </span>
            )}
          </div>
          <p className="text-[9px] text-white/25 leading-relaxed">
            Each step runs a full ReAct loop sequentially. The HTTP response returns after all steps
            complete. Output keys from each step are written to the shared state table and available
            to subsequent steps. Monitor step-by-step output on the kernel serial port.
          </p>
        </div>
      )}
    </div>
  );
}
