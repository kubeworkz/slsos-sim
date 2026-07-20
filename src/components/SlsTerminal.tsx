import React, { useState, useRef, useEffect, useCallback } from "react";
import { TerminalSquare } from "lucide-react";
import { runCommand, isDestructive, CLEAR_COMMAND } from "../lib/shellCommands";

// ─────────────────────────────────────────────────────────────────────────────
// Terminal 2 (docs/AeroSLS-Web-Terminal-Plan-v0.1.md §4): a line-based
// request/response console over the command router built in shellCommands.ts
// (Terminal 1). Not a pty/xterm.js integration -- per the plan's §7 scope
// note, shell.c itself is one-line-in/one-block-out too, so this matches
// that rather than exceeding it.
//
// Destructive-command confirmation (Terminal 3, §6) is wired here rather
// than deferred to a later pass -- it's a small, self-contained bit of
// state (`pendingConfirm`) and building the scrollback UI without it would
// mean redoing the input-submit handler twice.
// ─────────────────────────────────────────────────────────────────────────────

type LineType = "input" | "output" | "error" | "confirm" | "banner";
interface Line { type: LineType; text: string; }

const PROMPT = "aerosls$ ";
const BANNER = [
  "AeroSLS Web Terminal — client-side command router over the live HTTP API.",
  "Type 'help' for the full command list, 'clear' to clear this screen.",
].join("\n");

export default function SlsTerminal() {
  const [lines, setLines] = useState<Line[]>([{ type: "banner", text: BANNER }]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  const appendLines = (...next: Line[]) => setLines(prev => [...prev, ...next]);

  const execute = useCallback(async (commandLine: string) => {
    setBusy(true);
    try {
      const result = await runCommand(commandLine);
      if (result.text) appendLines({ type: result.isError ? "error" : "output", text: result.text });
    } catch (e: any) {
      appendLines({ type: "error", text: `✖ ${e?.message || "request failed"}` });
    }
    setBusy(false);
  }, []);

  const submit = useCallback(async (raw: string) => {
    const text = raw; // preserve exact text (including case) for confirmation echo
    const trimmed = text.trim();

    // ── Awaiting a y/N confirmation for a previously-entered destructive command ──
    if (pendingConfirm !== null) {
      appendLines({ type: "input", text: `${PROMPT}${text}` });
      const confirmed = /^(y|yes)$/i.test(trimmed);
      const target = pendingConfirm;
      setPendingConfirm(null);
      if (confirmed) {
        await execute(target);
      } else {
        appendLines({ type: "output", text: "cancelled." });
      }
      return;
    }

    if (!trimmed) { appendLines({ type: "input", text: PROMPT }); return; }

    appendLines({ type: "input", text: `${PROMPT}${trimmed}` });
    setHistory(prev => [trimmed, ...prev.filter(h => h !== trimmed)].slice(0, 200));
    setHistoryIndex(null);

    if (trimmed === CLEAR_COMMAND) {
      setLines([]);
      return;
    }

    if (isDestructive(trimmed)) {
      appendLines({ type: "confirm", text: `Confirm: ${trimmed}? [y/N]` });
      setPendingConfirm(trimmed);
      return;
    }

    await execute(trimmed);
  }, [pendingConfirm, execute]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (busy) return;
      const value = input;
      setInput("");
      submit(value);
      return;
    }
    if (e.key === "ArrowUp") {
      if (pendingConfirm !== null || history.length === 0) return;
      e.preventDefault();
      const nextIndex = historyIndex === null ? 0 : Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(nextIndex);
      setInput(history[nextIndex]);
      return;
    }
    if (e.key === "ArrowDown") {
      if (pendingConfirm !== null || historyIndex === null) return;
      e.preventDefault();
      const nextIndex = historyIndex - 1;
      if (nextIndex < 0) { setHistoryIndex(null); setInput(""); }
      else { setHistoryIndex(nextIndex); setInput(history[nextIndex]); }
      return;
    }
  };

  const lineColor = (t: LineType) =>
    t === "error" ? "text-red-400/90" :
    t === "confirm" ? "text-yellow-400/90" :
    t === "input" ? "text-cyan-400" :
    t === "banner" ? "text-white/40" :
    "text-white/80";

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="mb-6">
        <span className="font-mono text-[10px] tracking-widest text-cyan-400 uppercase font-bold">Terminal // AeroSLS</span>
        <h2 className="text-2xl font-serif italic text-white mt-1 border-b border-white/10 pb-4">
          Command Line
        </h2>
        <p className="text-[11px] font-mono text-white/40 mt-3 leading-relaxed">
          A client-side command router over the live HTTP API — no QEMU serial console needed. Covers most of{" "}
          <code className="text-cyan-400">user/shell.c</code>'s command surface; a few commands with no HTTP route yet
          are listed honestly in <code className="text-cyan-400">help</code> rather than silently failing.
        </p>
      </div>

      {/* Terminal panel */}
      <div
        className="border border-white/10 bg-[#0B0E14] flex flex-col cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-[9px] font-mono tracking-widest uppercase text-white/40 flex items-center gap-1.5">
            <TerminalSquare className="w-3 h-3" /> Session
          </span>
          <span className="text-[9px] font-mono text-white/20">↑/↓ for history</span>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto max-h-[480px] min-h-[320px] px-4 py-3 space-y-2">
          {lines.map((l, i) => (
            <pre key={i} className={`font-mono text-xs whitespace-pre-wrap break-words leading-relaxed ${lineColor(l.type)}`}>
              {l.text}
            </pre>
          ))}
          {busy && <pre className="font-mono text-xs text-white/30">running…</pre>}
        </div>

        <div className="border-t border-white/10 px-4 py-3 flex items-center gap-2">
          <span className={`font-mono text-xs shrink-0 ${pendingConfirm !== null ? "text-yellow-400/90" : "text-cyan-400"}`}>
            {pendingConfirm !== null ? "confirm [y/N]" : PROMPT.trim()}
          </span>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
            placeholder={pendingConfirm !== null ? "y / N" : "type a command…"}
            className="flex-1 min-w-0 bg-transparent text-white font-mono text-xs outline-none placeholder:text-white/20 disabled:opacity-40"
          />
        </div>
      </div>
    </div>
  );
}
