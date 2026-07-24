/**
 * shellCommands.ts — command registry + router for the web Terminal
 * (Task 1 of docs/AeroSLS-Web-Terminal-Plan-v0.1.md in aerosls2).
 *
 * Maps shell-style command strings ("valloc foo DB_TABLE 2", "partition
 * list", "sql SELECT * FROM users") onto AeroSLS's existing HTTP API
 * (net/http.c) — no kernel changes, per the plan's chosen approach (§2,
 * option A). Every route/field name below was read directly out of
 * net/http.c's handler bodies (json_str/json_int/json_array_object_at
 * calls) and the kernel .c files those routes call into, not guessed from
 * the shell's own command names — several genuinely differ (e.g. the HTTP
 * route for shell's "agent kill" is named /api/agent/drop).
 *
 * Command syntax deliberately isn't a byte-for-byte copy of user/shell.c's
 * own positional parsing: several HTTP routes accept optional fields
 * shell.c's hand-rolled parser doesn't expose in one call (mqt create,
 * aggregate, constraint add, cursor open all have 3-7 optional fields).
 * Those use `key=value` tokens after the required positional args instead
 * of a long fixed positional list nobody could type from memory. Usage
 * strings on every command spell out the exact syntax; `help` prints all
 * of them.
 */

// ─── Result & registry types ────────────────────────────────────────────────
export interface CommandResult {
  text: string;
  isError?: boolean;
}

export type CommandHandler = (rest: string) => Promise<CommandResult>;

interface CommandSpec {
  name: string;         // e.g. "partition create" -- space-separated, matched as a whole-word prefix
  usage: string;        // shown in `help` and in "wrong number of args" errors
  destructive?: boolean; // consulted by the Terminal UI's confirmation flow (Task 3)
  handler: CommandHandler;
}

// Shell-Command JSON-Promotion Roadmap: this file used to carry a second
// table here (SHELL_FALLBACK_COMMANDS) listing the 28 real user/shell.c
// commands that had no purpose-built HTTP route and were only reachable
// through POST /api/shell/exec's plain-text legacy dispatch. All 28 --
// including the legacy loader group (write/demo/load/loader list/upload)
// and "login" -- now have real JSON routes in net/http.c and are
// registered below like every other command, so that table and the
// execViaShellFallback() plumbing it fed are gone. One command's shape
// changed in the process: "login" was a session uid/gid switch in
// shell.c, but net/http.c's HTTP session always reseeds identity from the
// bearer token on every request (Architectural Phase 4), making that
// switch a no-op over HTTP even under the old fallback path. It's
// promoted here as a read-only "login" -> GET /api/session/whoami instead
// of a fake state-mutating impersonation route, which would just reopen
// the privilege-escalation gap that phase closed.

const COMMANDS: CommandSpec[] = [];
// First-word index for "did you mean" suggestions when a category prefix
// matches but no full command does (e.g. user types "vec frobnicate").
const byFirstWord: Record<string, string[]> = {};

function register(spec: CommandSpec) {
  COMMANDS.push(spec);
  const first = spec.name.split(" ")[0];
  (byFirstWord[first] ||= []).push(spec.name);
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────
import { authFetch } from "./apiFetch";

async function getJSON(path: string): Promise<any> {
  const r = await authFetch(path);
  let data: any = {};
  try { data = await r.json(); } catch { /* non-JSON or empty body */ }
  if (!r.ok && data?.error === undefined) return { error: `HTTP ${r.status}` };
  return data;
}

async function postJSON(path: string, body: Record<string, any>): Promise<any> {
  const r = await authFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: any = {};
  try { data = await r.json(); } catch { /* non-JSON or empty body */ }
  if (!r.ok && data?.error === undefined) return { ok: "false", error: `HTTP ${r.status}` };
  return data;
}

// VectorStore Interface Roadmap Phase 1 -- the first real HTTP DELETE
// routes this backend has ever had (every prior destructive action in
// this file, e.g. "index drop"/"mqt drop"/"partition destroy", goes
// through postJSON() against a "/drop" or "/destroy"-suffixed POST route
// instead). Real DELETE was the deliberate choice for the three new
// /api/vec/* routes -- see docs/AeroSLS-VectorStore-Interface-Roadmap-v0.1.md
// Phase 1 for the full rationale -- so this mirrors postJSON()'s exact
// shape with the one method difference rather than routing vec deletes
// through a "/drop" POST path to match the older idiom.
async function deleteJSON(path: string, body: Record<string, any>): Promise<any> {
  const r = await authFetch(path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: any = {};
  try { data = await r.json(); } catch { /* non-JSON or empty body */ }
  if (!r.ok && data?.error === undefined) return { ok: "false", error: `HTTP ${r.status}` };
  return data;
}

const isOk = (data: any) => data?.ok === "true";
const errOf = (data: any): string | null =>
  typeof data?.error === "string" ? data.error : (data?.ok === "false" ? "request failed" : null);

// ─── Output formatting ───────────────────────────────────────────────────────
function cellStr(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function fmtTable(rows: Record<string, any>[] | undefined | null, columns?: string[]): string {
  if (!rows || rows.length === 0) return "(no rows)";
  const colSet = new Set<string>();
  rows.forEach(r => Object.keys(r).forEach(k => colSet.add(k)));
  const cols = columns || Array.from(colSet);
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => cellStr(r[c]).length)));
  const header = cols.map((c, i) => c.toUpperCase().padEnd(widths[i])).join("  ");
  const sep = widths.map(w => "-".repeat(w)).join("  ");
  const body = rows.map(r => cols.map((c, i) => cellStr(r[c]).padEnd(widths[i])).join("  "));
  return [header, sep, ...body, "", `${rows.length} row${rows.length === 1 ? "" : "s"}`].join("\n");
}

function fmtKV(obj: Record<string, any>, skip: string[] = []): string {
  return Object.entries(obj)
    .filter(([k]) => !skip.includes(k))
    .map(([k, v]) => `${k}: ${cellStr(v)}`)
    .join("\n");
}

const ok = (text: string): CommandResult => ({ text: `✔ ${text}` });
const err = (text: string): CommandResult => ({ text: `✖ ${text}`, isError: true });

// ─── Arg parsing helpers ────────────────────────────────────────────────────
// Plain whitespace split (no quote-awareness -- commands that need a
// free-text tail, like `sql`/`agent run`/`workflow run`, take the raw
// remainder of the line instead of re-splitting it).
function words(rest: string): string[] {
  return rest.trim().length ? rest.trim().split(/\s+/) : [];
}

// Splits leading positional tokens off from trailing `key=value` tokens.
// `key=value` tokens may appear anywhere after the positional args; order
// among themselves doesn't matter.
function splitKV(rest: string): { pos: string[]; kv: Record<string, string> } {
  const kv: Record<string, string> = {};
  const pos: string[] = [];
  for (const w of words(rest)) {
    const eq = w.indexOf("=");
    if (eq > 0) kv[w.slice(0, eq)] = w.slice(eq + 1);
    else pos.push(w);
  }
  return { pos, kv };
}

// ─── Object catalog ──────────────────────────────────────────────────────────
const OBJ_TYPES: Record<string, number> = {
  SYSTEM_METADATA: 0, DB_TABLE: 1, DB_INDEX: 2, HEAP_BLOB: 3, SERVICE_PROCESS: 4,
  WEB_APP: 5, JOURNAL: 6, PROGRAM: 7, STREAM: 8, AGENT: 9, WORKFLOW: 10,
};
function resolveObjType(t: string): number | null {
  const n = Number(t);
  if (!Number.isNaN(n)) return n;
  const named = OBJ_TYPES[t.toUpperCase()];
  return named !== undefined ? named : null;
}

