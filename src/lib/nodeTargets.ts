/**
 * nodeTargets.ts — resolving a cluster node id to an HTTP endpoint.
 *
 * ─── Why this is its own module ───────────────────────────────────────────
 * It was three lines inside server.ts's proxy `router`, and those three
 * lines had a bug that the comment directly above them denied:
 *
 *     // A request to an unknown node id is refused rather than silently
 *     // served by the default target -- answering for the wrong machine is
 *     // worse than answering "I do not know where that node is".
 *     return NODE_TARGETS.get(id) || DEFAULT_KERNEL;      // <- a FALLBACK
 *
 * With AEROSLS_NODES unset, `/node/4/api/cluster` was proxied to
 * localhost:3001 — node 1 — and the panel rendered node 1's roster, memory
 * and workloads under the heading "node 4". No error, no warning, wrong
 * machine. Exactly the failure the comment was written to prevent.
 *
 * Pulling the decision out here makes it a pure function with a test. The
 * express wiring stays in server.ts; the judgement lives where it can be
 * checked.
 */

/* A flat result rather than a discriminated union on `ok: true|false`.
 * This project's tsconfig does not enable `strict`, so boolean-literal
 * discriminants are widened and narrowing after `if (r.ok)` does not
 * apply -- the compiler still demands `reason` exist on the success arm.
 * `target === null` carries the same information and needs no narrowing. */
export interface NodeResolution {
  /** Where to send the request, or null if it must be refused. */
  target: string | null;
  /** Why it was refused. Empty when `target` is set. */
  reason: string;
}

/**
 * Where should a request for `id` go?
 *
 * - An id present in the address book resolves to its URL.
 * - With an EMPTY address book, only id 1 resolves, to `defaultKernel`.
 *   That is the single-kernel setup `AEROSLS_NODES` exists to extend, and
 *   refusing it would break the common case for no benefit.
 * - Anything else is REFUSED, with a reason naming what to configure.
 *
 * Never falls back to a default for an unknown id. A dashboard that shows
 * one machine's numbers under another machine's name is worse than one
 * that says it cannot reach the node.
 */
export function resolveNodeTarget(
  id: number,
  targets: Map<number, string>,
  defaultKernel: string,
): NodeResolution {
  if (!Number.isFinite(id) || id <= 0) {
    return { target: null, reason: `'${id}' is not a node id` };
  }

  const mapped = targets.get(id);
  if (mapped) return { target: mapped, reason: "" };

  if (targets.size === 0) {
    if (id === 1) return { target: defaultKernel, reason: "" };
    return {
      target: null,
      reason:
        `AEROSLS_NODES is not set, so only node 1 (${defaultKernel}) is known. ` +
        `Start the cluster and set e.g. ` +
        `AEROSLS_NODES="1=http://localhost:3001,2=http://localhost:3002"`,
    };
  }

  const known = [...targets.keys()].sort((a, b) => a - b).join(", ");
  return {
    target: null,
    reason: `node ${id} is not in AEROSLS_NODES (which lists: ${known})`,
  };
}

/**
 * Parse `AEROSLS_NODES="1=http://a,2=http://b"`.
 *
 * A malformed entry is SKIPPED rather than aborting the whole book — one
 * typo should not take the other nodes offline — but it is reported, so a
 * silently-missing node has somewhere to be explained. Returns the map and
 * the list of rejected fragments.
 */
export function parseNodeTargets(spec: string | undefined): {
  targets: Map<number, string>;
  rejected: string[];
} {
  const targets = new Map<number, string>();
  const rejected: string[] = [];
  if (!spec) return { targets, rejected };

  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const eq = trimmed.indexOf("=");
    const idRaw = eq >= 0 ? trimmed.slice(0, eq).trim() : "";
    const url = eq >= 0 ? trimmed.slice(eq + 1).trim() : "";
    const id = Number.parseInt(idRaw, 10);

    // The id has to be the WHOLE token, not a prefix of it: "1x=http://…"
    // parsing as 1 would quietly point node 1 somewhere unintended.
    if (!/^\d+$/.test(idRaw) || !Number.isFinite(id) || id <= 0 || !url) {
      rejected.push(trimmed);
      continue;
    }
    if (targets.has(id)) {
      // Last-wins would be a coin flip over which kernel a panel talks to.
      rejected.push(`${trimmed} (duplicate id ${id}; keeping the first)`);
      continue;
    }
    targets.set(id, url);
  }
  return { targets, rejected };
}
