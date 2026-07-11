import React, { useState, useEffect, useRef } from "react";
import { StorageTier, SlsSystemMetrics } from "../types/sls";
import { Cpu, HardDrive, Database, Layers, Activity, RefreshCw, Server, Flame, AlertCircle } from "lucide-react";
import * as d3 from "d3";

interface SlsStorageThroughputProps {
  systemMetrics: SlsSystemMetrics;
}

interface DataPoint {
  index: number;
  [StorageTier.L1_CACHE]: number; // Latency (ms) or Throughput (GB/s)
  [StorageTier.L2_DRAM]: number;
  [StorageTier.L3_SSD]: number;
  [StorageTier.L4_ARCHIVE]: number;
  isSpike: boolean;
}

export default function SlsStorageThroughput({ systemMetrics }: SlsStorageThroughputProps) {
  const [metricMode, setMetricMode] = useState<"LATENCY" | "THROUGHPUT">("THROUGHPUT");
  const [scaleMode, setScaleMode] = useState<"LINEAR" | "LOG">("LINEAR");
  
  // Real-time NVMe controller diagnostic stats
  const [driveTemp, setDriveTemp] = useState(41);
  const [queueDepth, setQueueDepth] = useState(1);
  const [tbw, setTbw] = useState(124.68); // Terabytes Written
  const [wearout, setWearout] = useState(99.4); // Flash remaining %
  const [isBenchmarking, setIsBenchmarking] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dataRef = useRef<DataPoint[]>([]);

  // Initialize data history
  useEffect(() => {
    const points: DataPoint[] = [];
    for (let i = 0; i < 30; i++) {
      points.push({
        index: i,
        [StorageTier.L1_CACHE]: metricMode === "THROUGHPUT" ? 820 : 0.005,
        [StorageTier.L2_DRAM]: metricMode === "THROUGHPUT" ? 115 : 0.08,
        [StorageTier.L3_SSD]: metricMode === "THROUGHPUT" ? 8.2 : 1.2,
        [StorageTier.L4_ARCHIVE]: metricMode === "THROUGHPUT" ? 2.1 : 11.5,
        isSpike: false
      });
    }
    dataRef.current = points;
  }, [metricMode]);

  // Keep tracking of page faults or accesses to inject live spikes
  const lastFaultCount = useRef(systemMetrics.pageFaultCount);
  const lastAccessCount = useRef(systemMetrics.totalAccesses);

  // Triggering spike if parent registers accesses or page faults
  useEffect(() => {
    let spiked = false;
    if (systemMetrics.pageFaultCount > lastFaultCount.current) {
      spiked = true;
      lastFaultCount.current = systemMetrics.pageFaultCount;
    }
    if (systemMetrics.totalAccesses > lastAccessCount.current) {
      spiked = true;
      lastAccessCount.current = systemMetrics.totalAccesses;
    }

    if (spiked) {
      // Inject spike on NVMe L3 & L4
      setQueueDepth(Math.min(64, Math.floor(Math.random() * 8) + 12));
      setDriveTemp(prev => Math.min(68, prev + 1));
      setTbw(prev => Number((prev + 0.01).toFixed(4)));

      if (dataRef.current.length > 0) {
        const last = dataRef.current[dataRef.current.length - 1];
        if (metricMode === "THROUGHPUT") {
          // NVMe writes peak during swap migrations
          last[StorageTier.L3_SSD] = Number((12.4 + Math.random() * 1.5).toFixed(2)); // PCIe Gen5 saturation
          last[StorageTier.L4_ARCHIVE] = Number((4.1 + Math.random() * 0.8).toFixed(2));
        } else {
          // Latency stalls spike up due to software decompression path
          last[StorageTier.L3_SSD] = Number((2.8 + Math.random() * 1.2).toFixed(2));
          last[StorageTier.L4_ARCHIVE] = Number((15.4 + Math.random() * 4.5).toFixed(2));
        }
        last.isSpike = true;
      }
    }
  }, [systemMetrics.pageFaultCount, systemMetrics.totalAccesses, metricMode]);

  // Handle manual controller benchmark trigger
  const runBenchmark = () => {
    if (isBenchmarking) return;
    setIsBenchmarking(true);
    setQueueDepth(32);

    let count = 0;
    const interval = setInterval(() => {
      setDriveTemp(t => Math.min(65, t + 1));
      setTbw(t => Number((t + 0.12).toFixed(2)));

      if (dataRef.current.length > 0) {
        const last = dataRef.current[dataRef.current.length - 1];
        if (metricMode === "THROUGHPUT") {
          last[StorageTier.L3_SSD] = Number((13.8 + Math.random() * 0.5).toFixed(2)); // Full PCIe Gen5 x4 saturation
          last[StorageTier.L4_ARCHIVE] = Number((3.9 + Math.random() * 0.3).toFixed(2));
        } else {
          last[StorageTier.L3_SSD] = Number((3.2 + Math.random() * 0.4).toFixed(2));
          last[StorageTier.L4_ARCHIVE] = Number((14.1 + Math.random() * 1.5).toFixed(2));
        }
        last.isSpike = true;
      }

      count++;
      if (count > 6) {
        clearInterval(interval);
        setIsBenchmarking(false);
        setQueueDepth(1);
      }
    }, 400);
  };

  // Regular periodic ticker to simulate background device activity & shift chart
  useEffect(() => {
    const interval = setInterval(() => {
      // Gradually cool down controller
      setDriveTemp(t => (t > 41 ? t - 1 : 41));

      const points = [...dataRef.current];
      // Remove first point
      points.shift();
      
      // Add new point at the end with nominal fluctuating background activity
      const baseL1 = metricMode === "THROUGHPUT" ? 820 + (Math.random() - 0.5) * 10 : 0.005 + (Math.random() - 0.5) * 0.001;
      const baseL2 = metricMode === "THROUGHPUT" ? 115 + (Math.random() - 0.5) * 4 : 0.08 + (Math.random() - 0.5) * 0.01;
      const baseL3 = metricMode === "THROUGHPUT" ? 8.2 + (Math.random() - 0.5) * 0.6 : 1.2 + (Math.random() - 0.5) * 0.15;
      const baseL4 = metricMode === "THROUGHPUT" ? 2.1 + (Math.random() - 0.5) * 0.3 : 11.5 + (Math.random() - 0.5) * 0.8;

      points.push({
        index: points.length,
        [StorageTier.L1_CACHE]: Number(Math.max(0.001, baseL1).toFixed(3)),
        [StorageTier.L2_DRAM]: Number(Math.max(0.01, baseL2).toFixed(3)),
        [StorageTier.L3_SSD]: Number(Math.max(0.1, baseL3).toFixed(2)),
        [StorageTier.L4_ARCHIVE]: Number(Math.max(0.5, baseL4).toFixed(2)),
        isSpike: false
      });

      // Recalculate horizontal index
      points.forEach((p, idx) => {
        p.index = idx;
      });

      dataRef.current = points;
      drawChart();
    }, 1000);

    return () => clearInterval(interval);
  }, [metricMode, scaleMode]);

  // Handle responsive resize of SVG chart
  useEffect(() => {
    drawChart();
    window.addEventListener("resize", drawChart);
    return () => window.removeEventListener("resize", drawChart);
  }, [metricMode, scaleMode]);

  // Main D3 Rendering Pipeline
  const drawChart = () => {
    if (!svgRef.current || !containerRef.current || dataRef.current.length === 0) return;

    const data = dataRef.current;
    const width = containerRef.current.clientWidth;
    const height = 240;
    const margin = { top: 20, right: 30, bottom: 35, left: 60 };

    // Clear previous elements
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    svg.attr("width", width).attr("height", height);

    // Setup X axis (indices)
    const xScale = d3.scaleLinear()
      .domain([0, data.length - 1])
      .range([margin.left, width - margin.right]);

    // Setup Y axis scale (Linear vs Logarithmic)
    let yScale: d3.ScaleLinear<number, number> | d3.ScaleLogarithmic<number, number>;
    
    // Find absolute bounds for auto-scale
    const allVals: number[] = data.flatMap(d => [
      Number(d[StorageTier.L1_CACHE]),
      Number(d[StorageTier.L2_DRAM]),
      Number(d[StorageTier.L3_SSD]),
      Number(d[StorageTier.L4_ARCHIVE])
    ]);
    const maxVal: number = d3.max(allVals) ?? (metricMode === "THROUGHPUT" ? 1000 : 20);
    const minVal: number = d3.min(allVals) ?? (metricMode === "THROUGHPUT" ? 1 : 0.001);

    if (scaleMode === "LOG") {
      // For log scale, ensure min val is positive and non-zero
      yScale = d3.scaleLog()
        .domain([Math.max(0.0001, minVal * 0.8), maxVal * 1.2])
        .range([height - margin.bottom, margin.top]);
    } else {
      yScale = d3.scaleLinear()
        .domain([0, maxVal * 1.15])
        .range([height - margin.bottom, margin.top]);
    }

    // Gridlines helper
    const yGrid = d3.axisLeft(yScale)
      .tickSize(-width + margin.left + margin.right)
      .tickFormat(() => "");

    svg.append("g")
      .attr("class", "grid-lines text-white/5 opacity-10")
      .attr("transform", `translate(${margin.left}, 0)`)
      .call(yGrid);

    // X Axis drawing
    const xAxis = d3.axisBottom(xScale)
      .ticks(10)
      .tickFormat((d) => `T-${30 - Number(d)}s`);

    svg.append("g")
      .attr("transform", `translate(0, ${height - margin.bottom})`)
      .attr("class", "text-[10px] font-mono text-white/40")
      .call(xAxis)
      .call(g => g.select(".domain").attr("stroke", "rgba(255, 255, 255, 0.1)"))
      .call(g => g.selectAll(".tick line").attr("stroke", "rgba(255, 255, 255, 0.1)"));

    // Y Axis drawing
    const yAxisFormatter = (d: any) => {
      const val = Number(d);
      if (metricMode === "THROUGHPUT") {
        return val >= 100 ? `${val.toFixed(0)} GB/s` : `${val.toFixed(1)} GB/s`;
      } else {
        return val < 0.1 ? `${(val * 1000).toFixed(0)} µs` : `${val.toFixed(2)} ms`;
      }
    };

    const yAxis = d3.axisLeft(yScale)
      .ticks(scaleMode === "LOG" ? 5 : 6)
      .tickFormat(yAxisFormatter);

    svg.append("g")
      .attr("transform", `translate(${margin.left}, 0)`)
      .attr("class", "text-[10px] font-mono text-white/40")
      .call(yAxis)
      .call(g => g.select(".domain").attr("stroke", "rgba(255, 255, 255, 0.1)"))
      .call(g => g.selectAll(".tick line").attr("stroke", "rgba(255, 255, 255, 0.1)"));

    // Line drawing helper
    const createLineGenerator = (tier: StorageTier) => {
      return d3.line<DataPoint>()
        .x(d => xScale(d.index))
        .y(d => yScale(d[tier]))
        .curve(d3.curveMonotoneX);
    };

    // Color mapper for lines
    const getColors = (tier: StorageTier) => {
      switch (tier) {
        case StorageTier.L1_CACHE: return { stroke: "#06b6d4", fill: "rgba(6, 182, 212, 0.05)" }; // Cyan
        case StorageTier.L2_DRAM: return { stroke: "#6366f1", fill: "rgba(99, 102, 241, 0.05)" }; // Indigo
        case StorageTier.L3_SSD: return { stroke: "#f59e0b", fill: "rgba(245, 158, 11, 0.05)" }; // Amber
        case StorageTier.L4_ARCHIVE: return { stroke: "#d946ef", fill: "rgba(217, 70, 239, 0.05)" }; // Fuchsia
      }
    };

    const tiers = [StorageTier.L1_CACHE, StorageTier.L2_DRAM, StorageTier.L3_SSD, StorageTier.L4_ARCHIVE];

    // Render area gradients (optional but looks beautiful)
    tiers.forEach(tier => {
      const colors = getColors(tier);
      const areaGen = d3.area<DataPoint>()
        .x(d => xScale(d.index))
        .y0(height - margin.bottom)
        .y1(d => yScale(d[tier]))
        .curve(d3.curveMonotoneX);

      svg.append("path")
        .datum(data)
        .attr("fill", colors.fill)
        .attr("d", areaGen)
        .attr("class", "pointer-events-none opacity-30");
    });

    // Render lines
    tiers.forEach(tier => {
      const colors = getColors(tier);
      const lineGen = createLineGenerator(tier);

      svg.append("path")
        .datum(data)
        .attr("fill", "none")
        .attr("stroke", colors.stroke)
        .attr("stroke-width", 2)
        .attr("d", lineGen)
        .attr("class", "transition-all duration-300 pointer-events-none");
    });

    // Draw active spike indicators/vertical line markers if there are any
    data.forEach((d) => {
      if (d.isSpike) {
        svg.append("line")
          .attr("x1", xScale(d.index))
          .attr("y1", margin.top)
          .attr("x2", xScale(d.index))
          .attr("y2", height - margin.bottom)
          .attr("stroke", "rgba(245, 158, 11, 0.3)")
          .attr("stroke-dasharray", "3,3")
          .attr("stroke-width", 1);

        svg.append("text")
          .attr("x", xScale(d.index) + 4)
          .attr("y", margin.top + 15)
          .text("NVMe I/O Spike")
          .attr("class", "fill-amber-400 font-mono text-[8px] uppercase tracking-wider");
      }
    });
  };

  return (
    <div className="bg-[#0B0E14] border border-white/10 p-8 flex flex-col xl:flex-row gap-8 mt-8" id="sls-storage-throughput-dashboard">
      
      {/* Chart Section */}
      <div className="flex-1 space-y-4" ref={containerRef}>
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-white/10 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] tracking-widest text-amber-400 uppercase font-semibold">Active NVMe Telemetry Bus</span>
              <span className="bg-amber-400/10 text-amber-400 border border-amber-400/20 text-[8px] px-1.5 py-0.5 font-mono uppercase tracking-widest">PCIe Gen 5 x4</span>
            </div>
            <h3 className="text-xl font-serif italic text-white mt-1">
              Storage I/O Speed & Latency Analyzer
            </h3>
          </div>

          {/* Controls toggles */}
          <div className="flex flex-wrap gap-2 text-[10px] font-mono uppercase">
            <div className="flex bg-[#0F1219] border border-white/10">
              <button
                onClick={() => setMetricMode("THROUGHPUT")}
                className={`px-3 py-1.5 transition-colors cursor-pointer ${metricMode === "THROUGHPUT" ? "bg-amber-400 text-[#0B0E14] font-bold" : "text-white/50 hover:text-white"}`}
              >
                Speed (GB/s)
              </button>
              <button
                onClick={() => setMetricMode("LATENCY")}
                className={`px-3 py-1.5 transition-colors cursor-pointer ${metricMode === "LATENCY" ? "bg-amber-400 text-[#0B0E14] font-bold" : "text-white/50 hover:text-white"}`}
              >
                Latency (ms)
              </button>
            </div>

            <div className="flex bg-[#0F1219] border border-white/10">
              <button
                onClick={() => setScaleMode("LINEAR")}
                className={`px-2.5 py-1.5 transition-colors cursor-pointer ${scaleMode === "LINEAR" ? "bg-[#1E2530] text-white" : "text-white/30 hover:text-white"}`}
              >
                Linear
              </button>
              <button
                onClick={() => setScaleMode("LOG")}
                className={`px-2.5 py-1.5 transition-colors cursor-pointer ${scaleMode === "LOG" ? "bg-[#1E2530] text-white" : "text-white/30 hover:text-white"}`}
              >
                Log Scale
              </button>
            </div>
          </div>
        </div>

        {/* Real D3 SVG */}
        <div className="relative bg-[#0F1219] border border-white/5 p-4 rounded-none">
          <svg ref={svgRef} className="w-full h-60"></svg>
          
          {/* Bottom Custom Legend */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-2 pt-3 border-t border-white/5 justify-center text-[9px] font-mono uppercase tracking-wider">
            <span className="flex items-center gap-1.5 text-cyan-400">
              <span className="w-2.5 h-1.5 bg-cyan-400 rounded-none inline-block"></span> L1 SRAM (~820 GB/s | 5µs)
            </span>
            <span className="flex items-center gap-1.5 text-indigo-400">
              <span className="w-2.5 h-1.5 bg-indigo-400 rounded-none inline-block"></span> L2 System DRAM (~115 GB/s | 80µs)
            </span>
            <span className="flex items-center gap-1.5 text-amber-400">
              <span className="w-2.5 h-1.5 bg-amber-400 rounded-none inline-block"></span> L3 NVMe Primary Flash (~8.2 GB/s | 1.2ms)
            </span>
            <span className="flex items-center gap-1.5 text-fuchsia-400">
              <span className="w-2.5 h-1.5 bg-fuchsia-400 rounded-none inline-block"></span> L4 Swapped NVMe Compressed (~2.1 GB/s | 11.5ms)
            </span>
          </div>
        </div>
      </div>

      {/* NVMe Controller Specs & Diagnostics */}
      <div className="w-full xl:w-80 space-y-6 shrink-0 bg-[#0F1219]/40 border-l xl:border-l border-t xl:border-t-0 border-white/10 pt-6 xl:pt-0 xl:pl-8 flex flex-col justify-between">
        <div className="space-y-6">
          <div>
            <span className="font-mono text-[9px] tracking-widest text-amber-400 uppercase font-bold">ASIC Controller Node</span>
            <h4 className="text-base font-serif italic text-white mt-0.5">NVMe 2.0 Physical Layer</h4>
          </div>

          <div className="space-y-3 font-mono text-[10px]">
            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-white/40">NVMe CONTROLLER:</span>
              <span className="text-white font-medium">Enterprise PCIe 5.0 x4</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-white/40">DRIVE TEMPERATURE:</span>
              <span className={`flex items-center gap-1 font-medium ${driveTemp > 60 ? "text-red-400 animate-pulse" : driveTemp > 50 ? "text-amber-400" : "text-emerald-400"}`}>
                <Flame className="w-3.5 h-3.5" /> {driveTemp}°C
              </span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-white/40">COMMAND QUEUE DEPTH:</span>
              <span className="text-white font-medium">QD: {queueDepth} / 64k SQ</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-white/40">WRITE ENDUR. (TBW):</span>
              <span className="text-white font-medium">{tbw.toFixed(2)} TB</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-white/40">FLASH CELLS LIFE:</span>
              <span className="text-emerald-400 font-medium">{wearout}% Health</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">DEVICE REGISTERS:</span>
              <span className="text-white font-mono text-[9px] bg-[#0B0E14] px-1 py-0.5 text-white/60 font-semibold">[0x1F40 - OK]</span>
            </div>
          </div>

          {/* Description of NVMe Role in SLS */}
          <div className="bg-[#0B0E14] border border-white/5 p-4 text-[11px] leading-relaxed font-light text-white/50 space-y-2">
            <p>
              When pages are demoted to L3 and L4 tiers, they saturate the ultra-fast <strong className="text-white font-medium">PCIe Gen5 NVMe fabric</strong>.
            </p>
            <p>
              Under heavy loads, Page Fault decompression processes operate sequentially on our NVMe hardware block controllers, which dynamically impacts latencies between microsecond cache-lines and millisecond archival structures.
            </p>
          </div>
        </div>

        {/* Action button to test and trigger chart spikes */}
        <div className="pt-4 border-t border-white/10">
          <button
            onClick={runBenchmark}
            disabled={isBenchmarking}
            className="w-full bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-[#0B0E14] font-mono text-xs font-bold py-3 uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            {isBenchmarking ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Saturating NVMe Channels...
              </>
            ) : (
              <>
                <Activity className="w-4 h-4" />
                Benchmark PCIe Link
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