register({
  name: "ls", usage: "ls  |  ls objects",
  handler: async () => {
    const d = await getJSON("/api/objects");
    if (errOf(d)) return err(errOf(d)!);
    return { text: fmtTable(d.objects, ["name", "type", "tier", "pages", "uid"]) };
  },
});
register({
  name: "stat", usage: "stat <name>",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: stat <name>");
    const d = await getJSON(`/api/objects/${encodeURIComponent(name)}`);
    if (errOf(d)) return err(errOf(d)!);
    const records = d.records;
    delete d.records;
    let text = fmtKV(d);
    if (records?.length) text += "\n\nrecords:\n" + fmtTable(records, ["key", "value", "type"]);
    return { text };
  },
});
register({
  name: "valloc", usage: "valloc <name> <TYPE|type_int> <pages> [database]",
  handler: async (rest) => {
    const [name, type, pages, database] = words(rest);
    if (!name || !type || !pages) return err("usage: valloc <name> <TYPE|type_int> <pages> [database]");
    const typeNum = resolveObjType(type);
    if (typeNum === null) return err(`unknown type '${type}' -- try one of: ${Object.keys(OBJ_TYPES).join(", ")}, or a raw integer`);
    // VectorStore Gap Analysis §3: optional trailing database name tags the
    // new object's database_id at creation time -- the same catalog object
    // a "vec collection create" promotes, so tagging it here means
    // catalog_check_access()'s existing database-scoped grant check already
    // covers the resulting vector collection, no VectorStore-specific code
    // needed.
    const body: Record<string, unknown> = { name, type: typeNum, pages: parseInt(pages, 10) || 0 };
    if (database) body.database = database;
    const d = await postJSON("/api/valloc", body);
    if (!isOk(d)) return err(errOf(d) || "valloc failed");
    return ok(`allocated '${name}' — object_id=${d.object_id}`);
  },
});
register({
  name: "select", usage: "select <object>  (legacy KV record dump — for row-store tables use 'sql SELECT ...')",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: select <object>");
    const d = await getJSON(`/api/objects/${encodeURIComponent(name)}`);
    if (errOf(d)) return err(errOf(d)!);
    return { text: fmtTable(d.records, ["key", "value", "type"]) };
  },
});
register({
  name: "insert", usage: "insert <object> <key> <value>  (legacy KV record — for row-store tables use 'sql INSERT ...')",
  handler: async (rest) => {
    const [object, key, ...v] = words(rest);
    if (!object || !key || !v.length) return err("usage: insert <object> <key> <value>");
    const d = await postJSON("/api/record", { object, key, value: v.join(" "), op: "insert" });
    if (!isOk(d)) return err(errOf(d) || "insert failed");
    return ok(`inserted ${object}.${key}`);
  },
});
register({
  name: "update", usage: "update <object> <key> <value>",
  handler: async (rest) => {
    const [object, key, ...v] = words(rest);
    if (!object || !key || !v.length) return err("usage: update <object> <key> <value>");
    const d = await postJSON("/api/record", { object, key, value: v.join(" "), op: "update" });
    if (!isOk(d)) return err(errOf(d) || "update failed");
    return ok(`updated ${object}.${key}`);
  },
});
register({
  name: "delete", usage: "delete <object> <key>",
  destructive: true,
  handler: async (rest) => {
    const [object, key] = words(rest);
    if (!object || !key) return err("usage: delete <object> <key>");
    const d = await postJSON("/api/record", { object, key, value: "", op: "delete" });
    if (!isOk(d)) return err(errOf(d) || "delete failed");
    return ok(`deleted ${object}.${key}`);
  },
});

// ─── Schema / row-store tables / SQL ─────────────────────────────────────────
register({
  name: "schema set", usage: "schema set <table> <field> <STRING|UINT64|FLOAT|BOOL>",
  handler: async (rest) => {
    const [table, field, type] = words(rest);
    if (!table || !field || !type) return err("usage: schema set <table> <field> <STRING|UINT64|FLOAT|BOOL>");
    const d = await postJSON("/api/schema", { name: table, columns: [{ name: field, type: type.toUpperCase() }] });
    if (!isOk(d)) return err(errOf(d) || "schema set failed");
    return ok(`column '${field}' set on '${table}'`);
  },
});
register({
  name: "schema show", usage: "schema show <table>",
  handler: async (rest) => {
    const [table] = words(rest);
    if (!table) return err("usage: schema show <table>");
    const d = await getJSON(`/api/tables/${encodeURIComponent(table)}/schema`);
    if (errOf(d)) return err(errOf(d)!);
    return { text: fmtTable(d.columns, ["name", "type"]) };
  },
});
register({
  name: "table create", usage: "table create <name>  (after 'valloc <name> DB_TABLE ...' + 'schema set ...')",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: table create <name>");
    const d = await postJSON("/api/tables", { name });
    if (!isOk(d)) return err(errOf(d) || "table create failed");
    return ok(`'${name}' promoted to row-store table`);
  },
});
register({
  name: "sql", usage: "sql <statement>  (one autocommit statement, e.g. sql SELECT * FROM users)",
  handler: async (rest) => {
    if (!rest.trim()) return err("usage: sql <statement>");
    const d = await postJSON("/api/sql", { query: rest.trim() });
    if (!isOk(d)) return err(`${errOf(d) || "sql failed"}${d?.error_code !== undefined ? ` (code ${d.error_code})` : ""}`);
    if (d.columns) {
      const rows = (d.rows || []).map((r: string[]) => Object.fromEntries(d.columns.map((c: string, i: number) => [c, r[i]])));
      let text = fmtTable(rows, d.columns);
      if (d.truncated) text += "\n(truncated)";
      return { text };
    }
    return ok(`${d.affected_rows ?? 0} row(s) affected`);
  },
});
register({
  name: "query scan", usage: "query scan",
  handler: async () => {
    const d = await getJSON("/api/scan");
    if (errOf(d)) return err(errOf(d)!);
    return { text: fmtTable(d.objects, ["name", "type", "tier", "pages", "uid", "field_count"]) };
  },
});
register({
  name: "query", usage: "query <text>",
  handler: async (rest) => {
    if (!rest.trim()) return err("usage: query <text>");
    const d = await getJSON(`/api/query?q=${encodeURIComponent(rest.trim())}`);
    if (errOf(d)) return err(errOf(d)!);
    return { text: fmtTable(d.data?.objects, ["name", "type", "tier", "pages", "uid", "field_count"]) };
  },
});

// ─── Storage tiers ────────────────────────────────────────────────────────────
register({
  name: "tier list", usage: "tier list",
  handler: async () => {
    const d = await getJSON("/api/tiers");
    if (errOf(d)) return err(errOf(d)!);
    const rows = ["l1_cache", "l2_dram", "l3_ssd", "l4_archive"].flatMap(
      tier => (d[tier] || []).map((o: any) => ({ tier, ...o }))
    );
    return { text: fmtTable(rows, ["tier", "name", "accesses", "idle"]) };
  },
});
// Navigator-Parity Gap Roadmap Phase 5b/5c + Storage Isolation Roadmap
// Phase 2: system-wide capacity/tier totals plus (Phase 2) a per-partition
// on-disk byte usage/quota breakdown, sourced from the same real counters
// "partition storagequotas" reads (in pages) but reported here in bytes.
register({
  name: "disk status", usage: "disk status",
  handler: async () => {
    const d = await getJSON("/api/disk");
    if (errOf(d)) return err(errOf(d)!);
    const tierRows = Object.entries(d?.tiers || {}).map(([tier, o]: [string, any]) => ({ tier, ...o }));
    const tierText = fmtTable(tierRows, ["tier", "bytes_used", "object_count"]);
    const partText = fmtTable(d?.partitions, ["partition_id", "disk_bytes_used", "disk_bytes_quota"]);
    return { text: `capacity_bytes: ${d?.capacity_bytes ?? "?"}\n\n${tierText}\n${partText}` };
  },
});

// ─── Transactions ─────────────────────────────────────────────────────────────
register({ name: "tx begin", usage: "tx begin", handler: async () => {
  const d = await postJSON("/api/tx/begin", {});
  if (!isOk(d)) return err(errOf(d) || "tx begin failed");
  return ok(`transaction started — tx_id=${d.tx_id}`);
}});
register({ name: "tx commit", usage: "tx commit", handler: async () => {
  const d = await postJSON("/api/tx/commit", {});
  if (!isOk(d)) return err(errOf(d) || "tx commit failed");
  return ok("transaction committed");
}});
register({ name: "tx rollback", usage: "tx rollback", handler: async () => {
  const d = await postJSON("/api/tx/rollback", {});
  if (!isOk(d)) return err(errOf(d) || "tx rollback failed");
  return ok("transaction rolled back");
}});

// ─── Cursors ──────────────────────────────────────────────────────────────────
register({
  name: "cursor open", usage: "cursor open <table> [where=<field>] [eq=<value>] [order=<field>]",
  handler: async (rest) => {
    const { pos, kv } = splitKV(rest);
    if (!pos[0]) return err("usage: cursor open <table> [where=<field>] [eq=<value>] [order=<field>]");
    const d = await postJSON("/api/cursor/open", { table: pos[0], where: kv.where || "", eq: kv.eq || "", order: kv.order || "" });
    if (!isOk(d)) return err(errOf(d) || "cursor open failed");
    return ok(`cursor opened — id=${d.cursor_id}`);
  },
});
register({
  name: "cursor fetch", usage: "cursor fetch <id> [n]",
  handler: async (rest) => {
    const [id, n] = words(rest);
    if (!id) return err("usage: cursor fetch <id> [n]");
    const d = await getJSON(`/api/cursor/fetch?id=${encodeURIComponent(id)}&n=${encodeURIComponent(n || "10")}`);
    if (errOf(d)) return err(errOf(d)!);
    let text = fmtTable(d.rows, ["key", "value"]);
    if (d.done) text += "\n(cursor exhausted)";
    return { text };
  },
});
register({
  name: "cursor close", usage: "cursor close <id>",
  handler: async (rest) => {
    const [id] = words(rest);
    if (!id) return err("usage: cursor close <id>");
    const d = await getJSON(`/api/cursor/close?id=${encodeURIComponent(id)}`);
    if (errOf(d)) return err(errOf(d)!);
    return ok(`cursor ${id} closed`);
  },
});
register({
  name: "cursor list", usage: "cursor list",
  handler: async () => {
    const d = await getJSON("/api/cursors");
    return { text: fmtTable(Array.isArray(d) ? d : d?.cursors, ["id", "table", "where", "eq", "order", "pos", "done"]) };
  },
});

