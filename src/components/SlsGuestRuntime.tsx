/**
 * SlsGuestRuntime.tsx — QEMU-SLS, the in-node guest runtime.
 *
 * ─── What this screen is for ────────────────────────────────────────────────
 * QEMU-SLS is QEMU's TCG linked into the AeroSLS kernel (15 objects) so a node
 * can execute guest binaries INSIDE itself. It is not the qemu-system-x86_64
 * that runs the node -- that one is stock, launched by run-cluster.sh. Two
 * different QEMUs at two different layers, and conflating them is the easiest
 * mistake to make about this architecture, which is why the banner below says
 * so on screen rather than only in this comment.
 *
 * ─── Why cold-vs-warm and not a live chart ──────────────────────────────────
 * The interesting property is that translated guest code is a persistent
 * object: compiled once, written to NVMe with the checkpoint, restored on the
 * next boot. Run the bench twice and the second run compiles nothing. That is
 * one number going to zero, which a side-by-side shows better than any
 * animation -- 8 blocks becomes 0, 8,003 bytes becomes 0, and the cache serves
 * every block instead.
 *
 * ─── Why CODE bytes is the headline and cycles are not ──────────────────────
 * code_bytes has never varied across any sample this project has taken -- the
 * same 8,003 across boots, builds and a week of commits. The cycle columns
 * carry a ~10% cold CV and, on a host without KVM, are dominated by the OUTER
 * emulator translating our JIT's output rather than by the guest. They are
 * shown for completeness, greyed, and explicitly not the figure to quote.
 *
 * ─── No "run a binary" control, deliberately ────────────────────────────────
 * `qemu run <hex>` exists on the serial console but has no HTTP route: it
 * feeds arbitrary bytes to the guest frontend and the shadow-paging fault
 * path, and the frontend implements 18 opcodes so it could not run a real
 * binary anyway. A box that answered "unsupported opcode" to everything a
 * visitor tried would make honest work look broken.
 */
import React, { useState } from "react";
import { Cpu, Play, Zap, ShieldCheck, AlertCircle, Layers } from "lucide-react";
import { authFetch } from "../lib/apiFetch";

/** Shape of POST /api/qemu/bench, captured from a live node — not inferred.
 *  Note the string booleans: this kernel emits "true"/"false" as JSON strings
 *  (jb_str, see net/http.c), so these are compared, never used as truthy. */
interface BenchResult {
  ok: string;
  loads: number;
  insns: number;
  total_cycles: number;
  exec_cycles: number;
  translate_cycles: number;
  blocks: number;
  code_bytes: number;
  tcache_hits: number;
  tcache_misses: number;
  cold: string;
  arena_consumed: number;
  arena_used: number;
  arena_total: number;
  softmmu: string;
  error?: string;
  min?: number;
  max?: number;
  requested?: number;
}

const LOADS = 500;

function Stat({ label, value, unit, dim, hero }: {
  label: string; value: string | number; unit?: string; dim?: boolean; hero?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span className="font-mono text-[9px] text-white/30 uppercase">{label}</span>
      <span className={
        (hero ? "font-mono text-sm " : "font-mono text-[11px] ") +
        (dim ? "text-white/35" : hero ? "text-cyan-300" : "text-white/80")
      }>
        {value}{unit ? <span className="text-white/30 text-[9px] ml-0.5">{unit}</span> : null}
      </span>
    </div>
  );
}

function RunPanel({ title, r, subtitle }: { title: string; r: BenchResult | null; subtitle: string }) {
  return (
    <div className="bg-[#0B0E14] border border-white/5 p-4 space-y-2.5">
      <div className="flex justify-between items-center border-b border-white/10 pb-2 mb-1">
        <span className="font-mono text-[10px] text-white/60 uppercase tracking-wider">{title}</span>
        {r && (
          <span className={"font-mono text-[9px] px-1.5 py-0.5 border " +
            (r.cold === "true"
              ? "text-amber-300 border-amber-400/30"
              : "text-emerald-300 border-emerald-400/30")}>
            {r.cold === "true" ? "COMPILED" : "FROM CACHE"}
          </span>
        )}
      </div>
      {!r ? (
        <div className="font-mono text-[10px] text-white/25 py-6 text-center">{subtitle}</div>
      ) : (
        <>
          <Stat label="blocks compiled" value={r.blocks} hero />
          <Stat label="code emitted" value={r.code_bytes.toLocaleString()} unit="bytes" hero />
          <Stat label="cache hits" value={r.tcache_hits} />
          <Stat label="cache misses" value={r.tcache_misses} />
          <Stat label="arena consumed" value={r.arena_consumed.toLocaleString()} unit="bytes" />
          <Stat label="guest instructions" value={r.insns} />
          <div className="border-t border-white/5 pt-2 mt-2 space-y-2">
            {/* Shown, greyed, and not the figure to quote. See the header note. */}
            <Stat label="translate cycles" value={r.translate_cycles.toLocaleString()} dim />
            <Stat label="exec cycles" value={r.exec_cycles.toLocaleString()} dim />
          </div>
        </>
      )}
    </div>
  );
}

