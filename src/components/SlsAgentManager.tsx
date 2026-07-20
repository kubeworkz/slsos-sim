/**
 * SlsAgentManager — Phase H: AI Agent management panel.
 * Calls the kernel REST API directly (same-origin when served from the OS).
 * Auth token: dave@gridworkz.com  DB_ADMIN  (fixed at kernel boot).
 */
import React, { useState, useEffect } from "react";
import {
  Bot, Plus, Play, Trash2, RefreshCw, CheckCircle, AlertTriangle
} from "lucide-react";
import { authHeaders } from "../lib/apiFetch";

interface AgentInfo {
  name: string;
  model: string;
  endpoint: string;
  state: string;
  steps: number;
  tool_mask: number;
  object_id: number;
  memory_table?: string;
  last_answer?: string;
}

const TOOLS = [
  { flag: 0x01, name: "db_select",    label: "DB Select"    },
  { flag: 0x02, name: "db_insert",    label: "DB Insert"    },
  { flag: 0x04, name: "db_query",     label: "DB Query"     },
  { flag: 0x08, name: "stream_read",  label: "Stream Read"  },
  { flag: 0x10, name: "stream_write", label: "Stream Write" },
  { flag: 0x80, name: "tier_promote", label: "Tier Promote" },
];

export default function SlsAgentManager() {
  const [agents,      setAgents]      = useState<AgentInfo[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [fetchError,  setFetchError]  = useState<string | null>(null);

  // Create form
  const [showCreate,     setShowCreate]     = useState(false);
  const [createName,     setCreateName]     = useState("");
  const [createEndpoint, setCreateEndpoint] = useState("10.0.2.2:11434");
  const [createModel,    setCreateModel]    = useState("llama3.2");
  const [createPrompt,   setCreatePrompt]   = useState("");
  const [createToolMask, setCreateToolMask] = useState(0);
  const [createStatus,   setCreateStatus]   = useState<string | null>(null);

  // Run form
  const [showRun,    setShowRun]    = useState(false);
  const [runAgent,   setRunAgent]   = useState("");
  const [runMessage, setRunMessage] = useState("");
  const [runLoading, setRunLoading] = useState(false);
  const [runResult,  setRunResult]  = useState<string | null>(null);

  // authHeaders imported from ../lib/apiFetch (was a local re-declaration).

  const fetchAgents = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/agents", { headers: authHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAgents(data.agents || []);
    } catch (e: any) {
      setFetchError(`Could not reach kernel API: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAgents(); }, []);

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreateStatus("Creating...");
    try {
      const toolsList = TOOLS.filter(t => createToolMask & t.flag).map(t => t.name).join(",");
      const res = await fetch("/api/agent/create", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          name:          createName,
          endpoint:      createEndpoint,
          model:         createModel,
          system_prompt: createPrompt,
          tools:         toolsList,
        }),
      });
      const data = await res.json();
      if (data.ok === "true") {
        setCreateStatus(`Agent '${createName}' created.`);
        setCreateName(""); setCreatePrompt(""); setCreateToolMask(0);
        setShowCreate(false);
        fetchAgents();
      } else {
        setCreateStatus(`Error: ${data.error ?? "unknown"}`);
      }
    } catch (e: any) {
      setCreateStatus(`Error: ${e.message}`);
    }
  };

  const handleRun = async () => {
    if (!runAgent || !runMessage.trim()) return;
    setRunLoading(true);
    setRunResult(null);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name: runAgent, message: runMessage }),
      });
      const data = await res.json();
      if (data.ok === "true") {
        setRunResult(`Completed — ${data.steps} total step(s). Check serial log for answer.`);
      } else {
        setRunResult(`Error: ${data.error ?? "run failed"}`);
      }
      fetchAgents();
    } catch (e: any) {
      setRunResult(`Error: ${e.message}`);
    } finally {
      setRunLoading(false);
    }
  };

  const handleDrop = async (name: string) => {
    try {
      await fetch("/api/agent/drop", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name }),
      });
      fetchAgents();
    } catch { /* ignore */ }
  };

  const toggleTool = (flag: number) => setCreateToolMask(prev => prev ^ flag);

  return (
    <div className="p-6 space-y-6 font-mono">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bot className="w-5 h-5 text-cyan-400" />
          <h2 className="text-sm font-bold tracking-widest uppercase text-white">AI Agent Manager</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchAgents}
            className="flex items-center gap-1.5 text-[10px] text-white/50 hover:text-white border border-white/10 px-3 py-1.5 transition-colors">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
          <button onClick={() => { setShowCreate(true); setCreateStatus(null); }}
            className="flex items-center gap-1.5 text-[10px] bg-cyan-400 text-[#0B0E14] font-bold px-3 py-1.5 hover:bg-cyan-300 transition-colors">
            <Plus className="w-3 h-3" /> New Agent
          </button>
          <button onClick={() => { setShowRun(true); setRunResult(null); }}
            className="flex items-center gap-1.5 text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold px-3 py-1.5 hover:bg-emerald-500/30 transition-colors">
            <Play className="w-3 h-3" /> Run Agent
          </button>
        </div>
      </div>

      {fetchError && (
        <div className="flex items-center gap-2 text-xs text-red-400 border border-red-500/30 bg-red-500/10 px-4 py-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {fetchError}
        </div>
      )}

      {/* ── Agent table ─────────────────────────────────────────────────────── */}
      <div className="border border-white/10">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-white/10 text-white/40 uppercase tracking-wider">
              <th className="text-left px-4 py-2">Name</th>
              <th className="text-left px-4 py-2">Model</th>
              <th className="text-left px-4 py-2">Endpoint</th>
              <th className="text-left px-4 py-2">State</th>
              <th className="text-left px-4 py-2">Steps</th>
              <th className="text-left px-4 py-2">Tools</th>
              <th className="text-left px-4 py-2">Last Answer</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-white/30">Loading from kernel...</td></tr>
            )}
            {!loading && agents.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-white/30">No agents registered. Create one to begin.</td></tr>
            )}
            {agents.map(ag => (
              <tr key={ag.name} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="px-4 py-2.5 text-cyan-400 font-bold">{ag.name}</td>
                <td className="px-4 py-2.5 text-white/70">{ag.model}</td>
                <td className="px-4 py-2.5 text-white/50">{ag.endpoint}</td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 text-[9px] font-bold uppercase ${
                    ag.state === "IDLE"    ? "bg-emerald-500/20 text-emerald-400" :
                    ag.state === "RUNNING" ? "bg-amber-500/20  text-amber-400"   :
                                            "bg-red-500/20     text-red-400"
                  }`}>{ag.state}</span>
                </td>
                <td className="px-4 py-2.5 text-white/70">{ag.steps}</td>
                <td className="px-4 py-2.5 text-white/40 font-mono">
                  {TOOLS.filter(t => ag.tool_mask & t.flag).map(t => t.label).join(", ") || "—"}
                </td>
                <td className="px-4 py-2.5 max-w-[240px]">
                  {ag.last_answer ? (
                    <span title={ag.last_answer}
                      className="text-white/50 text-[10px] block truncate cursor-help">
                      {ag.last_answer}
                    </span>
                  ) : (
                    <span className="text-white/20 text-[10px]">none</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <button onClick={() => handleDrop(ag.name)}
                    className="text-red-400/40 hover:text-red-400 transition-colors p-1">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Create Agent panel ──────────────────────────────────────────────── */}
      {showCreate && (
        <div className="border border-cyan-400/25 bg-[#0F1219] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white uppercase tracking-wider">Create Agent</span>
            <button onClick={() => setShowCreate(false)} className="text-white/30 hover:text-white">✕</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Name",              val: createName,     set: setCreateName,     ph: "myagent"                            },
              { label: "Endpoint (ip:port)",val: createEndpoint, set: setCreateEndpoint, ph: "10.0.2.2:11434"                      },
              { label: "Model",             val: createModel,    set: setCreateModel,    ph: "llama3.2"                           },
              { label: "System Prompt",     val: createPrompt,   set: setCreatePrompt,   ph: "You are a kernel data assistant"    },
            ].map(({ label, val, set, ph }) => (
              <div key={label}>
                <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1">{label}</label>
                <input value={val} onChange={e => set(e.target.value)}
                  className="w-full bg-transparent border border-white/20 text-white text-xs px-3 py-2 focus:border-cyan-400/50 outline-none font-mono"
                  placeholder={ph} />
              </div>
            ))}
          </div>

          <div>
            <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-2">Permitted Tools</label>
            <div className="flex flex-wrap gap-2">
              {TOOLS.map(t => (
                <button key={t.flag} onClick={() => toggleTool(t.flag)}
                  className={`text-[10px] px-2.5 py-1 border transition-colors ${
                    createToolMask & t.flag
                      ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-400"
                      : "border-white/15 text-white/40 hover:border-white/30"
                  }`}>{t.label}</button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button onClick={handleCreate}
              className="bg-cyan-400 text-[#0B0E14] text-xs font-bold px-5 py-2 hover:bg-cyan-300 transition-colors">
              Create Agent
            </button>
            {createStatus && (
              <span className={`text-[10px] ${createStatus.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>
                {createStatus}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Run Agent panel ─────────────────────────────────────────────────── */}
      {showRun && (
        <div className="border border-emerald-500/20 bg-[#0F1219] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white uppercase tracking-wider">Run Agent (ReAct Loop)</span>
            <button onClick={() => setShowRun(false)} className="text-white/30 hover:text-white">✕</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1">Agent</label>
              <select value={runAgent} onChange={e => setRunAgent(e.target.value)}
                className="w-full bg-[#0B0E14] border border-white/20 text-white text-xs px-3 py-2 focus:border-emerald-400/50 outline-none font-mono">
                <option value="">Select agent…</option>
                {agents.map(ag => <option key={ag.name} value={ag.name}>{ag.name} ({ag.model})</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1">Message</label>
              <input value={runMessage} onChange={e => setRunMessage(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleRun()}
                className="w-full bg-transparent border border-white/20 text-white text-xs px-3 py-2 focus:border-emerald-400/50 outline-none font-mono"
                placeholder="Query or instruction…" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleRun} disabled={runLoading}
              className="flex items-center gap-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-bold px-5 py-2 hover:bg-emerald-500/30 transition-colors disabled:opacity-50">
              {runLoading
                ? <><span className="animate-spin inline-block w-3 h-3 border border-emerald-400 border-t-transparent rounded-full" /> Running inference…</>
                : <><Play className="w-3 h-3" /> Run</>}
            </button>
            {runResult && !runLoading && (
              <span className={`text-[10px] flex items-center gap-1 ${runResult.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>
                {runResult.startsWith("Error") ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />} {runResult}
              </span>
            )}
          </div>
          <p className="text-[9px] text-white/25 leading-relaxed">
            The response arrives after the full ReAct chain completes (may take several seconds for local LLMs).
            The kernel serial log shows each reasoning step and any tool calls in real time.
          </p>
        </div>
      )}
    </div>
  );
}
