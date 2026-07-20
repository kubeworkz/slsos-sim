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
 * commands, the shell-fallback route (POST /api/shell/exec, for commands
 * with no dedicated HTTP route), and isDestructive().
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

  // ── Shell-fallback commands (Kernel-Side Shell Refactor follow-on): no
  // dedicated route, routed through POST /api/shell/exec instead ─────────
  calls = []; mockNext({ ok: "true", output: "" });
  const vfreeRes = await runCommand("vfree foo");
  eq("vfree (fallback): path", lastCall().url, "/api/shell/exec");
  eq("vfree (fallback): method", lastCall().method, "POST");
  eq("vfree (fallback): body", lastCall().body, { command: "vfree foo" });
  check("vfree (fallback): recognized, no output -> placeholder text", vfreeRes.text === "(no output)" && !vfreeRes.isError, vfreeRes.text);

  calls = []; mockNext({ ok: "true", output: "Session credentials updated: uid=7 gid=7 role=APP_USER\n" });
  const loginRes = await runCommand("login 7 7");
  eq("login (fallback): body", lastCall().body, { command: "login 7 7" });
  check("login (fallback): trims trailing newline, not an error", loginRes.text === "Session credentials updated: uid=7 gid=7 role=APP_USER" && !loginRes.isError, loginRes.text);

  calls = []; mockNext({ ok: "false", output: "Unknown command: 'vfree'. Type 'help' for usage.\n" });
  const badFallback = await runCommand("vfree");
  check("fallback command kernel didn't recognize -> isError true", badFallback.isError === true && badFallback.text.includes("Unknown command"), badFallback.text);

  check("isDestructive: partition destroy", isDestructive("partition destroy 4") === true);
  check("isDestructive: vfree (fallback, still flagged)", isDestructive("vfree foo") === true);
  check("isDestructive: agent kill", isDestructive("agent kill a1") === true);
  check("isDestructive: ls (not destructive)", isDestructive("ls") === false);
  check("isDestructive: sql SELECT (not destructive)", isDestructive("sql SELECT * FROM foo") === false);

  const emptyRes = await runCommand("   ");
  check("empty input is a no-op", emptyRes.text === "" && !emptyRes.isError);

  const help = await runCommand("help");
  check("help lists commands", help.text.includes("valloc") && help.text.includes("via legacy shell dispatch"));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