// ─── Indexes ──────────────────────────────────────────────────────────────────
register({
  name: "index create", usage: "index create <name> <table> <field>",
  handler: async (rest) => {
    const [name, table, field] = words(rest);
    if (!name || !table || !field) return err("usage: index create <name> <table> <field>");
    const d = await postJSON("/api/index/create", { name, table, field });
    if (!isOk(d)) return err(errOf(d) || "index create failed");
    return ok(`index '${name}' created on ${table}.${field}`);
  },
});
register({
  name: "index drop", usage: "index drop <name>", destructive: true,
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: index drop <name>");
    const d = await postJSON("/api/index/drop", { name });
    if (!isOk(d)) return err(errOf(d) || "index drop failed");
    return ok(`index '${name}' dropped`);
  },
});
register({
  name: "index rebuild", usage: "index rebuild <name>",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: index rebuild <name>");
    const d = await postJSON("/api/index/rebuild", { name });
    if (!isOk(d)) return err(errOf(d) || "index rebuild failed");
    return ok(`index '${name}' rebuilt`);
  },
});
register({
  name: "index list", usage: "index list",
  handler: async () => {
    const d = await getJSON("/api/indexes");
    return { text: fmtTable(Array.isArray(d) ? d : d?.indexes, ["name", "table", "field", "entries"]) };
  },
});
register({
  name: "index scan", usage: "index scan <name> <value>",
  handler: async (rest) => {
    const [name, value] = words(rest);
    if (!name || !value) return err("usage: index scan <name> <value>");
    const d = await getJSON(`/api/index/${encodeURIComponent(name)}?q=${encodeURIComponent(value)}`);
    if (errOf(d)) return err(errOf(d)!);
    return { text: d.hit ? `hit — key=${d.key}` : "no match" };
  },
});

// ─── Constraints ──────────────────────────────────────────────────────────────
register({
  name: "constraint add", usage: "constraint add <table> <field> <UNIQUE|NOT_NULL|REFERENCE|RANGE> [ref=<table.field>] [min=<n>] [max=<n>]",
  handler: async (rest) => {
    const { pos, kv } = splitKV(rest);
    const [table, field, type] = pos;
    if (!table || !field || !type) return err("usage: constraint add <table> <field> <UNIQUE|NOT_NULL|REFERENCE|RANGE> [ref=] [min=] [max=]");
    const d = await postJSON("/api/constraint/add", { table, field, type: type.toUpperCase(), ref: kv.ref || "", min: kv.min || "", max: kv.max || "" });
    if (!isOk(d)) return err(errOf(d) || "constraint add failed");
    return ok(`constraint added: ${table}.${field} ${type.toUpperCase()}`);
  },
});
register({
  name: "constraint remove", usage: "constraint remove <table> <field> <type>", destructive: true,
  handler: async (rest) => {
    const [table, field, type] = words(rest);
    if (!table || !field || !type) return err("usage: constraint remove <table> <field> <type>");
    const d = await postJSON("/api/constraint/remove", { table, field, type: type.toUpperCase() });
    if (!isOk(d)) return err(errOf(d) || "constraint remove failed");
    return ok(`constraint removed: ${table}.${field} ${type.toUpperCase()}`);
  },
});
register({
  name: "constraint list", usage: "constraint list [table]",
  handler: async (rest) => {
    const [table] = words(rest);
    const d = await getJSON(table ? `/api/constraints?table=${encodeURIComponent(table)}` : "/api/constraints");
    return { text: fmtTable(Array.isArray(d) ? d : d?.constraints, ["table", "field", "type", "min", "max", "ref"]) };
  },
});

// ─── Journals ─────────────────────────────────────────────────────────────────
register({
  name: "journal attach", usage: "journal attach <journal> <table>",
  handler: async (rest) => {
    const [journal, table] = words(rest);
    if (!journal || !table) return err("usage: journal attach <journal> <table>");
    const d = await postJSON("/api/journal/attach", { journal, table });
    if (!isOk(d)) return err(errOf(d) || "journal attach failed");
    return ok(`'${journal}' attached to '${table}'`);
  },
});
register({
  name: "journal detach", usage: "journal detach <journal> <table>", destructive: true,
  handler: async (rest) => {
    const [journal, table] = words(rest);
    if (!journal || !table) return err("usage: journal detach <journal> <table>");
    const d = await postJSON("/api/journal/detach", { journal, table });
    if (!isOk(d)) return err(errOf(d) || "journal detach failed");
    return ok(`'${journal}' detached from '${table}'`);
  },
});
register({
  name: "journal list", usage: "journal list",
  handler: async () => {
    const d = await getJSON("/api/journals");
    return { text: fmtTable(Array.isArray(d) ? d : d?.journals, ["journal", "table"]) };
  },
});
register({
  name: "journal dump", usage: "journal dump <name> [since]",
  handler: async (rest) => {
    const [name, since] = words(rest);
    if (!name) return err("usage: journal dump <name> [since]");
    const path = since ? `/api/journal/${encodeURIComponent(name)}?since=${encodeURIComponent(since)}` : `/api/journal/${encodeURIComponent(name)}`;
    const d = await getJSON(path);
    if (errOf(d)) return err(errOf(d)!);
    return { text: fmtTable(Array.isArray(d) ? d : [], ["seq", "type", "object", "key", "before", "after", "tx", "committed"]) };
  },
});

// ─── MQTs / aggregate ─────────────────────────────────────────────────────────
register({
  name: "mqt create", usage: "mqt create <name> <table> <COUNT|SUM|AVG|MIN|MAX> [field=<f>] [where=<f>] [eq=<v>] [group_by=<f>]",
  handler: async (rest) => {
    const { pos, kv } = splitKV(rest);
    const [name, table, fn] = pos;
    if (!name || !table || !fn) return err("usage: mqt create <name> <table> <COUNT|SUM|AVG|MIN|MAX> [field=] [where=] [eq=] [group_by=]");
    const d = await postJSON("/api/mqt/create", { name, table, fn: fn.toUpperCase(), field: kv.field || "", where: kv.where || "", eq: kv.eq || "", group_by: kv.group_by || "" });
    if (!isOk(d)) return err(errOf(d) || "mqt create failed");
    return ok(`MQT '${name}' created`);
  },
});
register({
  name: "mqt drop", usage: "mqt drop <name>", destructive: true,
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: mqt drop <name>");
    const d = await postJSON("/api/mqt/drop", { name });
    if (!isOk(d)) return err(errOf(d) || "mqt drop failed");
    return ok(`MQT '${name}' dropped`);
  },
});
register({
  name: "mqt refresh", usage: "mqt refresh <name>",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: mqt refresh <name>");
    const d = await postJSON("/api/mqt/refresh", { name });
    if (!isOk(d)) return err(errOf(d) || "mqt refresh failed");
    return ok(`MQT '${name}' refreshed`);
  },
});
register({
  name: "mqt list", usage: "mqt list",
  handler: async () => {
    const d = await getJSON("/api/mqts");
    return { text: fmtTable(Array.isArray(d) ? d : d?.mqts, ["name", "base_table", "fn", "field", "group_by", "where"]) };
  },
});
register({
  name: "mqt scan", usage: "mqt scan <name>",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: mqt scan <name>");
    const d = await getJSON(`/api/mqt/${encodeURIComponent(name)}`);
    if (errOf(d)) return err(errOf(d)!);
    const records = d.records;
    delete d.records;
    let text = fmtKV(d);
    if (records?.length) text += "\n\n" + fmtTable(records, ["key", "value", "type"]);
    return { text };
  },
});
register({
  name: "aggregate", usage: "aggregate <table> [<COUNT|SUM|AVG|MIN|MAX>] [field=] [where=] [eq=] [group_by=] [order_by=] [order=ASC|DESC] [having=<n>]",
  handler: async (rest) => {
    const { pos, kv } = splitKV(rest);
    const [table, fn] = pos;
    if (!table) return err("usage: aggregate <table> [<COUNT|SUM|AVG|MIN|MAX>] [field=] [where=] [eq=] [group_by=] [order_by=] [order=] [having=]");
    const d = await postJSON("/api/aggregate", {
      table, fn: (fn || "").toUpperCase(), field: kv.field || "", where: kv.where || "", eq: kv.eq || "",
      group_by: kv.group_by || "", order_by: kv.order_by || "", order: (kv.order || "ASC").toUpperCase(),
      having: kv.having ? parseInt(kv.having, 10) : 0,
    });
    if (errOf(d)) return err(errOf(d)!);
    return { text: fmtTable(d.rows, undefined) };
  },
});

