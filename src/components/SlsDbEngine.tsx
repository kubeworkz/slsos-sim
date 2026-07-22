import React, { useState, useEffect, useCallback, useRef } from "react";
import { Database, BookOpen, BarChart3, Table2, RefreshCw, Play, Plus, Trash2, ChevronDown, ChevronRight, Upload, Terminal, FileText, Download, TerminalSquare, Rows3 } from "lucide-react";
import { SlsObject, SlsUser } from "../types/sls";
import { DEMO_TOKEN, authHeaders, authFetch } from "../lib/apiFetch";

interface SlsDbEngineProps {
  objects: SlsObject[];
  activeUser: SlsUser | null;
}

type DbTab = "sql" | "schema" | "journal" | "mqt" | "programs" | "streams";

// ─── Shared fetch helper ──────────────────────────────────────────────────────
// kFetch is this file's own convenience wrapper (auto-parses JSON, unlike
// authFetch/fetch) but now just forwards to the app-wide authFetch() in
// ../lib/apiFetch so it can't drift out of sync with every other component's
// auth handling again -- see that file's header comment for the history of
// why a single shared choke point replaced each component's own local
// token constant.
async function kFetch(path: string, opts?: RequestInit) {
  const r = await authFetch(path, opts);
  return r.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// 0. SQL CONSOLE / TABLES BROWSER
//
// The one gap none of the six panels below ever closed: this project has had
// a real SQL engine (SYS_SLS_SQL_EXECUTE — SELECT/INSERT/UPDATE/DELETE, WHERE,
// ORDER BY, LIMIT, two-table JOIN, MVCC-backed) reachable over HTTP since Gap
// Remediation Phase B (POST /api/sql, GET /api/tables, GET /api/tables/<name>
// /schema), but no panel in this file ever called any of those three routes —
// SchemaExplorer below reads legacy /api/scan DB_TABLE objects (the pre-SQL
// KV-record model), and Query Builder only runs canned /api/aggregate calls,
// never arbitrary SQL. This panel is the first UI in the project to actually
// browse real row-store tables and run free-form SQL against them.
// ─────────────────────────────────────────────────────────────────────────────
interface SqlTableSummary { name: string; column_count: number; row_count: number; page_count: number; }
interface SqlColumnDef { name: string; type: string; }
interface SqlRunResult {
  ok: boolean;
  error?: string;
  error_code?: number;
  row_count?: number;
  truncated?: boolean;
  columns?: string[];
  rows?: string[][];
  affected_rows?: number;
}

// Gap Remediation Phase H companion: the "create a real SQL table from
// scratch" flow needs three separate authenticated calls in sequence --
// POST /api/valloc (allocate an empty DB_TABLE object), POST /api/schema
// (define its columns, one sys_sls_schema_set() call per column server-
// side), POST /api/tables (promote it to a row-store table, freezing the
// schema). None of the three routes chains the others -- each is a thin,
// independent wrapper around one syscall, matching every other POST route
// in this file -- so the sequencing lives here, client-side, same as any
// other multi-step admin action a UI composes from single-purpose routes.
type NewColumn = { name: string; type: string };
const COLUMN_TYPES = ["STRING", "UINT64", "FLOAT", "BOOL"];

function CreateTablePanel({ onCreated }: { onCreated: (name: string) => void }) {
  const [open, setOpen]       = useState(false);
  const [name, setName]       = useState("");
  const [pages, setPages]     = useState("2");
  const [columns, setColumns] = useState<NewColumn[]>([{ name: "", type: "STRING" }]);
  const [step, setStep]       = useState("");
  const [error, setError]     = useState("");
  const [busy, setBusy]       = useState(false);

  // authHeaders imported from ../lib/apiFetch (was a local re-declaration
  // of the exact same object; using the shared one directly instead).

  const updateColumn = (i: number, patch: Partial<NewColumn>) =>
    setColumns(prev => prev.map((c, ci) => ci === i ? { ...c, ...patch } : c));
  const addColumn    = () => setColumns(prev => [...prev, { name: "", type: "STRING" }]);
  const removeColumn = (i: number) => setColumns(prev => prev.filter((_, ci) => ci !== i));

  const reset = () => {
    setName(""); setPages("2"); setColumns([{ name: "", type: "STRING" }]);
    setStep(""); setError(""); setOpen(false);
  };

  const handleCreate = async () => {
    const tname = name.trim();
    const cols  = columns.filter(c => c.name.trim());
    if (!tname)        { setError("Table name required."); return; }
    if (cols.length === 0) { setError("At least one column required."); return; }

    setBusy(true); setError("");
    try {
      setStep("Allocating object…");
      const vr = await kFetch("/api/valloc", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ name: tname, type: 1 /* DB_TABLE */, pages: parseInt(pages, 10) || 2 }),
      });
      if (vr?.ok !== "true") { setError(`valloc failed: ${vr?.error || "unknown error"}`); setBusy(false); return; }

      setStep("Defining columns…");
      const sr = await kFetch("/api/schema", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ name: tname, columns: cols.map(c => ({ name: c.name.trim(), type: c.type })) }),
      });
      if (sr?.ok !== "true") { setError(`schema definition failed: ${sr?.error || "unknown error"} (${sr?.columns_set ?? 0}/${cols.length} columns applied)`); setBusy(false); return; }

      setStep("Promoting to row-store…");
      const pr = await kFetch("/api/tables", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ name: tname }),
      });
      if (pr?.ok !== "true") { setError(`promotion to row-store failed: ${pr?.error || "unknown error"}`); setBusy(false); return; }

      setBusy(false);
      onCreated(tname);
      reset();
    } catch (e: any) {
      setError(e?.message || "request failed");
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 border-t border-white/10 text-[10px] font-mono tracking-widest uppercase text-cyan-400/80 hover:text-cyan-400 hover:bg-cyan-400/5 transition-colors"
      >
        <Plus className="w-3 h-3" /> New Table
      </button>
    );
  }

  return (
    <div className="border-t border-white/10 px-4 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono tracking-widest uppercase text-cyan-400">Create Table</span>
        <button onClick={reset} className="text-white/30 hover:text-white/60 text-[10px] font-mono">cancel</button>
      </div>
      <div className="flex gap-2">
        <input
          value={name} onChange={e => setName(e.target.value)} placeholder="table_name"
          className="flex-1 min-w-0 bg-[#0F1219] border border-white/10 text-white font-mono text-xs px-2.5 py-1.5 outline-none focus:border-cyan-400/50"
        />
        <input
          value={pages} onChange={e => setPages(e.target.value)} type="number" min="1" max="64" placeholder="pages"
          className="w-16 bg-[#0F1219] border border-white/10 text-white font-mono text-xs px-2 py-1.5 outline-none focus:border-cyan-400/50"
        />
      </div>
      <div className="space-y-1.5">
        {columns.map((c, i) => (
          <div key={i} className="flex gap-1.5">
            <input
              value={c.name} onChange={e => updateColumn(i, { name: e.target.value })} placeholder={`column ${i + 1}`}
              className="flex-1 min-w-0 bg-[#0F1219] border border-white/10 text-white font-mono text-[11px] px-2 py-1.5 outline-none focus:border-cyan-400/50"
            />
            <select
              value={c.type} onChange={e => updateColumn(i, { type: e.target.value })}
              className="bg-[#0F1219] border border-white/10 text-white/70 font-mono text-[11px] px-1.5 py-1.5 outline-none focus:border-cyan-400/50"
            >
              {COLUMN_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            {columns.length > 1 && (
              <button onClick={() => removeColumn(i)} className="text-white/30 hover:text-red-400 transition-colors px-1">
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        <button onClick={addColumn} className="flex items-center gap-1 text-[10px] font-mono text-white/40 hover:text-white/70 transition-colors">
          <Plus className="w-3 h-3" /> Add column
        </button>
      </div>
      {error && <p className="text-[10px] font-mono text-red-400/80 leading-relaxed">{error}</p>}
      {busy && step && <p className="text-[10px] font-mono text-cyan-400/70">{step}</p>}
      <button
        onClick={handleCreate}
        disabled={busy}
        className="w-full bg-cyan-400 text-[#0B0E14] font-mono text-[10px] font-bold uppercase tracking-widest py-2 hover:bg-cyan-300 transition-colors disabled:opacity-40"
      >
        {busy ? "Creating…" : "Create Table"}
      </button>
    </div>
  );
}

function SqlConsole() {
  const [tables, setTables]           = useState<SqlTableSummary[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState("");
  const [schema, setSchema]           = useState<SqlColumnDef[] | null>(null);
  const [schemaError, setSchemaError] = useState("");
  const [sql, setSql]                 = useState("");
  const [result, setResult]           = useState<SqlRunResult | null>(null);
  const [running, setRunning]         = useState(false);
  const [history, setHistory]         = useState<string[]>([]);
  const textareaRef                   = useRef<HTMLTextAreaElement>(null);
  const [exportingSchema, setExportingSchema] = useState(false);
  const [importingSchema, setImportingSchema] = useState(false);
  const [schemaMsg, setSchemaMsg]     = useState<{ ok: boolean; text: string } | null>(null);
  const importFileRef                 = useRef<HTMLInputElement>(null);

  const loadTables = useCallback(async () => {
    setTablesLoading(true);
    try {
      const data = await kFetch("/api/tables");
      setTables(data?.tables || []);
    } catch (_) { setTables([]); }
    setTablesLoading(false);
  }, []);

  useEffect(() => { loadTables(); }, [loadTables]);

  const runSql = useCallback(async (text: string) => {
    const query = text.trim();
    if (!query) return;
    setRunning(true);
    try {
      const data: SqlRunResult = await kFetch("/api/sql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      setResult(data);
      setHistory(prev => [query, ...prev.filter(h => h !== query)].slice(0, 10));
      // A successful write (INSERT/UPDATE/DELETE) or a table promotion may
      // have changed row/page counts — refresh the sidebar counts silently.
      if (data?.ok && data.affected_rows !== undefined) loadTables();
    } catch (e: any) {
      setResult({ ok: false, error: e?.message || "request failed" });
    }
    setRunning(false);
  }, [loadTables]);

  const selectTable = useCallback(async (name: string) => {
    setSelectedTable(name);
    setSchema(null);
    setSchemaError("");
    try {
      const data = await kFetch(`/api/tables/${encodeURIComponent(name)}/schema`);
      if (data?.error) setSchemaError(data.error);
      else setSchema(data?.columns || []);
    } catch (_) { setSchemaError("failed to load schema"); }
    const query = `SELECT * FROM ${name} LIMIT 50`;
    setSql(query);
    runSql(query);
  }, [runSql]);

  // ── Schema export/import (SQL Feature-Parity Roadmap, Phase 8 follow-on) ──
  // GET /api/schema/export -> {sql, bytes}; POST /api/schema/import ->
  // {total, succeeded, failed, truncated?, statements:[{offset, ok, error?}]}.
  // "ok"/"truncated" travel as the JSON strings "true"/"false" (jb_str(), not
  // a real JSON boolean) -- same `=== "true"` convention every other route
  // in this file already uses (see api/valloc, api/schema, api/tables).
  const handleExportSchema = useCallback(async () => {
    setExportingSchema(true);
    setSchemaMsg(null);
    try {
      const data = await kFetch("/api/schema/export");
      const text: string = data?.sql || "";
      if (!text) {
        setSchemaMsg({ ok: false, text: "Nothing to export — no readable row-store tables." });
      } else {
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        a.href = url; a.download = `aerosls_schema_${stamp}.sql`; a.click();
        URL.revokeObjectURL(url);
        setSchemaMsg({ ok: true, text: `Exported ${data?.bytes ?? text.length} bytes to file.` });
      }
    } catch (e: any) {
      setSchemaMsg({ ok: false, text: e?.message || "export failed" });
    }
    setExportingSchema(false);
  }, []);

  const handleImportSchemaClick = () => importFileRef.current?.click();

  const handleImportSchemaFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingSchema(true);
    setSchemaMsg(null);
    try {
      const text = await file.text();
      const data = await kFetch("/api/schema/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: text }),
      });
      const stmts: { ok: string; error?: string }[] = data?.statements || [];
      const firstError = stmts.find(s => s.ok !== "true")?.error;
      const failed = Number(data?.failed ?? 0);
      setSchemaMsg({
        ok: failed === 0,
        text: `${data?.succeeded ?? 0}/${data?.total ?? 0} statement(s) succeeded` +
              (failed ? `, ${failed} failed${firstError ? ` (${firstError})` : ""}` : "") +
              (data?.truncated === "true" ? " — import truncated at 64 statements" : ""),
      });
      loadTables();
      if (selectedTable) selectTable(selectedTable);
    } catch (err: any) {
      setSchemaMsg({ ok: false, text: err?.message || "import failed" });
    }
    setImportingSchema(false);
    if (importFileRef.current) importFileRef.current.value = "";
  }, [loadTables, selectedTable, selectTable]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      runSql(sql);
    }
  };

  const resultRows = result?.rows || [];
  const resultCols = result?.columns || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
      {/* ── Tables sidebar ────────────────────────────────────────────────── */}
      <div className="border border-white/10 bg-[#0B0E14] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-[9px] font-mono tracking-widest uppercase text-white/40 flex items-center gap-1.5">
            <Rows3 className="w-3 h-3" /> Row-Store Tables
          </span>
          <button onClick={loadTables} className="text-white/40 hover:text-cyan-400 transition-colors" title="Refresh table list">
            <RefreshCw className={`w-3 h-3 ${tablesLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto max-h-[480px]">
          {tablesLoading ? (
            <p className="text-white/30 font-mono text-[11px] px-4 py-4">Loading…</p>
          ) : tables.length === 0 ? (
            <p className="text-white/30 font-mono text-[11px] px-4 py-4 leading-relaxed">
              No row-store tables yet. Promote a schema'd object with{" "}
              <code className="text-cyan-400">POST /api/tables {"{"}"name"{"}"}</code>, or use the shell's{" "}
              <code className="text-cyan-400">sql</code> command from a booted kernel.
            </p>
          ) : (
            tables.map(t => (
              <button
                key={t.name}
                onClick={() => selectTable(t.name)}
                className={`w-full text-left px-4 py-2.5 border-b border-white/5 transition-colors ${
                  selectedTable === t.name ? "bg-cyan-400/10 border-l-2 border-l-cyan-400" : "hover:bg-white/5 border-l-2 border-l-transparent"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Table2 className="w-3 h-3 text-cyan-400 shrink-0" />
                  <span className="font-mono text-xs text-white font-semibold truncate">{t.name}</span>
                </div>
                <div className="text-[9px] font-mono text-white/30 mt-0.5 pl-5">
                  {t.column_count} cols · {t.row_count} rows · {t.page_count}p
                </div>
              </button>
            ))
          )}
        </div>

        {selectedTable && (
          <div className="border-t border-white/10 px-4 py-3">
            <span className="text-[9px] font-mono tracking-widest uppercase text-white/30 block mb-2">Schema — {selectedTable}</span>
            {schemaError ? (
              <p className="text-[10px] font-mono text-red-400/80">{schemaError}</p>
            ) : !schema ? (
              <p className="text-[10px] font-mono text-white/30">Loading…</p>
            ) : (
              <div className="space-y-1">
                {schema.map(c => (
                  <div key={c.name} className="flex items-center justify-between text-[10px] font-mono">
                    <span className="text-white/70">{c.name}</span>
                    <span className="text-purple-400/80">{c.type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <CreateTablePanel onCreated={selectTable} />
      </div>

      {/* ── SQL editor + results ──────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="border border-white/10 bg-[#0B0E14] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono tracking-widest uppercase text-cyan-400 flex items-center gap-1.5">
              <TerminalSquare className="w-3.5 h-3.5" /> SQL Console
            </span>
            <div className="flex items-center gap-3">
              <input
                ref={importFileRef}
                type="file"
                accept=".sql,.txt"
                className="hidden"
                onChange={handleImportSchemaFile}
              />
              <button
                onClick={handleImportSchemaClick}
                disabled={importingSchema}
                title="Import a .sql schema dump (CREATE TABLE/CREATE INDEX statements)"
                className="flex items-center gap-1.5 text-white/40 hover:text-cyan-400 transition-colors font-mono text-[9px] uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Upload className="w-3 h-3" /> {importingSchema ? "Importing…" : "Import Schema"}
              </button>
              <button
                onClick={handleExportSchema}
                disabled={exportingSchema}
                title="Export every readable table's schema as a .sql file"
                className="flex items-center gap-1.5 text-white/40 hover:text-cyan-400 transition-colors font-mono text-[9px] uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="w-3 h-3" /> {exportingSchema ? "Exporting…" : "Export Schema"}
              </button>
              <span className="text-[9px] font-mono text-white/20">⌘/Ctrl + Enter to run</span>
            </div>
          </div>
          {schemaMsg && (
            <div className={`text-[10px] font-mono px-3 py-2 border ${
              schemaMsg.ok ? "border-green-400/20 bg-green-400/5 text-green-300/80" : "border-red-400/20 bg-red-400/5 text-red-300/80"
            }`}>
              {schemaMsg.text}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={sql}
            onChange={e => setSql(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="SELECT * FROM employees WHERE dept = 'Engineering' ORDER BY score DESC LIMIT 10"
            rows={4}
            spellCheck={false}
            className="w-full bg-[#0F1219] border border-white/10 text-white font-mono text-xs px-3 py-2.5 outline-none focus:border-cyan-400/50 resize-y leading-relaxed"
          />
          <div className="flex items-center justify-between">
            <button
              onClick={() => runSql(sql)}
              disabled={running || !sql.trim()}
              className="flex items-center gap-2 bg-cyan-400 text-[#0B0E14] font-mono text-xs font-bold uppercase tracking-widest px-5 py-2 hover:bg-cyan-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play className="w-3.5 h-3.5" /> {running ? "Running…" : "Run Query"}
            </button>
            {history.length > 0 && (
              <select
                onChange={e => { if (e.target.value) { setSql(e.target.value); } }}
                value=""
                className="bg-[#0F1219] border border-white/10 text-white/50 font-mono text-[10px] px-2 py-1.5 outline-none max-w-[240px]"
              >
                <option value="">History…</option>
                {history.map((h, i) => <option key={i} value={h}>{h.length > 48 ? h.slice(0, 48) + "…" : h}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Results */}
        {result && (
          <div className="border border-white/10 bg-[#0B0E14] p-4 space-y-3">
            {!result.ok ? (
              <div className="flex items-start gap-2">
                <span className="text-[9px] font-mono tracking-widest uppercase text-red-400 shrink-0 pt-0.5">Error{result.error_code !== undefined ? ` (${result.error_code})` : ""}</span>
                <span className="text-[11px] font-mono text-red-300/80">{result.error || "query failed"}</span>
              </div>
            ) : result.affected_rows !== undefined ? (
              <div className="flex items-center gap-3">
                <span className="text-[9px] font-mono tracking-widest uppercase text-green-400">OK</span>
                <span className="text-[11px] font-mono text-white/60">{result.affected_rows} row{result.affected_rows === 1 ? "" : "s"} affected</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <span className="text-[9px] font-mono tracking-widest uppercase text-green-400">Results</span>
                  <span className="text-[10px] font-mono text-white/30">
                    {result.row_count ?? resultRows.length} row{(result.row_count ?? resultRows.length) === 1 ? "" : "s"}
                    {result.truncated ? " (truncated)" : ""}
                  </span>
                </div>
                {resultRows.length === 0 ? (
                  <p className="text-white/40 font-mono text-xs italic">No rows returned.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] font-mono border-collapse">
                      <thead>
                        <tr className="border-b border-white/10 text-white/40 text-[9px] uppercase tracking-widest">
                          {resultCols.map((c, i) => <th key={i} className="text-left px-3 py-2 whitespace-nowrap">{c}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {resultRows.map((row, ri) => (
                          <tr key={ri} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                            {row.map((v, ci) => <td key={ci} className="px-3 py-2 text-white/70 whitespace-nowrap">{v === "" ? "—" : v}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
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
// 5. PROGRAM MANAGER
// ─────────────────────────────────────────────────────────────────────────────
interface ProgramEntry {
  name: string; vaddr: string; pages: number;
  tier: string; binary: string; binary_bytes: number; format: string;
}

function ProgramManager() {
  const [programs, setPrograms]   = useState<ProgramEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [newName, setNewName]     = useState("");
  const [newPages, setNewPages]   = useState("2");
  const [upName, setUpName]       = useState("");
  const [upHex, setUpHex]         = useState("");
  const [spawnName, setSpawnName] = useState("");
  const [lastPid, setLastPid]     = useState<number | null>(null);
  const [msg, setMsg]             = useState("");

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 4000); };

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await kFetch("/api/programs"); setPrograms(d.programs || []); }
    catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // authHeaders imported from ../lib/apiFetch. (These three calls used to
  // build their own header via a local tok() = localStorage.getItem
  // ("sls_token") -- a key nothing in this app ever sets, so every one of
  // them was silently sending "Authorization: Bearer " with no token and
  // 401'ing. Found while wiring up CSV import elsewhere in this file.)

  const handleCreate = async () => {
    if (!newName || !newPages) return;
    const r = await kFetch("/api/program/create", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: newName, pages: parseInt(newPages, 10) }),
    });
    if (r.ok === "true") { flash(`✔ Created '${newName}'`); load(); setNewName(""); }
    else flash(`✖ ${r.error || "create failed"}`);
  };

  const handleUpload = async () => {
    if (!upName || !upHex) return;
    const CHUNK = 2048;
    for (let offset = 0; offset < upHex.length; offset += CHUNK) {
      const slice = upHex.slice(offset, offset + CHUNK);
      const isLast = offset + CHUNK >= upHex.length ? 1 : 0;
      const r = await kFetch("/api/program/upload", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name: upName, hex: slice, offset: offset / 2, last: isLast }),
      });
      if (r.ok !== "true") { flash(`✖ Upload failed: ${r.error}`); return; }
    }
    flash(`✔ Uploaded ${upHex.length / 2} bytes to '${upName}'`);
    load(); setUpHex("");
  };

  const handleSpawn = async () => {
    if (!spawnName) return;
    const r = await kFetch("/api/program/spawn", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: spawnName }),
    });
    if (r.ok === "true") { setLastPid(r.pid); flash(`✔ Spawned '${spawnName}' as PID ${r.pid}`); load(); }
    else flash(`✖ ${r.error || "spawn failed"}`);
  };

  const statusColor = (s: string) =>
    s === "running" ? "text-emerald-400" : s === "ready" ? "text-cyan-400" : s === "created" ? "text-amber-400" : "text-white/40";

  return (
    <div className="space-y-8">
      {msg && <div className="bg-[#0d1117] border border-white/10 px-4 py-2 text-[11px] font-mono text-white/70">{msg}</div>}

      <div className="bg-[#0B0E14] border border-white/10 p-6">
        <div className="flex items-center justify-between mb-4">
          <span className="font-mono text-[10px] tracking-widest text-cyan-400 uppercase font-semibold">Registered Programs</span>
          <button onClick={load} className="flex items-center gap-1.5 text-[10px] font-mono text-white/40 hover:text-white/70 transition-colors">
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> REFRESH
          </button>
        </div>
        {programs.length === 0 ? (
          <p className="text-white/30 text-xs font-mono text-center py-4">NO PROGRAM OBJECTS</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="border-b border-white/10">
                  {["Name","Pages","Tier","Binary","Bytes","Format","Status"].map(h => (
                    <th key={h} className="text-left text-white/40 py-2 pr-5 uppercase tracking-widest font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {programs.map(p => (
                  <tr key={p.name} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                    <td className="py-1.5 pr-5 text-white font-semibold">{p.name}</td>
                    <td className="py-1.5 pr-5 text-white/60">{p.pages}</td>
                    <td className="py-1.5 pr-5 text-white/50 text-[10px]">{p.tier}</td>
                    <td className="py-1.5 pr-5">
                      <span className={`text-[10px] px-1.5 py-0.5 border ${p.binary === "yes" ? "border-emerald-700/50 text-emerald-300 bg-emerald-900/30" : "border-white/10 text-white/30"}`}>
                        {p.binary === "yes" ? "LOADED" : "EMPTY"}
                      </span>
                    </td>
                    <td className="py-1.5 pr-5 text-white/60">{p.binary_bytes > 0 ? `${p.binary_bytes}B` : "—"}</td>
                    <td className="py-1.5 pr-5 text-white/50 text-[10px]">{p.format !== "none" ? p.format : "—"}</td>
                    <td className={`py-1.5 text-[10px] uppercase ${statusColor((p as any).status || "")}`}>{(p as any).status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="bg-[#0B0E14] border border-white/10 p-6 space-y-4">
          <span className="font-mono text-[10px] tracking-widest text-amber-400 uppercase font-semibold flex items-center gap-2">
            <Plus className="w-3.5 h-3.5" /> Create Program Object
          </span>
          <p className="text-[10px] text-white/40 font-mono leading-relaxed">Allocates an OBJ_TYPE_PROGRAM entry with journaled metadata seeds.</p>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="program name"
            className="w-full bg-[#0d1117] border border-white/10 px-3 py-2 text-[11px] font-mono text-white/80 outline-none focus:border-cyan-500/50" />
          <input value={newPages} onChange={e => setNewPages(e.target.value)} placeholder="pages (default 2)" type="number" min="1" max="64"
            className="w-full bg-[#0d1117] border border-white/10 px-3 py-2 text-[11px] font-mono text-white/80 outline-none focus:border-cyan-500/50" />
          <button onClick={handleCreate} className="w-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-mono tracking-widest uppercase py-2 hover:bg-amber-500/20 transition-colors">ALLOCATE</button>
        </div>

        <div className="bg-[#0B0E14] border border-white/10 p-6 space-y-4">
          <span className="font-mono text-[10px] tracking-widest text-cyan-400 uppercase font-semibold flex items-center gap-2">
            <Upload className="w-3.5 h-3.5" /> Upload Binary
          </span>
          <p className="text-[10px] text-white/40 font-mono leading-relaxed">Hex-encoded flat binary or ELF64. Auto-chunked. Fires engine hooks on completion.</p>
          <input value={upName} onChange={e => setUpName(e.target.value)} placeholder="program name"
            className="w-full bg-[#0d1117] border border-white/10 px-3 py-2 text-[11px] font-mono text-white/80 outline-none focus:border-cyan-500/50" />
          <textarea value={upHex} onChange={e => setUpHex(e.target.value)} placeholder="hex bytes (e.g. 4889c748c7c0...)"
            rows={4} className="w-full bg-[#0d1117] border border-white/10 px-3 py-2 text-[11px] font-mono text-white/60 outline-none focus:border-cyan-500/50 resize-none" />
          <button onClick={handleUpload} className="w-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[10px] font-mono tracking-widest uppercase py-2 hover:bg-cyan-500/20 transition-colors">UPLOAD</button>
        </div>

        <div className="bg-[#0B0E14] border border-white/10 p-6 space-y-4">
          <span className="font-mono text-[10px] tracking-widest text-emerald-400 uppercase font-semibold flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5" /> Spawn Process
          </span>
          <p className="text-[10px] text-white/40 font-mono leading-relaxed">Maps binary into a fresh PML4 and enters Ring-3. Updates status→running + last_pid.</p>
          <input value={spawnName} onChange={e => setSpawnName(e.target.value)} placeholder="program name"
            className="w-full bg-[#0d1117] border border-white/10 px-3 py-2 text-[11px] font-mono text-white/80 outline-none focus:border-cyan-500/50" />
          {lastPid !== null && (
            <div className="bg-emerald-900/20 border border-emerald-700/30 px-3 py-2 text-[11px] font-mono text-emerald-300">Last PID: {lastPid}</div>
          )}
          <button onClick={handleSpawn} className="w-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[10px] font-mono tracking-widest uppercase py-2 hover:bg-emerald-500/20 transition-colors">SPAWN</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. STREAM LIBRARY
// ─────────────────────────────────────────────────────────────────────────────
interface StreamEntry { name: string; mime_type: string; size: number; }

// ─── CSV → Table import helpers ────────────────────────────────────────────
// A CSV upload doesn't go through the stream path at all (see the "CSV →
// Table" mode toggle in StreamLibrary below): it's parsed client-side and
// pushed through the same valloc -> schema -> tables -> INSERT sequence
// CreateTablePanel (above, in the SQL Console section) already uses to build
// a table by hand. No kernel changes needed -- that pipeline was already
// complete and HTTP-reachable; this just drives it from a file instead of
// a form. Constraints enforced client-side because the kernel enforces them
// server-side anyway and a client-side check gives a much better error than
// a mid-import HTTP failure: ROWSTORE_MAX_COLUMNS=16 (kernel/rowstore.h),
// ROWSTORE_STRING_LEN=64 bytes per STRING cell including the NUL (so 63
// usable chars), and SQL_MAX_TEXT_LEN=512 chars per statement
// (kernel/sql_parser.h) -- INSERT has no multi-row VALUES support, so every
// row is its own statement and has to fit that budget on its own.

// Minimal RFC 4180 parser: quoted fields, "" as an escaped quote inside a
// quoted field, commas/newlines inside quotes. Good enough for real-world
// exported CSVs without pulling in a new dependency for a client-side demo
// feature.
function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAny = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; sawAny = true; continue; }
    if (c === ',') { row.push(field); field = ""; sawAny = true; continue; }
    if (c === '\r') continue;
    if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ""; sawAny = false;
      continue;
    }
    field += c; sawAny = true;
  }
  if (sawAny || field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  // Drop fully-blank trailing lines (common at EOF).
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ""));
}

// Infers a rowstore column type from a sample of a column's values. Order
// matters: try the narrowest type first (an all-digit column is UINT64
// before it's ever considered FLOAT or STRING).
function inferCsvColumnType(values: string[]): string {
  const sample = values.filter(v => v.trim() !== "").slice(0, 50);
  if (sample.length === 0) return "STRING";
  if (sample.every(v => /^\d+$/.test(v.trim()))) return "UINT64";
  if (sample.every(v => /^-?\d+(\.\d+)?$/.test(v.trim()))) return "FLOAT";
  if (sample.every(v => /^(true|false)$/i.test(v.trim()))) return "BOOL";
  return "STRING";
}

// Renders one CSV cell as a SQL literal for the target column type. Never
// throws -- an unparseable numeric value degrades to 0 with a warning
// rather than aborting the whole row, since one bad cell in a 5,000-row
// import shouldn't take the other 4,999 down with it.
function csvCellToSqlLiteral(raw: string, type: string): { sql: string; warning?: string } {
  const v = (raw ?? "").trim();
  if (type === "UINT64") {
    if (!/^\d+$/.test(v)) return { sql: "0", warning: `non-numeric value "${v}" → 0` };
    return { sql: v };
  }
  if (type === "FLOAT") {
    if (!/^-?\d+(\.\d+)?$/.test(v)) return { sql: "0", warning: `non-numeric value "${v}" → 0` };
    return { sql: v };
  }
  if (type === "BOOL") {
    return { sql: /^true$/i.test(v) ? "TRUE" : "FALSE" };
  }
  // STRING -- ROWSTORE_STRING_LEN is 64 bytes including the NUL terminator,
  // so 63 usable characters; '' is this SQL dialect's escaped single quote
  // (kernel/sql_parser.c's lexer, standard SQL convention).
  let s = v;
  let warning: string | undefined;
  if (s.length > 63) { s = s.slice(0, 63); warning = `truncated to 63 chars`; }
  return { sql: `'${s.replace(/'/g, "''")}'`, warning };
}

function StreamLibrary() {
  const [streams, setStreams]       = useState<StreamEntry[]>([]);
  const [loading, setLoading]       = useState(true);
  const [msg, setMsg]               = useState("");
  const [upName, setUpName]         = useState("");
  const [upMime, setUpMime]         = useState("application/octet-stream");
  const [upSize, setUpSize]         = useState(0);
  const [upFile, setUpFile]         = useState<File | null>(null);
  const [upProgress, setUpProgress] = useState(0);   // 0–100
  const [uploading, setUploading]   = useState(false);
  const fileRef                     = useRef<HTMLInputElement>(null);

  // ── CSV → Table mode ──────────────────────────────────────────────────
  // A second upload path alongside the raw-stream one above: parses the
  // file client-side into rows and drives the existing valloc -> schema ->
  // tables -> INSERT pipeline (see the helper functions above this
  // component) instead of storing the bytes as an opaque OBJ_TYPE_STREAM.
  const [upMode, setUpMode]           = useState<"file" | "csv">("file");
  const [csvFile, setCsvFile]         = useState<File | null>(null);
  const [csvTableName, setCsvTableName] = useState("");
  const [csvColumns, setCsvColumns]   = useState<{ name: string; type: string }[]>([]);
  const [csvRows, setCsvRows]         = useState<string[][]>([]);
  const [csvParseError, setCsvParseError] = useState("");
  const [csvBusy, setCsvBusy]         = useState(false);
  const [csvStep, setCsvStep]         = useState("");
  const [csvProgress, setCsvProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [csvResult, setCsvResult]     = useState<{ ok: number; failed: number; warned: number; failMsgs: string[]; table: string } | null>(null);
  const csvFileRef                    = useRef<HTMLInputElement>(null);

  const CSV_MAX_ROWS = 5000;      // sequential one-row-per-request INSERTs -- see helper comment above
  const CSV_MAX_COLUMNS = 16;     // ROWSTORE_MAX_COLUMNS (kernel/rowstore.h)

  // 16 KiB binary per request = 32 KiB hex, safely under the 64 KiB req_buf
  const BINARY_CHUNK = 16384;
  const MAX_FILE_SIZE = 64 * 1024 * 1024; // 64 MiB (STREAM_MAX_FRAMES × 4 KiB)

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };
  // authHeaders imported from ../lib/apiFetch (was a dead-token local tok()
  // -- see the comment on ProgramManager's own copy of this bug, above).

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await kFetch("/api/streams"); setStreams(d.streams || []); }
    catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // On file select: store File reference only — no full read into memory
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUpName(file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 48));
    setUpMime(file.type || "application/octet-stream");
    setUpSize(file.size);
    setUpFile(file);
    setUpProgress(0);
  };

  const handleUpload = async () => {
    if (!upFile || !upName || upSize > MAX_FILE_SIZE) return;
    setUploading(true);
    setUpProgress(0);

    // 1. Create the stream object
    const cr = await kFetch("/api/stream/create", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: upName, mime: upMime }),
    });
    if (cr.ok !== "true" && cr.error !== "already exists") {
      flash(`✖ Create failed: ${cr.error}`); setUploading(false); return;
    }

    // 2. Stream-upload in BINARY_CHUNK slices — only one chunk in memory at a time
    const totalChunks = Math.ceil(upFile.size / BINARY_CHUNK);
    for (let ci = 0; ci < totalChunks; ci++) {
      const byteOff = ci * BINARY_CHUNK;
      const buf     = await upFile.slice(byteOff, byteOff + BINARY_CHUNK).arrayBuffer();
      const bytes   = new Uint8Array(buf);
      const hex     = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
      const isLast  = ci === totalChunks - 1 ? 1 : 0;

      const ur = await kFetch("/api/stream/upload", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name: upName, hex, offset: byteOff, last: isLast }),
      });
      if (ur.ok !== "true") {
        flash(`✖ Upload failed at chunk ${ci + 1}/${totalChunks}: ${ur.error}`);
        setUploading(false); return;
      }
      setUpProgress(Math.round(((ci + 1) / totalChunks) * 100));
    }

    flash(`✔ Stored '${upName}' (${fmtSize(upFile.size)})`);
    setUpFile(null); setUpSize(0); setUpProgress(0);
    if (fileRef.current) fileRef.current.value = "";
    load();
    setUploading(false);
  };

  const handleDownload = async (name: string, mime: string) => {
    try {
      const r = await authFetch(`/api/stream/${name}`);
      if (!r.ok) { flash(`✖ Download failed: ${r.status}`); return; }
      const blob = await r.blob();
      const url  = URL.createObjectURL(new Blob([blob], { type: mime }));
      const a    = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch (_) { flash("✖ Download error"); }
  };

  // ── CSV → Table handlers ──────────────────────────────────────────────
  const csvUpdateColumn = (i: number, patch: Partial<{ name: string; type: string }>) =>
    setCsvColumns(prev => prev.map((c, ci) => ci === i ? { ...c, ...patch } : c));

  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvResult(null);
    setCsvParseError("");
    setCsvFile(file);
    setCsvTableName(file.name.replace(/\.csv$/i, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 48));

    file.text().then(text => {
      const parsed = parseCsvText(text);
      if (parsed.length < 2) {
        setCsvParseError("CSV needs a header row plus at least one data row.");
        setCsvColumns([]); setCsvRows([]);
        return;
      }
      const header = parsed[0].map(h => h.trim().replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 63) || "col");
      const data   = parsed.slice(1);

      if (header.length > CSV_MAX_COLUMNS) {
        setCsvParseError(`CSV has ${header.length} columns; row-store tables support at most ${CSV_MAX_COLUMNS}. Trim the file and re-upload.`);
        setCsvColumns([]); setCsvRows([]);
        return;
      }
      if (data.length > CSV_MAX_ROWS) {
        setCsvParseError(`CSV has ${data.length} data rows; this uploader imports at most ${CSV_MAX_ROWS} rows at a time (each row is its own request). Split the file and re-upload.`);
        setCsvColumns([]); setCsvRows([]);
        return;
      }

      const inferred = header.map((name, ci) => ({
        name,
        type: inferCsvColumnType(data.map(r => r[ci] ?? "")),
      }));
      setCsvColumns(inferred);
      setCsvRows(data);
    }).catch(() => setCsvParseError("Could not read file as text."));
  };

  const handleCsvImport = async () => {
    const tname = csvTableName.trim();
    if (!tname || csvColumns.length === 0 || csvRows.length === 0) return;
    if (csvColumns.some(c => !c.name.trim())) { setCsvParseError("Every column needs a name."); return; }

    setCsvBusy(true); setCsvParseError(""); setCsvResult(null);
    setCsvProgress({ done: 0, total: csvRows.length, failed: 0 });

    try {
      setCsvStep("Allocating object…");
      // Rough page estimate: (rows × row width) / 4 KiB, at least 2 pages
      // (CreateTablePanel's own default), capped at 64 (its own max).
      const rowBytes = 1 + csvColumns.length * 64; // tombstone byte + one ROWSTORE_STRING_LEN slot/column
      const pages = Math.max(2, Math.min(64, Math.ceil((csvRows.length * rowBytes) / 4096) + 1));
      const vr = await kFetch("/api/valloc", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ name: tname, type: 1 /* DB_TABLE */, pages }),
      });
      if (vr?.ok !== "true") { setCsvParseError(`valloc failed: ${vr?.error || "unknown error"}`); setCsvBusy(false); return; }

      setCsvStep("Defining columns…");
      const sr = await kFetch("/api/schema", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ name: tname, columns: csvColumns.map(c => ({ name: c.name.trim(), type: c.type })) }),
      });
      if (sr?.ok !== "true") { setCsvParseError(`schema definition failed: ${sr?.error || "unknown error"}`); setCsvBusy(false); return; }

      setCsvStep("Promoting to row-store…");
      const pr = await kFetch("/api/tables", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ name: tname }),
      });
      if (pr?.ok !== "true") { setCsvParseError(`promotion to row-store failed: ${pr?.error || "unknown error"}`); setCsvBusy(false); return; }

      setCsvStep("Importing rows…");
      const colNames = csvColumns.map(c => c.name.trim()).join(", ");
      let ok = 0, failed = 0, warned = 0;
      const failMsgs: string[] = [];

      for (let r = 0; r < csvRows.length; r++) {
        const row = csvRows[r];
        const literals = csvColumns.map((c, ci) => {
          const lit = csvCellToSqlLiteral(row[ci] ?? "", c.type);
          if (lit.warning) warned++;
          return lit.sql;
        });
        const sql = `INSERT INTO ${tname} (${colNames}) VALUES (${literals.join(", ")})`;

        if (sql.length > 500) {          // SQL_MAX_TEXT_LEN=512, leave a small margin
          failed++;
          if (failMsgs.length < 5) failMsgs.push(`row ${r + 2}: statement too long (${sql.length} chars) -- shorten string values or drop columns`);
        } else {
          try {
            const ir = await kFetch("/api/sql", { method: "POST", headers: authHeaders, body: JSON.stringify({ query: sql }) });
            if (ir?.ok === "true") ok++;
            else { failed++; if (failMsgs.length < 5) failMsgs.push(`row ${r + 2}: ${ir?.error || "insert failed"}`); }
          } catch (e: any) {
            failed++; if (failMsgs.length < 5) failMsgs.push(`row ${r + 2}: ${e?.message || "request failed"}`);
          }
        }
        setCsvProgress({ done: r + 1, total: csvRows.length, failed });
      }

      setCsvResult({ ok, failed, warned, failMsgs, table: tname });
      setCsvFile(null); setCsvColumns([]); setCsvRows([]);
      if (csvFileRef.current) csvFileRef.current.value = "";
    } finally {
      setCsvBusy(false); setCsvStep("");
    }
  };

  const fmtSize = (n: number) =>
    n < 1024 ? `${n} B` : n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`;

  return (
    <div className="space-y-8">
      {msg && <div className="bg-[#0d1117] border border-white/10 px-4 py-2 text-[11px] font-mono text-white/70">{msg}</div>}

      {/* Stream list */}
      <div className="bg-[#0B0E14] border border-white/10 p-6">
        <div className="flex items-center justify-between mb-4">
          <span className="font-mono text-[10px] tracking-widest text-cyan-400 uppercase font-semibold">Stored Streams</span>
          <button onClick={load} className="flex items-center gap-1.5 text-[10px] font-mono text-white/40 hover:text-white/70 transition-colors">
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> REFRESH
          </button>
        </div>
        {streams.length === 0 ? (
          <p className="text-white/30 text-xs font-mono text-center py-4">NO STREAMS — upload a file below</p>
        ) : (
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="border-b border-white/10">
                {["Name","MIME Type","Size",""].map(h => (
                  <th key={h} className="text-left text-white/40 py-2 pr-5 uppercase tracking-widest font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {streams.map(s => (
                <tr key={s.name} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="py-1.5 pr-5 text-white font-semibold">{s.name}</td>
                  <td className="py-1.5 pr-5 text-white/50 text-[10px]">{s.mime_type}</td>
                  <td className="py-1.5 pr-5 text-white/60">{s.size > 0 ? fmtSize(s.size) : "—"}</td>
                  <td className="py-1.5">
                    {s.size > 0 && (
                      <button onClick={() => handleDownload(s.name, s.mime_type)}
                        className="flex items-center gap-1 text-[10px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors">
                        <Download className="w-3 h-3" /> DOWNLOAD
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Upload panel */}
      <div className="bg-[#0B0E14] border border-white/10 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-widest text-amber-400 uppercase font-semibold flex items-center gap-2">
            <FileText className="w-3.5 h-3.5" /> Upload
          </span>
          <div className="flex border border-white/10 text-[9px] font-mono uppercase tracking-widest">
            <button onClick={() => setUpMode("file")}
              className={`px-3 py-1.5 transition-colors ${upMode === "file" ? "bg-amber-500/15 text-amber-300" : "text-white/40 hover:text-white/70"}`}>
              Raw File
            </button>
            <button onClick={() => setUpMode("csv")}
              className={`px-3 py-1.5 border-l border-white/10 transition-colors flex items-center gap-1.5 ${upMode === "csv" ? "bg-cyan-500/15 text-cyan-300" : "text-white/40 hover:text-white/70"}`}>
              <Rows3 className="w-3 h-3" /> CSV → Table
            </button>
          </div>
        </div>

        {upMode === "file" ? (
          <>
            <p className="text-[10px] text-white/40 font-mono leading-relaxed">
              Any file type up to 64 MiB. Streamed in 16 KiB chunks — only one chunk in memory at a time. Stored as <code>OBJ_TYPE_STREAM</code>; journaled and indexed automatically.
            </p>
            <input ref={fileRef} type="file" onChange={handleFileChange}
              className="w-full text-[11px] font-mono text-white/60 bg-[#0d1117] border border-white/10 px-3 py-2 file:mr-3 file:bg-amber-500/10 file:border file:border-amber-500/30 file:text-amber-300 file:text-[10px] file:font-mono file:uppercase file:tracking-widest file:px-3 file:py-1 file:cursor-pointer" />
            {upSize > 0 && (
              <div className="text-[10px] font-mono text-white/50 space-y-1">
                <div>Name: <span className="text-white/80">{upName}</span></div>
                <div>MIME: <span className="text-white/80">{upMime}</span></div>
                <div>Size: <span className={`${upSize > MAX_FILE_SIZE ? "text-red-400" : "text-emerald-400"}`}>
                  {fmtSize(upSize)}{upSize > MAX_FILE_SIZE ? " — exceeds 64 MiB limit" : ""}
                </span></div>
              </div>
            )}
            <div className="flex gap-3">
              <input value={upName} onChange={e => setUpName(e.target.value)} placeholder="object name (auto-filled)"
                className="flex-1 bg-[#0d1117] border border-white/10 px-3 py-2 text-[11px] font-mono text-white/80 outline-none focus:border-cyan-500/50" />
              <input value={upMime} onChange={e => setUpMime(e.target.value)} placeholder="mime type"
                className="flex-1 bg-[#0d1117] border border-white/10 px-3 py-2 text-[11px] font-mono text-white/80 outline-none focus:border-cyan-500/50" />
            </div>
            {uploading && (
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-mono text-white/40">
                  <span>UPLOADING…</span><span>{upProgress}%</span>
                </div>
                <div className="w-full bg-white/5 h-1">
                  <div className="bg-amber-400 h-1 transition-all" style={{ width: `${upProgress}%` }} />
                </div>
              </div>
            )}
            <button onClick={handleUpload} disabled={!upFile || uploading || upSize > MAX_FILE_SIZE}
              className="w-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-mono tracking-widest uppercase py-2 hover:bg-amber-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {uploading ? `UPLOADING ${upProgress}%` : "STORE STREAM"}
            </button>
          </>
        ) : (
          <>
            <p className="text-[10px] text-white/40 font-mono leading-relaxed">
              Parses the CSV in your browser and creates a real row-store table from it — one <code>valloc</code> + <code>schema</code> + <code>tables</code> call, then one <code>INSERT</code> per row through the SQL engine. Not stored as a stream. Up to {CSV_MAX_COLUMNS} columns and {CSV_MAX_ROWS.toLocaleString()} rows per import; string cells over 63 characters are truncated.
            </p>
            <input ref={csvFileRef} type="file" accept=".csv,text/csv" onChange={handleCsvFileChange}
              className="w-full text-[11px] font-mono text-white/60 bg-[#0d1117] border border-white/10 px-3 py-2 file:mr-3 file:bg-cyan-500/10 file:border file:border-cyan-500/30 file:text-cyan-300 file:text-[10px] file:font-mono file:uppercase file:tracking-widest file:px-3 file:py-1 file:cursor-pointer" />

            {csvParseError && <p className="text-[10px] font-mono text-red-400/80 leading-relaxed">{csvParseError}</p>}

            {csvColumns.length > 0 && (
              <div className="space-y-3">
                <input value={csvTableName} onChange={e => setCsvTableName(e.target.value)} placeholder="table name"
                  className="w-full bg-[#0d1117] border border-white/10 px-3 py-2 text-[11px] font-mono text-white/80 outline-none focus:border-cyan-500/50" />

                <div className="text-[9px] font-mono text-white/40 uppercase tracking-widest">
                  {csvRows.length.toLocaleString()} rows detected — review inferred columns
                </div>
                <div className="space-y-1.5">
                  {csvColumns.map((c, i) => (
                    <div key={i} className="flex gap-1.5">
                      <input value={c.name} onChange={e => csvUpdateColumn(i, { name: e.target.value })}
                        className="flex-1 min-w-0 bg-[#0F1219] border border-white/10 text-white font-mono text-[11px] px-2 py-1.5 outline-none focus:border-cyan-400/50" />
                      <select value={c.type} onChange={e => csvUpdateColumn(i, { type: e.target.value })}
                        className="bg-[#0F1219] border border-white/10 text-white/70 font-mono text-[11px] px-1.5 py-1.5 outline-none focus:border-cyan-400/50">
                        {COLUMN_TYPES.map(t => <option key={t}>{t}</option>)}
                      </select>
                      <span className="text-[9px] font-mono text-white/30 self-center w-24 truncate" title={csvRows[0]?.[i]}>
                        e.g. {csvRows[0]?.[i] || "—"}
                      </span>
                    </div>
                  ))}
                </div>

                {csvBusy && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] font-mono text-white/40">
                      <span>{csvStep || "IMPORTING…"}</span>
                      {csvProgress.total > 0 && <span>{csvProgress.done}/{csvProgress.total}{csvProgress.failed ? ` (${csvProgress.failed} failed)` : ""}</span>}
                    </div>
                    <div className="w-full bg-white/5 h-1">
                      <div className="bg-cyan-400 h-1 transition-all"
                        style={{ width: csvProgress.total ? `${Math.round((csvProgress.done / csvProgress.total) * 100)}%` : "0%" }} />
                    </div>
                  </div>
                )}

                <button onClick={handleCsvImport} disabled={csvBusy || !csvTableName.trim()}
                  className="w-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[10px] font-mono tracking-widest uppercase py-2 hover:bg-cyan-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {csvBusy ? "IMPORTING…" : `CREATE TABLE + IMPORT ${csvRows.length.toLocaleString()} ROWS`}
                </button>
              </div>
            )}

            {csvResult && (
              <div className={`border px-3 py-2 text-[11px] font-mono space-y-1 ${csvResult.failed ? "bg-amber-900/20 border-amber-700/30 text-amber-300" : "bg-emerald-900/20 border-emerald-700/30 text-emerald-300"}`}>
                <div>
                  ✔ Table '{csvResult.table}' created — {csvResult.ok} row{csvResult.ok === 1 ? "" : "s"} imported
                  {csvResult.failed ? `, ${csvResult.failed} failed` : ""}
                  {csvResult.warned ? `, ${csvResult.warned} cell${csvResult.warned === 1 ? "" : "s"} coerced/truncated` : ""}.
                </div>
                {csvResult.failMsgs.length > 0 && (
                  <ul className="text-white/50 text-[10px] list-disc list-inside">
                    {csvResult.failMsgs.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                )}
                <div className="text-white/40 text-[10px]">Query it from the SQL Console tab: <code>SELECT * FROM {csvResult.table}</code></div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN CONTAINER
// ─────────────────────────────────────────────────────────────────────────────
const DB_TABS: { key: DbTab; label: string; icon: React.ReactNode }[] = [
  { key: "sql",       label: "SQL Console",        icon: <TerminalSquare className="w-3.5 h-3.5" /> },
  { key: "schema",    label: "Schema Explorer",    icon: <Database  className="w-3.5 h-3.5" /> },
  { key: "journal",   label: "Journal Viewer",     icon: <BookOpen  className="w-3.5 h-3.5" /> },
  { key: "mqt",       label: "MQT Dashboard",      icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { key: "programs",  label: "Program Manager",    icon: <Upload    className="w-3.5 h-3.5" /> },
  { key: "streams",   label: "Stream Library",     icon: <FileText  className="w-3.5 h-3.5" /> },
];

export default function SlsDbEngine({ objects, activeUser }: SlsDbEngineProps) {
  const [dbTab, setDbTab] = useState<DbTab>("sql");

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="mb-6">
        <span className="font-mono text-[10px] tracking-widest text-cyan-400 uppercase font-bold">DB Engine // AeroSLS</span>
        <h2 className="text-2xl font-serif italic text-white mt-1 border-b border-white/10 pb-4">
          Database Control Centre
        </h2>
        <p className="text-[11px] font-mono text-white/40 mt-3 leading-relaxed">
          Run free-form SQL, browse row-store tables, inspect schemas, walk before/after-image journals, monitor materialized query tables, and run analytics queries — all powered by the live AeroSLS DB engine.
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
        {dbTab === "sql"       && <SqlConsole />}
        {dbTab === "schema"    && <SchemaExplorer />}
        {dbTab === "journal"   && <JournalViewer />}
        {dbTab === "mqt"       && <MqtDashboard />}
        {dbTab === "programs"  && <ProgramManager />}
        {dbTab === "streams"   && <StreamLibrary />}
      </div>
    </div>
  );
}
