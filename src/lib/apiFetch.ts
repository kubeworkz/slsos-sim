/**
 * apiFetch.ts — single shared choke point for every authenticated call this
 * app makes to the AeroSLS kernel's HTTP API (net/http.c).
 *
 * Why this exists: Gap Remediation Phase E put a bearer-token gate on every
 * GET /api/* route (and the kernel's write routes have always required one).
 * Before this file existed, each component that needed auth re-declared its
 * own local "authHeaders"/"AUTH_TOKEN" constant (SlsDbEngine.tsx,
 * SlsAgentManager.tsx, App.tsx all did this independently), and several call
 * sites were simply missed each time a new panel or polling loop was added —
 * Journal Viewer, MQT Dashboard, Schema Explorer, the main dashboard's 5s
 * poll loop, /api/v1/sync's three separate call sites, /api/stream/:name,
 * /api/agents, /api/locks, and /api/workflows all shipped without the header
 * at one point or another, each discovered only after a 401 showed up live.
 * One shared helper, used everywhere, closes that off structurally instead
 * of relying on every future call site remembering to attach it by hand.
 */

// Fixed at-boot demo admin token (dave@gridworkz.com / DB_ADMIN) — the token
// every authenticated kernel route in this app accepts today.
export const DEMO_TOKEN = "deadbeef01234567cafebabe76543210";

export const authHeaders: Record<string, string> = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${DEMO_TOKEN}`,
};

/**
 * Drop-in replacement for fetch() that always attaches the bearer token.
 * Any headers passed in opts are merged in on top (so a caller can still
 * override Content-Type etc. if it ever needs to), and the response is
 * returned raw (not pre-parsed) so callers can still check res.ok / res.status
 * or call res.json() themselves — matching how most existing call sites in
 * this app already use fetch() directly.
 */
export function authFetch(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(routeForNode(path), {
    ...opts,
    headers: {
      "Authorization": `Bearer ${DEMO_TOKEN}`,
      ...(opts?.headers || {}),
    },
  });
}

/* ─── Multi-node routing (cluster view) ────────────────────────────────
 * Every kernel call in this app already funnels through authFetch(), for
 * the reason spelled out at the top of this file. That makes it the one
 * place node selection can be added without touching a single panel: the
 * 16 existing components become "node N's view" for free.
 *
 * ─── Why the UI needs an address book at all ──────────────────────────
 * The kernel deals in node IDs, not addresses. DSPP is L2 broadcast with
 * self-filtering precisely so it never needs an id-to-address table (see
 * net/dspp.h), and nothing in the cluster resolves an id to an HTTP
 * endpoint. So the browser has to be told where each node listens. That
 * is configuration, not something the cluster can be asked for, and
 * pretending otherwise would mean inventing a resolution layer the
 * kernel deliberately does without.
 *
 * Paths are rewritten to /node/<id>/api/... and the dev server maps that
 * prefix onto the right kernel. Node 0 means "the default target",
 * which is exactly the single-kernel behaviour this app had before, so
 * nothing changes until a node is actually selected. */
let selectedNodeId = 0;

export function setSelectedNode(nodeId: number): void {
  selectedNodeId = nodeId | 0;
}
export function getSelectedNode(): number {
  return selectedNodeId;
}

/* Applied inside authFetch() so no call site can forget it. */
function routeForNode(path: string): string {
  if (selectedNodeId === 0) return path;
  if (!path.startsWith("/api/") && !path.startsWith("/auth/")) return path;
  return `/node/${selectedNodeId}${path}`;
}
