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

// Commands with no dedicated structured HTTP route (docs/AeroSLS-Web-
// Terminal-Plan-v0.1.md §3's original "Missing" list, corrected twice now:
// first during Task 1, when journal dump/index scan/mqt scan/agent status
// turned out to already have routes and moved to the real registry below,
// and vfree turned out to have NO route despite being listed as available
// in the plan's first draft; second after the Kernel-Side Shell Refactor
// (§10) shipped POST /api/shell/exec, which runs user/shell.c's *entire*
// dispatch chain -- every one of these is a real shell.c command, so all
// of them are reachable now, just through the legacy shell dispatch
// instead of a purpose-built route with structured JSON output like the
// COMMANDS registry above. Kept as a separate table (not merged into
// COMMANDS) because that distinction is real and worth surfacing to the
// user, not because these don't work.
//
// Usage strings below are the ACTUAL user/shell.c argument shapes (verified
// against a full read of shell.c, not the shell's own command names guessed
// at) -- they're no longer just inert documentation once §10 shipped, since
// runFallbackCommand() sends the raw typed line straight to the kernel's
// real parser, which will reject anything that doesn't match. A few were
// wrong in the original draft, written before that mattered: "auth create"
// takes <email> <uid> <role>, not just <name>; "login" is a session
// uid/gid switch, not username/password; "demo"/"upload" take a leading
// <name> the old usage strings omitted; "ipc post" takes a hex opcode, not
// free-text; "webapp set"/"webapp append" take a leading <obj>; "seal" was
// fixed to its new post-refactor <name> <password> single-line form
// (§10.1); and "delete object" was removed outright -- it was never a real
// shell.c command, just an invented alias for vfree that would have always
// failed with "Unknown command" once actually sent to the kernel.
//
// Architectural Phase 4 (docs/AeroSLS-Architectural-MVP-Roadmap-v0.1.md):
// "auth create" now takes a trailing <password> too (previously an account
// with no password could later have its live token handed to anyone who
// just knew its email via POST /auth/token) and, along with "auth revoke",
// now requires the caller to already be DB_ADMIN or higher -- a privilege-
// escalation gap (any session could mint itself a DB_ADMIN account) found
// and closed in the same pass. Both marked destructive here to match: they
// mutate real account/credential state, same bar as role set/grant/revoke/chmod.
const SHELL_FALLBACK_COMMANDS: Record<string, { usage: string; destructive?: boolean }> = {
  "login":            { usage: "login <uid> <gid>" },
  "role set":         { usage: "role set <uid> <SYSTEM_KERNEL|DB_ADMIN|APP_USER|GUEST>", destructive: true },
  "grant":            { usage: "grant <uid> <object> <perm>", destructive: true },
  "revoke":           { usage: "revoke <uid> <object> <perm>", destructive: true },
  "chmod":            { usage: "chmod <name> <mask_hex>", destructive: true },
  "auth create":      { usage: "auth create <email> <uid> <SYSTEM_KERNEL|DB_ADMIN|APP_USER|GUEST> <password> (requires DB_ADMIN+)", destructive: true },
  "auth list":        { usage: "auth list" },
  "auth revoke":      { usage: "auth revoke <email>  (requires DB_ADMIN+)", destructive: true },
  "seal":             { usage: "seal <name> <password>" },
  "write":            { usage: "write <name> <payload>  (legacy raw heap write)" },
  "demo":             { usage: "demo <name>  (legacy loader demo)" },
  "load":             { usage: "load <name>  (legacy loader)" },
  "loader list":      { usage: "loader list  (legacy loader)" },
  "upload":           { usage: "upload <name> <hex>  (legacy loader upload -- see 'program upload'/'stream upload')" },
  "svc crash":        { usage: "svc crash <name>", destructive: true },
  "svc restart":      { usage: "svc restart <name>", destructive: true },
  "proc kill":        { usage: "proc kill <pid>", destructive: true },
  "ipc post":         { usage: "ipc post <svc_name> <opcode_hex>" },
  "ipc stat":         { usage: "ipc stat" },
  "journal create":   { usage: "journal create <name>" },
  "journal purge":    { usage: "journal purge <name>", destructive: true },
  "tier demote":      { usage: "tier demote <name>" },
  "tier promote":     { usage: "tier promote <name>" },
  "vfree":            { usage: "vfree <name>", destructive: true },
  "workflow addstep": { usage: "workflow addstep <workflow> <agent> <in> <out>" },
  "webapp set":       { usage: "webapp set <obj> <path> <content>" },
  "webapp list":      { usage: "webapp list [<obj>]" },
  "webapp append":    { usage: "webapp append <obj> <path> <content>" },
};

