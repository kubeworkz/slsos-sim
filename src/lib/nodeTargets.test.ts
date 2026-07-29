/**
 * nodeTargets.test.ts — the node address book and the routing decision.
 *
 * ─── The bug this exists to prevent coming back ───────────────────────────
 * server.ts's proxy router read:
 *
 *     // A request to an unknown node id is refused rather than silently
 *     // served by the default target -- answering for the wrong machine is
 *     // worse than answering "I do not know where that node is".
 *     return NODE_TARGETS.get(id) || DEFAULT_KERNEL;
 *
 * The comment describes a refusal; the code is a fallback. With
 * AEROSLS_NODES unset, `/node/4/api/cluster` was proxied to localhost:3001
 * -- node 1 -- and the cluster panel rendered node 1's roster, memory and
 * workload counts under the heading "node 4". No error. No warning. The
 * wrong machine's numbers, labelled with the right machine's name.
 *
 * That is the worst shape a bug can take in a monitoring UI, so the check
 * that it stays fixed is the first one below.
 *
 * Plain asserts and a PASS/FAIL summary, matching shellCommands.test.ts and
 * the kernel-side host tests -- this project has no test framework.
 */
import { resolveNodeTarget, parseNodeTargets } from "./nodeTargets";

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string) {
  if (cond) { console.log(`ok:   ${msg}`); passed++; }
  else      { console.log(`FAIL: ${msg}`); failed++; }
}

const DEFAULT = "http://localhost:3001";

console.log("=== node address book ===\n");

// ═══ 1: the bug ═════════════════════════════════════════════════════════
console.log("-- 1: an unplaceable node id is REFUSED, never defaulted --");
{
  const empty = new Map<number, string>();
  const r = resolveNodeTarget(4, empty, DEFAULT);
  check(r.target === null,
    "*** with AEROSLS_NODES unset, node 4 does NOT resolve to the default kernel ***");
  check(r.target !== DEFAULT,
    "*** ...specifically not to node 1, which would show its data as node 4's ***");
  check(r.reason.includes("AEROSLS_NODES"),
    "...and the refusal names the variable to set");
  check(r.reason.includes("2=http://localhost:3002"),
    "...with a worked example, not just the name");
}

// ═══ 2: the single-kernel case still works ══════════════════════════════
console.log("\n-- 2: unset means one kernel, and node 1 is it --");
{
  const empty = new Map<number, string>();
  const r = resolveNodeTarget(1, empty, DEFAULT);
  check(r.target === DEFAULT,
    "*** node 1 resolves to the default kernel with no address book ***");
  check(r.reason === "", "...with no complaint");
}

// ═══ 3: a populated book ════════════════════════════════════════════════
console.log("\n-- 3: with an address book --");
{
  const { targets } = parseNodeTargets(
    "1=http://localhost:3001,2=http://localhost:3002,3=http://localhost:3003");
  check(targets.size === 3, "three nodes parse");
  check(resolveNodeTarget(2, targets, DEFAULT).target === "http://localhost:3002",
    "node 2 resolves to its own URL");
  check(resolveNodeTarget(3, targets, DEFAULT).target === "http://localhost:3003",
    "node 3 to its own");

  const miss = resolveNodeTarget(7, targets, DEFAULT);
  check(miss.target === null,
    "*** a node NOT in the book is refused even though the book is populated ***");
  check(miss.reason.includes("1, 2, 3"),
    "...and lists which nodes ARE known, so the gap is obvious");
}

// ═══ 4: parsing refuses rather than guesses ═════════════════════════════
console.log("\n-- 4: malformed entries --");
{
  const { targets, rejected } = parseNodeTargets(
    "1=http://a,notanid=http://b,3=http://c");
  check(targets.size === 2, "the valid entries survive one bad neighbour");
  check(targets.get(1) === "http://a" && targets.get(3) === "http://c",
    "...and they are the right ones");
  check(rejected.length === 1 && rejected[0].includes("notanid"),
    "*** the bad entry is REPORTED, so a missing node has an explanation ***");

  // A prefix-parse would silently point node 1 somewhere unintended.
  const p = parseNodeTargets("1x=http://wrong,2=http://right");
  check(!p.targets.has(1),
    "*** '1x' does not parse as node 1 -- the id must be the whole token ***");
  check(p.targets.get(2) === "http://right", "...and the valid one still lands");

  // Last-wins on a duplicate is a coin flip over which kernel a panel talks to.
  const d = parseNodeTargets("2=http://first,2=http://second");
  check(d.targets.get(2) === "http://first",
    "*** a duplicate id keeps the FIRST, deterministically ***");
  check(d.rejected.some((r) => r.includes("duplicate")),
    "...and says a duplicate was dropped");

  check(parseNodeTargets(undefined).targets.size === 0, "undefined is an empty book");
  check(parseNodeTargets("").targets.size === 0, "so is an empty string");
  check(parseNodeTargets("1=http://a,,2=http://b").targets.size === 2,
    "an empty fragment between commas is skipped, not counted");
  check(parseNodeTargets("1=").rejected.length === 1, "a key with no URL is rejected");
}

// ═══ 5: nonsense ids ════════════════════════════════════════════════════
console.log("\n-- 5: degenerate ids --");
{
  const { targets } = parseNodeTargets("1=http://a");
  check(resolveNodeTarget(0, targets, DEFAULT).target === null, "node 0 is refused");
  check(resolveNodeTarget(-1, targets, DEFAULT).target === null, "a negative id is refused");
  check(resolveNodeTarget(NaN, targets, DEFAULT).target === null, "NaN is refused");
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
