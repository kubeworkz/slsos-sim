/**
 * shellCommands.test.ts — Terminal 6 (docs/AeroSLS-Web-Terminal-Plan-v0.1.md
 * §8/§9 item 6): host-side verification for the command router.
 *
 * This project has no test framework installed (no vitest/jest in
 * package.json, confirmed), matching the plain-assert "host test" pattern
 * used throughout aerosls2's own kernel-side test suite -- one executable
 * script, plain asserts, a PASS/FAIL summary, non-zero exit on failure.
 *
 * Mocks global.fetch and asserts, for a representative command from every
 * category in the registry: the right path, HTTP method, and body shape go
 * out, and the formatted CommandResult text reflects the mocked response.
 * Also covers the router-level behavior that isn't route-specific: unknown
 * commands, a sample of the formerly-legacy commands promoted to real JSON
 * routes by the Shell-Command JSON-Promotion Roadmap, and isDestructive().
 *
 * VectorStore Gap Analysis §2 follow-on: a consolidated pass covering every
 * vec* command that had shipped with zero executed test until now -- each
 * prior VectorStore roadmap phase added its own new command(s) and named
 * its own missing test as an individually small, acceptable limit, but
 * across five phases that compounded into 13 of 15 vec* commands (all but
 * "vec insert"/"vec embed-insert" above) having no coverage at all. Closes
 * that, in one pass, below. Named honestly rather than silently
 * discovered: "vec schema export/import" and "vec data export/import" are
 * NOT among the 13 -- grepping this file confirms those four never got a
 * shellCommands.ts command at all, only a kernel-native user/shell.c one
 * (the VectorStore tab's own Export/Import buttons reach the same HTTP
 * routes directly, without going through this router) -- adding new
 * commands is out of scope for a test-coverage pass, so that gap is
 * recorded here, not silently fixed as a side effect.
 *
 * Run (no test framework needed, just tsc's own JS emitter + node):
 *   tsc --module commonjs --target es2020 --esModuleInterop --skipLibCheck \
 *       --outDir /tmp/build src/lib/shellCommands.ts src/lib/apiFetch.ts \
 *       src/lib/shellCommands.test.ts
 *   node /tmp/build/shellCommands.test.js
 */
import { runCommand, isDestructive } from "./shellCommands";

// ─── fetch mock ───────────────────────────────────────────────────────────
interface Call { url: string; method: string; body: any; }
let calls: Call[] = [];
let nextResponse: any = {};

(global as any).fetch = async (url: string, opts?: any) => {
  calls.push({
    url,
    method: opts?.method || "GET",
    body: opts?.body ? JSON.parse(opts.body) : undefined,
  });
  const body = nextResponse;
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as any;
};

function mockNext(response: any) { nextResponse = response; }
function lastCall(): Call { return calls[calls.length - 1]; }