const COMMANDS: CommandSpec[] = [];
// First-word index for "did you mean" suggestions when a category prefix
// matches but no full command does (e.g. user types "vec frobnicate").
const byFirstWord: Record<string, string[]> = {};

function register(spec: CommandSpec) {
  COMMANDS.push(spec);
  const first = spec.name.split(" ")[0];
  (byFirstWord[first] ||= []).push(spec.name);
}
for (const name of Object.keys(SHELL_FALLBACK_COMMANDS)) {
  const first = name.split(" ")[0];
  (byFirstWord[first] ||= []).push(name);
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

const isOk = (data: any) => data?.ok === "true";
const errOf = (data: any): string | null =>
  typeof data?.error === "string" ? data.error : (data?.ok === "false" ? "request failed" : null);

// Kernel-Side Shell Refactor follow-on (docs/AeroSLS-Web-Terminal-Plan-
// v0.1.md §10.6): every command in SHELL_FALLBACK_COMMANDS is a real
// user/shell.c command with no purpose-built HTTP route of its own, now
// reachable through POST /api/shell/exec, which runs the command string
// through shell.c's *entire* dispatch chain and returns whatever the
// serial console would have printed. `ok` on that response means "the
// kernel recognized the command," not "the operation succeeded" -- most
// shell.c commands only communicate real success/failure through their
// own printed text, exactly as a human reading the serial console always
// has. This function doesn't try to parse or reformat that text (there's
// no structured shape to parse -- it's whatever kernel_serial_print calls
// that command happened to make) -- it's shown to the user verbatim,
// same as every other command's output.
async function execViaShellFallback(commandLine: string): Promise<CommandResult> {
  const data = await postJSON("/api/shell/exec", { command: commandLine });
  if (typeof data?.output !== "string") {
    return err(errOf(data) || "request failed");
  }
  const text = data.output.length ? data.output.replace(/\n+$/, "") : "(no output)";
  // ok:false here means "kernel didn't recognize this command line" (a
  // syntax mismatch against shell.c's exact parser, not a network error) --
  // still worth flagging as an error rather than printing silently.
  return { text, isError: !isOk(data) };
}

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
  name: "valloc", usage: "valloc <name> <TYPE|type_int> <pages>",
  handler: async (rest) => {
    const [name, type, pages] = words(rest);
    if (!name || !type || !pages) return err("usage: valloc <name> <TYPE|type_int> <pages>");
    const typeNum = resolveObjType(type);
    if (typeNum === null) return err(`unknown type '${type}' -- try one of: ${Object.keys(OBJ_TYPES).join(", ")}, or a raw integer`);
    const d = await postJSON("/api/valloc", { name, type: typeNum, pages: parseInt(pages, 10) || 0 });
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

// ─── Router ───────────────────────────────────────────────────────────────────
// Longest command name (by word count) wins, so "vec index search" is tried
// before "vec" would ever be (and "vec" alone was never registered as its
// own command in the first place — see byFirstWord's role below instead).
const ALL_NAMES = [
  ...COMMANDS.map(c => c.name),
  ...Object.keys(SHELL_FALLBACK_COMMANDS),
].sort((a, b) => b.split(" ").length - a.split(" ").length || b.length - a.length);

export function isDestructive(commandLine: string): boolean {
  const matched = matchCommand(commandLine);
  if (!matched) return false;
  const spec = COMMANDS.find(c => c.name === matched.name);
  if (spec) return !!spec.destructive;
  return !!SHELL_FALLBACK_COMMANDS[matched.name]?.destructive;
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

  const spec = COMMANDS.find(c => c.name === matched.name);
  if (spec) {
    try {
      return await spec.handler(matched.rest);
    } catch (e: any) {
      return err(e?.message || "request failed");
    }
  }

  // No purpose-built route for this one -- fall through to the kernel's
  // own shell dispatch via POST /api/shell/exec (§10.6) instead of the old
  // static "not available over the web yet" message.
  try {
    return await execViaShellFallback(trimmed);
  } catch (e: any) {
    return err(e?.message || "request failed");
  }
}

function helpText(): string {
  const have = COMMANDS.map(c => `  ${c.usage}`).sort();
  const fallback = Object.entries(SHELL_FALLBACK_COMMANDS).map(([, v]) => `  ${v.usage}  (via legacy shell dispatch)`).sort();
  return [
    "Available commands:",
    ...have,
    "",
    "Also available, routed through the kernel's legacy shell dispatch",
    "(POST /api/shell/exec -- plain-text output, not structured JSON like",
    "the commands above; a syntax mismatch against the exact usage below",
    "will come back as 'Unknown command'):",
    ...fallback,
    "",
    "clear                        clear the screen",
    "help                         this message",
  ].join("\n");
}

export const CLEAR_COMMAND = "clear";
