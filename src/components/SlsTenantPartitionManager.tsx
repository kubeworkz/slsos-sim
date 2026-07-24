/**
 * SlsTenantPartitionManager — dashboard panel for the multitenant isolation
 * features that shipped with zero frontend surface before this: Weighted
 * CPU Scheduling, Storage Isolation (page quotas + Phase 2 byte-level
 * export), and Tenants (Multitenant Isolation Gap Analysis §5 item 1).
 *
 * Calls the kernel REST API directly (same-origin when served from the OS),
 * self-contained with no props, matching SlsAgentManager.tsx/
 * SlsVectorStore.tsx's established pattern rather than being threaded
 * through App.tsx's central poll loop -- this data is only interesting
 * while this tab is open, not part of the always-on dashboard chrome.
 * Auth token: dave@gridworkz.com  DB_ADMIN  (fixed at kernel boot).
 *
 * Five real routes, merged into two per-partition tables plus a tenants
 * table plus a disk/tier summary:
 *   GET  /api/partitions              -- id, name, frame_usage/quota
 *   GET  /api/partition/cpuweights    -- partition_id, weight
 *   GET  /api/partition/storagequotas -- partition_id, page_usage, page_quota
 *   GET  /api/usage                   -- partition_id, name, http_requests_total,
 *                                         frame_ticks_total, frames_now (live gauge)
 *   GET  /api/disk                    -- capacity_bytes, tiers{}, partitions[]
 *                                         (partition_id, disk_bytes_used, disk_bytes_quota)
 * The first three are merged into one "Partitions" configuration table
 * (frame/CPU/storage all live per-partition); /api/usage's cumulative
 * counters get their own "Usage Metering" table since they're telemetry,
 * not configuration; /api/disk's tier totals get their own small summary
 * strip. Every write goes through the same POST routes the terminal's
 * shell commands use (lib/shellCommands.ts) -- this panel and the terminal
 * are two different UIs over the identical backend surface, not two
 * separate implementations of it.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  Boxes, Plus, Trash2, RefreshCw, AlertTriangle, Pause, Play,
  Settings, Users, HardDrive, Gauge, X, CheckCircle
} from "lucide-react";
import { authHeaders } from "../lib/apiFetch";

interface PartitionRow {
  id: number;
  name: string;
  frame_usage: number;
  frame_quota: number;
  quota_unlimited: string; // "true" | "false"
}
interface CpuWeightRow { partition_id: number; weight: number; }
interface StorageQuotaRow { partition_id: number; page_usage: number; page_quota: number; }
interface UsageRow {
  partition_id: number;
  name: string;
  http_requests_total: number;
  frame_ticks_total: number;
  frames_now: number;
}
interface TenantRow {
  id: number;
  name: string;
  partition_id: number;
  database_id: number;
  owner_uid: number;
}
interface DiskTier { bytes_used: number; object_count: number; }
interface DiskPartitionRow { partition_id: number; disk_bytes_used: number; disk_bytes_quota: number; }
interface DiskStatus {
  capacity_bytes: number;
  tiers: Record<string, DiskTier>;
  partitions: DiskPartitionRow[];
}

// Merged, per-partition view -- one row per partition_id across every
// route above, joined client-side since the kernel intentionally keeps
// each concern (frame accounting, CPU weight, storage quota, disk bytes)
// in its own subsystem/route rather than one combined one (see Storage
// Isolation Roadmap Phase 2's own design-fork writeup on exactly this
// question for /api/usage vs. a new SLSUsageEntry field).
interface MergedPartition {
  id: number;
  name: string;
  frame_usage: number;
  frame_quota: number;
  cpu_weight: number;
  page_usage: number;
  page_quota: number;
  disk_bytes_used: number;
  disk_bytes_quota: number;
}

function fmtBytes(n: number): string {
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function SlsTenantPartitionManager() {
  const [partitions,    setPartitions]    = useState<PartitionRow[]>([]);
  const [cpuWeights,    setCpuWeights]    = useState<CpuWeightRow[]>([]);
  const [storageQuotas, setStorageQuotas] = useState<StorageQuotaRow[]>([]);
  const [usage,         setUsage]         = useState<UsageRow[]>([]);
  const [tenants,       setTenants]       = useState<TenantRow[]>([]);
  const [disk,          setDisk]          = useState<DiskStatus | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [fetchError,    setFetchError]    = useState<string | null>(null);

  // Create Partition form
  const [showCreatePartition, setShowCreatePartition] = useState(false);
  const [createPartitionName, setCreatePartitionName] = useState("");
  const [createPartitionStatus, setCreatePartitionStatus] = useState<string | null>(null);

  // Configure Partition form (frame quota / CPU weight / storage quota / assign uid)
  const [configurePid,      setConfigurePid]      = useState<number | null>(null);
  const [configFrameQuota,  setConfigFrameQuota]  = useState("");
  const [configCpuWeight,   setConfigCpuWeight]   = useState("");
  const [configPageQuota,   setConfigPageQuota]   = useState("");
  const [configAssignUid,   setConfigAssignUid]   = useState("");
  const [configStatus,      setConfigStatus]      = useState<string | null>(null);

  // Create Tenant form
  const [showCreateTenant, setShowCreateTenant] = useState(false);
  const [createTenantName, setCreateTenantName] = useState("");
  const [createTenantStatus, setCreateTenantStatus] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const [pRes, cwRes, sqRes, uRes, tRes, dRes] = await Promise.all([
        fetch("/api/partitions",              { headers: authHeaders }),
        fetch("/api/partition/cpuweights",    { headers: authHeaders }),
        fetch("/api/partition/storagequotas", { headers: authHeaders }),
        fetch("/api/usage",                   { headers: authHeaders }),
        fetch("/api/tenants",                 { headers: authHeaders }),
        fetch("/api/disk",                    { headers: authHeaders }),
      ]);
      const [pData, cwData, sqData, uData, tData, dData] = await Promise.all([
        pRes.json(), cwRes.json(), sqRes.json(), uRes.json(), tRes.json(), dRes.json(),
      ]);
      setPartitions(pData.partitions || []);
      setCpuWeights(cwData.cpuweights || []);
      setStorageQuotas(sqData.storagequotas || []);
      setUsage(uData.partitions || []);
      setTenants(tData.tenants || []);
      setDisk(dData?.capacity_bytes !== undefined ? dData : null);
    } catch (e: any) {
      setFetchError(`Could not reach kernel API: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Merge partitions + cpuweights + storagequotas + disk bytes into one
  // per-partition row. Weight/page-quota/disk-bytes default to their own
  // subsystem's "unconfigured" value (weight 1, quota 0=unlimited, bytes 0)
  // for any partition the other routes didn't mention -- matching each
  // route's own "skip if nothing interesting" convention (net/http.c). ────
  const merged: MergedPartition[] = partitions.map(p => {
    const cw = cpuWeights.find(c => c.partition_id === p.id);
    const sq = storageQuotas.find(s => s.partition_id === p.id);
    const db = disk?.partitions.find(d => d.partition_id === p.id);
    return {
      id: p.id,
      name: p.name,
      frame_usage: p.frame_usage,
      frame_quota: p.frame_quota,
      cpu_weight: cw?.weight ?? 1,
      page_usage: sq?.page_usage ?? 0,
      page_quota: sq?.page_quota ?? 0,
      disk_bytes_used: db?.disk_bytes_used ?? 0,
      disk_bytes_quota: db?.disk_bytes_quota ?? 0,
    };
  });

  const handleCreatePartition = async () => {
    if (!createPartitionName.trim()) return;
    setCreatePartitionStatus("Creating...");
    try {
      const res = await fetch("/api/partitions", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ name: createPartitionName }),
      });
      const data = await res.json();
      if (data.ok === "true") {
        setCreatePartitionStatus(`Partition '${createPartitionName}' created (id=${data.partition_id}).`);
        setCreatePartitionName("");
        setShowCreatePartition(false);
        fetchAll();
      } else {
        setCreatePartitionStatus(`Error: ${data.error ?? "unknown"}`);
      }
    } catch (e: any) {
      setCreatePartitionStatus(`Error: ${e.message}`);
    }
  };

  const handlePauseResume = async (id: number, action: "pause" | "resume") => {
    try {
      await fetch(`/api/partition/${action}`, {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ partition_id: id }),
      });
      fetchAll();
    } catch { /* ignore */ }
  };

  const handleDestroy = async (id: number) => {
    try {
      await fetch("/api/partition/destroy", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ partition_id: id }),
      });
      fetchAll();
    } catch { /* ignore */ }
  };

  const openConfigure = (row: MergedPartition) => {
    setConfigurePid(row.id);
    setConfigFrameQuota(String(row.frame_quota));
    setConfigCpuWeight(String(row.cpu_weight));
    setConfigPageQuota(String(row.page_quota));
    setConfigAssignUid("");
    setConfigStatus(null);
  };

  const handleApplyConfigure = async () => {
    if (configurePid === null) return;
    setConfigStatus("Applying...");
    try {
      const calls: Promise<Response>[] = [
        fetch("/api/partition/quota", {
          method: "POST", headers: authHeaders,
          body: JSON.stringify({ partition_id: configurePid, frame_quota: parseInt(configFrameQuota, 10) || 0 }),
        }),
        fetch("/api/partition/cpuweight", {
          method: "POST", headers: authHeaders,
          body: JSON.stringify({ partition_id: configurePid, weight: parseInt(configCpuWeight, 10) || 0 }),
        }),
        fetch("/api/partition/storagequota", {
          method: "POST", headers: authHeaders,
          body: JSON.stringify({ partition_id: configurePid, page_quota: parseInt(configPageQuota, 10) || 0 }),
        }),
      ];
      if (configAssignUid.trim()) {
        calls.push(fetch("/api/partition/assign", {
          method: "POST", headers: authHeaders,
          body: JSON.stringify({ uid: parseInt(configAssignUid, 10) || 0, partition_id: configurePid }),
        }));
      }
      const results = await Promise.all(calls);
      const datas = await Promise.all(results.map(r => r.json()));
      const allOk = datas.every(d => d.ok === "true");
      setConfigStatus(allOk ? "Applied." : "One or more settings failed to apply.");
      fetchAll();
    } catch (e: any) {
      setConfigStatus(`Error: ${e.message}`);
    }
  };

  const handleCreateTenant = async () => {
    if (!createTenantName.trim()) return;
    setCreateTenantStatus("Creating...");
    try {
      const res = await fetch("/api/tenants", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ name: createTenantName }),
      });
      const data = await res.json();
      if (data.ok === "true") {
        setCreateTenantStatus(`Tenant '${createTenantName}' created (id=${data.tenant_id}).`);
        setCreateTenantName("");
        setShowCreateTenant(false);
        fetchAll();
      } else {
        setCreateTenantStatus(`Error: ${data.error ?? "unknown"}`);
      }
    } catch (e: any) {
      setCreateTenantStatus(`Error: ${e.message}`);
    }
  };

  const tierEntries: [string, DiskTier][] = disk ? Object.entries(disk.tiers) as [string, DiskTier][] : [];

  return (
    <div className="p-6 space-y-8 font-mono">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Boxes className="w-5 h-5 text-cyan-400" />
          <h2 className="text-sm font-bold tracking-widest uppercase text-white">Tenant / Partition Manager</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchAll}
            className="flex items-center gap-1.5 text-[10px] text-white/50 hover:text-white border border-white/10 px-3 py-1.5 transition-colors">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
          <button onClick={() => { setShowCreatePartition(true); setCreatePartitionStatus(null); }}
            className="flex items-center gap-1.5 text-[10px] bg-cyan-400 text-[#0B0E14] font-bold px-3 py-1.5 hover:bg-cyan-300 transition-colors">
            <Plus className="w-3 h-3" /> New Partition
          </button>
          <button onClick={() => { setShowCreateTenant(true); setCreateTenantStatus(null); }}
            className="flex items-center gap-1.5 text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold px-3 py-1.5 hover:bg-emerald-500/30 transition-colors">
            <Users className="w-3 h-3" /> New Tenant
          </button>
        </div>
      </div>

      {fetchError && (
        <div className="flex items-center gap-2 text-xs text-red-400 border border-red-500/30 bg-red-500/10 px-4 py-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {fetchError}
        </div>
      )}

      {/* ── Partitions table ─────────────────────────────────────────────────
          One row per partition, merging /api/partitions (frame accounting),
          /api/partition/cpuweights (Weighted CPU Scheduling), /api/partition/
          storagequotas (Storage Isolation Phase 1, page-granular), and
          /api/disk's per-partition byte export (Storage Isolation Phase 2). */}
      <div>
        <h3 className="text-[10px] font-bold tracking-widest uppercase text-white/50 mb-2">Partitions</h3>
        <div className="border border-white/10">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-white/10 text-white/40 uppercase tracking-wider">
                <th className="text-left px-3 py-2">ID</th>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Frames (used/quota)</th>
                <th className="text-left px-3 py-2">CPU Weight</th>
                <th className="text-left px-3 py-2">Storage Pages (used/quota)</th>
                <th className="text-left px-3 py-2">Disk Bytes (used/quota)</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-white/30">Loading from kernel...</td></tr>
              )}
              {!loading && merged.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-white/30">No partitions defined. Create one to begin.</td></tr>
              )}
              {merged.map(row => (
                <tr key={row.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2.5 text-white/40">{row.id}</td>
                  <td className="px-3 py-2.5 text-cyan-400 font-bold">{row.name}</td>
                  <td className="px-3 py-2.5 text-white/70">
                    {row.frame_usage} / {row.frame_quota === 0 ? "∞" : row.frame_quota}
                  </td>
                  <td className="px-3 py-2.5 text-white/70">{row.cpu_weight}</td>
                  <td className="px-3 py-2.5 text-white/70">
                    {row.page_usage} / {row.page_quota === 0 ? "∞" : row.page_quota}
                  </td>
                  <td className="px-3 py-2.5 text-white/70">
                    {fmtBytes(row.disk_bytes_used)} / {row.disk_bytes_quota === 0 ? "∞" : fmtBytes(row.disk_bytes_quota)}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openConfigure(row)} title="Configure"
                        className="text-cyan-400/60 hover:text-cyan-400 transition-colors p-1">
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handlePauseResume(row.id, "pause")} title="Pause"
                        className="text-amber-400/60 hover:text-amber-400 transition-colors p-1">
                        <Pause className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handlePauseResume(row.id, "resume")} title="Resume"
                        className="text-emerald-400/60 hover:text-emerald-400 transition-colors p-1">
                        <Play className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDestroy(row.id)} title="Destroy"
                        className="text-red-400/40 hover:text-red-400 transition-colors p-1">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Create Partition panel ──────────────────────────────────────────── */}
      {showCreatePartition && (
        <div className="border border-cyan-400/25 bg-[#0F1219] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white uppercase tracking-wider">Create Partition</span>
            <button onClick={() => setShowCreatePartition(false)} className="text-white/30 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div>
            <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1">Name</label>
            <input value={createPartitionName} onChange={e => setCreatePartitionName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleCreatePartition()}
              className="w-full bg-transparent border border-white/20 text-white text-xs px-3 py-2 focus:border-cyan-400/50 outline-none font-mono"
              placeholder="tenant-acme" />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleCreatePartition}
              className="bg-cyan-400 text-[#0B0E14] text-xs font-bold px-5 py-2 hover:bg-cyan-300 transition-colors">
              Create
            </button>
            {createPartitionStatus && (
              <span className={`text-[10px] ${createPartitionStatus.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>
                {createPartitionStatus}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Configure Partition panel ───────────────────────────────────────── */}
      {configurePid !== null && (
        <div className="border border-cyan-400/25 bg-[#0F1219] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white uppercase tracking-wider">Configure Partition {configurePid}</span>
            <button onClick={() => setConfigurePid(null)} className="text-white/30 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1">Frame Quota (0=unlimited)</label>
              <input value={configFrameQuota} onChange={e => setConfigFrameQuota(e.target.value)}
                className="w-full bg-transparent border border-white/20 text-white text-xs px-3 py-2 focus:border-cyan-400/50 outline-none font-mono" />
            </div>
            <div>
              <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1">CPU Weight (0=default 1)</label>
              <input value={configCpuWeight} onChange={e => setConfigCpuWeight(e.target.value)}
                className="w-full bg-transparent border border-white/20 text-white text-xs px-3 py-2 focus:border-cyan-400/50 outline-none font-mono" />
            </div>
            <div>
              <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1">Storage Page Quota (0=unlimited)</label>
              <input value={configPageQuota} onChange={e => setConfigPageQuota(e.target.value)}
                className="w-full bg-transparent border border-white/20 text-white text-xs px-3 py-2 focus:border-cyan-400/50 outline-none font-mono" />
            </div>
            <div>
              <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1">Assign UID (optional)</label>
              <input value={configAssignUid} onChange={e => setConfigAssignUid(e.target.value)}
                className="w-full bg-transparent border border-white/20 text-white text-xs px-3 py-2 focus:border-cyan-400/50 outline-none font-mono"
                placeholder="leave blank to skip" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleApplyConfigure}
              className="bg-cyan-400 text-[#0B0E14] text-xs font-bold px-5 py-2 hover:bg-cyan-300 transition-colors">
              Apply
            </button>
            {configStatus && (
              <span className={`text-[10px] flex items-center gap-1 ${configStatus.startsWith("Error") || configStatus.startsWith("One") ? "text-red-400" : "text-emerald-400"}`}>
                {configStatus.startsWith("Error") || configStatus.startsWith("One") ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />} {configStatus}
              </span>
            )}
          </div>
          <p className="text-[9px] text-white/25 leading-relaxed">
            Storage page quota is a soft, admin-configurable ceiling underneath a second, hard, physical
            per-partition disk sub-range (Storage Isolation Roadmap Phase 3) — a quota set above that
            physical capacity simply never binds.
          </p>
        </div>
      )}

      {/* ── Usage Metering table -- cumulative telemetry, kept separate from
          the configuration table above since it's a read-only gauge/counter
          feed, not something this panel writes to. ─────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Gauge className="w-3.5 h-3.5 text-white/40" />
          <h3 className="text-[10px] font-bold tracking-widest uppercase text-white/50">Usage Metering</h3>
        </div>
        <div className="border border-white/10">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-white/10 text-white/40 uppercase tracking-wider">
                <th className="text-left px-3 py-2">Partition</th>
                <th className="text-left px-3 py-2">HTTP Requests (total)</th>
                <th className="text-left px-3 py-2">Frame Ticks (total)</th>
                <th className="text-left px-3 py-2">Live Frames Now</th>
              </tr>
            </thead>
            <tbody>
              {!loading && usage.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-white/30">No usage recorded yet.</td></tr>
              )}
              {usage.map(row => (
                <tr key={row.partition_id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2.5 text-cyan-400 font-bold">{row.name} <span className="text-white/30 font-normal">#{row.partition_id}</span></td>
                  <td className="px-3 py-2.5 text-white/70">{row.http_requests_total}</td>
                  <td className="px-3 py-2.5 text-white/70">{row.frame_ticks_total}</td>
                  <td className="px-3 py-2.5 text-white/70">{row.frames_now}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Disk / Tier summary -- system-wide capacity + tier totals
          (Navigator-Parity Gap Roadmap Phase 5b/5c), from the same GET
          /api/disk route the per-partition byte column above reads. ──────── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <HardDrive className="w-3.5 h-3.5 text-white/40" />
          <h3 className="text-[10px] font-bold tracking-widest uppercase text-white/50">
            Disk Status {disk && <span className="text-white/30 normal-case">— capacity {fmtBytes(disk.capacity_bytes)}</span>}
          </h3>
        </div>
        <div className="border border-white/10">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-white/10 text-white/40 uppercase tracking-wider">
                <th className="text-left px-3 py-2">Tier</th>
                <th className="text-left px-3 py-2">Bytes Used</th>
                <th className="text-left px-3 py-2">Object Count</th>
              </tr>
            </thead>
            <tbody>
              {tierEntries.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-white/30">
                  {loading ? "Loading from kernel..." : "No disk status available."}
                </td></tr>
              )}
              {tierEntries.map(([tier, t]) => (
                <tr key={tier} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2.5 text-white/70 uppercase">{tier.replace("_", " ")}</td>
                  <td className="px-3 py-2.5 text-white/70">{fmtBytes(t.bytes_used)}</td>
                  <td className="px-3 py-2.5 text-white/70">{t.object_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Tenants table ────────────────────────────────────────────────────
          Multitenant Isolation Gap Analysis §5/§7 item 1: the identity
          unifying a partition_id and a database_id under one named tenant. */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-3.5 h-3.5 text-white/40" />
          <h3 className="text-[10px] font-bold tracking-widest uppercase text-white/50">Tenants</h3>
        </div>
        <div className="border border-white/10">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-white/10 text-white/40 uppercase tracking-wider">
                <th className="text-left px-3 py-2">ID</th>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Partition</th>
                <th className="text-left px-3 py-2">Database</th>
                <th className="text-left px-3 py-2">Owner UID</th>
              </tr>
            </thead>
            <tbody>
              {!loading && tenants.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-white/30">No tenants defined. Create one to begin.</td></tr>
              )}
              {tenants.map(t => (
                <tr key={t.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2.5 text-white/40">{t.id}</td>
                  <td className="px-3 py-2.5 text-emerald-400 font-bold">{t.name}</td>
                  <td className="px-3 py-2.5 text-white/70">{t.partition_id}</td>
                  <td className="px-3 py-2.5 text-white/70">{t.database_id}</td>
                  <td className="px-3 py-2.5 text-white/70">{t.owner_uid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Create Tenant panel ──────────────────────────────────────────────── */}
      {showCreateTenant && (
        <div className="border border-emerald-500/20 bg-[#0F1219] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white uppercase tracking-wider">Create Tenant</span>
            <button onClick={() => setShowCreateTenant(false)} className="text-white/30 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div>
            <label className="text-[10px] text-white/40 uppercase tracking-wider block mb-1">Name</label>
            <input value={createTenantName} onChange={e => setCreateTenantName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleCreateTenant()}
              className="w-full bg-transparent border border-white/20 text-white text-xs px-3 py-2 focus:border-emerald-400/50 outline-none font-mono"
              placeholder="acme-corp" />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleCreateTenant}
              className="bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-bold px-5 py-2 hover:bg-emerald-500/30 transition-colors">
              Create
            </button>
            {createTenantStatus && (
              <span className={`text-[10px] ${createTenantStatus.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>
                {createTenantStatus}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
