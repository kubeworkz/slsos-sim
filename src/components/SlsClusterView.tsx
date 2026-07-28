/**
 * SlsClusterView.tsx — the cluster pane of the control plane.
 *
 * ─── Why this app IS the control plane ────────────────────────────────
 * Kubernetes needs a separate control-plane process because Linux knows
 * nothing about clusters. This kernel does: the service registry, the
 * reconciler, the circuit breakers and workload restarts all live inside
 * it and replicate over DSPP (Orchestration Plan Phases 4-7). There is no
 * etcd, no apiserver, no scheduler daemon to front.
 *
 * So what was missing was never a control plane -- it was a cluster-wide
 * VIEW of one that already exists and is already distributed. A userspace
 * aggregator would have been a second source of truth for state the
 * kernel already owns authoritatively.
 *
 * The consequence this panel depends on: because every node holds the
 * roster and the replicated registry, ANY node can answer the cluster
 * questions. There is no control-plane node to point at, so there is no
 * new single point of failure.
 *
 * ─── What a node can and cannot tell you about its peers ──────────────
 * First-hand for itself; membership-only for everyone else. Partition
 * ownership and announced services ARE known cluster-wide, because
 * partition_owner_table[] is the authority for where a partition lives
 * and the service registry replicates. A peer's memory, workloads and
 * breakers are not replicated and are NOT shown as zeroes -- the node
 * reports `detail: "membership-only"` and this panel says so, because a
 * fabricated figure is worse than an absent one. Select the node to see
 * its real numbers; every other panel then follows the selection.
 */
import { useEffect, useState } from "react";
import { authFetch, setSelectedNode, getSelectedNode } from "../lib/apiFetch";

type RosterEntry = { node_id: number; self: string };
type ClusterInfo = {
  node_id: number;
  role: string;
  term: number;
  active_nodes: number;
  quorum_threshold: number;
  initialised: string;
  roster: RosterEntry[];
};
type NodeInfo = {
  node_id: number;
  self: string;
  detail: string;
  role?: string;
  partitions_owned?: number;
  services_local?: number;
  services_announced?: number;
  workloads?: number;
  live_contexts?: number;
};

export default function SlsClusterView() {
  const [cluster, setCluster] = useState<ClusterInfo | null>(null);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<number>(getSelectedNode());

  async function load() {
    try {
      const [c, n] = await Promise.all([
        authFetch("/api/cluster").then((r) => r.json()),
        authFetch("/api/nodes").then((r) => r.json()),
      ]);
      setCluster(c);
      setNodes(n.nodes || []);
      setErr(null);
    } catch {
      setErr("Kernel not reachable");
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [selected]);

  function pick(id: number) {
    setSelectedNode(id);
    setSelected(id);
  }

  if (err) {
    return <div className="p-6 text-red-400 font-mono text-sm">{err}</div>;
  }
  if (!cluster) {
    return <div className="p-6 text-slate-400 font-mono text-sm">Loading cluster…</div>;
  }

  /* node_id 0 is the kernel's "cluster_init() was never called" sentinel.
   * Say "standalone" rather than drawing a one-node cluster that has not
   * actually been formed -- the distinction matters, because until
   * cluster_init() runs, partition_migrate() takes the same-disk path. */
  const standalone = cluster.initialised !== "true";

  return (
    <div className="p-6 space-y-6 font-mono text-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg text-slate-100">Cluster</h2>
        <button onClick={load} className="text-xs px-3 py-1 rounded bg-slate-700 text-slate-200">
          Refresh
        </button>
      </div>

      {standalone ? (
        <div className="rounded border border-amber-600/40 bg-amber-950/30 p-4 text-amber-200">
          <div className="font-semibold">Standalone — no cluster formed</div>
          <div className="mt-1 text-xs text-amber-300/80">
            This node reports id 0, the reserved “uninitialised” sentinel.
            Run <code className="text-amber-100">cluster init &lt;id&gt;</code> on its console.
            Until then <code className="text-amber-100">partition migrate</code> takes the
            same-disk relocate path rather than the cross-node wire path.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            ["This node", `#${cluster.node_id}`],
            ["Role", cluster.role],
            ["Term", String(cluster.term)],
            ["Active nodes", String(cluster.active_nodes)],
            ["Quorum needs", String(cluster.quorum_threshold)],
          ].map(([k, v]) => (
            <div key={k} className="rounded border border-slate-700 bg-slate-900/60 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">{k}</div>
              <div className="mt-1 text-slate-100">{v}</div>
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="mb-2 text-slate-300">
          Nodes
          <span className="ml-2 text-xs text-slate-500">
            selecting one points every other panel at it
          </span>
        </div>
        <div className="space-y-2">
          {nodes.map((n) => {
            const isSelf = n.self === "true";
            const active = selected === n.node_id || (selected === 0 && isSelf);
            const firstHand = n.detail === "first-hand";
            return (
              <div
                key={n.node_id}
                onClick={() => pick(isSelf ? 0 : n.node_id)}
                className={`cursor-pointer rounded border p-3 transition ${
                  active
                    ? "border-emerald-500/60 bg-emerald-950/20"
                    : "border-slate-700 bg-slate-900/40 hover:border-slate-500"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-slate-100">
                    node #{n.node_id}
                    {isSelf && <span className="ml-2 text-xs text-emerald-400">this node</span>}
                    {n.role && <span className="ml-2 text-xs text-slate-400">{n.role}</span>}
                  </div>
                  {active && <span className="text-xs text-emerald-400">viewing</span>}
                </div>

                <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <Stat label="partitions" value={n.partitions_owned} />
                  <Stat
                    label={firstHand ? "services" : "services announced"}
                    value={firstHand ? n.services_local : n.services_announced}
                  />
                  {/* Deliberately absent rather than zero for a peer: these
                      are not replicated, so this node genuinely does not
                      know them. */}
                  <Stat label="workloads" value={n.workloads} unknown={!firstHand} />
                  <Stat label="live contexts" value={n.live_contexts} unknown={!firstHand} />
                </div>

                {!firstHand && (
                  <div className="mt-2 text-[11px] text-slate-500">
                    Membership only — partition ownership and announced services are
                    replicated cluster-wide; this node’s own counters are not. Select it
                    to read them from the node itself.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  unknown,
}: {
  label: string;
  value?: number;
  unknown?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={unknown || value === undefined ? "text-slate-600" : "text-slate-200"}>
        {unknown || value === undefined ? "—" : value}
      </div>
    </div>
  );
}