// ─── Vector store ─────────────────────────────────────────────────────────────
function parseVector(s: string): number[] {
  return s.split(",").map(x => parseFloat(x.trim())).filter(x => !Number.isNaN(x));
}
register({
  name: "vec create", usage: "vec create <name> <dimension>",
  handler: async (rest) => {
    const [name, dim] = words(rest);
    if (!name || !dim) return err("usage: vec create <name> <dimension>");
    const d = await postJSON("/api/vec/collections", { name, dimension: parseInt(dim, 10) || 0 });
    if (!isOk(d)) return err(errOf(d) || "vec create failed");
    return ok(`collection '${name}' created`);
  },
});
register({
  name: "vec list", usage: "vec list",
  handler: async () => {
    const d = await getJSON("/api/vec/collections");
    return { text: fmtTable(d?.collections, ["name", "dimension", "entry_count", "page_count"]) };
  },
});
register({
  name: "vec insert", usage: "vec insert <collection> <external_id> <v1,v2,v3,...>",
  handler: async (rest) => {
    const [collection, extId, vecStr] = words(rest);
    if (!collection || !extId || !vecStr) return err("usage: vec insert <collection> <external_id> <v1,v2,v3,...>");
    const d = await postJSON("/api/vec/insert", { collection, external_id: parseInt(extId, 10), values: parseVector(vecStr) });
    if (errOf(d)) return err(errOf(d)!);
    return ok(`inserted — page_id=${d.page_id} slot=${d.slot_index}`);
  },
});
register({
  name: "vec embed-insert", usage: "vec embed-insert <collection> <external_id> [endpoint=] [port=] [model=] <prompt text...>",
  handler: async (rest) => {
    const promptIdx = rest.search(/\bprompt=/);
    let head = rest, prompt = "";
    if (promptIdx >= 0) { head = rest.slice(0, promptIdx); prompt = rest.slice(promptIdx + "prompt=".length); }
    const { pos, kv } = splitKV(head);
    const [collection, extId] = pos;
    if (!collection || !extId || !prompt.trim()) return err("usage: vec embed-insert <collection> <external_id> [endpoint=] [port=] [model=] prompt=<text>");
    const d = await postJSON("/api/vec/embed-insert", {
      collection, external_id: parseInt(extId, 10), prompt: prompt.trim(),
      endpoint_ip: kv.endpoint || "127.0.0.1", port: kv.port ? parseInt(kv.port, 10) : 11434, model: kv.model || "nomic-embed-text",
    });
    if (errOf(d)) return err(errOf(d)!);
    return ok(`embedded + inserted (ollama_status=${d.ollama_status}, insert_status=${d.insert_status})`);
  },
});
register({
  name: "vec search", usage: "vec search <collection> <v1,v2,...> [metric=cosine|l2] [k=10]",
  handler: async (rest) => {
    const { pos, kv } = splitKV(rest);
    const [collection, vecStr] = pos;
    if (!collection || !vecStr) return err("usage: vec search <collection> <v1,v2,...> [metric=] [k=]");
    const d = await postJSON("/api/vec/search", { collection, query: parseVector(vecStr), metric: kv.metric || "cosine", k: kv.k ? parseInt(kv.k, 10) : 10 });
    if (errOf(d)) return err(errOf(d)!);
    let text = fmtTable(d.matches, ["external_id", "page_id", "slot_index", "distance"]);
    if (d.truncated) text += "\n(truncated)";
    return { text };
  },
});
register({
  name: "vec search-text",
  usage: "vec search-text <collection> [endpoint=] [port=] [model=] [metric=cosine|l2] [k=10] prompt=<query text>",
  handler: async (rest) => {
    // Same prompt= marker convention as "vec embed-insert" above, not the
    // bare-trailing-text shape "agent run" uses -- a free-text query can
    // itself contain "=" (e.g. "revenue = cost + margin"), which splitKV()
    // would otherwise misparse as a stray kv token. Consistency with the
    // one other command in this file that already takes free-form text
    // alongside kv flags, for the same real reason that command adopted it.
    const promptIdx = rest.search(/\bprompt=/);
    let head = rest, prompt = "";
    if (promptIdx >= 0) { head = rest.slice(0, promptIdx); prompt = rest.slice(promptIdx + "prompt=".length); }
    const { pos, kv } = splitKV(head);
    const [collection] = pos;
    if (!collection || !prompt.trim()) return err("usage: vec search-text <collection> [endpoint=] [port=] [model=] [metric=] [k=] prompt=<text>");
    const d = await postJSON("/api/vec/embed-search", {
      collection, prompt: prompt.trim(),
      endpoint_ip: kv.endpoint || "127.0.0.1", port: kv.port ? parseInt(kv.port, 10) : 11434, model: kv.model || "nomic-embed-text",
      metric: kv.metric || "cosine", k: kv.k ? parseInt(kv.k, 10) : 10,
    });
    // ok:"false" here means the embed step itself failed (ollama_status !=
    // 0) -- the syscall adapter never attempts the search in that case, same
    // "distinguish denial from absence" posture "vec embed-insert" already
    // established for its own two-stage ollama_status/insert_status split.
    if (errOf(d)) return err(`${errOf(d)} (ollama_status=${d.ollama_status})`);
    let text = fmtTable(d.matches, ["external_id", "page_id", "slot_index", "distance"]);
    if (d.truncated) text += "\n(truncated)";
    return { text };
  },
});
register({
  name: "vec join", usage: "vec join <table> <id_column> <matches JSON array>  (advanced — pass the 'matches' array a prior 'vec search' printed, as JSON)",
  handler: async (rest) => {
    const bracket = rest.indexOf("[");
    if (bracket < 0) return err("usage: vec join <table> <id_column> <matches JSON array>");
    const [table, idCol] = words(rest.slice(0, bracket));
    if (!table || !idCol) return err("usage: vec join <table> <id_column> <matches JSON array>");
    let matches: any[];
    try { matches = JSON.parse(rest.slice(bracket)); } catch { return err("could not parse matches as JSON"); }
    const d = await postJSON("/api/vec/join", { table, id_column: idCol, matches });
    if (errOf(d)) return err(errOf(d)!);
    let text = fmtTable((d.results || []).map((r: any) => ({ external_id: r.external_id, row: r.row?.join(", ") })), ["external_id", "row"]);
    if (d.truncated) text += "\n(truncated)";
    return { text };
  },
});
register({
  name: "vec index create", usage: "vec index create <name> <collection> [metric=cosine|l2]",
  handler: async (rest) => {
    const { pos, kv } = splitKV(rest);
    const [name, collection] = pos;
    if (!name || !collection) return err("usage: vec index create <name> <collection> [metric=]");
    const d = await postJSON("/api/vec/indexes", { name, collection, metric: kv.metric || "cosine" });
    if (!isOk(d)) return err(errOf(d) || "vec index create failed");
    return ok(`vector index '${name}' created`);
  },
});
register({
  name: "vec index list", usage: "vec index list",
  handler: async () => {
    const d = await getJSON("/api/vec/indexes");
    return { text: fmtTable(d?.indexes, ["name", "collection", "metric", "active_count", "node_count"]) };
  },
});
register({
  name: "vec index search", usage: "vec index search <index> <v1,v2,...> [k=10] [ef=]",
  handler: async (rest) => {
    const { pos, kv } = splitKV(rest);
    const [index, vecStr] = pos;
    if (!index || !vecStr) return err("usage: vec index search <index> <v1,v2,...> [k=] [ef=]");
    const k = kv.k ? parseInt(kv.k, 10) : 10;
    const d = await postJSON("/api/vec/index/search", { index, query: parseVector(vecStr), k, ef: kv.ef ? parseInt(kv.ef, 10) : k });
    if (errOf(d)) return err(errOf(d)!);
    let text = fmtTable(d.matches, ["external_id", "page_id", "slot_index", "distance"]);
    if (d.truncated) text += "\n(truncated)";
    return { text };
  },
});
register({
  name: "vec index search-text",
  usage: "vec index search-text <index> [endpoint=] [port=] [model=] [k=10] [ef=] prompt=<query text>",
  handler: async (rest) => {
    // Same prompt= marker convention as "vec search-text" above -- see that
    // command's own comment for why (a free-text query can contain "=").
    // No metric= kv here, matching "vec index search"'s own body shape --
    // an HNSW index's metric is fixed at creation time, not chosen per query.
    const promptIdx = rest.search(/\bprompt=/);
    let head = rest, prompt = "";
    if (promptIdx >= 0) { head = rest.slice(0, promptIdx); prompt = rest.slice(promptIdx + "prompt=".length); }
    const { pos, kv } = splitKV(head);
    const [index] = pos;
    if (!index || !prompt.trim()) return err("usage: vec index search-text <index> [endpoint=] [port=] [model=] [k=] [ef=] prompt=<text>");
    const k = kv.k ? parseInt(kv.k, 10) : 10;
    const d = await postJSON("/api/vec/index/embed-search", {
      index, prompt: prompt.trim(),
      endpoint_ip: kv.endpoint || "127.0.0.1", port: kv.port ? parseInt(kv.port, 10) : 11434, model: kv.model || "nomic-embed-text",
      k, ef: kv.ef ? parseInt(kv.ef, 10) : k,
    });
    if (errOf(d)) return err(`${errOf(d)} (ollama_status=${d.ollama_status})`);
    let text = fmtTable(d.matches, ["external_id", "page_id", "slot_index", "distance"]);
    if (d.truncated) text += "\n(truncated)";
    return { text };
  },
});
register({
  // Not marked destructive -- matches "index rebuild"'s own (row-store
  // B-tree) precedent exactly, which this command's name deliberately
  // mirrors for the same operation on the vector side. Clears and
  // repopulates an index's contents from its live collection, but never
  // touches the collection itself or drops the index -- a repair/refresh
  // action, not a data-loss risk the way "vec index drop" is.
  name: "vec index rebuild", usage: "vec index rebuild <name>",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: vec index rebuild <name>");
    const d = await postJSON("/api/vec/index/rebuild", { index: name });
    if (!isOk(d)) return err(errOf(d) || "vec index rebuild failed");
    return ok(`vector index '${name}' rebuilt`);
  },
});
register({
  name: "vec delete", usage: "vec delete <collection> <page_id> <slot_index>", destructive: true,
  handler: async (rest) => {
    const [collection, pageId, slotIndex] = words(rest);
    if (!collection || !pageId || !slotIndex) return err("usage: vec delete <collection> <page_id> <slot_index>  (page_id/slot_index come from a prior 'vec insert' or 'vec search' result, not external_id)");
    const d = await deleteJSON("/api/vec/vector", { collection, page_id: parseInt(pageId, 10), slot_index: parseInt(slotIndex, 10) });
    if (!isOk(d)) return err(errOf(d) || "vec delete failed");
    return ok(`vector deleted from '${collection}' (page_id=${pageId}, slot_index=${slotIndex})`);
  },
});
register({
  name: "vec collection drop", usage: "vec collection drop <name>", destructive: true,
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: vec collection drop <name>");
    const d = await deleteJSON("/api/vec/collections", { name });
    if (!isOk(d)) return err(errOf(d) || "vec collection drop failed");
    return ok(`collection '${name}' dropped`);
  },
});
register({
  // VectorStore Gap Analysis §1.3: opt-in external_id uniqueness. Not
  // destructive -- toggling never deletes or scans existing data, only
  // changes what happens on the NEXT insert (matches vecstore_set_unique_
  // external_id()'s own kernel-side doc comment).
  name: "vec collection unique", usage: "vec collection unique <name> <on|off>",
  handler: async (rest) => {
    const [name, onoff] = words(rest);
    if (!name || !onoff) return err("usage: vec collection unique <name> <on|off>");
    const enabled = onoff.toLowerCase() === "on" ? 1 : 0;
    const d = await postJSON("/api/vec/collections/unique", { name, enabled });
    if (!isOk(d)) return err(errOf(d) || "vec collection unique failed");
    return ok(`collection '${name}' external_id uniqueness -> ${enabled ? "ON" : "OFF"}`);
  },
});
register({
  // VectorStore Gap Analysis §3: generic retag reaching any catalog
  // object, including an already-promoted vector collection (which has no
  // ALTER verb of its own but shares object_catalog[] with SQL tables).
  // "none" clears the tag back to unassigned.
  name: "object set database", usage: "object set database <name> <database|none>",
  handler: async (rest) => {
    const [name, database] = words(rest);
    if (!name || !database) return err("usage: object set database <name> <database|none>");
    const body: Record<string, unknown> = { name };
    if (database.toLowerCase() !== "none") body.database = database;
    const d = await postJSON("/api/objects/database", body);
    if (!isOk(d)) return err(errOf(d) || "object set database failed");
    return ok(`object '${name}' database -> ${d.database ?? "(none)"}`);
  },
});
register({
  name: "vec index drop", usage: "vec index drop <name>", destructive: true,
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: vec index drop <name>");
    const d = await deleteJSON("/api/vec/indexes", { name });
    if (!isOk(d)) return err(errOf(d) || "vec index drop failed");
    return ok(`vector index '${name}' dropped`);
  },
});