export default function SlsGuestRuntime() {
  const [cold, setCold] = useState<BenchResult | null>(null);
  const [warm, setWarm] = useState<BenchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paging, setPaging] = useState<{ pass: boolean; rc: number } | null>(null);
  const [softmmu, setSoftmmu] = useState<string | null>(null);

  async function runBench() {
    setBusy(true); setError(null);
    try {
      const res = await authFetch("/api/qemu/bench", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loads: LOADS }),
      });
      const d: BenchResult = await res.json();
      if (d.ok !== "true") {
        setError(d.min !== undefined
          ? `${d.error} — loads must be ${d.min}..${d.max}, got ${d.requested}`
          : (d.error || "bench failed"));
        return;
      }
      setSoftmmu(d.softmmu);
      // The KERNEL decides which of these a run is, not the UI. It uses the
      // same test the serial console uses to print "cold: every block was
      // compiled", so the two can never disagree about the same run.
      if (d.cold === "true") { setCold(d); setWarm(null); } else { setWarm(d); }
    } catch (e: any) {
      setError(e?.message || "request failed");
    } finally { setBusy(false); }
  }

  async function runPaging() {
    setBusy(true); setError(null);
    try {
      const res = await authFetch("/api/qemu/paging", { method: "POST" });
      const d = await res.json();
      setPaging({ pass: d.pass === "true", rc: Number(d.rc ?? -1) });
    } catch (e: any) {
      setError(e?.message || "request failed");
    } finally { setBusy(false); }
  }

  const savedBytes = cold && warm ? cold.code_bytes - warm.code_bytes : null;

  return (
    <div className="p-6 space-y-5 overflow-y-auto">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="font-serif italic text-lg text-white flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-400" /> Guest Runtime — QEMU-SLS
          </h2>
          <p className="font-mono text-[10px] text-white/40 mt-1">
            Binary translation inside the node · TCG linked into the kernel
          </p>
        </div>
        {softmmu && (
          <span className="font-mono text-[9px] px-2 py-1 border border-white/10 text-white/50">
            softmmu={softmmu}
          </span>
        )}
      </div>

      {/* The one thing this screen must not let a visitor conclude. */}
      <div className="flex gap-2 items-start bg-[#0F1219] border border-white/10 p-3">
        <Layers className="w-3.5 h-3.5 text-white/30 mt-0.5 shrink-0" />
        <p className="font-mono text-[10px] text-white/45 leading-relaxed">
          This is a guest running <span className="text-white/70">inside</span> this node — not how
          the node itself runs. AeroSLS nodes are launched by stock qemu-system-x86_64; QEMU-SLS is
          how a node executes foreign binaries within itself.
        </p>
      </div>

      <div className="flex gap-2">
        <button onClick={runBench} disabled={busy}
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider px-3 py-2 border border-cyan-400/30 text-cyan-300 hover:bg-cyan-400/10 disabled:opacity-40">
          <Play className="w-3 h-3" /> Run benchmark ({LOADS} loads)
        </button>
        <button onClick={runPaging} disabled={busy}
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider px-3 py-2 border border-white/15 text-white/60 hover:bg-white/5 disabled:opacity-40">
          <ShieldCheck className="w-3 h-3" /> Test guest paging
        </button>
      </div>

      {error && (
        <div className="flex gap-2 items-center bg-red-500/5 border border-red-400/20 p-3">
          <AlertCircle className="w-3.5 h-3.5 text-red-300 shrink-0" />
          <span className="font-mono text-[10px] text-red-300">{error}</span>
        </div>
      )}

      {paging && (
        <div className={"flex gap-2 items-center border p-3 " +
          (paging.pass ? "bg-emerald-500/5 border-emerald-400/20" : "bg-red-500/5 border-red-400/20")}>
          <ShieldCheck className={"w-3.5 h-3.5 shrink-0 " + (paging.pass ? "text-emerald-300" : "text-red-300")} />
          <span className={"font-mono text-[10px] " + (paging.pass ? "text-emerald-300" : "text-red-300")}>
            {paging.pass
              ? "Guest paging PASS — the shadow walker resolved a GVA through the guest's own page tables"
              : `Guest paging FAIL (rc=${paging.rc})`}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <RunPanel title="First run since boot" r={cold}
          subtitle="Run the benchmark to compile the guest" />
        <RunPanel title="Repeat run" r={warm}
          subtitle="Run it again — nothing should be compiled" />
      </div>

      {savedBytes !== null && savedBytes > 0 && (
        <div className="flex gap-2 items-center bg-[#0F1219] border border-cyan-400/20 p-3">
          <Zap className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
          <span className="font-mono text-[10px] text-white/60">
            The repeat run compiled <span className="text-cyan-300">nothing</span>: all{" "}
            <span className="text-cyan-300">{cold!.blocks}</span> blocks were served from the
            translation cache, and{" "}
            <span className="text-cyan-300">{savedBytes.toLocaleString()}</span> bytes of host code
            did not need to be emitted again. That cache survives a reboot — it is written to NVMe
            with the checkpoint.
          </span>
        </div>
      )}
    </div>
  );
}
