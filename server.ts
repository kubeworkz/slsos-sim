import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route: Gemini integration
  app.post("/api/gemini/generate", async (req, res) => {
    try {
      const { prompt, systemInstruction } = req.body;
      if (!prompt) {
        res.status(400).json({ error: "Prompt is required" });
        return;
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
        res.status(400).json({
          error: "Gemini API Key is missing or unconfigured. Please configure it in Settings > Secrets."
        });
        return;
      }

      // Lazy initialization of GoogleGenAI
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      // Query Gemini using gemini-3.1-pro-preview with HIGH thinking level
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
        config: {
          systemInstruction: systemInstruction || "You are an expert system architect specializing in Single Level Storage Operating Systems, virtual memory architectures, database integrity, and microkernel fault isolation.",
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.HIGH,
          },
        },
      });

      res.json({ text: response.text });
    } catch (err: any) {
      console.error("Gemini API Error:", err);
      res.status(500).json({
        error: "Failed to generate content from Gemini",
        details: err.message || String(err),
      });
    }
  });

  // ==========================================
  // SINGLE LEVEL STORAGE (SLS) REST API & SYNC
  // ==========================================

  interface SlsApiKey {
    id: string;
    name: string;
    secret: string;
    createdAt: string;
    lastUsed: string;
    status: "active" | "revoked";
  }

  interface UserState {
    objects: any[];
    services: any[];
    walLogs: any[];
    systemMetrics: any;
    systemState: string;
    lastUpdated: number;
    apiKeys?: SlsApiKey[];
  }

  // In-memory data store for live developer API interactions
  const memorySpacesStore = new Map<string, UserState>();

  // Token Auth Helper
  function getUserIdFromToken(authHeader: string | undefined): string | null {
    if (!authHeader) return null;
    const match = authHeader.match(/^Bearer\s+(sls_dev_key_[a-zA-Z0-9_]+)$/i);
    if (!match) return null;

    const token = match[1];
    const tokenBody = token.substring("sls_dev_key_".length);
    const parts = tokenBody.split("__");
    const userId = parts[0];

    const state = memorySpacesStore.get(userId);
    if (!state) {
      // If there's no state yet on server, but they are using a primary key format, let it pass to sync
      if (parts.length === 1) {
        return userId;
      }
      return null;
    }

    if (state.apiKeys && state.apiKeys.length > 0) {
      const keyObj = state.apiKeys.find(k => k.secret === token);
      if (!keyObj) {
        return null;
      }
      if (keyObj.status === "revoked") {
        return null;
      }

      // Update lastUsed
      keyObj.lastUsed = new Date().toISOString();
      state.lastUpdated = Date.now();
      memorySpacesStore.set(userId, state);
      return userId;
    } else {
      // Compatibility for default/legacy single key if apiKeys list is not yet populated
      if (parts.length === 1 && token === `sls_dev_key_${userId}`) {
        return userId;
      }
    }

    return null;
  }

  function generateAddress(): string {
    const segment = Math.floor(0x2000 + Math.random() * 0xD000).toString(16).toUpperCase();
    return `0x0000_1000_${segment}_0000`;
  }

  // Sync Endpoint: Push client state to server
  app.post("/api/v1/sync/:userId", (req, res) => {
    const { userId } = req.params;
    const { objects, services, walLogs, systemMetrics, systemState, lastUpdated, apiKeys } = req.body;
    
    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    memorySpacesStore.set(userId, {
      objects: objects || [],
      services: services || [],
      walLogs: walLogs || [],
      systemMetrics: systemMetrics || {},
      systemState: systemState || "RUNNING",
      lastUpdated: lastUpdated || Date.now(),
      apiKeys: apiKeys || []
    });

    res.json({ success: true, serverTime: Date.now() });
  });

  // Sync Endpoint: Pull state from server
  app.get("/api/v1/sync/:userId", (req, res) => {
    const { userId } = req.params;
    const state = memorySpacesStore.get(userId);
    res.json({ state: state || null });
  });

  // REST Route: List active virtual memory segments
  app.get("/api/v1/memory", (req, res) => {
    const userId = getUserIdFromToken(req.headers.authorization);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized. Missing or invalid Authorization header. Expected: 'Bearer sls_dev_key_[userId]'" });
      return;
    }

    const state = memorySpacesStore.get(userId);
    if (!state) {
      res.status(404).json({ error: "Memory space uninitialized. Please open the SLS Web App to provision your flat space address pool first." });
      return;
    }

    res.json({
      leaseholder_id: userId,
      allocated_kb: state.objects.reduce((sum, o) => sum + (o.sizePages || 0), 0) * 4,
      metrics: {
        total_objects: state.objects.length,
        system_status: state.systemState,
        uptime_seconds: state.systemMetrics?.uptimeSeconds || 0
      },
      objects: state.objects.map(o => ({
        id: o.id,
        name: o.name,
        type: o.type,
        startAddress: o.startAddress,
        sizePages: o.sizePages,
        sizeKB: o.sizePages * 4,
        tier: o.tier,
        owner: o.owner,
        lastAccessTime: o.lastAccessTime,
        data: o.data
      }))
    });
  });

  // REST Route: Remote virtual memory allocation (valloc)
  app.post("/api/v1/memory/valloc", (req, res) => {
    const userId = getUserIdFromToken(req.headers.authorization);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    const state = memorySpacesStore.get(userId);
    if (!state) {
      res.status(404).json({ error: "Memory space uninitialized." });
      return;
    }

    const { name, type, sizePages, data } = req.body;
    if (!name || !sizePages) {
      res.status(400).json({ error: "Parameters 'name' and 'sizePages' (integer) are required in request body." });
      return;
    }

    const sizePagesInt = parseInt(sizePages, 10);
    if (isNaN(sizePagesInt) || sizePagesInt <= 0) {
      res.status(400).json({ error: "sizePages must be a positive integer." });
      return;
    }

    const currentPages = state.objects.reduce((sum, o) => sum + (o.sizePages || 0), 0);
    // Dynamic max check based on user details or default to 512
    const maxPages = 512; 
    if (currentPages + sizePagesInt > maxPages) {
      res.status(400).json({ error: `LEASE ALLOCATION FAULT: Lease pool cap exceeded. Space remaining: ${maxPages - currentPages} pages (${(maxPages - currentPages) * 4} KB).` });
      return;
    }

    const startAddress = generateAddress();
    const newObj = {
      id: `heap_obj_api_${Date.now()}`,
      name,
      type: type || "DB_TABLE",
      startAddress,
      sizePages: sizePagesInt,
      tier: "L2_DRAM",
      owner: "App User",
      lastAccessTime: new Date().toISOString(),
      isCompressed: false,
      acl: {
        "System Kernel": { read: true, write: true, execute: true },
        "DB Admin": { read: true, write: true, execute: false },
        "App User": { read: true, write: true, execute: false },
        "Guest": { read: true, write: false, execute: false }
      },
      data: data || { api_agent: "REST Curl Client", initialized_at: new Date().toISOString() }
    };

    state.objects.push(newObj);
    state.lastUpdated = Date.now();

    // Create WAL Entry
    state.walLogs.push({
      index: state.walLogs.length + 1,
      txId: `tx_api_${Date.now().toString().slice(-4)}`,
      timestamp: new Date().toISOString(),
      action: "ALLOCATE",
      details: `API CALL valloc(): Instantiated heap segment [${name}] at ${startAddress} (${sizePagesInt * 4} KB).`,
      checksum: `CRC_API_${Math.floor(Math.random() * 1000000).toString(16).toUpperCase()}`,
      verified: true
    });

    if (state.systemMetrics) {
      state.systemMetrics.totalAllocatedPages += sizePagesInt;
      state.systemMetrics.totalAccesses += 1;
    }

    memorySpacesStore.set(userId, state);

    res.status(201).json({
      success: true,
      message: `Object '${name}' valloc() resolve success`,
      allocated_segment: newObj
    });
  });

  // REST Route: Remote payload segment write
  app.post("/api/v1/memory/write", (req, res) => {
    const userId = getUserIdFromToken(req.headers.authorization);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    const state = memorySpacesStore.get(userId);
    if (!state) {
      res.status(404).json({ error: "Memory space uninitialized." });
      return;
    }

    const { id, data } = req.body;
    if (!id || !data) {
      res.status(400).json({ error: "Parameters 'id' and 'data' are required." });
      return;
    }

    const objIndex = state.objects.findIndex(o => o.id === id);
    if (objIndex === -1) {
      res.status(404).json({ error: `Segment ID '${id}' not found in active flat pool.` });
      return;
    }

    state.objects[objIndex].data = {
      ...state.objects[objIndex].data,
      ...data,
      api_modified_time: new Date().toISOString()
    };
    state.objects[objIndex].lastAccessTime = new Date().toISOString();
    state.lastUpdated = Date.now();

    state.walLogs.push({
      index: state.walLogs.length + 1,
      txId: `tx_api_${Date.now().toString().slice(-4)}`,
      timestamp: new Date().toISOString(),
      action: "WRITE",
      details: `API CALL write(): Mutated segment payload [${state.objects[objIndex].name}] at ${state.objects[objIndex].startAddress}.`,
      checksum: `CRC_API_${Math.floor(Math.random() * 1000000).toString(16).toUpperCase()}`,
      verified: true
    });

    if (state.systemMetrics) {
      state.systemMetrics.totalAccesses += 1;
    }

    memorySpacesStore.set(userId, state);

    res.json({
      success: true,
      message: "Data write committed",
      updated_segment: state.objects[objIndex]
    });
  });

  // REST Route: Deallocate/Free memory segment
  app.delete("/api/v1/memory/free/:id", (req, res) => {
    const userId = getUserIdFromToken(req.headers.authorization);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    const state = memorySpacesStore.get(userId);
    if (!state) {
      res.status(404).json({ error: "Memory space uninitialized." });
      return;
    }

    const { id } = req.params;
    const objIndex = state.objects.findIndex(o => o.id === id);
    if (objIndex === -1) {
      res.status(404).json({ error: `Segment ID '${id}' not found.` });
      return;
    }

    const freedObj = state.objects[objIndex];
    state.objects.splice(objIndex, 1);
    state.lastUpdated = Date.now();

    state.walLogs.push({
      index: state.walLogs.length + 1,
      txId: `tx_api_${Date.now().toString().slice(-4)}`,
      timestamp: new Date().toISOString(),
      action: "DEALLOCATE",
      details: `API CALL free(): Released address segment [${freedObj.name}] from ${freedObj.startAddress}.`,
      checksum: `CRC_API_${Math.floor(Math.random() * 1000000).toString(16).toUpperCase()}`,
      verified: true
    });

    if (state.systemMetrics) {
      state.systemMetrics.totalAllocatedPages = Math.max(0, state.systemMetrics.totalAllocatedPages - (freedObj.sizePages || 0));
    }

    memorySpacesStore.set(userId, state);

    res.json({
      success: true,
      message: `Released segment '${freedObj.name}' from active flat virtual address map.`
    });
  });

  // REST Route: Physical memory Hex Dump
  app.get("/api/v1/memory/hexdump", (req, res) => {
    const userId = getUserIdFromToken(req.headers.authorization);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }

    const state = memorySpacesStore.get(userId);
    if (!state) {
      res.status(404).json({ error: "Memory space uninitialized." });
      return;
    }

    let dump = `========================================================================\n`;
    dump += `SINGLE LEVEL STORAGE OS - SOVEREIGN FLAT ADDRESS SPACE MEMORY DUMP (REST API)\n`;
    dump += `========================================================================\n`;
    dump += `LEASEHOLDER ID: ${userId}\n`;
    dump += `EXPORT TIME:    ${new Date().toISOString()}\n`;
    dump += `ALLOCATED:      ${state.objects.reduce((sum, o) => sum + (o.sizePages || 0), 0) * 4} KB\n`;
    dump += `========================================================================\n\n`;

    state.objects.forEach((obj, idx) => {
      dump += `SEGMENT 0${idx + 1} //\n`;
      dump += `  IDENTIFIER: ${obj.name}\n`;
      dump += `  V-ADDRESS:  ${obj.startAddress}\n`;
      dump += `  PAGES:      ${obj.sizePages} pages\n`;
      dump += `  PAYLOAD DATA:\n`;
      const jsonStr = JSON.stringify(obj.data || {});
      const chars = Array.from(jsonStr);
      let hexLines = [];
      for (let i = 0; i < chars.length; i += 16) {
        const chunk = chars.slice(i, i + 16);
        const hexParts = chunk.map(c => c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase());
        const asciiParts = chunk.map(c => (c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126) ? c : '.');
        while (hexParts.length < 16) hexParts.push("  ");
        const offset = (idx * 0x1000 + i).toString(16).padStart(8, '0').toUpperCase();
        hexLines.push(`    ${offset}  ${hexParts.slice(0, 8).join(" ")}  ${hexParts.slice(8, 16).join(" ")}  |${asciiParts.join("")}|`);
      }
      dump += hexLines.join("\n") + "\n";
      dump += `------------------------------------------------------------------------\n\n`;
    });

    res.setHeader("Content-Type", "text/plain");
    res.send(dump);
  });

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", platform: "SLS-OS-Simulator" });
  });

  // Vite integration for asset serving
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SLS-OS Server] Express running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
