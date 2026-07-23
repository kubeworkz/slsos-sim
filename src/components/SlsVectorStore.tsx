/**
 * SlsVectorStore.tsx — VectorStore Interface Roadmap Phase 4: a dedicated
 * Vector Store tab, closing the last gap the roadmap doc named (§0, gap 4):
 * every vec* capability was Terminal-only before this, functional but not
 * how a normal user would expect to browse collections, run a search, or
 * manage an index.
 *
 * Follows SlsDbEngine.tsx's own established pattern exactly: a sub-tab bar
 * over self-contained panel components, each with its own authFetch-based
 * load/render loop -- no shared generic "data table" component exists in
 * this codebase, so this follows the existing hand-rolled-per-panel
 * convention rather than introducing a new abstraction. Each panel fetches
 * whatever collection/index lists it needs independently (mirroring
 * SqlConsole's own independent loadTables()), not lifted into shared
 * parent state.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Boxes, Upload, Search, Network, RefreshCw, Plus, Trash2, Wand2, Sparkles, Download } from "lucide-react";
import { authFetch, authHeaders } from "../lib/apiFetch";

// ─── Shared fetch helpers ───────────────────────────────────────────────────
// kFetch mirrors SlsDbEngine.tsx's own helper exactly (authFetch + auto-parse
// JSON). kDelete is the one addition this file needs beyond that precedent --
// DELETE /api/vec/vector|collections|indexes (VectorStore Interface Roadmap
// Phase 1) are the first-ever genuine HTTP DELETE routes in this whole API,
// so no prior panel in this codebase had a reason to need this helper before.
async function kFetch(path: string, opts?: RequestInit) {
  const r = await authFetch(path, opts);
  return r.json();
}
async function kDelete(path: string, body: Record<string, any>) {
  const r = await authFetch(path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

type VsTab = "collections" | "insert" | "search" | "indexes";

interface VecCollection { name: string; dimension: number; entry_count: number; page_count: number; }
interface VecIndexEntry { name: string; collection: string; metric: string; active_count: number; node_count: number; }
interface VecMatch { external_id: number; page_id: number; slot_index: number; distance: number; }

const inputCls = "w-full bg-[#0F1219] border border-white/10 text-white font-mono text-xs px-3 py-2 outline-none focus:border-cyan-400/50";
const labelCls = "text-[9px] font-mono text-white/40 uppercase tracking-widest";

// ─── Two-step inline delete confirm — no prior GUI precedent in this
// codebase for a destructive action (SlsDbEngine.tsx has no delete buttons
// at all; the only existing destructive-confirmation flow is SlsTerminal's
// own text-based confirm/cancel prompt, which doesn't translate to a form
// UI). A small, self-contained new pattern rather than reusing something
// that doesn't fit: click once to arm, click "Confirm" to actually fire,
// or "Cancel"/click elsewhere to disarm. ────────────────────────────────────
function ConfirmDeleteButton({ armed, onArm, onConfirm, onCancel, label }: {
  armed: boolean; onArm: () => void; onConfirm: () => void; onCancel: () => void; label: string;
}) {
  if (!armed) {
    return (
      <button onClick={onArm} className="text-white/30 hover:text-red-400 transition-colors" title={`Delete ${label}`}>
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-widest">
      <span className="text-red-400">Delete?</span>
      <button onClick={onConfirm} className="text-red-400 hover:text-red-300 font-bold">Confirm</button>
      <button onClick={onCancel} className="text-white/40 hover:text-white/70">Cancel</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. COLLECTIONS PANEL
// ─────────────────────────────────────────────────────────────────────────────
function CollectionsPanel() {
  const [collections, setCollections] = useState<VecCollection[]>([]);
  const [loading, setLoading]         = useState(true);
  const [newName, setNewName]         = useState("");
  const [newDim, setNewDim]           = useState("4");
  const [busy, setBusy]               = useState(false);
  const [msg, setMsg]                 = useState("");
  const [armedDelete, setArmedDelete] = useState<string | null>(null);

  // ── VectorStore Interface Roadmap Phase 5/6 follow-on: Export/Import
  // Collections (definitions only -- COLLECTION/INDEX text, not the
  // vector data itself, matching this pair's own backend scope). Mirrors
  // SlsDbEngine.tsx's SQL Console Export/Import Schema buttons exactly:
  // same Blob+download-link export, same hidden-file-input+POST import,
  // same `=== "true"` string-boolean convention every route in this app
  // already uses (never a real JSON boolean -- see net/http.c's jb_str()).
  const [exportingSchema, setExportingSchema] = useState(false);
  const [importingSchema, setImportingSchema] = useState(false);
  const [schemaMsg, setSchemaMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  // ── VectorStore Interface Roadmap Phase 6 follow-on: bulk vector DATA
  // export/import (the embeddings themselves, not just the COLLECTION/
  // INDEX definitions the pair above handles). Backend has been complete
  // and host-tested since Phase 6 (vec_data_export()/vec_data_import(),
  // GET /api/vec/data/export/<collection>, POST /api/vec/data/import) --
  // this closes the one gap the VectorStore Gap Analysis doc named as
  // most actionable: the buttons were never added here. Export is scoped
  // to ONE collection per call (unlike schema export's "every readable
  // collection at once" -- see vec_data_export()'s own header comment on
  // why: vector data volume is vastly larger than DDL-sized definitions),
  // so this is a per-row action keyed by collection name, not a single
  // header button. Import stays a single header button, same shape as
  // schema import, since a VECTOR line names its own target collection
  // and a dump can cover more than one.
  const [exportingData, setExportingData] = useState<string | null>(null);
  const [importingData, setImportingData] = useState(false);
  const [dataMsg, setDataMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dataImportFileRef = useRef<HTMLInputElement>(null);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 4000); };

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await kFetch("/api/vec/collections"); setCollections(d?.collections || []); }
    catch (_) { setCollections([]); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleExportSchema = useCallback(async () => {
    setExportingSchema(true);
    setSchemaMsg(null);
    try {
      const data = await kFetch("/api/vec/schema/export");
      const text: string = data?.text || "";
      if (!text) {
        setSchemaMsg({ ok: false, text: "Nothing to export — no readable vector collections." });
      } else {
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        a.href = url; a.download = `aerosls_vector_schema_${stamp}.txt`; a.click();
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
      const data = await kFetch("/api/vec/schema/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const lines: { ok: string; error?: string }[] = data?.lines || [];
      const firstError = lines.find(l => l.ok !== "true")?.error;
      const failed = Number(data?.failed ?? 0);
      setSchemaMsg({
        ok: failed === 0,
        text: `${data?.succeeded ?? 0}/${data?.total ?? 0} line(s) succeeded` +
              (failed ? `, ${failed} failed${firstError ? ` (${firstError})` : ""}` : "") +
              (data?.truncated === "true" ? " — import truncated at 64 lines" : ""),
      });
      load();
    } catch (err: any) {
      setSchemaMsg({ ok: false, text: err?.message || "import failed" });
    }
    setImportingSchema(false);
    if (importFileRef.current) importFileRef.current.value = "";
  }, [load]);

  // VectorStore Gap Analysis §1.4 (closed): vec_data_export()'s buffer is
  // genuinely tight at real embedding dimensions, so one call may return
  // only a handful of vectors -- occasionally zero -- for a large
  // collection. This now loops, following GET .../skip/<N> (§1.4's own new
  // path segment) with skip advanced by each call's own vectors_written,
  // until entries_remaining hits 0, then downloads everything as ONE
  // combined file rather than silently handing the user a partial export.
  // MAX_PAGES is a safety cap against a runaway loop (e.g. a server bug
  // that reports entries_remaining > 0 forever) -- not expected to bite in
  // practice, named honestly rather than looping unbounded.
  const handleExportData = useCallback(async (name: string) => {
    setExportingData(name);
    setDataMsg(null);
    const MAX_PAGES = 500;
    try {
      const lines: string[] = [];
      let skip = 0;
      let totalWritten = 0;
      let total = 0;
      let remaining = 0;
      let pages = 0;
      for (;;) {
        const path = skip > 0
          ? `/api/vec/data/export/${encodeURIComponent(name)}/skip/${skip}`
          : `/api/vec/data/export/${encodeURIComponent(name)}`;
        const data = await kFetch(path);
        const text: string = data?.text || "";
        const written = data?.vectors_written ?? 0;
        total = data?.vectors_total ?? total;
        remaining = data?.entries_remaining ?? 0;
        totalWritten += written;
        pages++;
        // Every page after the first repeats the "# vector-store data
        // export ..." header comment (vec_data_export() has no notion of
        // "which page" -- it just answers "starting from skip_count,
        // what's next") -- strip it before concatenating so the combined
        // file has exactly one header, not one per page.
        const bodyLines = text.split("\n").filter(l => !(pages > 1 && l.startsWith("#")));
        lines.push(...bodyLines);
        if (remaining <= 0 || written === 0 || pages >= MAX_PAGES) break;
        skip += written;
      }
      const combinedText = lines.join("\n").replace(/\n+$/, "\n");
      if (totalWritten === 0) {
        setDataMsg({ ok: false, text: `'${name}' has no vectors to export.` });
      } else {
        const blob = new Blob([combinedText], { type: "text/plain;charset=utf-8" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        a.href = url; a.download = `aerosls_vector_data_${name}_${stamp}.txt`; a.click();
        URL.revokeObjectURL(url);
        setDataMsg({
          ok: true,
          text: `Exported ${totalWritten}/${total} vector(s) from '${name}'` +
                (pages > 1 ? ` across ${pages} page(s)` : "") +
                ` (${combinedText.length} bytes)` +
                (remaining > 0 ? ` — stopped after ${pages} page(s) (safety cap); ${remaining} vector(s) still remain` : ""),
        });
      }
    } catch (e: any) {
      setDataMsg({ ok: false, text: e?.message || "export failed" });
    }
    setExportingData(null);
  }, []);

  const handleImportDataClick = () => dataImportFileRef.current?.click();

  const handleImportDataFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingData(true);
    setDataMsg(null);
    try {
      const text = await file.text();
      const data = await kFetch("/api/vec/data/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const lines: { ok: string; error?: string }[] = data?.lines || [];
      const firstError = lines.find(l => l.ok !== "true")?.error;
      const failed = Number(data?.failed ?? 0);
      setDataMsg({
        ok: failed === 0,
        text: `${data?.succeeded ?? 0}/${data?.total ?? 0} vector(s) succeeded` +
              (failed ? `, ${failed} failed${firstError ? ` (${firstError})` : ""}` : "") +
              (data?.truncated === "true" ? " — import truncated" : ""),
      });
      load();
    } catch (err: any) {
      setDataMsg({ ok: false, text: err?.message || "import failed" });
    }
    setImportingData(false);
    if (dataImportFileRef.current) dataImportFileRef.current.value = "";
  }, [load]);

  // Collections require an already-existing catalog object
  // (sys_sls_vec_create()'s own precondition) -- chains POST /api/valloc
  // then POST /api/vec/collections client-side, the same two-step-
  // sequenced-into-one-button pattern CreateTablePanel (SlsDbEngine.tsx)
  // already established for row-store tables, rather than mirroring the
  // Terminal's own more manual "valloc, then vec create, as two separate
  // commands" convention -- a deliberately better GUI-native UX. No
  // dedicated object type exists for vector collections at the kernel
  // level (OBJ_TYPES has no VECTOR_COLLECTION entry), so this reuses
  // DB_TABLE (1), same as every other client-side valloc call in this app
  // -- cosmetic only, since vecstore_create_collection() never itself
  // checks object type.
  const handleCreate = async () => {
    const name = newName.trim();
    const dim = parseInt(newDim, 10);
    if (!name)        { flash("✖ collection name required"); return; }
    if (!dim || dim < 1) { flash("✖ a positive dimension is required"); return; }
    setBusy(true);
    try {
      const vr = await kFetch("/api/valloc", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ name, type: 1, pages: 2 }),
      });
      if (vr?.ok !== "true") { flash(`✖ valloc failed: ${vr?.error || "unknown error"}`); setBusy(false); return; }

      const cr = await kFetch("/api/vec/collections", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ name, dimension: dim }),
      });
      if (cr?.ok !== "true") { flash(`✖ collection create failed (status ${cr?.status ?? "?"})`); setBusy(false); return; }

      flash(`✔ collection '${name}' created`);
      setNewName(""); setNewDim("4");
      load();
    } catch (e: any) {
      flash(`✖ ${e?.message || "request failed"}`);
    }
    setBusy(false);
  };

  const handleDelete = async (name: string) => {
    const r = await kDelete("/api/vec/collections", { name });
    flash(r?.ok === "true" ? `✔ collection '${name}' deleted` : `✖ delete failed`);
    setArmedDelete(null);
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
          {collections.length} Vector Collection{collections.length !== 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-4">
          <input
            ref={importFileRef}
            type="file"
            accept=".txt"
            className="hidden"
            onChange={handleImportSchemaFile}
          />
          <button
            onClick={handleImportSchemaClick}
            disabled={importingSchema}
            title="Import a COLLECTION/INDEX definition dump (no vector data)"
            className="flex items-center gap-1.5 text-white/40 hover:text-cyan-400 transition-colors font-mono text-[9px] uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Upload className="w-3 h-3" /> {importingSchema ? "Importing…" : "Import Collections"}
          </button>
          <button
            onClick={handleExportSchema}
            disabled={exportingSchema}
            title="Export every readable collection's COLLECTION/INDEX definitions (no vector data)"
            className="flex items-center gap-1.5 text-white/40 hover:text-cyan-400 transition-colors font-mono text-[9px] uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-3 h-3" /> {exportingSchema ? "Exporting…" : "Export Collections"}
          </button>
          <span className="w-px h-3 bg-white/10" />
          <input
            ref={dataImportFileRef}
            type="file"
            accept=".txt"
            className="hidden"
            onChange={handleImportDataFile}
          />
          <button
            onClick={handleImportDataClick}
            disabled={importingData}
            title="Import a bulk VECTOR data dump (external_id + values) — import schema first if restoring both"
            className="flex items-center gap-1.5 text-white/40 hover:text-purple-400 transition-colors font-mono text-[9px] uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Upload className="w-3 h-3" /> {importingData ? "Importing…" : "Import Data"}
          </button>
          <button onClick={load} className="flex items-center gap-1.5 text-[10px] font-mono text-white/40 hover:text-white/70 transition-colors">
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {schemaMsg && (
        <div className={`text-[10px] font-mono px-3 py-2 border ${
          schemaMsg.ok ? "border-green-400/20 bg-green-400/5 text-green-300/80" : "border-red-400/20 bg-red-400/5 text-red-300/80"
        }`}>
          {schemaMsg.text}
        </div>
      )}
      {dataMsg && (
        <div className={`text-[10px] font-mono px-3 py-2 border ${
          dataMsg.ok ? "border-green-400/20 bg-green-400/5 text-green-300/80" : "border-red-400/20 bg-red-400/5 text-red-300/80"
        }`}>
          {dataMsg.text}
        </div>
      )}
      <p className="text-[9px] font-mono text-white/30 leading-relaxed">
        <span className="text-cyan-400">Export/Import Collections</span> cover collection and index definitions
        only (name, dimension, index metric) — not the vector data itself.{" "}
        <span className="text-purple-400">Export Data</span> (per-row, below) and{" "}
        <span className="text-purple-400">Import Data</span> (above) cover the actual vectors
        (<code>external_id</code> + values) for one collection at a time. Import schema before data if restoring
        both. Data export is capped by a fixed buffer size, so a large collection at real embedding dimensions
        may only export a partial batch per click — the export message reports how many of the collection's
        vectors actually made it into the file.
      </p>

      {msg && <div className="bg-[#0d1117] border border-white/10 px-4 py-2 text-[11px] font-mono text-white/70">{msg}</div>}

      <div className="border border-white/10 bg-[#0B0E14]">
        {loading ? (
          <p className="text-white/30 font-mono text-xs px-5 py-6 text-center">Loading…</p>
        ) : collections.length === 0 ? (
          <p className="text-white/30 font-mono text-xs px-5 py-6 text-center">No vector collections yet. Create one below.</p>
        ) : (
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="border-b border-white/10 text-white/40 text-[9px] uppercase tracking-widest">
                <th className="text-left px-5 py-2.5">Name</th>
                <th className="text-left px-5 py-2.5">Dimension</th>
                <th className="text-left px-5 py-2.5">Entries</th>
                <th className="text-left px-5 py-2.5">Pages</th>
                <th className="text-right px-5 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {collections.map(c => (
                <tr key={c.name} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="px-5 py-2.5 text-white font-semibold">{c.name}</td>
                  <td className="px-5 py-2.5 text-purple-400/80">{c.dimension}</td>
                  <td className="px-5 py-2.5 text-white/60">{c.entry_count}</td>
                  <td className="px-5 py-2.5 text-white/40">{c.page_count}</td>
                  <td className="px-5 py-2.5 text-right">
                    <div className="flex justify-end items-center gap-3">
                      <button
                        onClick={() => handleExportData(c.name)}
                        disabled={exportingData === c.name}
                        title={`Export '${c.name}'s vector data (external_id + values)`}
                        className="flex items-center gap-1 text-white/30 hover:text-purple-400 transition-colors text-[9px] font-mono uppercase tracking-widest disabled:opacity-40"
                      >
                        <Download className="w-3 h-3" /> {exportingData === c.name ? "Exporting…" : "Data"}
                      </button>
                      <ConfirmDeleteButton
                        armed={armedDelete === c.name}
                        onArm={() => setArmedDelete(c.name)}
                        onConfirm={() => handleDelete(c.name)}
                        onCancel={() => setArmedDelete(null)}
                        label={c.name}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border border-white/10 bg-[#0B0E14] p-5 space-y-3">
        <span className="text-[9px] font-mono tracking-widest uppercase text-cyan-400 flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Create Collection
        </span>
        <div className="flex gap-2">
          <div className="flex-1 min-w-0 space-y-1">
            <label className={labelCls}>Name</label>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="my_embeddings" className={inputCls} />
          </div>
          <div className="w-28 space-y-1">
            <label className={labelCls}>Dimension</label>
            <input value={newDim} onChange={e => setNewDim(e.target.value)} type="number" min="1" className={inputCls} />
          </div>
        </div>
        <button
          onClick={handleCreate} disabled={busy}
          className="w-full bg-cyan-400 text-[#0B0E14] font-mono text-[10px] font-bold uppercase tracking-widest py-2.5 hover:bg-cyan-300 transition-colors disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create Collection"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. INSERT PANEL
// ─────────────────────────────────────────────────────────────────────────────
type InsertMode = "raw" | "embed";

function InsertPanel() {
  const [collections, setCollections] = useState<VecCollection[]>([]);
  const [collection, setCollection]   = useState("");
  const [mode, setMode]               = useState<InsertMode>("raw");
  const [externalId, setExternalId]   = useState("");
  const [rawVector, setRawVector]     = useState("");
  const [prompt, setPrompt]           = useState("");
  const [endpoint, setEndpoint]       = useState("10.0.2.2");
  const [port, setPort]               = useState("11434");
  const [model, setModel]             = useState("nomic-embed-text");
  const [busy, setBusy]               = useState(false);
  const [msg, setMsg]                 = useState("");

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 6000); };

  const loadCollections = useCallback(async () => {
    try {
      const d = await kFetch("/api/vec/collections");
      const list: VecCollection[] = d?.collections || [];
      setCollections(list);
      if (!collection && list.length > 0) setCollection(list[0].name);
    } catch (_) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { loadCollections(); }, [loadCollections]);

  const selected = collections.find(c => c.name === collection);

  const handleInsertRaw = async () => {
    if (!collection) { flash("✖ select a collection first"); return; }
    const extId = parseInt(externalId, 10);
    const values = rawVector.split(",").map(s => parseFloat(s.trim())).filter(v => !Number.isNaN(v));
    if (!externalId || Number.isNaN(extId)) { flash("✖ external_id required"); return; }
    if (values.length === 0) { flash("✖ at least one vector value required"); return; }
    setBusy(true);
    try {
      const r = await kFetch("/api/vec/insert", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ collection, external_id: extId, values }),
      });
      if (r?.status === 0) flash(`✔ inserted — page_id=${r.page_id} slot_index=${r.slot_index}`);
      else flash(`✖ insert failed (status ${r?.status ?? "?"})${values.length !== selected?.dimension ? ` — collection expects ${selected?.dimension} values, got ${values.length}` : ""}`);
    } catch (e: any) { flash(`✖ ${e?.message || "request failed"}`); }
    setBusy(false);
  };

  const handleInsertEmbed = async () => {
    if (!collection) { flash("✖ select a collection first"); return; }
    const extId = parseInt(externalId, 10);
    if (!externalId || Number.isNaN(extId)) { flash("✖ external_id required"); return; }
    if (!prompt.trim()) { flash("✖ prompt text required"); return; }
    setBusy(true);
    try {
      const r = await kFetch("/api/vec/embed-insert", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({
          collection, external_id: extId, prompt: prompt.trim(),
          endpoint_ip: endpoint || "10.0.2.2", port: parseInt(port, 10) || 11434, model: model || "nomic-embed-text",
        }),
      });
      if (r?.ollama_status !== 0) flash(`✖ embedding failed (ollama_status=${r?.ollama_status}) — insert never attempted`);
      else if (r?.insert_status !== 0) flash(`✖ embedded ok, but insert failed (insert_status=${r?.insert_status})`);
      else flash(`✔ embedded + inserted into '${collection}'`);
    } catch (e: any) { flash(`✖ ${e?.message || "request failed"}`); }
    setBusy(false);
  };

  return (
    <div className="max-w-2xl space-y-5">
      <div className="border border-white/10 bg-[#0B0E14] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className={labelCls}>Collection</span>
          <button onClick={loadCollections} className="text-white/30 hover:text-cyan-400 transition-colors"><RefreshCw className="w-3 h-3" /></button>
        </div>
        {collections.length === 0 ? (
          <p className="text-white/30 font-mono text-xs italic">No collections yet — create one in the Collections tab first.</p>
        ) : (
          <select value={collection} onChange={e => setCollection(e.target.value)} className={inputCls}>
            {collections.map(c => <option key={c.name} value={c.name}>{c.name} (dim {c.dimension})</option>)}
          </select>
        )}

        <div className="flex gap-1 border-b border-white/10 pb-3">
          {(["raw", "embed"] as InsertMode[]).map(m => (
            <button
              key={m} onClick={() => setMode(m)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                mode === m ? "bg-cyan-400/15 text-cyan-400 border border-cyan-400/30" : "text-white/40 border border-transparent hover:text-white/70"
              }`}
            >
              {m === "raw" ? <><Upload className="w-3 h-3" /> Raw Vector</> : <><Sparkles className="w-3 h-3" /> Embed Text</>}
            </button>
          ))}
        </div>

        <div className="space-y-1">
          <label className={labelCls}>External ID</label>
          <input value={externalId} onChange={e => setExternalId(e.target.value)} type="number" placeholder="42" className={inputCls} />
        </div>

        {mode === "raw" ? (
          <div className="space-y-1">
            <label className={labelCls}>Vector values ({selected ? `${selected.dimension} expected` : "comma-separated"})</label>
            <textarea
              value={rawVector} onChange={e => setRawVector(e.target.value)} rows={3}
              placeholder="0.12, 0.98, -0.44, 0.05"
              className={`${inputCls} resize-y`}
            />
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <label className={labelCls}>Prompt text</label>
              <textarea
                value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
                placeholder="Text to embed via Ollama, then store as this collection's vector."
                className={`${inputCls} resize-y`}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className={labelCls}>Endpoint</label>
                <input value={endpoint} onChange={e => setEndpoint(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Port</label>
                <input value={port} onChange={e => setPort(e.target.value)} type="number" className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Model</label>
                <input value={model} onChange={e => setModel(e.target.value)} className={inputCls} />
              </div>
            </div>
          </>
        )}

        {msg && <p className="text-[11px] font-mono text-white/70 leading-relaxed">{msg}</p>}

        <button
          onClick={mode === "raw" ? handleInsertRaw : handleInsertEmbed}
          disabled={busy || collections.length === 0}
          className="w-full bg-cyan-400 text-[#0B0E14] font-mono text-[10px] font-bold uppercase tracking-widest py-2.5 hover:bg-cyan-300 transition-colors disabled:opacity-40"
        >
          {busy ? "Inserting…" : mode === "raw" ? "Insert Vector" : "Embed + Insert"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. SEARCH PANEL
// ─────────────────────────────────────────────────────────────────────────────
type SearchTarget = "collection" | "index";
type QueryMode = "text" | "raw";

function formatDistance(d: number): string {
  if (typeof d !== "number" || Number.isNaN(d)) return "—";
  return d.toFixed(4);
}

function SearchPanel() {
  const [collections, setCollections] = useState<VecCollection[]>([]);
  const [indexes, setIndexes]         = useState<VecIndexEntry[]>([]);
  const [target, setTarget]           = useState<SearchTarget>("collection");
  const [collection, setCollection]   = useState("");
  const [indexName, setIndexName]     = useState("");
  const [queryMode, setQueryMode]     = useState<QueryMode>("text");
  const [prompt, setPrompt]           = useState("");
  const [rawVector, setRawVector]     = useState("");
  const [metric, setMetric]           = useState<"cosine" | "l2">("cosine");
  const [k, setK]                     = useState("10");
  const [ef, setEf]                   = useState("");
  const [endpoint, setEndpoint]       = useState("10.0.2.2");
  const [port, setPort]               = useState("11434");
  const [model, setModel]             = useState("nomic-embed-text");
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState("");
  const [matches, setMatches]         = useState<VecMatch[] | null>(null);
  const [truncated, setTruncated]     = useState(false);
  // Search results are the one place a user can point at a specific vector
  // (page_id/slot_index, the real VecId — see api_vec_delete's own comment
  // in net/http.c on why deletion is keyed by that instead of external_id),
  // so this is where the delete-a-vector control belongs. Keyed by
  // "pageId:slotIndex" since that pair, not array index, is the row's real
  // identity. Same ConfirmDeleteButton two-step pattern the Collections/
  // Indexes panels already use, for one consistent destructive-action UX
  // across this whole tab.
  const [armedDeleteVec, setArmedDeleteVec] = useState<string | null>(null);
  const [deleteVecMsg, setDeleteVecMsg] = useState("");

  const loadAll = useCallback(async () => {
    try {
      const [cd, id] = await Promise.all([kFetch("/api/vec/collections"), kFetch("/api/vec/indexes")]);
      const clist: VecCollection[] = cd?.collections || [];
      const ilist: VecIndexEntry[] = id?.indexes || [];
      setCollections(clist);
      setIndexes(ilist);
      if (!collection && clist.length > 0) setCollection(clist[0].name);
      if (!indexName && ilist.length > 0) setIndexName(ilist[0].name);
    } catch (_) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { loadAll(); }, [loadAll]);

  const runSearch = async () => {
    setError(""); setMatches(null); setTruncated(false);
    if (target === "collection" && !collection) { setError("select a collection first"); return; }
    if (target === "index" && !indexName)        { setError("select an index first (create one in the Indexes tab)"); return; }
    let values: number[] = [];
    if (queryMode === "raw") {
      values = rawVector.split(",").map(s => parseFloat(s.trim())).filter(v => !Number.isNaN(v));
      if (values.length === 0) { setError("at least one vector value required"); return; }
    } else if (!prompt.trim()) { setError("query text required"); return; }

    setBusy(true);
    try {
      let path: string;
      let body: Record<string, any>;
      if (target === "collection" && queryMode === "raw") {
        path = "/api/vec/search";
        body = { collection, query: values, metric, k: parseInt(k, 10) || 10 };
      } else if (target === "collection" && queryMode === "text") {
        path = "/api/vec/embed-search";
        body = {
          collection, prompt: prompt.trim(), metric, k: parseInt(k, 10) || 10,
          endpoint_ip: endpoint || "10.0.2.2", port: parseInt(port, 10) || 11434, model: model || "nomic-embed-text",
        };
      } else if (target === "index" && queryMode === "raw") {
        path = "/api/vec/index/search";
        body = { index: indexName, query: values, k: parseInt(k, 10) || 10, ef: parseInt(ef, 10) || undefined };
      } else {
        path = "/api/vec/index/embed-search";
        body = {
          index: indexName, prompt: prompt.trim(), k: parseInt(k, 10) || 10, ef: parseInt(ef, 10) || undefined,
          endpoint_ip: endpoint || "10.0.2.2", port: parseInt(port, 10) || 11434, model: model || "nomic-embed-text",
        };
      }
      const r = await kFetch(path, { method: "POST", headers: authHeaders, body: JSON.stringify(body) });
      if (r?.ollama_status !== undefined && r.ollama_status !== 0) {
        setError(`embedding failed (ollama_status=${r.ollama_status}) — search never ran`);
      } else if (r?.ok === "false" && r?.error) {
        setError(r.error);
      } else {
        setMatches(r?.matches || []);
        setTruncated(!!r?.truncated);
      }
    } catch (e: any) { setError(e?.message || "request failed"); }
    setBusy(false);
  };

  // A match's VecId is a physical address into some collection's storage
  // regardless of whether it was found via brute-force (target==="collection")
  // or an HNSW index (target==="index") -- an index is just an alternate
  // path to the same underlying vecstore_delete(), so both cases resolve to
  // the one backing collection name DELETE /api/vec/vector actually needs.
  const deleteVectorCollection = (): string | undefined =>
    target === "collection" ? collection : indexes.find(ix => ix.name === indexName)?.collection;

  const handleDeleteVector = async (m: VecMatch) => {
    const targetCollection = deleteVectorCollection();
    if (!targetCollection) { setDeleteVecMsg("✖ delete failed — no backing collection resolved"); setArmedDeleteVec(null); return; }
    const r = await kDelete("/api/vec/vector", { collection: targetCollection, page_id: m.page_id, slot_index: m.slot_index });
    if (r?.ok === "true") {
      setMatches(prev => (prev || []).filter(x => !(x.page_id === m.page_id && x.slot_index === m.slot_index)));
      setDeleteVecMsg(`✔ deleted external_id=${m.external_id} (page_id=${m.page_id} slot_index=${m.slot_index})`);
    } else {
      setDeleteVecMsg(`✖ delete failed (status=${r?.status})`);
    }
    setArmedDeleteVec(null);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
      {/* ── Query builder ─────────────────────────────────────────────────── */}
      <div className="border border-white/10 bg-[#0B0E14] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className={labelCls}>Search target</span>
          <button onClick={loadAll} className="text-white/30 hover:text-cyan-400 transition-colors ml-auto"><RefreshCw className="w-3 h-3" /></button>
        </div>
        <div className="flex gap-1">
          {(["collection", "index"] as SearchTarget[]).map(t => (
            <button
              key={t} onClick={() => setTarget(t)}
              className={`flex-1 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                target === t ? "bg-cyan-400/15 text-cyan-400 border border-cyan-400/30" : "text-white/40 border border-transparent hover:text-white/70"
              }`}
            >
              {t === "collection" ? "Brute-force" : "HNSW Index"}
            </button>
          ))}
        </div>

        {target === "collection" ? (
          collections.length === 0 ? (
            <p className="text-white/30 font-mono text-xs italic">No collections yet.</p>
          ) : (
            <select value={collection} onChange={e => setCollection(e.target.value)} className={inputCls}>
              {collections.map(c => <option key={c.name} value={c.name}>{c.name} (dim {c.dimension})</option>)}
            </select>
          )
        ) : (
          indexes.length === 0 ? (
            <p className="text-white/30 font-mono text-xs italic">No HNSW indexes yet — create one in the Indexes tab.</p>
          ) : (
            <select value={indexName} onChange={e => setIndexName(e.target.value)} className={inputCls}>
              {indexes.map(ix => <option key={ix.name} value={ix.name}>{ix.name} → {ix.collection} ({ix.metric})</option>)}
            </select>
          )
        )}

        <div className="flex gap-1 border-t border-white/10 pt-4">
          {(["text", "raw"] as QueryMode[]).map(m => (
            <button
              key={m} onClick={() => setQueryMode(m)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                queryMode === m ? "bg-cyan-400/15 text-cyan-400 border border-cyan-400/30" : "text-white/40 border border-transparent hover:text-white/70"
              }`}
            >
              {m === "text" ? <><Sparkles className="w-3 h-3" /> Text</> : <><Wand2 className="w-3 h-3" /> Raw Vector</>}
            </button>
          ))}
        </div>

        {queryMode === "text" ? (
          <>
            <div className="space-y-1">
              <label className={labelCls}>Query text</label>
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
                placeholder="What is this collection about?" className={`${inputCls} resize-y`} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1"><label className={labelCls}>Endpoint</label><input value={endpoint} onChange={e => setEndpoint(e.target.value)} className={inputCls} /></div>
              <div className="space-y-1"><label className={labelCls}>Port</label><input value={port} onChange={e => setPort(e.target.value)} type="number" className={inputCls} /></div>
              <div className="space-y-1"><label className={labelCls}>Model</label><input value={model} onChange={e => setModel(e.target.value)} className={inputCls} /></div>
            </div>
          </>
        ) : (
          <div className="space-y-1">
            <label className={labelCls}>Vector values</label>
            <textarea value={rawVector} onChange={e => setRawVector(e.target.value)} rows={3}
              placeholder="0.12, 0.98, -0.44, 0.05" className={`${inputCls} resize-y`} />
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <label className={labelCls}>k</label>
            <input value={k} onChange={e => setK(e.target.value)} type="number" min="1" className={inputCls} />
          </div>
          {target === "collection" ? (
            <div className="space-y-1 col-span-2">
              <label className={labelCls}>Metric</label>
              <select value={metric} onChange={e => setMetric(e.target.value as "cosine" | "l2")} className={inputCls}>
                <option value="cosine">cosine</option>
                <option value="l2">l2</option>
              </select>
            </div>
          ) : (
            <div className="space-y-1 col-span-2">
              <label className={labelCls}>ef (optional, default = k)</label>
              <input value={ef} onChange={e => setEf(e.target.value)} type="number" min="1" className={inputCls} />
            </div>
          )}
        </div>

        <button
          onClick={runSearch} disabled={busy}
          className="w-full flex items-center justify-center gap-2 bg-cyan-400 text-[#0B0E14] font-mono text-xs font-bold uppercase tracking-widest py-2.5 hover:bg-cyan-300 transition-colors disabled:opacity-40"
        >
          <Search className="w-3.5 h-3.5" /> {busy ? "Searching…" : "Search"}
        </button>
      </div>

      {/* ── Results ────────────────────────────────────────────────────────── */}
      <div className="border border-white/10 bg-[#0B0E14] p-5 space-y-3 min-h-[200px]">
        {error ? (
          <div className="flex items-start gap-2">
            <span className="text-[9px] font-mono tracking-widest uppercase text-red-400 shrink-0 pt-0.5">Error</span>
            <span className="text-[11px] font-mono text-red-300/80">{error}</span>
          </div>
        ) : matches === null ? (
          <p className="text-white/30 font-mono text-xs italic">Run a search to see results here.</p>
        ) : matches.length === 0 ? (
          <p className="text-white/40 font-mono text-xs italic">No matches found.</p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="text-[9px] font-mono tracking-widest uppercase text-green-400">Results</span>
              <span className="text-[10px] font-mono text-white/30">{matches.length} match{matches.length === 1 ? "" : "es"}{truncated ? " (truncated)" : ""}</span>
              {deleteVecMsg && <span className="text-[10px] font-mono text-white/50 ml-auto">{deleteVecMsg}</span>}
            </div>
            <table className="w-full text-[11px] font-mono border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-white/40 text-[9px] uppercase tracking-widest">
                  <th className="text-left px-3 py-2">External ID</th>
                  <th className="text-left px-3 py-2">Distance</th>
                  <th className="text-left px-3 py-2">Page ID</th>
                  <th className="text-left px-3 py-2">Slot Index</th>
                  <th className="text-left px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m, i) => {
                  const key = `${m.page_id}:${m.slot_index}`;
                  return (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                      <td className="px-3 py-2 text-white font-semibold">{m.external_id}</td>
                      <td className="px-3 py-2 text-cyan-300">{formatDistance(m.distance)}</td>
                      <td className="px-3 py-2 text-white/50">{m.page_id}</td>
                      <td className="px-3 py-2 text-white/50">{m.slot_index}</td>
                      <td className="px-3 py-2">
                        <ConfirmDeleteButton
                          armed={armedDeleteVec === key}
                          onArm={() => setArmedDeleteVec(key)}
                          onConfirm={() => handleDeleteVector(m)}
                          onCancel={() => setArmedDeleteVec(null)}
                          label={`vector external_id=${m.external_id}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. INDEXES PANEL
// ─────────────────────────────────────────────────────────────────────────────
function IndexesPanel() {
  const [indexes, setIndexes]         = useState<VecIndexEntry[]>([]);
  const [collections, setCollections] = useState<VecCollection[]>([]);
  const [loading, setLoading]         = useState(true);
  const [newName, setNewName]         = useState("");
  const [newCollection, setNewCollection] = useState("");
  const [newMetric, setNewMetric]     = useState<"cosine" | "l2">("cosine");
  const [busy, setBusy]               = useState(false);
  const [rebuilding, setRebuilding]   = useState<Record<string, boolean>>({});
  const [msg, setMsg]                 = useState("");
  const [armedDelete, setArmedDelete] = useState<string | null>(null);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [id, cd] = await Promise.all([kFetch("/api/vec/indexes"), kFetch("/api/vec/collections")]);
      const clist: VecCollection[] = cd?.collections || [];
      setIndexes(id?.indexes || []);
      setCollections(clist);
      if (!newCollection && clist.length > 0) setNewCollection(clist[0].name);
    } catch (_) {}
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name)          { flash("✖ index name required"); return; }
    if (!newCollection) { flash("✖ select a collection first"); return; }
    setBusy(true);
    try {
      const r = await kFetch("/api/vec/indexes", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ name, collection: newCollection, metric: newMetric }),
      });
      if (r?.ok !== "true") { flash(`✖ index create failed (status ${r?.status ?? "?"})`); setBusy(false); return; }
      flash(`✔ index '${name}' created over '${newCollection}' — empty until rebuilt (see the Rebuild button below)`);
      setNewName("");
      load();
    } catch (e: any) { flash(`✖ ${e?.message || "request failed"}`); }
    setBusy(false);
  };

  const handleRebuild = async (name: string) => {
    setRebuilding(p => ({ ...p, [name]: true }));
    try {
      const r = await kFetch("/api/vec/index/rebuild", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ index: name }),
      });
      flash(r?.ok === "true" ? `✔ index '${name}' rebuilt` : `✖ rebuild failed (status ${r?.status ?? "?"})`);
      load();
    } catch (e: any) { flash(`✖ ${e?.message || "request failed"}`); }
    setRebuilding(p => ({ ...p, [name]: false }));
  };

  const handleDelete = async (name: string) => {
    const r = await kDelete("/api/vec/indexes", { name });
    flash(r?.ok === "true" ? `✔ index '${name}' dropped` : `✖ drop failed`);
    setArmedDelete(null);
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
          {indexes.length} HNSW Index{indexes.length !== 1 ? "es" : ""}
        </span>
        <button onClick={load} className="flex items-center gap-1.5 text-[10px] font-mono text-white/40 hover:text-white/70 transition-colors">
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {msg && <div className="bg-[#0d1117] border border-white/10 px-4 py-2 text-[11px] font-mono text-white/70">{msg}</div>}

      <div className="border border-white/10 bg-[#0B0E14]">
        {loading ? (
          <p className="text-white/30 font-mono text-xs px-5 py-6 text-center">Loading…</p>
        ) : indexes.length === 0 ? (
          <p className="text-white/30 font-mono text-xs px-5 py-6 text-center">No HNSW indexes yet. Create one below.</p>
        ) : (
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="border-b border-white/10 text-white/40 text-[9px] uppercase tracking-widest">
                <th className="text-left px-5 py-2.5">Name</th>
                <th className="text-left px-5 py-2.5">Collection</th>
                <th className="text-left px-5 py-2.5">Metric</th>
                <th className="text-left px-5 py-2.5">Active</th>
                <th className="text-left px-5 py-2.5">Nodes</th>
                <th className="text-right px-5 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {indexes.map(ix => (
                <tr key={ix.name} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="px-5 py-2.5 text-white font-semibold">{ix.name}</td>
                  <td className="px-5 py-2.5 text-white/70">{ix.collection}</td>
                  <td className="px-5 py-2.5 text-purple-400/80">{ix.metric}</td>
                  <td className="px-5 py-2.5 text-white/60">{ix.active_count}{ix.active_count === 0 && <span className="text-amber-400/70 ml-1.5 text-[9px] uppercase tracking-widest">empty — needs rebuild</span>}</td>
                  <td className="px-5 py-2.5 text-white/40">{ix.node_count}</td>
                  <td className="px-5 py-2.5 text-right">
                    <div className="flex justify-end items-center gap-3">
                      {armedDelete !== ix.name && (
                        <button
                          onClick={() => handleRebuild(ix.name)} disabled={rebuilding[ix.name]}
                          className="flex items-center gap-1 text-white/40 hover:text-cyan-400 transition-colors text-[9px] font-mono uppercase tracking-widest"
                          title="Rebuild (clear + repopulate from the live collection)"
                        >
                          <RefreshCw className={`w-3 h-3 ${rebuilding[ix.name] ? "animate-spin" : ""}`} /> Rebuild
                        </button>
                      )}
                      <ConfirmDeleteButton
                        armed={armedDelete === ix.name}
                        onArm={() => setArmedDelete(ix.name)}
                        onConfirm={() => handleDelete(ix.name)}
                        onCancel={() => setArmedDelete(null)}
                        label={ix.name}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="border border-white/10 bg-[#0B0E14] p-5 space-y-3">
        <span className="text-[9px] font-mono tracking-widest uppercase text-cyan-400 flex items-center gap-1.5">
          <Network className="w-3.5 h-3.5" /> Create HNSW Index
        </span>
        {collections.length === 0 ? (
          <p className="text-white/30 font-mono text-xs italic">No collections yet — create one in the Collections tab first.</p>
        ) : (
          <>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0 space-y-1">
                <label className={labelCls}>Index name</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="idx_my_embeddings" className={inputCls} />
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <label className={labelCls}>Collection</label>
                <select value={newCollection} onChange={e => setNewCollection(e.target.value)} className={inputCls}>
                  {collections.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div className="w-28 space-y-1">
                <label className={labelCls}>Metric</label>
                <select value={newMetric} onChange={e => setNewMetric(e.target.value as "cosine" | "l2")} className={inputCls}>
                  <option value="cosine">cosine</option>
                  <option value="l2">l2</option>
                </select>
              </div>
            </div>
            <p className="text-[9px] font-mono text-white/30 leading-relaxed">
              A fresh index starts empty even over an already-populated collection — click <span className="text-cyan-400">Rebuild</span> after creating it to backfill from the collection's current contents.
            </p>
            <button
              onClick={handleCreate} disabled={busy}
              className="w-full bg-cyan-400 text-[#0B0E14] font-mono text-[10px] font-bold uppercase tracking-widest py-2.5 hover:bg-cyan-300 transition-colors disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create Index"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN CONTAINER
// ─────────────────────────────────────────────────────────────────────────────
const VS_TABS: { key: VsTab; label: string; icon: React.ReactNode }[] = [
  { key: "collections", label: "Collections", icon: <Boxes  className="w-3.5 h-3.5" /> },
  { key: "insert",      label: "Insert",      icon: <Upload className="w-3.5 h-3.5" /> },
  { key: "search",      label: "Search",      icon: <Search className="w-3.5 h-3.5" /> },
  { key: "indexes",     label: "Indexes",     icon: <Network className="w-3.5 h-3.5" /> },
];

export default function SlsVectorStore() {
  const [vsTab, setVsTab] = useState<VsTab>("collections");

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="mb-6">
        <span className="font-mono text-[10px] tracking-widest text-cyan-400 uppercase font-bold">Vector Store // AeroSLS</span>
        <h2 className="text-2xl font-serif italic text-white mt-1 border-b border-white/10 pb-4">
          Semantic Vector Storage
        </h2>
        <p className="text-[11px] font-mono text-white/40 mt-3 leading-relaxed">
          Manage vector collections, insert raw or text-embedded vectors, run brute-force or approximate (HNSW) similarity search, and build/rebuild indexes — all powered by the live AeroSLS VectorStore engine.
        </p>
      </div>

      {/* Sub-tab bar */}
      <div className="flex border-b border-white/10 mb-6 overflow-x-auto">
        {VS_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setVsTab(t.key)}
            className={`flex items-center gap-2 px-5 py-3 text-[10px] font-mono tracking-widest uppercase whitespace-nowrap transition-all border-b-2 ${
              vsTab === t.key
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
        {vsTab === "collections" && <CollectionsPanel />}
        {vsTab === "insert"      && <InsertPanel />}
        {vsTab === "search"      && <SearchPanel />}
        {vsTab === "indexes"     && <IndexesPanel />}
      </div>
    </div>
  );
}