// ─── Partitions ───────────────────────────────────────────────────────────────
register({
  name: "partition create", usage: "partition create <name>",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: partition create <name>");
    const d = await postJSON("/api/partitions", { name });
    if (!isOk(d)) return err(errOf(d) || "partition create failed");
    return ok(`partition '${name}' created — id=${d.partition_id}`);
  },
});
register({
  name: "partition list", usage: "partition list",
  handler: async () => {
    const d = await getJSON("/api/partitions");
    return { text: fmtTable(d?.partitions, ["id", "name", "frame_usage", "frame_quota", "quota_unlimited"]) };
  },
});
register({
  name: "partition assign", usage: "partition assign <uid> <partition_id>",
  handler: async (rest) => {
    const [uid, pid] = words(rest);
    if (!uid || !pid) return err("usage: partition assign <uid> <partition_id>");
    const d = await postJSON("/api/partition/assign", { uid: parseInt(uid, 10), partition_id: parseInt(pid, 10) });
    if (!isOk(d)) return err(errOf(d) || "partition assign failed");
    return ok(`uid ${uid} assigned to partition ${pid}`);
  },
});
register({
  name: "partition destroy", usage: "partition destroy <partition_id>", destructive: true,
  handler: async (rest) => {
    const [pid] = words(rest);
    if (!pid) return err("usage: partition destroy <partition_id>");
    const d = await postJSON("/api/partition/destroy", { partition_id: parseInt(pid, 10) });
    if (!isOk(d)) return err(errOf(d) || "partition destroy failed");
    return ok(`partition ${pid} destroyed`);
  },
});
register({
  name: "partition pause", usage: "partition pause <partition_id>",
  handler: async (rest) => {
    const [pid] = words(rest);
    if (!pid) return err("usage: partition pause <partition_id>");
    const d = await postJSON("/api/partition/pause", { partition_id: parseInt(pid, 10) });
    if (!isOk(d)) return err(errOf(d) || "partition pause failed");
    return ok(`partition ${pid} paused`);
  },
});
register({
  name: "partition resume", usage: "partition resume <partition_id>",
  handler: async (rest) => {
    const [pid] = words(rest);
    if (!pid) return err("usage: partition resume <partition_id>");
    const d = await postJSON("/api/partition/resume", { partition_id: parseInt(pid, 10) });
    if (!isOk(d)) return err(errOf(d) || "partition resume failed");
    return ok(`partition ${pid} resumed`);
  },
});
register({
  name: "partition quota", usage: "partition quota <partition_id> <frame_quota|0=unlimited>",
  handler: async (rest) => {
    const [pid, quota] = words(rest);
    if (!pid || !quota) return err("usage: partition quota <partition_id> <frame_quota|0=unlimited>");
    const d = await postJSON("/api/partition/quota", { partition_id: parseInt(pid, 10), frame_quota: parseInt(quota, 10) || 0 });
    if (!isOk(d)) return err(errOf(d) || "partition quota failed");
    return ok(`partition ${pid} quota set to ${quota}`);
  },
});
register({
  name: "partition quotas", usage: "partition quotas",
  handler: async () => {
    const d = await getJSON("/api/partition/quotas");
    return { text: fmtTable(d?.quotas, ["partition_id", "usage", "quota", "unlimited"]) };
  },
});
// Weighted CPU Scheduling (Multitenant Isolation Gap Analysis §5/§7 item 8):
// mirrors "partition quota"/"partition quotas" exactly, just against the
// CPU scheduler's weight pair instead of the RAM frame-quota pair.
register({
  name: "partition cpuweight", usage: "partition cpuweight <partition_id> <weight|0=default 1>",
  handler: async (rest) => {
    const [pid, weight] = words(rest);
    if (!pid || !weight) return err("usage: partition cpuweight <partition_id> <weight|0=default 1>");
    const d = await postJSON("/api/partition/cpuweight", { partition_id: parseInt(pid, 10), weight: parseInt(weight, 10) || 0 });
    if (!isOk(d)) return err(errOf(d) || "partition cpuweight failed");
    return ok(`partition ${pid} CPU weight set to ${weight}`);
  },
});
register({
  name: "partition cpuweights", usage: "partition cpuweights",
  handler: async () => {
    const d = await getJSON("/api/partition/cpuweights");
    return { text: fmtTable(d?.cpuweights, ["partition_id", "weight"]) };
  },
});
// Storage Isolation Roadmap Phase 1: per-partition on-disk page quota,
// rowstore+vecstore combined (kernel/storage_quota.c) — same shape again.
register({
  name: "partition storagequota", usage: "partition storagequota <partition_id> <page_quota|0=unlimited>",
  handler: async (rest) => {
    const [pid, pages] = words(rest);
    if (!pid || !pages) return err("usage: partition storagequota <partition_id> <page_quota|0=unlimited>");
    const d = await postJSON("/api/partition/storagequota", { partition_id: parseInt(pid, 10), page_quota: parseInt(pages, 10) || 0 });
    if (!isOk(d)) return err(errOf(d) || "partition storagequota failed");
    return ok(`partition ${pid} on-disk page quota set to ${pages}`);
  },
});
register({
  name: "partition storagequotas", usage: "partition storagequotas",
  handler: async () => {
    const d = await getJSON("/api/partition/storagequotas");
    return { text: fmtTable(d?.storagequotas, ["partition_id", "page_usage", "page_quota"]) };
  },
});
// Multitenant Isolation Gap Analysis §5/§7 item 6: cumulative per-partition
// usage metering (HTTP requests, frame ticks) plus a live frame-usage gauge.
register({
  name: "usage", usage: "usage",
  handler: async () => {
    const d = await getJSON("/api/usage");
    if (errOf(d)) return err(errOf(d)!);
    return { text: fmtTable(d?.partitions, ["partition_id", "name", "http_requests_total", "frame_ticks_total", "frames_now"]) };
  },
});