// ─── tiny assert harness ─────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${label}${detail ? " — " + detail : ""}`); }
}
function eq(label: string, actual: any, expected: any) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function main() {
  // ── Object catalog ──────────────────────────────────────────────────────
  calls = []; mockNext({ ok: "true", object_id: "0xdead" });
  await runCommand("valloc foo DB_TABLE 2");
  eq("valloc: path", lastCall().url, "/api/valloc");
  eq("valloc: method", lastCall().method, "POST");
  eq("valloc: body", lastCall().body, { name: "foo", type: 1, pages: 2 });

  calls = []; mockNext({ objects: [{ name: "foo", type: 1, tier: 0, pages: 2, uid: 1 }] });
  const lsRes = await runCommand("ls");
  eq("ls: path", lastCall().url, "/api/objects");
  eq("ls: method", lastCall().method, "GET");
  check("ls: renders table", lsRes.text.includes("foo"), lsRes.text);

  calls = []; mockNext({ name: "foo", type: "DB_TABLE" });
  await runCommand("stat foo");
  eq("stat: path", lastCall().url, "/api/objects/foo");

  // ── SQL ──────────────────────────────────────────────────────────────────
  calls = []; mockNext({ ok: "true", columns: ["id", "name"], rows: [["1", "a"]] });
  const sqlRes = await runCommand("sql SELECT * FROM foo");
  eq("sql: path", lastCall().url, "/api/sql");
  eq("sql: method", lastCall().method, "POST");
  eq("sql: body", lastCall().body, { query: "SELECT * FROM foo" });
  check("sql: renders columns", sqlRes.text.includes("ID") && sqlRes.text.includes("a"), sqlRes.text);

  calls = []; mockNext({ ok: "false", error: "no such table", error_code: 7 });
  const sqlErr = await runCommand("sql SELECT * FROM nope");
  check("sql: error surfaced", sqlErr.isError === true && sqlErr.text.includes("no such table"), sqlErr.text);

  calls = []; mockNext({ ok: "true" });
  await runCommand("schema set foo bar STRING");
  eq("schema set: path", lastCall().url, "/api/schema");
  eq("schema set: body", lastCall().body, { name: "foo", columns: [{ name: "bar", type: "STRING" }] });

  // ── Transactions / cursors ─────────────────────────────────────────────
  calls = []; mockNext({ ok: "true", tx_id: 5 });
  await runCommand("tx begin");
  eq("tx begin: path", lastCall().url, "/api/tx/begin");

  calls = []; mockNext({ ok: "true", cursor_id: 3 });
  await runCommand("cursor open foo where=name eq=bob order=id");
  eq("cursor open: path", lastCall().url, "/api/cursor/open");
  eq("cursor open: body", lastCall().body, { table: "foo", where: "name", eq: "bob", order: "id" });

  calls = []; mockNext({ rows: [], done: true });
  await runCommand("cursor fetch 3 5");
  eq("cursor fetch: path+query (GET)", lastCall().url, "/api/cursor/fetch?id=3&n=5");
  eq("cursor fetch: method", lastCall().method, "GET");

  // ── Indexes / journals / mqts (the four categories corrected mid-Task-1) ──
  calls = []; mockNext({ hit: true, key: "row42" });
  await runCommand("index scan idx1 someval");
  eq("index scan: path", lastCall().url, "/api/index/idx1?q=someval");

  calls = []; mockNext([{ seq: 1, type: "insert", object: "foo", key: "k", before: "", after: "v", tx: 1, committed: true }]);
  await runCommand("journal dump j1");
  eq("journal dump: path", lastCall().url, "/api/journal/j1");

  calls = []; mockNext({ records: [] });
  await runCommand("mqt scan m1");
  eq("mqt scan: path", lastCall().url, "/api/mqt/m1");

  calls = []; mockNext({ name: "a1", state: "idle" });
  await runCommand("agent status a1");
  eq("agent status: path", lastCall().url, "/api/agent/a1");

  // ── Vector store ─────────────────────────────────────────────────────────
  calls = []; mockNext({ page_id: 1, slot_index: 2 });
  await runCommand("vec insert coll1 7 1.0,2.0,3.0");
  eq("vec insert: path", lastCall().url, "/api/vec/insert");
  eq("vec insert: body", lastCall().body, { collection: "coll1", external_id: 7, values: [1, 2, 3] });

  calls = []; mockNext({ ollama_status: "ok", insert_status: "ok" });
  await runCommand("vec embed-insert coll1 7 model=nomic-embed-text prompt=hello there world");
  eq("vec embed-insert: path", lastCall().url, "/api/vec/embed-insert");
  eq("vec embed-insert: body", lastCall().body, {
    collection: "coll1", external_id: 7, prompt: "hello there world",
    endpoint_ip: "127.0.0.1", port: 11434, model: "nomic-embed-text",
  });

  // ── Vector store, consolidated pass: the 13 previously-untested vec*
  // commands (VectorStore Gap Analysis §2) ───────────────────────────────
  calls = []; mockNext({ ok: "true" });
  await runCommand("vec create coll2 128");
  eq("vec create: path", lastCall().url, "/api/vec/collections");
  eq("vec create: method", lastCall().method, "POST");
  eq("vec create: body", lastCall().body, { name: "coll2", dimension: 128 });

  calls = []; mockNext({ collections: [{ name: "coll1", dimension: 3, entry_count: 2, page_count: 1 }] });
  const vecListRes = await runCommand("vec list");
  eq("vec list: path", lastCall().url, "/api/vec/collections");
  eq("vec list: method", lastCall().method, "GET");
  check("vec list: renders collection name", vecListRes.text.includes("coll1"), vecListRes.text);

  calls = []; mockNext({ matches: [{ external_id: 7, page_id: 1, slot_index: 2, distance: 0.05 }] });
  const vecSearchRes = await runCommand("vec search coll1 1.0,2.0,3.0 metric=l2 k=5");
  eq("vec search: path", lastCall().url, "/api/vec/search");
  eq("vec search: body", lastCall().body, { collection: "coll1", query: [1, 2, 3], metric: "l2", k: 5 });
  check("vec search: renders a match", vecSearchRes.text.includes("7"), vecSearchRes.text);

  calls = []; mockNext({ matches: [] });
  await runCommand("vec search-text coll1 metric=l2 k=3 prompt=what is this about");
  eq("vec search-text: path", lastCall().url, "/api/vec/embed-search");
  eq("vec search-text: body", lastCall().body, {
    collection: "coll1", prompt: "what is this about",
    endpoint_ip: "127.0.0.1", port: 11434, model: "nomic-embed-text", metric: "l2", k: 3,
  });

  calls = []; mockNext({ ok: "false", error: "ollama unreachable", ollama_status: -1 });
  const vecSearchTextErr = await runCommand("vec search-text coll1 prompt=hello");
  check("vec search-text: embed failure surfaces ollama_status, not a generic error",
    vecSearchTextErr.isError === true && vecSearchTextErr.text.includes("ollama unreachable") && vecSearchTextErr.text.includes("ollama_status=-1"),
    vecSearchTextErr.text);

  calls = []; mockNext({ results: [{ external_id: 7, row: ["a", "b"] }] });
  const vecJoinRes = await runCommand('vec join mytable id [{"external_id":7,"page_id":1,"slot_index":2}]');
  eq("vec join: path", lastCall().url, "/api/vec/join");
  eq("vec join: body", lastCall().body, { table: "mytable", id_column: "id", matches: [{ external_id: 7, page_id: 1, slot_index: 2 }] });
  check("vec join: renders joined row", vecJoinRes.text.includes("a, b"), vecJoinRes.text);

  calls = []; mockNext({ ok: "true" });
  await runCommand("vec index create idx1 coll1 metric=l2");
  eq("vec index create: path", lastCall().url, "/api/vec/indexes");
  eq("vec index create: body", lastCall().body, { name: "idx1", collection: "coll1", metric: "l2" });

  calls = []; mockNext({ indexes: [{ name: "idx1", collection: "coll1", metric: "cosine", active_count: 5, node_count: 5 }] });
  const vecIdxListRes = await runCommand("vec index list");
  eq("vec index list: path", lastCall().url, "/api/vec/indexes");
  eq("vec index list: method", lastCall().method, "GET");
  check("vec index list: renders index name", vecIdxListRes.text.includes("idx1"), vecIdxListRes.text);

  calls = []; mockNext({ matches: [{ external_id: 9, page_id: 2, slot_index: 0, distance: 0.02 }] });
  await runCommand("vec index search idx1 1.0,2.0 k=4 ef=20");
  eq("vec index search: path", lastCall().url, "/api/vec/index/search");
  eq("vec index search: body", lastCall().body, { index: "idx1", query: [1, 2], k: 4, ef: 20 });

  calls = []; mockNext({ matches: [] });
  await runCommand("vec index search idx1 1.0,2.0 k=4");
  eq("vec index search: ef defaults to k when omitted", lastCall().body, { index: "idx1", query: [1, 2], k: 4, ef: 4 });

  calls = []; mockNext({ matches: [] });
  await runCommand("vec index search-text idx1 k=6 prompt=hello world");
  eq("vec index search-text: path", lastCall().url, "/api/vec/index/embed-search");
  eq("vec index search-text: body", lastCall().body, {
    index: "idx1", prompt: "hello world",
    endpoint_ip: "127.0.0.1", port: 11434, model: "nomic-embed-text", k: 6, ef: 6,
  });

  calls = []; mockNext({ ok: "true" });
  await runCommand("vec index rebuild idx1");
  eq("vec index rebuild: path", lastCall().url, "/api/vec/index/rebuild");
  eq("vec index rebuild: method", lastCall().method, "POST");
  eq("vec index rebuild: body", lastCall().body, { index: "idx1" });

  calls = []; mockNext({ ok: "true" });
  await runCommand("vec delete coll1 4 2");
  eq("vec delete: path", lastCall().url, "/api/vec/vector");
  eq("vec delete: method", lastCall().method, "DELETE");
  eq("vec delete: body", lastCall().body, { collection: "coll1", page_id: 4, slot_index: 2 });

  calls = []; mockNext({ ok: "false", error: "no such vector" });
  const vecDeleteErr = await runCommand("vec delete coll1 99 99");
  check("vec delete: kernel-reported failure -> isError true", vecDeleteErr.isError === true && vecDeleteErr.text.includes("no such vector"), vecDeleteErr.text);

  calls = []; mockNext({ ok: "true" });
  await runCommand("vec collection drop coll1");
  eq("vec collection drop: path", lastCall().url, "/api/vec/collections");
  eq("vec collection drop: method", lastCall().method, "DELETE");
  eq("vec collection drop: body", lastCall().body, { name: "coll1" });

  // ── VectorStore Gap Analysis §1.3: opt-in external_id uniqueness ────────
  calls = []; mockNext({ ok: "true", name: "coll1", enabled: "true", status: 0 });
  await runCommand("vec collection unique coll1 on");
  eq("vec collection unique on: path", lastCall().url, "/api/vec/collections/unique");
  eq("vec collection unique on: method", lastCall().method, "POST");
  eq("vec collection unique on: body", lastCall().body, { name: "coll1", enabled: 1 });

  calls = []; mockNext({ ok: "true", name: "coll1", enabled: "false", status: 0 });
  await runCommand("vec collection unique coll1 off");
  eq("vec collection unique off: body", lastCall().body, { name: "coll1", enabled: 0 });

  calls = []; mockNext({ ok: "false", status: 2 });
  const vecUniqueErr = await runCommand("vec collection unique coll1 on");
  check("vec collection unique: kernel-reported failure -> isError true", vecUniqueErr.isError === true, vecUniqueErr.text);

  check("isDestructive: vec collection unique (reversible toggle, not data-loss)", isDestructive("vec collection unique coll1 on") === false);

  calls = []; mockNext({ ok: "true" });
  await runCommand("vec index drop idx1");
  eq("vec index drop: path", lastCall().url, "/api/vec/indexes");
  eq("vec index drop: method", lastCall().method, "DELETE");
  eq("vec index drop: body", lastCall().body, { name: "idx1" });

  check("isDestructive: vec delete", isDestructive("vec delete coll1 4 2") === true);
  check("isDestructive: vec collection drop", isDestructive("vec collection drop coll1") === true);
  check("isDestructive: vec index drop", isDestructive("vec index drop idx1") === true);
  check("isDestructive: vec index rebuild (repair, not data-loss)", isDestructive("vec index rebuild idx1") === false);
  check("isDestructive: vec search (read-only)", isDestructive("vec search coll1 1.0,2.0") === false);

  // ── Partitions / agents / workflows ────────────────────────────────────
  calls = []; mockNext({ ok: "true", partition_id: 4 });
  await runCommand("partition create p1");
  eq("partition create: path", lastCall().url, "/api/partitions");
  eq("partition create: method", lastCall().method, "POST");

  calls = []; mockNext({ ok: "true" });
  await runCommand("agent kill a1");
  eq("agent kill -> drop: path", lastCall().url, "/api/agent/drop");
  eq("agent kill -> drop: body", lastCall().body, { name: "a1" });

  calls = []; mockNext({ ok: "true", steps: 3 });
  await runCommand("workflow create wf1 shared_tbl step=agentA:in:out step=agentB:mid:final");
  eq("workflow create: path", lastCall().url, "/api/workflow/create");
  eq("workflow create: body", lastCall().body, {
    name: "wf1", shared_table: "shared_tbl", step_count: 2,
    step0_agent: "agentA", step0_in: "in", step0_out: "out",
    step1_agent: "agentB", step1_in: "mid", step1_out: "final",
  });

  // ── Router-level behavior (not route-specific) ─────────────────────────
  const unknown = await runCommand("frobnicate");
  check("unknown command errors", unknown.isError === true && unknown.text.includes("command not found"), unknown.text);

  // ── Formerly-legacy commands (Shell-Command JSON-Promotion Roadmap): all
  // 28 now hit dedicated JSON routes instead of POST /api/shell/exec ──────
  calls = []; mockNext({ ok: "true" });
  const vfreeRes = await runCommand("vfree foo");
  eq("vfree: path", lastCall().url, "/api/vfree");
  eq("vfree: method", lastCall().method, "POST");
  eq("vfree: body", lastCall().body, { name: "foo" });
  check("vfree: not an error", !vfreeRes.isError, vfreeRes.text);

  calls = []; mockNext({ uid: 7, role: "APP_USER" });
  const loginRes = await runCommand("login");
  eq("login: path (whoami, read-only)", lastCall().url, "/api/session/whoami");
  eq("login: method", lastCall().method, "GET");
  check("login: shows real identity, not an error", loginRes.text.includes("APP_USER") && !loginRes.isError, loginRes.text);

  calls = []; mockNext({ ok: "false", error: "object not found" });
  const badVfree = await runCommand("vfree nope");
  check("vfree: kernel-reported failure -> isError true", badVfree.isError === true && badVfree.text.includes("object not found"), badVfree.text);

  calls = []; mockNext({ ok: "true", bytes_written: 4 });
  await runCommand("upload prog deadbeef");
  eq("upload (legacy loader): path", lastCall().url, "/api/upload");
  eq("upload (legacy loader): body", lastCall().body, { name: "prog", hex: "deadbeef" });

  check("isDestructive: partition destroy", isDestructive("partition destroy 4") === true);
  check("isDestructive: vfree (promoted, still flagged)", isDestructive("vfree foo") === true);
  check("isDestructive: agent kill", isDestructive("agent kill a1") === true);
  check("isDestructive: login (read-only, not flagged)", isDestructive("login") === false);
  check("isDestructive: ls (not destructive)", isDestructive("ls") === false);
  check("isDestructive: sql SELECT (not destructive)", isDestructive("sql SELECT * FROM foo") === false);

  const emptyRes = await runCommand("   ");
  check("empty input is a no-op", emptyRes.text === "" && !emptyRes.isError);

  const help = await runCommand("help");
  check("help lists commands", help.text.includes("valloc") && help.text.includes("vfree") && help.text.includes("login"));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
