import React, { useState, useEffect, useCallback } from "react";
import { Database, BookOpen, BarChart3, Table2, RefreshCw, Play, Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { SlsObject, SlsUser } from "../types/sls";

interface SlsDbEngineProps {
  objects: SlsObject[];
  activeUser: SlsUser | null;
}

type DbTab = "schema" | "journal" | "mqt" | "aggregate";

// ─── Shared fetch helper ──────────────────────────────────────────────────────
async function kFetch(path: string, opts?: RequestInit) {
  const r = await fetch(path, opts);
  return r.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. DB SCHEMA EXPLORER
// ─────────────────────────────────────────────────────────────────────────────
function SchemaExplorer() {
  const [tables, setTables]           = useState<any[]>([]);
  const [constraints, setConstraints] = useState<Record<string, any[]>>({});
  const [indexes, setIndexes]         = useState<any[]>([]);
  const [expanded, setExpanded]       = useState<Record<string, boolean>>({});
  const [loading, setLoading]         = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const scan = await kFetch("/api/scan");
      const dbTables = (scan.objects || []).filter((o: any) => o.type === "DB_TABLE" || o.type === 1);
      setTables(dbTables);

      const [cData, iData] = await Promise.all([
        kFetch("/api/constraints"),
        kFetch("/api/indexes"),
      ]);
      const cMap: Record<string, any[]> = {};
      (cData || []).forEach((c: any) => {
        if (!cMap[c.table]) cMap[c.table] = [];
        cMap[c.table].push(c);
      });
      setConstraints(cMap);
      setIndexes(iData || []);
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const ctypeBadge = (t: string) => {
    const colours: Record<string, string> = {
      UNIQUE: "text-cyan-400 bg-cyan-400/10 border-cyan-400/25",
      NOT_NULL: "text-amber-400 bg-amber-400/10 border-amber-400/25",
      RANGE: "text-purple-400 bg-purple-400/10 border-purple-400/25",
      REFERENCE: "text-green-400 bg-green-400/10 border-green-400/25",
    };
    return colours[t] || "text-white/50 bg-white/5 border-white/10";
  };

  if (loading) return <p className="text-white/40 font-mono text-xs">Loading schema…</p>;
  if (!tables.length) return <p className="text-white/40 font-mono text-xs">No DB_TABLE objects found. Create one with <code className="text-cyan-400">valloc &lt;name&gt; DB_TABLE &lt;pages&gt;</code>.</p>;

  return (
    <div className="space-y-3">
      {tables.map((t: any) => {
        const tName = t.name;
        const tConstraints = constraints[tName] || [];
        const tIndexes = indexes.filter((i: any) => i.table === tName);
        const isOpen = expanded[tName];
        return (
          <div key={tName} className="border border-white/10 bg-[#0B0E14]">
            <button
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/5 transition-colors"
              onClick={() => setExpanded(p => ({ ...p, [tName]: !p[tName] }))}
            >
              <div className="flex items-center gap-3">
                {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-white/40" /> : <ChevronRight className="w-3.5 h-3.5 text-white/40" />}
                <Table2 className="w-3.5 h-3.5 text-cyan-400" />
                <span className="font-mono text-sm text-white font-semibold">{tName}</span>
                <span className="text-[10px] font-mono text-white/30">DB_TABLE</span>
              </div>
              <div className="flex items-center gap-2">
                {tConstraints.length > 0 && (
                  <span className="text-[9px] font-mono px-2 py-0.5 bg-amber-400/10 border border-amber-400/25 text-amber-400 uppercase tracking-widest">
                    {tConstraints.length} constraint{tConstraints.length > 1 ? "s" : ""}
                  </span>
                )}
                {tIndexes.length > 0 && (
                  <span className="text-[9px] font-mono px-2 py-0.5 bg-cyan-400/10 border border-cyan-400/25 text-cyan-400 uppercase tracking-widest">
                    {tIndexes.length} index{tIndexes.length > 1 ? "es" : ""}
                  </span>
                )}
                <span className="text-[10px] font-mono text-white/30">{t.pages || "?"} pages · {t.tier || "?"}</span>
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-white/10 px-5 py-4 space-y-4">
                {/* Constraints */}
                <div>
                  <span className="text-[9px] font-mono tracking-widest uppercase text-white/30 block mb-2">Constraints</span>
                  {tConstraints.length === 0 ? (
                    <span className="text-[11px] font-mono text-white/30 italic">No constraints defined</span>
                  ) : (
                    <div className="space-y-1">
                      {tConstraints.map((c: any, i: number) => (
                        <div key={i} className="flex items-center gap-3 text-[11px] font-mono">
                          <span className={`px-2 py-0.5 border text-[9px] uppercase tracking-widest font-bold ${ctypeBadge(c.type)}`}>{c.type}</span>
                          <span className="text-white/70">{c.field}</span>
                          {c.min !== undefined && <span className="text-white/40">[{c.min}…{c.max}]</span>}
                          {c.ref && <span className="text-white/40">→ {c.ref}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* Indexes */}
                <div>
                  <span className="text-[9px] font-mono tracking-widest uppercase text-white/30 block mb-2">Indexes</span>
                  {tIndexes.length === 0 ? (
                    <span className="text-[11px] font-mono text-white/30 italic">No indexes defined</span>
                  ) : (
                    <div className="space-y-1">
                      {tIndexes.map((ix: any, i: number) => (
                        <div key={i} className="flex items-center gap-3 text-[11px] font-mono">
                          <span className="text-cyan-400 font-semibold">{ix.name}</span>
                          <span className="text-white/40">on field</span>
                          <span className="text-white/70">{ix.field}</span>
                          <span className="text-white/30">{ix.entries} entries</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <button onClick={load} className="flex items-center gap-2 text-[10px] font-mono text-white/40 hover:text-white/70 transition-colors mt-2">
        <RefreshCw className="w-3 h-3" /> Refresh
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. JOURNAL VIEWER
// ─────────────────────────────────────────────────────────────────────────────
const JTYPE_COLOURS: Record<string, string> = {
  PT: "text-green-400 bg-green-400/10 border-green-400/30",
  UP: "text-cyan-400 bg-cyan-400/10 border-cyan-400/30",
  UB: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  DL: "text-red-400 bg-red-400/10 border-red-400/30",
  CM: "text-blue-400 bg-blue-400/10 border-blue-400/30",
  RB: "text-purple-400 bg-purple-400/10 border-purple-400/30",
};

function JournalViewer() {
  const [journals, setJournals]   = useState<any[]>([]);
  const [selected, setSelected]   = useState("");
  const [entries, setEntries]     = useState<any[]>([]);
  const [since, setSince]         = useState("0");
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    kFetch("/api/journals").then(d => {
      const list = d || [];
      setJournals(list);
      if (list.length > 0) setSelected(list[0].journal);
    }).catch(() => {});
  }, []);

  const loadEntries = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    try {
      const sinceNum = parseInt(since) || 0;
      const data = await kFetch(`/api/journal/${selected}?since=${sinceNum}`);
      setEntries(Array.isArray(data) ? data : []);
    } catch (_) { setEntries([]); }
    setLoading(false);
  }, [selected, since]);

  useEffect(() => { if (selected) loadEntries(); }, [selected, loadEntries]);

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Journal</span>
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            className="bg-[#0B0E14] border border-white/10 text-white font-mono text-xs px-3 py-1.5 outline-none focus:border-cyan-400/50"
          >
            {journals.length === 0 && <option value="">No journals</option>}
            {journals.map((j: any) => (
              <option key={j.journal} value={j.journal}>{j.journal} → {j.table}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Since seq</span>
          <input
            type="number" value={since} onChange={e => setSince(e.target.value)} min={0}
            className="bg-[#0B0E14] border border-white/10 text-white font-mono text-xs px-3 py-1.5 w-24 outline-none focus:border-cyan-400/50"
          />
        </div>
        <button onClick={loadEntries} className="flex items-center gap-1.5 bg-cyan-400/10 border border-cyan-400/25 text-cyan-400 text-[10px] font-mono uppercase tracking-widest px-3 py-1.5 hover:bg-cyan-400/20 transition-colors">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {/* Entry type legend */}
      <div className="flex items-center gap-2 flex-wrap">
        {Object.entries(JTYPE_COLOURS).map(([t, cls]) => (
          <span key={t} className={`text-[9px] font-mono px-2 py-0.5 border uppercase tracking-widest font-bold ${cls}`}>{t}</span>
        ))}
        <span className="text-[9px] font-mono text-white/30">PT=Insert UP=Update UB=Before UB DL=Delete CM=Commit RB=Rollback</span>
      </div>

      {/* Table */}
      {journals.length === 0 ? (
        <p className="text-white/40 font-mono text-xs italic">
          No journals attached. Use <code className="text-cyan-400">POST /api/journal/attach</code> to start journaling a table.
        </p>
      ) : loading ? (
        <p className="text-white/40 font-mono text-xs">Loading entries…</p>
      ) : entries.length === 0 ? (
        <p className="text-white/40 font-mono text-xs italic">No journal entries yet. Insert or update records in the attached table.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-white/40 text-[9px] uppercase tracking-widest">
                <th className="text-left px-3 py-2">Seq</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Object</th>
                <th className="text-left px-3 py-2">Key</th>
                <th className="text-left px-3 py-2">Before</th>
                <th className="text-left px-3 py-2">After</th>
                <th className="text-left px-3 py-2">TX</th>
                <th className="text-left px-3 py-2">State</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e: any, i: number) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="px-3 py-2 text-white/50">{e.seq}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 border text-[9px] uppercase tracking-widest font-bold ${JTYPE_COLOURS[e.type] || "text-white/50 bg-white/5 border-white/10"}`}>
                      {e.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-white/70">{e.object || "—"}</td>
                  <td className="px-3 py-2 text-cyan-300">{e.key || "—"}</td>
                  <td className="px-3 py-2 text-amber-300/70">{e.before || "—"}</td>
                  <td className="px-3 py-2 text-green-300/70">{e.after || "—"}</td>
                  <td className="px-3 py-2 text-white/30">{e.tx || 0}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[9px] font-mono ${e.committed ? "text-green-400" : "text-white/30"}`}>
                      {e.committed ? "✓" : "pending"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] font-mono text-white/30 mt-2">{entries.length} entries</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. MQT DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
function MqtDashboard() {
  const [mqts, setMqts]           = useState<any[]>([]);
  const [results, setResults]     = useState<Record<string, any>>({});
  const [newForm, setNewForm]     = useState({ name: "", table: "", fn: "COUNT", field: "", group_by: "" });
  const [showForm, setShowForm]   = useState(false);
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});

  const loadAll = useCallback(async () => {
    try {
      const list = await kFetch("/api/mqts");
      setMqts(list || []);
      const ress: Record<string, any> = {};
      await Promise.all((list || []).map(async (m: any) => {
        try {
          const r = await kFetch(`/api/mqt/${m.name}`);
          ress[m.name] = r;
        } catch (_) {}
      }));
      setResults(ress);
    } catch (_) {}
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  // Auto-refresh every 5s
  useEffect(() => {
    const t = setInterval(loadAll, 5000);
    return () => clearInterval(t);
  }, [loadAll]);

  const handleRefresh = async (name: string) => {
    setRefreshing(p => ({ ...p, [name]: true }));
    await kFetch("/api/mqt/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer deadbeef01234567cafebabe76543210" },
      body: JSON.stringify({ name }),
    });
    await loadAll();
    setRefreshing(p => ({ ...p, [name]: false }));
  };

  const handleCreate = async () => {
    await kFetch("/api/mqt/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer deadbeef01234567cafebabe76543210" },
      body: JSON.stringify(newForm),
    });
    setShowForm(false);
    setNewForm({ name: "", table: "", fn: "COUNT", field: "", group_by: "" });
    loadAll();
  };

  const getResultValue = (name: string): string => {
    const r = results[name];
    if (!r || !r.records) return "—";
    const resultRec = r.records.find((rec: any) => rec.key === "result");
    if (resultRec) return resultRec.value;
    // Grouped: collect all non-meta records
    const grouped = r.records.filter((rec: any) => !["count", "refreshed_tick"].includes(rec.key) && !rec.key.endsWith("_count"));
    if (grouped.length > 0) return grouped.map((g: any) => `${g.key}=${g.value}`).join("  ");
    return "—";
  };

  const getCount = (name: string): string => {
    const r = results[name];
    if (!r || !r.records) return "";
    const c = r.records.find((rec: any) => rec.key === "count");
    return c ? `${c.value} rows` : "";
  };

  const getTick = (name: string): string => {
    const r = results[name];
    if (!r || !r.records) return "";
    const t = r.records.find((rec: any) => rec.key === "refreshed_tick");
    return t ? `tick ${t.value}` : "";
  };

  const fnColour = (fn: string) => {
    const m: Record<string, string> = { COUNT: "text-cyan-400", SUM: "text-green-400", AVG: "text-purple-400", MIN: "text-amber-400", MAX: "text-red-400" };
    return m[fn] || "text-white/50";
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
            {mqts.length} Materialized Query Table{mqts.length !== 1 ? "s" : ""}
          </span>
          <button onClick={loadAll} className="text-[10px] font-mono text-white/40 hover:text-white/70 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Refresh all
          </button>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 bg-cyan-400/10 border border-cyan-400/25 text-cyan-400 text-[10px] font-mono uppercase tracking-widest px-3 py-1.5 hover:bg-cyan-400/20 transition-colors"
        >
          <Plus className="w-3 h-3" /> New MQT
        </button>
      </div>

      {showForm && (
        <div className="border border-white/10 bg-[#0B0E14] p-5 space-y-3">
          <span className="text-[9px] font-mono tracking-widest uppercase text-cyan-400">Create Materialized Query Table</span>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "MQT Name", key: "name", placeholder: "dept_summary" },
              { label: "Base Table", key: "table", placeholder: "employees" },
              { label: "Agg Field", key: "field", placeholder: "score (optional)" },
              { label: "Group By Field", key: "group_by", placeholder: "dept (optional)" },
            ].map(({ label, key, placeholder }) => (
              <div key={key} className="space-y-1">
                <label className="text-[9px] font-mono text-white/40 uppercase tracking-widest">{label}</label>
                <input
                  value={(newForm as any)[key]} placeholder={placeholder}
                  onChange={e => setNewForm(p => ({ ...p, [key]: e.target.value }))}
                  className="w-full bg-[#0F1219] border border-white/10 text-white font-mono text-xs px-3 py-2 outline-none focus:border-cyan-400/50"
                />
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-mono text-white/40 uppercase tracking-widest">Function</label>
            <select
              value={newForm.fn} onChange={e => setNewForm(p => ({ ...p, fn: e.target.value }))}
              className="bg-[#0F1219] border border-white/10 text-white font-mono text-xs px-3 py-2 outline-none focus:border-cyan-400/50"
            >
              {["COUNT", "SUM", "AVG", "MIN", "MAX"].map(f => <option key={f}>{f}</option>)}
            </select>
          </div>
          <button onClick={handleCreate} className="bg-cyan-400 text-[#0B0E14] font-mono text-xs font-bold uppercase tracking-widest px-5 py-2 hover:bg-cyan-300 transition-colors">
            Create &amp; Populate
          </button>
        </div>
      )}

      {mqts.length === 0 ? (
        <p className="text-white/40 font-mono text-xs italic">No MQTs defined. Create one to pre-compute an aggregate that auto-refreshes on every INSERT, UPDATE, or DELETE.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {mqts.map((m: any) => (
            <div key={m.name} className="border border-white/10 bg-[#0B0E14] p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-mono px-2 py-0.5 border border-current/30 uppercase tracking-widest font-bold ${fnColour(m.fn)}`}>{m.fn}</span>
                    <span className="font-mono text-sm text-white font-semibold">{m.name}</span>
                  </div>
                  <p className="text-[10px] font-mono text-white/40 mt-1">
                    {m.base_table}{m.field ? ` · ${m.field}` : ""}{m.group_by ? ` · grouped by ${m.group_by}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => handleRefresh(m.name)}
                  disabled={refreshing[m.name]}
                  className="text-white/40 hover:text-cyan-400 transition-colors"
                  title="Force refresh"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing[m.name] ? "animate-spin" : ""}`} />
                </button>
              </div>
              <div className="border-t border-white/10 pt-3">
                <div className="text-2xl font-mono font-bold text-cyan-400 tracking-tight">
                  {getResultValue(m.name)}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  {getCount(m.name) && <span className="text-[10px] font-mono text-white/30">{getCount(m.name)}</span>}
                  {getTick(m.name) && <span className="text-[10px] font-mono text-white/20">{getTick(m.name)}</span>}
                </div>
              </div>
              <p className="text-[9px] font-mono text-white/20">Auto-refreshes on every committed write to {m.base_table}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. AGGREGATE QUERY BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function AggregateQueryBuilder({ objects }: { objects: SlsObject[] }) {
  const [form, setForm] = useState({
    table: "", fn: "COUNT", field: "", where: "", eq: "",
    group_by: "", having: "", order_by: "", order: "ASC"
  });
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  const dbTables = objects.filter(o => (o as any).type === "DB_TABLE" || (o as any).type === 1);

  const runQuery = async () => {
    if (!form.table) { setError("Select a table first."); return; }
    setError(""); setLoading(true);
    try {
      const body: any = { table: form.table, fn: form.fn };
      if (form.field)    body.field    = form.field;
      if (form.where)    body.where    = form.where;
      if (form.eq)       body.eq       = form.eq;
      if (form.group_by) body.group_by = form.group_by;
      if (form.having)   body.having   = parseInt(form.having);
      if (form.order_by) { body.order_by = form.order_by; body.order = form.order; }
      const data = await kFetch("/api/aggregate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer deadbeef01234567cafebabe76543210" },
        body: JSON.stringify(body),
      });
      setResults(data);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  const resultRows: any[] = results?.results || results?.rows || [];
  const isGrouped = resultRows.length > 0 && resultRows[0]?.group !== undefined;

  return (
    <div className="space-y-5">
      {/* Query Form */}
      <div className="border border-white/10 bg-[#0B0E14] p-5 space-y-4">
        <span className="text-[9px] font-mono tracking-widest uppercase text-cyan-400">Build Query</span>
        <div className="grid grid-cols-3 gap-3">
          {/* Table */}
          <div className="space-y-1">
            <label className="text-[9px] font-mono text-white/40 uppercase tracking-widest">Table *</label>
            <select value={form.table} onChange={e => setForm(p => ({ ...p, table: e.target.value }))}
              className="w-full bg-[#0F1219] border border-white/10 text-white font-mono text-xs px-3 py-2 outline-none focus:border-cyan-400/50"
            >
              <option value="">— select —</option>
              {dbTables.map((t: any) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </div>
          {/* Function */}
          <div className="space-y-1">
            <label className="text-[9px] font-mono text-white/40 uppercase tracking-widest">Function</label>
            <select value={form.fn} onChange={e => setForm(p => ({ ...p, fn: e.target.value }))}
              className="w-full bg-[#0F1219] border border-white/10 text-white font-mono text-xs px-3 py-2 outline-none focus:border-cyan-400/50"
            >
              <option value="">— ORDER BY only —</option>
              {["COUNT", "SUM", "AVG", "MIN", "MAX"].map(f => <option key={f}>{f}</option>)}
            </select>
          </div>
          {/* Field */}
          <div className="space-y-1">
            <label className="text-[9px] font-mono text-white/40 uppercase tracking-widest">Field suffix</label>
            <input value={form.field} placeholder="score, dept, …" onChange={e => setForm(p => ({ ...p, field: e.target.value }))}
              className="w-full bg-[#0F1219] border border-white/10 text-white font-mono text-xs px-3 py-2 outline-none focus:border-cyan-400/50"
            />
          </div>
          {/* WHERE */}
          <div className="space-y-1">
            <label className="text-[9px] font-mono text-white/40 uppercase tracking-widest">WHERE field</label>
            <input value={form.where} placeholder="dept" onChange={e => setForm(p => ({ ...p, where: e.target.value }))}
              className="w-full bg-[#0F1219] border border-white/10 text-white font-mono text-xs px-3 py-2 outline-none focus:border-cyan-400/50"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-mono text-white/40 uppercase tracking-widest">= value</label>
            <input value={form.eq} placeholder="Engineering" onChange={e => setForm(p => ({ ...p, eq: e.target.value }))}
              className="w-full bg-[#0F1219] border border-white/10 text-white font-mono text-xs px-3 py-2 outline-none focus:border-cyan-400/50"
            />
          </div>
          {/* GROUP BY */}
          <div className="space-y-1">
            <label className="text-[9px] font-mono text-white/40 uppercase tracking-widest">GROUP BY field</label>
            <input value={form.group_by} placeholder="dept" onChange={e => setForm(p => ({ ...p, group_by: e.target.value }))}
              className="w-full bg-[#0F1219] border border-white/10 text-white font-mono text-xs px-3 py-2 outline-none focus:border-cyan-400/50"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-mono text-white/40 uppercase tracking-widest">HAVING count ≥</label>
            <input type="number" value={form.having} placeholder="2" onChange={e => setForm(p => ({ ...p, having: e.target.value }))}
              className="w-full bg-[#0F1219] border border-white/10 text-white font-mono text-xs px-3 py-2 outline-none focus:border-cyan-400/50"
            />
          </div>
          {/* ORDER BY */}
          <div className="space-y-1">
            <label className="text-[9px] font-mono text-white/40 uppercase tracking-widest">ORDER BY field</label>
            <input value={form.order_by} placeholder="score" onChange={e => setForm(p => ({ ...p, order_by: e.target.value }))}
              className="w-full bg-[#0F1219] border border-white/10 text-white font-mono text-xs px-3 py-2 outline-none focus:border-cyan-400/50"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-mono text-white/40 uppercase tracking-widest">Direction</label>
            <select value={form.order} onChange={e => setForm(p => ({ ...p, order: e.target.value }))}
              className="w-full bg-[#0F1219] border border-white/10 text-white font-mono text-xs px-3 py-2 outline-none focus:border-cyan-400/50"
            >
              <option>ASC</option>
              <option>DESC</option>
            </select>
          </div>
        </div>
        <button onClick={runQuery} disabled={loading}
          className="flex items-center gap-2 bg-cyan-400 text-[#0B0E14] font-mono text-xs font-bold uppercase tracking-widest px-6 py-2.5 hover:bg-cyan-300 transition-colors disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5" /> {loading ? "Running…" : "Run Query"}
        </button>
        {error && <p className="text-red-400 font-mono text-[11px]">{error}</p>}
      </div>

      {/* Results */}
      {results && (
        <div className="border border-white/10 bg-[#0B0E14] p-5 space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-[9px] font-mono tracking-widest uppercase text-green-400">Results</span>
            <span className="text-[9px] font-mono text-white/30">{results.table} · {results.fn || "SELECT"}{results.field ? ` · ${results.field}` : ""}</span>
          </div>

          {resultRows.length === 0 ? (
            <p className="text-white/40 font-mono text-xs italic">No rows matched.</p>
          ) : isGrouped ? (
            <table className="w-full text-[11px] font-mono border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-white/40 text-[9px] uppercase tracking-widest">
                  <th className="text-left px-3 py-2">Group</th>
                  <th className="text-left px-3 py-2">{results.fn}</th>
                </tr>
              </thead>
              <tbody>
                {resultRows.map((r: any, i: number) => (
                  <tr key={i} className="border-b border-white/5">
                    <td className="px-3 py-2 text-cyan-300">{r.group}</td>
                    <td className="px-3 py-2 text-white font-semibold">{r[results.fn?.toLowerCase()] ?? r.count ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex flex-wrap gap-6">
              {resultRows.map((r: any, i: number) => {
                const keys = Object.keys(r).filter(k => k !== "group");
                return keys.map(k => (
                  <div key={`${i}-${k}`}>
                    <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest block">{k}</span>
                    <span className="text-3xl font-mono font-bold text-cyan-400">{r[k]}</span>
                  </div>
                ));
              })}
              {results.count !== undefined && (
                <div>
                  <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest block">rows scanned</span>
                  <span className="text-3xl font-mono font-bold text-white/50">{results.count ?? resultRows.length}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN CONTAINER
// ─────────────────────────────────────────────────────────────────────────────
const DB_TABS: { key: DbTab; label: string; icon: React.ReactNode }[] = [
  { key: "schema",    label: "Schema Explorer",    icon: <Database className="w-3.5 h-3.5" /> },
  { key: "journal",   label: "Journal Viewer",     icon: <BookOpen className="w-3.5 h-3.5" /> },
  { key: "mqt",       label: "MQT Dashboard",      icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { key: "aggregate", label: "Query Builder",      icon: <Play className="w-3.5 h-3.5" /> },
];

export default function SlsDbEngine({ objects, activeUser }: SlsDbEngineProps) {
  const [dbTab, setDbTab] = useState<DbTab>("schema");

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="mb-6">
        <span className="font-mono text-[10px] tracking-widest text-cyan-400 uppercase font-bold">DB Engine // AeroSLS</span>
        <h2 className="text-2xl font-serif italic text-white mt-1 border-b border-white/10 pb-4">
          Database Control Centre
        </h2>
        <p className="text-[11px] font-mono text-white/40 mt-3 leading-relaxed">
          Inspect schemas, browse before/after-image journals, monitor materialized query tables, and run analytics queries — all powered by the live AeroSLS DB engine (DB1–DB7).
        </p>
      </div>

      {/* Sub-tab bar */}
      <div className="flex border-b border-white/10 mb-6 overflow-x-auto">
        {DB_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setDbTab(t.key)}
            className={`flex items-center gap-2 px-5 py-3 text-[10px] font-mono tracking-widest uppercase whitespace-nowrap transition-all border-b-2 ${
              dbTab === t.key
                ? "border-cyan-400 text-white bg-[#0B0E14]"
                : "border-transparent text-white/40 hover:text-white/70 hover:bg-white/3"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div>
        {dbTab === "schema"    && <SchemaExplorer />}
        {dbTab === "journal"   && <JournalViewer />}
        {dbTab === "mqt"       && <MqtDashboard />}
        {dbTab === "aggregate" && <AggregateQueryBuilder objects={objects} />}
      </div>
    </div>
  );
}