// ─── Tenants ──────────────────────────────────────────────────────────────────
// Multitenant Isolation Gap Analysis §5/§7 item 1: the identity unifying a
// partition_id and a database_id under one named tenant.
register({
  name: "tenant create", usage: "tenant create <name>",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: tenant create <name>");
    const d = await postJSON("/api/tenants", { name });
    if (!isOk(d)) return err(errOf(d) || "tenant create failed");
    return ok(`tenant '${name}' created — id=${d.tenant_id}`);
  },
});
register({
  name: "tenant list", usage: "tenant list",
  handler: async () => {
    const d = await getJSON("/api/tenants");
    return { text: fmtTable(d?.tenants, ["id", "name", "partition_id", "database_id", "owner_uid"]) };
  },
});

// ─── Processes / programs ─────────────────────────────────────────────────────
register({
  name: "proc list", usage: "proc list",
  handler: async () => {
    const d = await getJSON("/api/processes");
    return { text: fmtTable(d?.processes, ["pid", "name", "state", "uid", "rip"]) };
  },
});
register({
  name: "program create", usage: "program create <name> <pages>",
  handler: async (rest) => {
    const [name, pages] = words(rest);
    if (!name || !pages) return err("usage: program create <name> <pages>");
    const d = await postJSON("/api/program/create", { name, pages: parseInt(pages, 10) || 0 });
    if (!isOk(d)) return err(errOf(d) || "program create failed");
    return ok(`program object '${name}' created — id=${d.object_id}`);
  },
});
register({
  name: "program upload", usage: "program upload <name> <hex-bytes>  (single-shot; large binaries should use the Program Manager tab)",
  handler: async (rest) => {
    const [name, hex] = words(rest);
    if (!name || !hex) return err("usage: program upload <name> <hex-bytes>");
    const d = await postJSON("/api/program/upload", { name, hex, offset: 0, last: 1 });
    if (!isOk(d)) return err(errOf(d) || "program upload failed");
    return ok(`${d.bytes_written} byte(s) written to '${name}'`);
  },
});
register({
  name: "program spawn", usage: "program spawn <name>",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: program spawn <name>");
    const d = await postJSON("/api/program/spawn", { name });
    if (!isOk(d)) return err(errOf(d) || "program spawn failed");
    return ok(`'${name}' spawned — pid=${d.pid}`);
  },
});

// ─── Streams ──────────────────────────────────────────────────────────────────
register({
  name: "stream create", usage: "stream create <name> [mime=application/octet-stream]",
  handler: async (rest) => {
    const { pos, kv } = splitKV(rest);
    const [name] = pos;
    if (!name) return err("usage: stream create <name> [mime=]");
    const d = await postJSON("/api/stream/create", { name, mime: kv.mime || "application/octet-stream" });
    if (!isOk(d) && d.error !== "already exists") return err(errOf(d) || "stream create failed");
    return ok(`stream '${name}' ready`);
  },
});
register({
  name: "stream upload", usage: "stream upload <name> <hex-bytes>  (single-shot; large files should use the Stream Library tab)",
  handler: async (rest) => {
    const [name, hex] = words(rest);
    if (!name || !hex) return err("usage: stream upload <name> <hex-bytes>");
    const d = await postJSON("/api/stream/upload", { name, hex, offset: 0, last: 1 });
    if (!isOk(d)) return err(errOf(d) || "stream upload failed");
    return ok(`${d.bytes_written} byte(s) written to '${name}'`);
  },
});

// ─── Agents ───────────────────────────────────────────────────────────────────
register({
  name: "agent create", usage: "agent create <name> <endpoint> <model> [tools=db_select,db_insert,...] prompt=<system prompt text>",
  handler: async (rest) => {
    const promptIdx = rest.search(/\bprompt=/);
    let head = rest, prompt = "";
    if (promptIdx >= 0) { head = rest.slice(0, promptIdx); prompt = rest.slice(promptIdx + "prompt=".length); }
    const { pos, kv } = splitKV(head);
    const [name, endpoint, model] = pos;
    if (!name || !endpoint || !model) return err("usage: agent create <name> <endpoint> <model> [tools=] prompt=<text>");
    const d = await postJSON("/api/agent/create", { name, endpoint, model, system_prompt: prompt.trim(), tools: kv.tools || "" });
    if (!isOk(d)) return err(errOf(d) || "agent create failed");
    return ok(`agent '${name}' created (tool_mask=0x${(d.tool_mask ?? 0).toString(16)})`);
  },
});
register({
  name: "agent list", usage: "agent list",
  handler: async () => {
    const d = await getJSON("/api/agents");
    return { text: fmtTable(d?.agents, ["name", "model", "state", "steps", "endpoint"]) };
  },
});
register({
  name: "agent status", usage: "agent status <name>",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: agent status <name>");
    const d = await getJSON(`/api/agent/${encodeURIComponent(name)}`);
    if (errOf(d)) return err(errOf(d)!);
    return { text: fmtKV(d) };
  },
});
register({
  name: "agent run", usage: "agent run <name> <message...>",
  handler: async (rest) => {
    const [name, ...rest2] = words(rest);
    if (!name || !rest2.length) return err("usage: agent run <name> <message...>");
    const d = await postJSON("/api/agent/run", { name, message: rest2.join(" ") });
    if (!isOk(d)) return err(errOf(d) || "agent run failed");
    return ok(`'${name}' completed ${d.steps} step(s) — see 'agent status ${name}' for the answer`);
  },
});
register({
  name: "agent schedule", usage: "agent schedule <name> <ticks> <message...>",
  handler: async (rest) => {
    const [name, ticks, ...msg] = words(rest);
    if (!name || !ticks || !msg.length) return err("usage: agent schedule <name> <ticks> <message...>");
    const d = await postJSON("/api/agent/schedule", { name, ticks: parseInt(ticks, 10) || 0, message: msg.join(" ") });
    if (!isOk(d)) return err(errOf(d) || "agent schedule failed");
    return ok(`'${name}' scheduled every ${ticks} ticks`);
  },
});
register({
  name: "agent unschedule", usage: "agent unschedule <name>",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: agent unschedule <name>");
    const d = await postJSON("/api/agent/unschedule", { name });
    if (!isOk(d)) return err(errOf(d) || "agent unschedule failed");
    return ok(`'${name}' unscheduled`);
  },
});
async function agentDrop(rest: string): Promise<CommandResult> {
  const [name] = words(rest);
  if (!name) return err("usage: agent kill <name>");
  const d = await postJSON("/api/agent/drop", { name });
  if (!isOk(d)) return err(errOf(d) || "agent kill failed");
  return ok(`agent '${name}' dropped`);
}
register({ name: "agent kill", usage: "agent kill <name>  (HTTP route: /api/agent/drop)", destructive: true, handler: agentDrop });
register({ name: "agent drop", usage: "agent drop <name>", destructive: true, handler: agentDrop });

