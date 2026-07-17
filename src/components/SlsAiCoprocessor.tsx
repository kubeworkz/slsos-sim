import React, { useState, useEffect } from "react";
import { Sparkles, Send, BrainCircuit, RefreshCw, MessageSquare, ArrowRight, HelpCircle, Bot } from "lucide-react";
import { SlsObject, SlsSystemMetrics, MicrokernelService } from "../types/sls";

interface SlsAiCoprocessorProps {
  objects: SlsObject[];
  services: MicrokernelService[];
  systemMetrics: SlsSystemMetrics;
  activeUser: string;
}

export default function SlsAiCoprocessor({
  objects,
  services,
  systemMetrics,
  activeUser
}: SlsAiCoprocessorProps) {
  const [inputPrompt, setInputPrompt] = useState("");
  const [chatHistory, setChatHistory] = useState<{ sender: "user" | "coprocessor"; text: string }[]>([
    {
      sender: "coprocessor",
      text: `Welcome to the AeroSLS AI Assistant. I am connected to your configured AI backend (Ollama by default — fully local, no data leaves your machine).\n\nI can analyse virtual address states, database pointer architectures, and microkernel logs.\n\nAsk me anything, or select one of the core OS concept templates below to begin!`
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([]);

  // ── Kernel Agent mode ──────────────────────────────────────────────────────
  // When enabled, prompts are routed to POST /api/agent/run instead of the
  // sim's /api/ai/generate proxy.  The kernel orchestrates the ReAct loop.
  const [kernelMode,          setKernelMode]          = useState(false);
  const [kernelAgents,        setKernelAgents]        = useState<{name:string;model:string;state:string}[]>([]);
  const [selectedKernelAgent, setSelectedKernelAgent] = useState("");
  const [kernelRunStatus,     setKernelRunStatus]     = useState<string | null>(null);
  const AUTH_TOKEN = "deadbeef01234567cafebabe76543210";

  useEffect(() => {
    if (!kernelMode) return;
    fetch("/api/agents")
      .then(r => r.json())
      .then(d => {
        const list = d.agents || [];
        setKernelAgents(list);
        if (list.length > 0) setSelectedKernelAgent(list[0].name);
      })
      .catch(() => setKernelAgents([]));
  }, [kernelMode]);

  const handleKernelSend = async (message: string) => {
    if (!message.trim() || !selectedKernelAgent || isLoading) return;
    setChatHistory(prev => [...prev, { sender: "user", text: message }]);
    setInputPrompt("");
    setIsLoading(true);
    setKernelRunStatus(null);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${AUTH_TOKEN}` },
        body: JSON.stringify({ name: selectedKernelAgent, message }),
      });
      const data = await res.json();
      if (data.ok === "true") {
        const status = `✅ Agent **${selectedKernelAgent}** completed ${data.steps} step(s). Full answer is on the kernel serial log. Use \`agent status ${selectedKernelAgent}\` in the shell to see the last answer.`;
        setChatHistory(prev => [...prev, { sender: "coprocessor", text: status }]);
        setKernelRunStatus(`✓ ${data.steps} step(s)`);
      } else {
        setChatHistory(prev => [...prev, { sender: "coprocessor", text: `⚠️ Kernel agent error: ${data.error ?? "unknown"}` }]);
      }
    } catch (e: any) {
      setChatHistory(prev => [...prev, { sender: "coprocessor", text: `⚠️ Connection error: ${e.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const promptTemplates = [
    {
      title: "Flat Address Space",
      prompt: "Explain how Flat Single Level Storage (SLS) removes the concept of files and replaces them with direct pointer access. How does this improve database performance?"
    },
    {
      title: "Object-Level Security",
      prompt: "In a Single Level Store, there is no file system. Explain how object-level security and protection boundaries are enforced directly on memory pointers at the hardware or kernel level."
    },
    {
      title: "Microkernel & Fault Isolation",
      prompt: "Explain how our microkernel isolates service crashes (like the VirtualMemoryMgr or StorageTierMgr) in separate user-space process containers, preventing persistent memory corruption."
    },
    {
      title: "Recovery & WAL Audits",
      prompt: "How does the Write-Ahead Log (WAL) and recovery log verification service guarantee absolute database integrity during a reboot following a catastrophic power loss?"
    }
  ];

  const handleSendPrompt = async (promptText: string) => {
    if (!promptText.trim() || isLoading) return;

    // Add user message to history
    setChatHistory(prev => [...prev, { sender: "user", text: promptText }]);
    setInputPrompt("");
    setIsLoading(true);

    // Initialize simulated thinking sequence while waiting for the AI backend
    setThinkingSteps(["Initializing AI Kernel connection...", "Reading active virtual address page tables..."]);
    
    const steps = [
      "Analyzing persistent heap object allocations...",
      "Inspecting microkernel process state vectors...",
      "Evaluating Write-Ahead Log checksum parities...",
      "Formulating system-level optimization responses..."
    ];

    let currentStepIdx = 0;
    const interval = setInterval(() => {
      if (currentStepIdx < steps.length) {
        setThinkingSteps(prev => [...prev, steps[currentStepIdx]]);
        currentStepIdx++;
      } else {
        clearInterval(interval);
      }
    }, 1200);

    try {
      // Gather system state telemetry to supply as context
      const telemetryContext = `
Active System Telemetry:
- Operating System: AeroSLS Simulator (AeroSLS)
- Current Active Security Profile: ${activeUser}
- Total Heap Objects: ${objects.length}
- Object Catalog: ${JSON.stringify(objects.map(o => ({ name: o.name, type: o.type, addr: o.startAddress, tier: o.tier, sizePages: o.sizePages })))}
- Page Faults Count: ${systemMetrics.pageFaultCount}
- Overall Compression Ratio in Archival Tier: ${systemMetrics.compressionRatio}:1
- Microkernel Services Status: ${JSON.stringify(services.map(s => ({ name: s.name, state: s.state, latency: s.latencyMs, restarts: s.restarts })))}
`;

      const fullPrompt = `
${telemetryContext}

User Query: ${promptText}

Please provide a highly detailed, architecturally accurate, and professional response. Frame it from the perspective of an expert operating system architect. Use clear markdown headers, bullet points, and code blocks as needed.
`;

      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: fullPrompt }),
      });

      const contentType = response.headers.get("content-type") || "";

      // ── SSE streaming (Ollama backend) ────────────────────────────────────
      if (contentType.includes("text/event-stream")) {
        clearInterval(interval);
        setThinkingSteps([]);

        // Seed an empty message that we'll grow token by token
        setChatHistory(prev => [...prev, { sender: "coprocessor", text: "" }]);

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const chunk = JSON.parse(line.slice(6));
              if (chunk.token) {
                accumulated += chunk.token;
                // Update the last message in-place so the cursor feels live
                setChatHistory(prev => {
                  const next = [...prev];
                  next[next.length - 1] = { sender: "coprocessor", text: accumulated };
                  return next;
                });
              }
            } catch { /* partial */ }
          }
        }
        setIsLoading(false);
        return;
      }

      // ── Guard: not JSON and not SSE (e.g. nginx returned HTML) ───────────
      if (!contentType.includes("application/json")) {
        clearInterval(interval);
        setChatHistory(prev => [...prev, {
          sender: "coprocessor",
          text: "⚠️ **AI backend not available.** The AI service requires the Express server (port 3000) to be running with an AI backend configured.\n\n**To enable:**\n1. Set `AI_BACKEND=ollama` (or `claude` / `openai`) in `/home/ubuntu/slsos-sim/.env`\n2. Start the Express server: `cd /home/ubuntu/slsos-sim && npm run dev`\n\nThe rest of the Navigator (kernel API, DB Engine, Stream Library) works without it."
        }]);
        setIsLoading(false);
        setThinkingSteps([]);
        return;
      }

      // ── Non-streaming JSON (Claude / OpenAI backends) ─────────────────────
      const data = await response.json();
      clearInterval(interval);

      if (data.error) {
        setChatHistory(prev => [
          ...prev,
          { sender: "coprocessor", text: `⚠️ **System Error:** ${data.error}` }
        ]);
      } else {
        setChatHistory(prev => [
          ...prev,
          { sender: "coprocessor", text: data.text || "No response received." }
        ]);
      }
    } catch (err: any) {
      clearInterval(interval);
      setChatHistory(prev => [
        ...prev,
          { sender: "coprocessor", text: `⚠️ **Connection Error:** Failed to establish communication pipeline with the AI assistant. Details: ${err.message || err}` }
      ]);
    } finally {
      setIsLoading(false);
      setThinkingSteps([]);
    }
  };

  // Basic custom markdown formatter to format headers, bold words, lists, and code blocks
  const formatMessageText = (text: string) => {
    return text.split("\n").map((line, idx) => {
      // Code blocks
      if (line.startsWith("```")) {
        return null; // For simplicity we strip code fences or wrap code blocks
      }
      
      // Headers
      if (line.startsWith("### ")) {
        return (
          <h4 key={idx} className="text-sm font-bold text-white mt-4 mb-2 border-b border-zinc-800 pb-1 flex items-center gap-1.5 font-mono">
            <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
            {line.replace("### ", "")}
          </h4>
        );
      }
      if (line.startsWith("## ")) {
        return (
          <h3 key={idx} className="text-base font-bold text-cyan-400 mt-5 mb-2 flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 shrink-0" />
            {line.replace("## ", "")}
          </h3>
        );
      }

      // Bullet points
      if (line.startsWith("- ") || line.startsWith("* ")) {
        const cleanLine = line.substring(2);
        return (
          <li key={idx} className="text-xs text-zinc-300 ml-4 list-disc pl-1 mb-1 leading-relaxed">
            {formatBoldText(cleanLine)}
          </li>
        );
      }

      // Standard paragraphs
      return (
        <p key={idx} className="text-xs text-zinc-300 leading-relaxed mb-3">
          {formatBoldText(line)}
        </p>
      );
    });
  };

  // Helper to highlight **bold** text in paragraphs
  const formatBoldText = (text: string) => {
    const parts = text.split(/\*\*([\s\S]*?)\*\*/g);
    if (parts.length === 1) return text;
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        return <strong key={i} className="text-white font-semibold">{part}</strong>;
      }
      return part;
    });
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8" id="sls-ai-coprocessor">
      
      {/* LEFT COLUMN: ACTIVE CHAT CONSOLE */}
      <div className="xl:col-span-2 bg-[#0B0E14] p-8 border border-white/10 flex flex-col h-[560px] justify-between">
        <div>
          <div className="flex justify-between items-center border-b border-white/10 pb-4 mb-6">
            <div className="flex items-center gap-3">
              <Sparkles className="text-amber-400 w-5 h-5 animate-pulse" />
              <div>
                <span className="font-mono text-[10px] tracking-widest text-amber-400 uppercase font-semibold">AI Assistant</span>
                <h3 className="text-2xl font-serif italic text-white mt-1">
                  AI Assistant
                </h3>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Kernel Agent mode toggle */}
              <button
                onClick={() => setKernelMode(prev => !prev)}
                title="Route prompts to a kernel-resident AI agent"
                className={`flex items-center gap-1.5 font-mono text-[9px] tracking-widest uppercase px-2.5 py-1.5 cursor-pointer transition-colors border ${
                  kernelMode
                    ? "bg-cyan-400/10 border-cyan-400/40 text-cyan-400 hover:bg-cyan-400/20"
                    : "border-white/10 text-white/30 hover:text-white hover:border-white/25"
                }`}
              >
                <Bot className="w-3 h-3" />
                {kernelMode ? "Kernel Agent" : "Sim AI"}
              </button>
              <button
                onClick={() => setChatHistory([
                  { sender: "coprocessor", text: "Chat history cleared. How can I assist you with AeroSLS architecture analysis?" }
                ])}
                className="font-mono text-[9px] tracking-widest uppercase text-white/40 hover:text-white border border-white/10 hover:border-white/25 px-2.5 py-1.5 cursor-pointer transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Kernel Agent selector — shown when kernel mode is active */}
          {kernelMode && (
            <div className="flex items-center gap-2 mb-3 p-2 bg-cyan-400/5 border border-cyan-400/20">
              <Bot className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="text-[10px] text-cyan-400 font-mono uppercase tracking-wider shrink-0">Agent:</span>
              {kernelAgents.length === 0 ? (
                <span className="text-[10px] text-white/30 font-mono">No kernel agents found — create one in the AI Agents tab.</span>
              ) : (
                <select value={selectedKernelAgent} onChange={e => setSelectedKernelAgent(e.target.value)}
                  className="flex-1 bg-transparent border border-cyan-400/30 text-cyan-400 text-[10px] px-2 py-1 outline-none font-mono">
                  {kernelAgents.map(ag => (
                    <option key={ag.name} value={ag.name} className="bg-[#0B0E14]">
                      {ag.name} ({ag.model}) — {ag.state}
                    </option>
                  ))}
                </select>
              )}
              {kernelRunStatus && (
                <span className="text-[10px] text-emerald-400 font-mono shrink-0">{kernelRunStatus}</span>
              )}
            </div>
          )}

          {/* Chat Message Thread */}
          <div className="overflow-y-auto h-[320px] mb-4 space-y-4 pr-2 scrollbar-thin">
            {chatHistory.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-3 max-w-[85%] ${
                  msg.sender === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
                }`}
              >
                <div className={`w-8 h-8 flex items-center justify-center shrink-0 border ${
                  msg.sender === "user" 
                    ? "bg-[#0F1219] border-white/10 text-white" 
                    : "bg-[#0F1219] border-amber-500/20 text-amber-400"
                }`}>
                  {msg.sender === "user" ? <MessageSquare className="w-4 h-4" /> : <BrainCircuit className="w-4 h-4" />}
                </div>
                <div className={`p-4 text-xs space-y-1 ${
                  msg.sender === "user"
                    ? "bg-[#0F1219] border border-white/10 text-white/80"
                    : "bg-[#0F1219] border border-white/10 text-white/80"
                }`}>
                  {formatMessageText(msg.text)}
                </div>
              </div>
            ))}

            {/* Glowing loader with dynamic thinking steps */}
            {isLoading && (
              <div className="flex gap-3 max-w-[85%] mr-auto animate-fadeIn">
                <div className="w-8 h-8 flex items-center justify-center shrink-0 border bg-[#0F1219] border-amber-500/20 text-amber-400">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                </div>
                <div className="p-5 bg-[#0F1219] border border-white/10 w-full space-y-3">
                  <div className="flex items-center gap-2 text-amber-400 text-xs font-mono uppercase tracking-wider font-semibold">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                    AI reasoning...
                  </div>
                  
                  {/* Visualizing reasoning steps */}
                  <div className="space-y-1.5 border-l border-white/10 pl-3 font-mono text-[10px] text-white/40">
                    {thinkingSteps.map((step, idx) => (
                      <div key={idx} className="flex items-center gap-1 animate-fadeIn">
                        <span className="text-emerald-400">✓</span>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Chat Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (kernelMode) handleKernelSend(inputPrompt);
            else            handleSendPrompt(inputPrompt);
          }}
          className="flex gap-2 border-t border-white/10 pt-4"
        >
          <input
            type="text"
            disabled={isLoading || (kernelMode && kernelAgents.length === 0)}
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            placeholder={kernelMode
              ? `Send to kernel agent '${selectedKernelAgent}'…`
              : "Query virtual space, ask about pointer-based paging, or design security traps..."}
            className={`flex-1 bg-[#0F1219] border px-4 py-3 text-xs text-white placeholder-white/30 focus:outline-none disabled:opacity-50 ${
              kernelMode ? "border-cyan-400/30 focus:border-cyan-400" : "border-white/10 focus:border-amber-400"
            }`}
          />
          <button
            type="submit"
            disabled={isLoading || !inputPrompt.trim() || (kernelMode && kernelAgents.length === 0)}
            className={`disabled:bg-white/5 disabled:text-white/20 text-[#0B0E14] p-3 flex items-center justify-center cursor-pointer transition-all active:scale-[0.98] ${
              kernelMode ? "bg-cyan-400 hover:bg-cyan-300" : "bg-amber-400 hover:bg-amber-300"
            }`}
          >
            {kernelMode ? <Bot className="w-4 h-4" /> : <Send className="w-4.5 h-4.5" />}
          </button>
        </form>
      </div>

      {/* RIGHT COLUMN: EDUCATIONAL TEMPLATE SELECTORS */}
      <div className="bg-[#0B0E14] p-8 border border-white/10 flex flex-col justify-between h-[560px]">
        <div>
          <span className="font-mono text-[10px] tracking-widest text-amber-400 uppercase font-semibold">OS Concept Templates</span>
          <h3 className="text-xl font-serif italic text-white mt-1 border-b border-white/10 pb-4 mb-6">
            Architecture Guides
          </h3>
          <p className="text-white/60 text-xs font-light leading-relaxed mb-6">
            Click on any conceptual card below. The AI Assistant will evaluate our current active memory simulation state and draft a precise, deep-dive architectural analysis!
          </p>

          <div className="space-y-3.5">
            {promptTemplates.map((tmpl, idx) => (
              <button
                key={idx}
                disabled={isLoading}
                onClick={() => handleSendPrompt(tmpl.prompt)}
                className="w-full bg-[#0F1219] border border-white/10 hover:border-white/25 p-4 text-left cursor-pointer transition-all group disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-serif italic text-white group-hover:text-amber-400 transition-colors">
                    {tmpl.title}
                  </span>
                  <span className="text-[9px] font-mono text-white/35 border border-white/10 px-1.5 py-0.5 uppercase tracking-wider">
                    Query Block
                  </span>
                </div>
                <p className="text-[10px] text-white/50 leading-relaxed line-clamp-2 font-light">
                  {tmpl.prompt}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* AI telemetric footprint */}
        <div className="border-t border-white/10 pt-4 text-[9px] text-white/30 uppercase tracking-widest flex justify-between font-mono">
          <span>Telemetry: Linked</span>
          <span>Sync: 100%</span>
        </div>
      </div>
    </div>
  );
}
