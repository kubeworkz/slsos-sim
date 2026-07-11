import React, { useState } from "react";
import { 
  Brain, 
  Search, 
  Sparkles, 
  Cpu, 
  Database, 
  Layers, 
  CheckCircle, 
  Terminal, 
  ArrowRight, 
  HelpCircle, 
  Activity,
  Shield,
  Zap,
  HardDrive
} from "lucide-react";
import { SlsObject, SlsSystemMetrics, MicrokernelService, SlsUser } from "../types/sls";

interface SlsDeepThinkingQueryProps {
  objects: SlsObject[];
  services: MicrokernelService[];
  systemMetrics: SlsSystemMetrics;
  activeUser: string;
}

interface QueryResultItem {
  address: string;
  name: string;
  tier: string;
  pages: number;
  owner: string;
  verification: string;
  content: string;
}

export default function SlsDeepThinkingQuery({
  objects,
  services,
  systemMetrics,
  activeUser
}: SlsDeepThinkingQueryProps) {
  const [queryText, setQueryText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([]);
  const [rawResponse, setRawResponse] = useState<string | null>(null);
  const [structuredResults, setStructuredResults] = useState<QueryResultItem[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Quick preset queries demonstrating no file systems & no SQL
  const presets = [
    {
      title: "Audit Active Financial Ledgers",
      query: "Find any active tables or segments containing ledger or customer transactions, list their page allocations, and verify that APP_USER has read but not write access."
    },
    {
      title: "SRAM Tier Access Check",
      query: "List all virtual address segments loaded into the L1 Cache (SRAM) tier, show their memory owners, and check if any contain raw telemetry or system metadata."
    },
    {
      title: "Verify Microkernel Service Health",
      query: "Scan the active microkernel services and identify if any system process is failed or degraded, then check if that affects our transactional logs."
    },
    {
      title: "Analyze Profile Protection Rings",
      query: "Locate all objects classified as user profiles, verify their protection ring owner, and summarize their memory addresses."
    }
  ];

  const handleRunQuery = async (searchPrompt: string) => {
    if (!searchPrompt.trim() || isLoading) return;

    setQueryText(searchPrompt);
    setIsLoading(true);
    setRawResponse(null);
    setStructuredResults([]);
    setErrorMsg(null);

    // Dynamic, high-fidelity cognitive processing phases
    setThinkingSteps([
      "Mapping user natural language query to cognitive register...",
      "Bypassing File System driver layers (no path resolution required)..."
    ]);

    const delaySteps = [
      "Accessing Single Level Storage unified 64-bit flat pointer-space...",
      "Scanning active RAM and SRAM cache tables directly...",
      "Evaluating Protection Ring (ACL) authorization states...",
      "Compiling non-SQL relational memory projections...",
      "Synthesizing address space objects in Deep Reasoner..."
    ];

    let currentIdx = 0;
    const interval = setInterval(() => {
      if (currentIdx < delaySteps.length) {
        setThinkingSteps(prev => [...prev, delaySteps[currentIdx]]);
        currentIdx++;
      } else {
        clearInterval(interval);
      }
    }, 1100);

    try {
      // Build full system context to feed to Gemini
      const memoryContext = {
        architecture: "Single Level Storage OS (Flat Memory Space, Zero Filesystem, Direct Pointers)",
        metrics: {
          totalAllocatedPages: systemMetrics.totalAllocatedPages,
          pageFaultCount: systemMetrics.pageFaultCount,
          compressionRatio: systemMetrics.compressionRatio,
          totalAccesses: systemMetrics.totalAccesses
        },
        services: services.map(s => ({
          name: s.name,
          state: s.state,
          restarts: s.restarts,
          address: s.memoryAddress
        })),
        objects: objects.map(o => ({
          id: o.id,
          name: o.name,
          type: o.type,
          address: o.startAddress,
          pages: o.sizePages,
          tier: o.tier,
          owner: o.owner,
          acl: o.acl,
          data: o.data
        }))
      };

      const systemInstruction = `You are the Google Deep Thinking Data Query Engine for the Single Level Storage (SLS) operating system.
In an SLS OS, there are NO files, NO folders, and NO hierarchical file systems. Everything resides in a unified flat 64-bit virtual address space.
Furthermore, there is NO relational SQL engine. Queries are executed directly against memory pages and pointers using cognitive deep-thinking reasoning.

Analyze the user's natural language query using the provided active system memory space telemetry.
Generate your response in standard Markdown containing:
1. A **Deep Thinking Reasoning Log**: Outline your cognitive steps, showing exactly how you scanned the flat memory space, evaluated permissions on the objects' ACLs, checked caching tiers, and projected the results without utilizing any files or SQL. Use a detailed, professional style.
2. A clear **Human-Readable Query Result Summary**.

At the absolute end of your response, you MUST provide a synthesized dataset wrapped inside a unique \`\`\`json-result block. This block should contain a valid JSON array of matched memory objects. Do NOT use any other key or name. The schema of each object in the array must strictly match this TypeScript interface:
interface QueryResultItem {
  address: string;    // Virtual address of the object, e.g. 0x0000_1000_A200_0000
  name: string;       // Object name
  tier: string;       // Storage tier, e.g. L1_CACHE, L2_DRAM, L3_SSD
  pages: number;      // Number of 4KB pages
  owner: string;      // SlsUser owner
  verification: string; // Brief security/integrity check status (e.g., "PASSED - Ring 0 Protection")
  content: string;    // Brief summary of the raw data/payload stored in this segment
}

Maintain a serious, highly advanced, scientific, and authoritative tone of a next-generation cognitive operating system.`;

      const prompt = `Active System Memory Space Telemetry:
${JSON.stringify(memoryContext, null, 2)}

User Natural Language Query: "${searchPrompt}"`;

      const response = await fetch("/api/gemini/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, systemInstruction }),
      });

      clearInterval(interval);

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }

      const text = data.text || "No query projection obtained.";
      setRawResponse(text);

      // Parse the special json-result block
      const jsonRegex = /```json-result([\s\S]*?)```/;
      const match = text.match(jsonRegex);
      if (match && match[1]) {
        try {
          const parsed = JSON.parse(match[1].trim());
          if (Array.isArray(parsed)) {
            setStructuredResults(parsed as QueryResultItem[]);
          }
        } catch (parseErr) {
          console.warn("Failed to parse dynamic json-result block:", parseErr);
        }
      } else {
        // Fallback: search for standard json block if json-result was not exact
        const fallbackRegex = /```json([\s\S]*?)```/;
        const fallbackMatch = text.match(fallbackRegex);
        if (fallbackMatch && fallbackMatch[1]) {
          try {
            const parsed = JSON.parse(fallbackMatch[1].trim());
            if (Array.isArray(parsed)) {
              setStructuredResults(parsed as QueryResultItem[]);
            }
          } catch (e) {}
        }
      }

    } catch (err: any) {
      clearInterval(interval);
      setErrorMsg(err.message || String(err));
    } finally {
      setIsLoading(false);
      setThinkingSteps([]);
    }
  };

  // Extract clean text (removing the JSON block to keep markdown clean)
  const getDisplayMarkdown = () => {
    if (!rawResponse) return "";
    return rawResponse.replace(/```json-result[\s\S]*?```/, "").replace(/```json[\s\S]*?```/, "").trim();
  };

  const formattedMarkdown = (text: string) => {
    return text.split("\n").map((line, idx) => {
      if (line.startsWith("### ")) {
        return (
          <h4 key={idx} className="text-sm font-bold text-white mt-4 mb-2 border-b border-white/5 pb-1 flex items-center gap-1.5 font-mono uppercase tracking-wider text-cyan-400">
            <ArrowRight className="w-3.5 h-3.5" />
            {line.substring(4)}
          </h4>
        );
      }
      if (line.startsWith("## ")) {
        return (
          <h3 key={idx} className="text-base font-serif italic text-white mt-5 mb-2.5 flex items-center gap-2 border-l-2 border-cyan-400 pl-2">
            {line.substring(3)}
          </h3>
        );
      }
      if (line.startsWith("# ")) {
        return (
          <h2 key={idx} className="text-lg font-serif italic text-cyan-400 mt-6 mb-3 border-b border-cyan-500/10 pb-2">
            {line.substring(2)}
          </h2>
        );
      }
      if (line.startsWith("- ") || line.startsWith("* ")) {
        return (
          <li key={idx} className="text-xs text-zinc-300 ml-5 list-disc mb-1 leading-relaxed">
            {formatInlineBold(line.substring(2))}
          </li>
        );
      }
      return (
        <p key={idx} className="text-xs text-zinc-300 leading-relaxed mb-2.5 font-light">
          {formatInlineBold(line)}
        </p>
      );
    });
  };

  const formatInlineBold = (text: string) => {
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
    <div className="space-y-8" id="sls-deep-thinking-query">
      
      {/* 1. INTRO HEADER CARD */}
      <div className="bg-[#0B0E14] border border-white/10 p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="bg-cyan-500/10 border border-cyan-400/25 p-1.5 text-cyan-400">
              <Brain className="w-5 h-5 animate-pulse" />
            </div>
            <span className="font-mono text-[10px] tracking-widest text-cyan-400 uppercase font-bold">
              Cognitive Space Query Engine
            </span>
          </div>
          <h2 className="text-3xl font-serif italic text-white">
            Google Deep Thinking Data Queries
          </h2>
          <p className="text-xs text-white/50 max-w-3xl leading-relaxed font-light">
            An address-space query model powered by real-time reasoning. Because Single Level Storage binds files and code into a single flat 64-bit virtual address plane, there is **no traditional file system** to scan and **no SQL layers** to compile. The AI reasoner scans the raw memory objects directly in response to natural language.
          </p>
        </div>
        <div className="bg-[#0F1219] border border-white/10 p-4 shrink-0 font-mono text-[10px] space-y-2 uppercase tracking-wider text-white/40">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
            <span>Filesystems: <strong className="text-red-400">Bypassed (0%)</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
            <span>SQL Database: <strong className="text-red-400">Not Compiled (0%)</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span>Query Logic: <strong className="text-cyan-400">Cognitive Direct</strong></span>
          </div>
        </div>
      </div>

      {/* 2. DYNAMIC QUERY BAR */}
      <div className="bg-[#0B0E14] border border-white/10 p-8">
        <h3 className="font-mono text-[10px] tracking-widest text-white/40 uppercase mb-3.5 font-bold">
          Input Natural Language Query
        </h3>
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            handleRunQuery(queryText);
          }}
          className="flex gap-3"
        >
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 w-4 h-4" />
            <input
              type="text"
              required
              disabled={isLoading}
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="e.g., Scan all uncompressed segments above 4 pages and check if they contain database tables..."
              className="w-full bg-[#0F1219] border border-white/10 pl-11 pr-4 py-4 text-xs text-white placeholder-white/20 focus:outline-none focus:border-cyan-400 disabled:opacity-50 font-mono"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !queryText.trim()}
            className="bg-cyan-400 hover:bg-cyan-300 disabled:bg-white/5 disabled:text-white/20 text-[#0B0E14] px-6 py-4 font-mono text-xs font-bold tracking-wider uppercase flex items-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
          >
            <Brain className="w-4 h-4" /> Run Deep Think
          </button>
        </form>

        {/* Query Presets */}
        <div className="mt-6 pt-6 border-t border-white/5">
          <span className="font-mono text-[9px] tracking-widest text-white/30 uppercase block mb-3 font-semibold">
            Suggested SLS Pointer Space Queries
          </span>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {presets.map((preset, idx) => (
              <button
                key={idx}
                type="button"
                disabled={isLoading}
                onClick={() => handleRunQuery(preset.query)}
                className="bg-[#0F1219] border border-white/10 hover:border-cyan-500/30 p-3 text-left cursor-pointer transition-all group disabled:opacity-50"
              >
                <div className="text-[10px] text-cyan-400 font-mono mb-1 group-hover:text-cyan-300 transition-colors uppercase font-bold flex items-center gap-1.5">
                  <Activity className="w-3 h-3" /> {preset.title}
                </div>
                <p className="text-[10px] text-white/50 font-light line-clamp-2 leading-relaxed">
                  {preset.query}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3. COGNITIVE PIPELINE LOADING */}
      {isLoading && (
        <div className="bg-[#0B0E14] border border-cyan-500/20 p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 flex items-center justify-center border border-cyan-400/30 text-cyan-400">
              <Activity className="w-3.5 h-3.5 animate-spin" />
            </div>
            <div>
              <span className="text-[9px] font-mono uppercase tracking-widest text-cyan-400 font-semibold block">ACTIVE PIPELINE</span>
              <h3 className="text-sm font-mono text-white">Google Deep Thinking Engine reasoning...</h3>
            </div>
          </div>

          <div className="space-y-2 pl-8 border-l border-white/10 font-mono text-[11px]">
            {thinkingSteps.map((step, index) => (
              <div key={index} className="flex items-center gap-2 text-white/40 animate-fadeIn">
                <span className="text-cyan-400 font-bold font-mono">0{index + 1} //</span>
                <span>{step}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. ERROR BLOCK */}
      {errorMsg && (
        <div className="bg-red-950/20 border border-red-900/40 p-6 font-mono text-xs text-red-400 leading-relaxed space-y-2">
          <div className="font-bold uppercase tracking-widest text-[10px] flex items-center gap-1.5">
            ⚠️ COGNITIVE BUS INTERRUPT
          </div>
          <p>{errorMsg}</p>
        </div>
      )}

      {/* 5. RESULTS AND REASONING CONTAINER */}
      {rawResponse && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 animate-fadeIn">
          
          {/* Left Column: Deep Thinking Reasoning Log */}
          <div className="bg-[#0B0E14] border border-white/10 p-8 flex flex-col h-[650px]">
            <div className="flex justify-between items-center border-b border-white/10 pb-4 mb-5">
              <div className="flex items-center gap-2.5">
                <Terminal className="text-cyan-400 w-4 h-4" />
                <h3 className="text-sm font-mono uppercase tracking-wider text-white">
                  01 // Deep Thinking Reasoning Log
                </h3>
              </div>
              <span className="text-[9px] font-mono text-emerald-400 border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 uppercase tracking-widest">
                verified reasoning
              </span>
            </div>

            {/* Scrollable markdown renderer */}
            <div className="overflow-y-auto flex-1 pr-2 space-y-2 scrollbar-thin">
              {formattedMarkdown(getDisplayMarkdown())}
            </div>
          </div>

          {/* Right Column: Synthesized Dynamic Datagrid */}
          <div className="bg-[#0B0E14] border border-white/10 p-8 flex flex-col h-[650px] justify-between">
            <div>
              <div className="flex justify-between items-center border-b border-white/10 pb-4 mb-5">
                <div className="flex items-center gap-2.5">
                  <Database className="text-cyan-400 w-4 h-4" />
                  <h3 className="text-sm font-mono uppercase tracking-wider text-white">
                    02 // Cognitive Dynamic Memory Projection
                  </h3>
                </div>
                <span className="text-[9px] font-mono text-cyan-400 border border-cyan-500/25 bg-cyan-400/5 px-2 py-0.5 uppercase tracking-widest">
                  no sql // zero fs
                </span>
              </div>

              {/* Data Grid table */}
              <div className="overflow-y-auto h-[460px] pr-2 scrollbar-thin">
                {structuredResults.length > 0 ? (
                  <div className="space-y-4">
                    <p className="text-[11px] text-white/50 leading-relaxed font-light">
                      The Deep Thinking Engine directly scanned the flat 64-bit page table, evaluated the Access Control Lists, and projected this structured view on-the-fly. No physical files were opened.
                    </p>
                    <div className="space-y-3">
                      {structuredResults.map((item, index) => (
                        <div 
                          key={index} 
                          className="bg-[#0F1219] border border-white/10 hover:border-cyan-400/30 p-4 transition-all"
                        >
                          <div className="flex justify-between items-start gap-4 mb-2.5 border-b border-white/5 pb-2">
                            <div>
                              <span className="text-[10px] font-mono text-cyan-400 block tracking-wider">
                                {item.address}
                              </span>
                              <h4 className="text-xs font-mono font-bold text-white mt-0.5">
                                {item.name}
                              </h4>
                            </div>
                            <div className="text-right">
                              <span className="text-[9px] font-mono border border-white/15 px-1.5 py-0.5 text-white/40 uppercase tracking-widest">
                                {item.tier}
                              </span>
                              <span className="text-[9px] font-mono text-cyan-400 block mt-1">
                                {item.pages} PAGES ({item.pages * 4} KB)
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4 text-[10px] font-mono uppercase tracking-wider text-white/40 mb-2">
                            <div>
                              <span className="text-white/25 block text-[9px]">Owner</span>
                              <span className="text-white font-medium">{item.owner}</span>
                            </div>
                            <div>
                              <span className="text-white/25 block text-[9px]">Protection Ring Ring</span>
                              <span className="text-emerald-400 font-medium">{item.verification}</span>
                            </div>
                          </div>

                          <div className="bg-[#0B0E14] border border-white/5 p-2 font-mono text-[10px] text-white/60 leading-relaxed">
                            <span className="text-cyan-400/50 mr-1.5 font-bold">// DATA:</span>
                            {item.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 border border-dashed border-white/10">
                    <HelpCircle className="w-8 h-8 text-white/20 mb-3" />
                    <h4 className="text-xs font-mono text-white uppercase tracking-wider mb-1">
                      No Dynamic Projection Found
                    </h4>
                    <p className="text-[10px] text-white/40 max-w-xs leading-relaxed font-light">
                      The reasoning output was successfully generated but did not yield a structured JSON object grid. You can read the full raw reasoning breakdown in the Left Column.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Security clearance footprint */}
            <div className="border-t border-white/10 pt-4 flex justify-between items-center font-mono text-[9px] text-white/30 uppercase tracking-widest">
              <span className="flex items-center gap-1">
                <Shield className="w-3 h-3 text-cyan-400" /> Security Token: CLEARED
              </span>
              <span>Ring 0 Core Access</span>
            </div>
          </div>

        </div>
      )}

    </div>
  );
}