// ─── Workflows ────────────────────────────────────────────────────────────────
register({
  name: "workflow create", usage: "workflow create <name> <shared_table> step=<agent>:<in>:<out> [step=... repeatable]",
  handler: async (rest) => {
    const { pos, kv } = splitKV(rest.replace(/\bstep=/g, "__step__="));
    // splitKV only keeps the LAST value per key; steps are repeatable, so
    // pull them out of the raw text directly instead of relying on kv.
    const steps = [...rest.matchAll(/\bstep=(\S+)/g)].map(m => m[1]);
    const [name, sharedTable] = pos;
    if (!name || !sharedTable || steps.length === 0) return err("usage: workflow create <name> <shared_table> step=<agent>:<in>:<out> [step=...]");
    const body: Record<string, any> = { name, shared_table: sharedTable, step_count: steps.length };
    steps.forEach((s, i) => {
      const [agent, inKey, outKey] = s.split(":");
      body[`step${i}_agent`] = agent || "";
      body[`step${i}_in`] = inKey || "";
      body[`step${i}_out`] = outKey || "";
    });
    void kv; // kv unused beyond step extraction above; steps read from raw text instead
    const d = await postJSON("/api/workflow/create", body);
    if (!isOk(d)) return err(errOf(d) || "workflow create failed");
    return ok(`workflow '${name}' created with ${d.steps} step(s)`);
  },
});
register({
  name: "workflow list", usage: "workflow list",
  handler: async () => {
    const d = await getJSON("/api/workflows");
    return { text: fmtTable(d?.workflows, ["name", "state", "steps", "current_step"]) };
  },
});
register({
  name: "workflow run", usage: "workflow run <name> <input...>",
  handler: async (rest) => {
    const [name, ...input] = words(rest);
    if (!name || !input.length) return err("usage: workflow run <name> <input...>");
    const d = await postJSON("/api/workflow/run", { name, input: input.join(" ") });
    if (!isOk(d)) return err(errOf(d) || "workflow run failed");
    return ok(`workflow '${name}' run — see 'workflow status ${name}'`);
  },
});
register({
  name: "workflow status", usage: "workflow status <name>",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: workflow status <name>");
    const d = await getJSON(`/api/workflow/${encodeURIComponent(name)}`);
    if (errOf(d)) return err(errOf(d)!);
    const steps = d.steps;
    delete d.steps;
    let text = fmtKV(d);
    if (steps?.length) text += "\n\n" + fmtTable(steps, ["agent", "input", "output"]);
    return { text };
  },
});

// ─── Misc / diagnostics ───────────────────────────────────────────────────────
register({
  name: "svc list", usage: "svc list",
  handler: async () => {
    const d = await getJSON("/api/services");
    return { text: fmtTable(d?.services, ["name", "pid", "port", "state", "reboots", "msgs"]) };
  },
});
register({
  name: "lock list", usage: "lock list",
  handler: async () => {
    const d = await getJSON("/api/locks");
    return { text: fmtTable(Array.isArray(d) ? d : [], ["tx", "type", "key"]) };
  },
});
register({
  name: "wal dump", usage: "wal dump",
  handler: async () => {
    const d = await getJSON("/api/wal");
    if (errOf(d)) return err(errOf(d)!);
    return { text: fmtTable(d.entries, ["id", "tx", "key", "state"]) };
  },
});
register({
  name: "simi info", usage: "simi info <name>",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: simi info <name>");
    const d = await getJSON(`/api/simi/${encodeURIComponent(name)}`);
    const entries = d.entries; const names = d.names;
    delete d.entries; delete d.names;
    let text = fmtKV(d);
    if (entries?.length) text += "\n\nentries:\n" + fmtTable(entries, ["name", "offset"]);
    if (names?.length) text += "\n\nnames: " + names.join(", ");
    return { text };
  },
});

// ─── Shell-Command JSON-Promotion Roadmap: formerly-legacy commands ─────────────
// All 28 of these used to be SHELL_FALLBACK_COMMANDS entries with no
// dedicated route, reachable only via the kernel's plain-text POST
// /api/shell/exec dispatch. Field names below were read directly out of
// each net/http.c handler's json_str/json_int calls, same verification
// standard as every command above.

