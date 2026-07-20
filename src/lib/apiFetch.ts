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
  return fetch(path, {
    ...opts,
    headers: {
      "Authorization": `Bearer ${DEMO_TOKEN}`,
      ...(opts?.headers || {}),
    },
  });
}