register({
  // "login" was a session uid/gid switch in shell.c, but net/http.c always
  // reseeds identity from the bearer token on every request -- promoted as
  // a read-only identity check instead of a state-mutating (and inert)
  // impersonation call. See the block comment above this section.
  name: "login", usage: "login  (shows your real session identity -- the HTTP API always reseeds uid/role from your bearer token, so this can't switch users)",
  handler: async () => {
    const d = await getJSON("/api/session/whoami");
    if (errOf(d)) return err(errOf(d)!);
    return { text: fmtKV(d) };
  },
});
register({
  name: "role set", usage: "role set <uid> <SYSTEM_KERNEL|DB_ADMIN|APP_USER|GUEST>", destructive: true,
  handler: async (rest) => {
    const [uid, role] = words(rest);
    if (!uid || !role) return err("usage: role set <uid> <SYSTEM_KERNEL|DB_ADMIN|APP_USER|GUEST>");
    const d = await postJSON("/api/role/set", { uid: parseInt(uid, 10) || 0, role: role.toUpperCase() });
    if (!isOk(d)) return err(errOf(d) || "role set failed");
    return ok(`role set for uid ${uid}`);
  },
});
register({
  name: "grant", usage: "grant <uid> <object> <perm>", destructive: true,
  handler: async (rest) => {
    const [uid, object, perm] = words(rest);
    if (!uid || !object || !perm) return err("usage: grant <uid> <object> <perm>");
    const d = await postJSON("/api/grant", { uid: parseInt(uid, 10) || 0, object, perm });
    if (!isOk(d)) return err(errOf(d) || "grant failed");
    return ok(`granted '${perm}' on '${object}' to uid ${uid}`);
  },
});
register({
  name: "revoke", usage: "revoke <uid> <object> <perm>", destructive: true,
  handler: async (rest) => {
    const [uid, object, perm] = words(rest);
    if (!uid || !object || !perm) return err("usage: revoke <uid> <object> <perm>");
    const d = await postJSON("/api/revoke", { uid: parseInt(uid, 10) || 0, object, perm });
    if (!isOk(d)) return err(errOf(d) || "revoke failed");
    return ok(`revoked '${perm}' on '${object}' from uid ${uid}`);
  },
});
register({
  name: "chmod", usage: "chmod <name> <mask_hex>", destructive: true,
  handler: async (rest) => {
    const [name, mask] = words(rest);
    if (!name || !mask) return err("usage: chmod <name> <mask_hex>");
    const d = await postJSON("/api/chmod", { name, mask });
    if (!isOk(d)) return err(errOf(d) || "chmod failed");
    return ok(`'${name}' permission mask set to ${mask}`);
  },
});
register({
  name: "auth create", usage: "auth create <email> <uid> <SYSTEM_KERNEL|DB_ADMIN|APP_USER|GUEST> <password>  (requires DB_ADMIN+)", destructive: true,
  handler: async (rest) => {
    const [email, uid, role, password] = words(rest);
    if (!email || !uid || !role || !password) return err("usage: auth create <email> <uid> <SYSTEM_KERNEL|DB_ADMIN|APP_USER|GUEST> <password>");
    const d = await postJSON("/api/auth/create", { email, uid: parseInt(uid, 10) || 0, role: role.toUpperCase(), password });
    if (!isOk(d)) return err(errOf(d) || "auth create failed");
    // Plaintext token returned once, same as shell.c's own one-time "[AUTH]
    // Token: ..." print -- there's no other way to learn a freshly-created
    // account's token afterward (auth list only ever shows an 8-char preview).
    return ok(`account '${email}' created${d.token ? ` — token: ${d.token}` : ""}`);
  },
});
register({
  name: "auth list", usage: "auth list",
  handler: async () => {
    const d = await getJSON("/api/auth/tokens");
    return { text: fmtTable(d?.tokens, ["email", "uid", "role", "token_preview"]) };
  },
});
register({
  name: "auth revoke", usage: "auth revoke <email>  (requires DB_ADMIN+)", destructive: true,
  handler: async (rest) => {
    const [email] = words(rest);
    if (!email) return err("usage: auth revoke <email>");
    const d = await postJSON("/api/auth/revoke", { email });
    if (!isOk(d)) return err(errOf(d) || "auth revoke failed");
    return ok(`revoked token(s) for '${email}'`);
  },
});
register({
  name: "seal", usage: "seal <name> <password>",
  handler: async (rest) => {
    const [name, password] = words(rest);
    if (!name || !password) return err("usage: seal <name> <password>");
    const d = await postJSON("/api/seal", { name, password });
    if (!isOk(d)) return err(errOf(d) || "seal failed");
    return ok(`'${name}' sealed`);
  },
});
register({
  name: "svc crash", usage: "svc crash <name>", destructive: true,
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: svc crash <name>");
    const d = await postJSON("/api/svc/crash", { name });
    if (!isOk(d)) return err(errOf(d) || "svc crash failed");
    return ok(`'${name}' crashed`);
  },
});
register({
  name: "svc restart", usage: "svc restart <name>", destructive: true,
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: svc restart <name>");
    const d = await postJSON("/api/svc/restart", { name });
    if (!isOk(d)) return err(errOf(d) || "svc restart failed");
    return ok(`'${name}' restarted`);
  },
});
register({
  name: "proc kill", usage: "proc kill <pid>", destructive: true,
  handler: async (rest) => {
    const [pid] = words(rest);
    if (!pid) return err("usage: proc kill <pid>");
    const d = await postJSON("/api/proc/kill", { pid: parseInt(pid, 10) || 0 });
    if (!isOk(d)) return err(errOf(d) || "proc kill failed");
    return ok(`pid ${pid} killed`);
  },
});
register({
  name: "ipc post", usage: "ipc post <svc_name> <opcode_hex>",
  handler: async (rest) => {
    const [service, opcode] = words(rest);
    if (!service || !opcode) return err("usage: ipc post <svc_name> <opcode_hex>");
    const d = await postJSON("/api/ipc/post", { service, opcode });
    if (!isOk(d)) return err(errOf(d) || "ipc post failed");
    return ok(`posted ${opcode} to '${service}' (port ${d.port})`);
  },
});
register({
  name: "ipc stat", usage: "ipc stat",
  handler: async () => {
    // Genuinely-unexposed real ipc_stats + per-queue depth -- deliberately
    // NOT a mirror of shell.c's own "ipc stat", which is actually aliased
    // to the service list in syscall_dispatch.c ("combined view"). See
    // api_ipc_stat()'s own comment in net/http.c for the full rationale.
    const d = await getJSON("/api/ipc/stat");
    if (errOf(d)) return err(errOf(d)!);
    const queues = d.queues;
    delete d.queues;
    let text = fmtKV(d);
    if (queues?.length) text += "\n\nqueues:\n" + fmtTable(queues, ["port", "depth"]);
    return { text };
  },
});
register({
  name: "journal create", usage: "journal create <name>",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: journal create <name>");
    const d = await postJSON("/api/journal", { name });
    if (!isOk(d)) return err(errOf(d) || "journal create failed");
    return ok(`journal '${name}' created — object_id=${d.object_id}`);
  },
});
register({
  name: "journal purge", usage: "journal purge <name>", destructive: true,
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: journal purge <name>");
    const d = await postJSON("/api/journal/purge", { name });
    if (!isOk(d)) return err(errOf(d) || "journal purge failed");
    return ok(`journal '${name}' purged`);
  },
});
register({
  name: "tier promote", usage: "tier promote <name>",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: tier promote <name>");
    const d = await postJSON("/api/tier/promote", { name });
    if (!isOk(d)) return err(errOf(d) || "tier promote failed");
    return ok(`'${name}' promoted a tier`);
  },
});
register({
  name: "tier demote", usage: "tier demote <name>",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: tier demote <name>");
    const d = await postJSON("/api/tier/demote", { name });
    if (!isOk(d)) return err(errOf(d) || "tier demote failed");
    return ok(`'${name}' demoted a tier`);
  },
});
register({
  name: "vfree", usage: "vfree <name>", destructive: true,
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: vfree <name>");
    const d = await postJSON("/api/vfree", { name });
    if (!isOk(d)) return err(errOf(d) || "vfree failed");
    return ok(`'${name}' freed`);
  },
});
register({
  name: "workflow addstep", usage: "workflow addstep <workflow> <agent> <in> <out>",
  handler: async (rest) => {
    const [workflow, agent, inKey, outKey] = words(rest);
    if (!workflow || !agent || !inKey || !outKey) return err("usage: workflow addstep <workflow> <agent> <in> <out>");
    const d = await postJSON("/api/workflow/addstep", { workflow, agent, in: inKey, out: outKey });
    if (!isOk(d)) return err(errOf(d) || "workflow addstep failed");
    return ok(`step added to '${workflow}'`);
  },
});
register({
  name: "webapp set", usage: "webapp set <obj> <path> <content>",
  handler: async (rest) => {
    const [obj, path, ...content] = words(rest);
    if (!obj || !path || !content.length) return err("usage: webapp set <obj> <path> <content>");
    const d = await postJSON("/api/webapp/set", { obj, path, content: content.join(" ") });
    if (!isOk(d)) return err(errOf(d) || "webapp set failed");
    return ok(`'${path}' set on '${obj}'`);
  },
});
register({
  name: "webapp append", usage: "webapp append <obj> <path> <content>",
  handler: async (rest) => {
    const [obj, path, ...content] = words(rest);
    if (!obj || !path || !content.length) return err("usage: webapp append <obj> <path> <content>");
    const d = await postJSON("/api/webapp/append", { obj, path, content: content.join(" ") });
    if (!isOk(d)) return err(errOf(d) || "webapp append failed");
    return ok(`content appended to '${obj}' at '${path}'`);
  },
});
register({
  name: "webapp list", usage: "webapp list [<obj>]",
  handler: async (rest) => {
    const [obj] = words(rest);
    const d = await getJSON(`/api/webapp/list${obj ? `?obj=${encodeURIComponent(obj)}` : ""}`);
    if (errOf(d)) return err(errOf(d)!);
    return { text: fmtTable(d.assets, ["obj", "path", "mime", "content_len"]) };
  },
});
register({
  name: "write", usage: "write <name> <payload>  (legacy raw heap write)",
  handler: async (rest) => {
    const [name, ...payload] = words(rest);
    if (!name || !payload.length) return err("usage: write <name> <payload>");
    const d = await postJSON("/api/write", { name, payload: payload.join(" ") });
    if (!isOk(d)) return err(errOf(d) || "write failed");
    return ok(`wrote payload to '${name}'`);
  },
});
register({
  name: "demo", usage: "demo <name>  (legacy loader demo)",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: demo <name>");
    const d = await postJSON("/api/demo", { name });
    if (!isOk(d)) return err(errOf(d) || "demo failed");
    return ok(`demo binary uploaded and spawned as '${name}'`);
  },
});
register({
  name: "load", usage: "load <name>  (legacy loader)",
  handler: async (rest) => {
    const [name] = words(rest);
    if (!name) return err("usage: load <name>");
    const d = await postJSON("/api/load", { name });
    if (!isOk(d)) return err(errOf(d) || "load failed");
    return ok(`'${name}' loaded — entry_point=${d.entry_point}`);
  },
});
register({
  name: "loader list", usage: "loader list  (legacy loader)",
  handler: async () => {
    const d = await getJSON("/api/loader/list");
    return { text: fmtTable(d?.binaries, ["name", "size", "format"]) };
  },
});
register({
  name: "upload", usage: "upload <name> <hex>  (legacy loader upload -- see 'program upload'/'stream upload')",
  handler: async (rest) => {
    const [name, hex] = words(rest);
    if (!name || !hex) return err("usage: upload <name> <hex>");
    const d = await postJSON("/api/upload", { name, hex });
    if (!isOk(d)) return err(errOf(d) || "upload failed");
    return ok(`${d.bytes_written} byte(s) written to '${name}'`);
  },
});

// ─── Router ───────────────────────────────────────────────────────────────────
// Longest command name (by word count) wins, so "vec index search" is tried
// before "vec" would ever be (and "vec" alone was never registered as its
// own command in the first place — see byFirstWord's role below instead).
const ALL_NAMES = COMMANDS.map(c => c.name)
  .sort((a, b) => b.split(" ").length - a.split(" ").length || b.length - a.length);

export function isDestructive(commandLine: string): boolean {
  const matched = matchCommand(commandLine);
  if (!matched) return false;
  const spec = COMMANDS.find(c => c.name === matched.name);
  return !!spec?.destructive;
}

function matchCommand(input: string): { name: string; rest: string } | null {
  const trimmed = input.trim();
  for (const name of ALL_NAMES) {
    if (trimmed === name) return { name, rest: "" };
    if (trimmed.startsWith(name + " ")) return { name, rest: trimmed.slice(name.length + 1) };
  }
  return null;
}

export async function runCommand(input: string): Promise<CommandResult> {
  const trimmed = input.trim();
  if (!trimmed) return { text: "" };
  if (trimmed === "help") return { text: helpText() };

  const matched = matchCommand(trimmed);
  if (!matched) {
    const firstWord = trimmed.split(/\s+/)[0];
    const siblings = byFirstWord[firstWord];
    if (siblings?.length) {
      return err(`'${trimmed}' not recognized — did you mean one of:\n  ${siblings.join("\n  ")}`);
    }
    return err(`command not found: ${firstWord} (try 'help')`);
  }

  // Every registered name in ALL_NAMES comes from COMMANDS, so this is
  // always found -- the Shell-Command JSON-Promotion Roadmap retired the
  // legacy POST /api/shell/exec fallback path that used to sit here once
  // every real shell.c command got its own purpose-built JSON route.
  const spec = COMMANDS.find(c => c.name === matched.name)!;
  try {
    return await spec.handler(matched.rest);
  } catch (e: any) {
    return err(e?.message || "request failed");
  }
}

function helpText(): string {
  const have = COMMANDS.map(c => `  ${c.usage}`).sort();
  return [
    "Available commands:",
    ...have,
    "",
    "clear                        clear the screen",
    "help                         this message",
  ].join("\n");
}

export const CLEAR_COMMAND = "clear";
