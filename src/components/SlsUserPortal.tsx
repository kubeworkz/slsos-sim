import React, { useState } from "react";
import { PortalUser, StorageTier, SlsObject, SlsUser } from "../types/sls";
import { 
  User, 
  Lock, 
  CreditCard, 
  TrendingUp, 
  ChevronRight, 
  LogOut, 
  Layers, 
  HelpCircle, 
  Cpu, 
  DollarSign, 
  Award,
  Zap,
  Globe,
  Terminal,
  ShieldCheck,
  PlusCircle,
  Clock,
  Sparkles,
  ArrowUpRight,
  Download,
  FileText
} from "lucide-react";

// Predefined seed users for the SaaS simulator
export const DEFAULT_PORTAL_USERS: PortalUser[] = [
  {
    id: "user_dave",
    username: "dave_gridworkz",
    email: "dave@gridworkz.com",
    companyName: "Gridworkz Tech Corp",
    tier: "Enterprise",
    maxMemoryKB: 2048,
    balanceUSD: 350.00,
    rentCostMonthly: 199.00
  },
  {
    id: "user_bob",
    username: "bob_vance",
    email: "bob@vancefridge.com",
    companyName: "Vance Refrigeration",
    tier: "Developer",
    maxMemoryKB: 512,
    balanceUSD: 85.50,
    rentCostMonthly: 49.00
  },
  {
    id: "user_carol",
    username: "carol_danvers",
    email: "carol@marvel.space",
    companyName: "Sovereign Air Forces",
    tier: "Sovereign",
    maxMemoryKB: 8192,
    balanceUSD: 1250.00,
    rentCostMonthly: 499.00
  },
  {
    id: "user_guest",
    username: "guest_sandbox",
    email: "guest@sandbox.io",
    companyName: "Independent Developer",
    tier: "Free",
    maxMemoryKB: 128,
    balanceUSD: 0.00,
    rentCostMonthly: 0.00
  }
];

interface SlsUserPortalProps {
  currentUser: PortalUser | null;
  onLogin: (user: PortalUser) => void;
  onLogout: () => void;
  onUpdateUser: (user: PortalUser) => void;
  objects: SlsObject[];
}

export default function SlsUserPortal({
  currentUser,
  onLogin,
  onLogout,
  onUpdateUser,
  objects
}: SlsUserPortalProps) {
  // Login / Registration Form States
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [selectedTier, setSelectedTier] = useState<"Free" | "Developer" | "Enterprise" | "Sovereign">("Developer");
  const [errorMsg, setErrorMsg] = useState("");

  // Billing and Deposit States
  const [depositAmount, setDepositAmount] = useState<string>("50");
  const [depositSuccess, setDepositSuccess] = useState(false);

  // Upgrade state
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // Address Space Export Handlers
  const downloadFile = (content: string, filename: string, contentType: string) => {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Calculate allocated pages size in KB (each page is 4KB)
  const currentAllocatedPages = objects.reduce((acc, obj) => acc + obj.sizePages, 0);
  const currentAllocatedKB = currentAllocatedPages * 4;
  const allocationPercent = Math.min(100, Math.round((currentAllocatedKB / (currentUser?.maxMemoryKB || 128)) * 100));

  const handleDownloadJson = () => {
    if (!currentUser) return;
    const data = {
      leaseholder: currentUser,
      timestamp: new Date().toISOString(),
      allocatedPages: currentAllocatedPages,
      allocatedKB: currentAllocatedKB,
      objects: objects.map(o => ({
        address: o.startAddress,
        name: o.name,
        type: o.type,
        pages: o.sizePages,
        tier: o.tier,
        owner: o.owner,
        acl: o.acl,
        payload: o.data
      }))
    };
    downloadFile(JSON.stringify(data, null, 2), `${currentUser.username}_address_space.json`, "application/json");
  };

  const handleDownloadHexDump = () => {
    if (!currentUser) return;
    let dump = `========================================================================\n`;
    dump += `SINGLE LEVEL STORAGE OS - SOVEREIGN FLAT ADDRESS SPACE MEMORY DUMP\n`;
    dump += `========================================================================\n`;
    dump += `LEASEHOLDER:  ${currentUser.username}\n`;
    dump += `SPACE ID:     ${currentUser.id}\n`;
    dump += `SPACE TIER:   ${currentUser.tier}\n`;
    dump += `EXPORT TIME:  ${new Date().toISOString()}\n`;
    dump += `QUOTA CAP:    ${currentUser.maxMemoryKB} KB\n`;
    dump += `ALLOCATED:    ${currentAllocatedKB} KB (${currentAllocatedPages} pages)\n`;
    dump += `========================================================================\n\n`;

    if (objects.length === 0) {
      dump += `[NO SEGMENTS FOUND - MEMORY SPACE IS CURRENTLY NULL/EMPTY]\n`;
    } else {
      objects.forEach((obj, idx) => {
        dump += `SEGMENT 0${idx + 1} //\n`;
        dump += `  IDENTIFIER: ${obj.name}\n`;
        dump += `  V-ADDRESS:  ${obj.startAddress}\n`;
        dump += `  TYPE:       ${obj.type}\n`;
        dump += `  PAGES:      ${obj.sizePages} pages (${obj.sizePages * 4} KB)\n`;
        dump += `  TIER:       ${obj.tier}\n`;
        let ringLevel = 3;
        if (obj.owner === SlsUser.SYSTEM_KERNEL) ringLevel = 0;
        else if (obj.owner === SlsUser.DB_ADMIN) ringLevel = 1;
        else if (obj.owner === SlsUser.APP_USER) ringLevel = 2;
        dump += `  PROTECTION: Ring ${ringLevel}\n`;
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
    }
    downloadFile(dump, `${currentUser.username}_flat_address_space.txt`, "text/plain");
  };

  const getTierDetails = (tier: "Free" | "Developer" | "Enterprise" | "Sovereign") => {
    switch (tier) {
      case "Free":
        return { kb: 128, price: 0, cores: 1, desc: "Shared L2 RAM, Standard Prioritization" };
      case "Developer":
        return { kb: 512, price: 49, cores: 2, desc: "Priority L1/L2 SRAM, WAL Logging Enabled" };
      case "Enterprise":
        return { kb: 2048, price: 199, cores: 8, desc: "Dedicated Microkernel Bus, 0 Page Fault SLA" };
      case "Sovereign":
        return { kb: 8192, price: 499, cores: 32, desc: "ASIC Compression Hardware, Custom ACL Ring Isolation" };
    }
  };

  const handleQuickLogin = (user: PortalUser) => {
    onLogin(user);
    setErrorMsg("");
  };

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setErrorMsg("Please enter your registered email address.");
      return;
    }

    // Try finding the user
    const usersList = getSavedUsers();
    const found = usersList.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
    if (found) {
      onLogin(found);
      setErrorMsg("");
    } else {
      setErrorMsg("No account registered with that email address. Try quick-login or register a new space!");
    }
  };

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !email.trim()) {
      setErrorMsg("Username and Email are required fields.");
      return;
    }

    const usersList = getSavedUsers();
    const isEmailTaken = usersList.some(u => u.email.toLowerCase() === email.trim().toLowerCase());
    if (isEmailTaken) {
      setErrorMsg("An account with this email already exists.");
      return;
    }

    const tierDetails = getTierDetails(selectedTier);
    const newUser: PortalUser = {
      id: `user_${Date.now()}`,
      username: username.trim().toLowerCase(),
      email: email.trim().toLowerCase(),
      companyName: company.trim() || "Independent Specialist",
      tier: selectedTier,
      maxMemoryKB: tierDetails.kb,
      balanceUSD: selectedTier === "Free" ? 0.00 : 100.00, // Gift developer/enterprise users $100 starting balance
      rentCostMonthly: tierDetails.price
    };

    const nextUsers = [...usersList, newUser];
    localStorage.setItem("sls_portal_users", JSON.stringify(nextUsers));
    
    // Automatically log in as new user
    onLogin(newUser);
    setErrorMsg("");
    setIsRegistering(false);
  };

  const getSavedUsers = (): PortalUser[] => {
    const saved = localStorage.getItem("sls_portal_users");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return DEFAULT_PORTAL_USERS;
      }
    }
    return DEFAULT_PORTAL_USERS;
  };

  // Deposit funds action
  const handleDepositFunds = () => {
    if (!currentUser) return;
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) return;

    const updatedUser: PortalUser = {
      ...currentUser,
      balanceUSD: currentUser.balanceUSD + amount
    };

    onUpdateUser(updatedUser);
    setDepositSuccess(true);
    setTimeout(() => setDepositSuccess(false), 3000);
  };

  // Upgrade lease tier action
  const handleUpgradeTier = (targetTier: "Free" | "Developer" | "Enterprise" | "Sovereign") => {
    if (!currentUser) return;
    const details = getTierDetails(targetTier);
    
    // Check if they have enough balance for first month
    if (currentUser.balanceUSD < details.price) {
      setErrorMsg(`Insufficient credits. Upgrading to ${targetTier} lease requires $${details.price} upfront payment.`);
      return;
    }

    const updatedUser: PortalUser = {
      ...currentUser,
      tier: targetTier,
      maxMemoryKB: details.kb,
      rentCostMonthly: details.price,
      balanceUSD: currentUser.balanceUSD - details.price
    };

    onUpdateUser(updatedUser);
    setShowUpgradeModal(false);
    setErrorMsg("");
  };

  return (
    <div className="w-full" id="sls-user-portal-container">
      {!currentUser ? (
        /* LOGGED OUT GATEWAY SCREEN */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 py-4 animate-fadeIn">
          {/* Left panel: Rental features & SaaS pitch (7 columns) */}
          <div className="lg:col-span-7 bg-[#0B0E14] border border-white/10 p-8 flex flex-col justify-between space-y-8">
            <div className="space-y-4">
              <span className="font-mono text-[10px] tracking-widest text-cyan-400 uppercase font-semibold">
                Sovereign Flat Memory Cloud // Infrastructure Lease
              </span>
              <h2 className="text-3xl font-serif italic text-white tracking-tight leading-tight border-b border-white/10 pb-4">
                Rent Your Isolated Flat Memory Frame
              </h2>
              <p className="text-white/60 text-xs font-light leading-relaxed">
                Single Level Storage eliminates traditional slow databases and filesystems. We lease globally addressable raw DRAM and fast persistent Flash pages directly to organizations. Set up secure rings, stage atomic WAL transactions, and let the microkernel manage automatic block archival.
              </p>
            </div>

            {/* Price Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(["Free", "Developer", "Enterprise", "Sovereign"] as const).map(t => {
                const det = getTierDetails(t);
                return (
                  <div key={t} className={`p-4 border ${selectedTier === t ? "border-cyan-400 bg-cyan-400/5" : "border-white/10 bg-[#0F1219]"} flex flex-col justify-between space-y-3 hover:border-white/20 transition-all`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-mono text-xs font-bold text-white uppercase">{t} Lease</h4>
                        <span className="text-[10px] text-white/40 block font-mono">{det.cores} V-CPU Cores</span>
                      </div>
                      <span className="font-serif italic text-cyan-400 text-sm font-semibold">
                        {det.price === 0 ? "Free" : `$${det.price}/mo`}
                      </span>
                    </div>
                    <div className="border-t border-white/5 pt-2 space-y-1.5">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-white/50">Capacity Pool:</span>
                        <span className="font-mono text-white font-medium">{det.kb} KB</span>
                      </div>
                      <p className="text-[10px] text-white/40 leading-normal font-light">
                        {det.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Simulated Live Statistics */}
            <div className="bg-[#0F1219] p-4 border border-white/5 grid grid-cols-3 gap-2 text-center text-xs font-mono uppercase tracking-wider">
              <div>
                <span className="text-white/40 block text-[9px] mb-1">Global Sectors</span>
                <span className="text-emerald-400 font-bold">14,891 Lease-Blocks</span>
              </div>
              <div className="border-x border-white/5">
                <span className="text-white/40 block text-[9px] mb-1">DRAM Bus Speed</span>
                <span className="text-white font-bold">128.4 GB/sec</span>
              </div>
              <div>
                <span className="text-white/40 block text-[9px] mb-1">Power Uptime SLA</span>
                <span className="text-cyan-400 font-bold">99.9999% SLA</span>
              </div>
            </div>
          </div>

          {/* Right panel: Login & Quick profiles (5 columns) */}
          <div className="lg:col-span-5 bg-[#0B0E14] border border-white/10 p-8 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Globe className="w-4 h-4 text-cyan-400" />
                <span className="font-mono text-[9px] tracking-widest text-cyan-400 uppercase font-bold">Kernel Gate-Auth</span>
              </div>
              <h3 className="text-xl font-serif italic text-white mb-6">
                {isRegistering ? "Register Custom Memory Space" : "Authenticate Portal Token"}
              </h3>

              {errorMsg && (
                <div className="bg-red-950/20 border border-red-900/40 p-3 text-red-400 text-xs font-mono mb-4">
                  ⚠️ {errorMsg}
                </div>
              )}

              {/* Login / Registration form */}
              <form onSubmit={isRegistering ? handleRegisterSubmit : handleLoginSubmit} className="space-y-4">
                {isRegistering && (
                  <>
                    <div>
                      <label className="text-[10px] text-white/50 font-mono uppercase tracking-wider block mb-1">Leaseholder Username:</label>
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="e.g. quantum_engineer"
                        required
                        className="w-full bg-[#0F1219] border border-white/10 p-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-white/50 font-mono uppercase tracking-wider block mb-1">Company / Organization:</label>
                      <input
                        type="text"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        placeholder="e.g. NeoVibe Solutions"
                        className="w-full bg-[#0F1219] border border-white/10 p-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="text-[10px] text-white/50 font-mono uppercase tracking-wider block mb-1">Email Token Address:</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. engineer@gridworkz.com"
                    required
                    className="w-full bg-[#0F1219] border border-white/10 p-2.5 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                  />
                </div>

                {isRegistering && (
                  <div>
                    <label className="text-[10px] text-white/50 font-mono uppercase tracking-wider block mb-1">Choose Initial Lease Pool:</label>
                    <select
                      value={selectedTier}
                      onChange={(e: any) => setSelectedTier(e.target.value)}
                      className="w-full bg-[#0F1219] border border-white/10 p-2.5 text-xs text-white font-mono focus:outline-none"
                    >
                      <option value="Free">Free Sandbox (128 KB - $0/mo)</option>
                      <option value="Developer">Developer Block (512 KB - $49/mo)</option>
                      <option value="Enterprise">Enterprise Node (2048 KB - $199/mo)</option>
                      <option value="Sovereign">Sovereign Cluster (8192 KB - $499/mo)</option>
                    </select>
                    <span className="text-[9px] text-white/30 font-mono mt-1 block">
                      * Developer & Enterprise registration includes a $100.00 initial credit gift!
                    </span>
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full bg-cyan-400 hover:bg-cyan-300 text-[#0B0E14] font-mono text-xs font-bold py-3 uppercase tracking-wider cursor-pointer transition-all flex items-center justify-center gap-2"
                >
                  {isRegistering ? "Lease Space Now" : "Unlock Portal Space"}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </form>

              <div className="border-t border-white/10 mt-6 pt-4 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setIsRegistering(!isRegistering);
                    setErrorMsg("");
                  }}
                  className="text-xs font-mono text-cyan-400 hover:underline cursor-pointer"
                >
                  {isRegistering ? "➔ Return to existing account login" : "➔ Rent new flat memory lease (Register)"}
                </button>
              </div>

              {/* Quick Preset Accounts (High Craft Selector) */}
              <div className="mt-8 border-t border-white/10 pt-5 space-y-3">
                <span className="font-mono text-[9px] text-white/40 block uppercase tracking-widest">// Quick-Auth Demo Accounts</span>
                <div className="grid grid-cols-2 gap-2">
                  {getSavedUsers().map((u) => (
                    <button
                      key={u.id}
                      onClick={() => handleQuickLogin(u)}
                      type="button"
                      className="border border-white/5 bg-[#0F1219] hover:bg-white/5 text-[11px] p-2.5 text-left rounded-none font-mono transition-all hover:border-cyan-400/40 text-white/80 hover:text-white flex flex-col justify-between"
                    >
                      <span className="font-bold text-white truncate">{u.username}</span>
                      <span className="text-[9px] text-cyan-400/70">{u.tier} ({u.maxMemoryKB}KB)</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 border-t border-white/10 pt-4 text-[9px] font-mono text-white/30 text-center leading-normal">
              🔒 TLS/2 Encryption Tunnel Established • SEC_VER: 0x8F9D
            </div>
          </div>
        </div>
      ) : (
        /* LOGGED IN WORKSPACE MANAGER & BILLING CONTROL */
        <div className="bg-[#0B0E14] border border-white/10 p-6 md:p-8 space-y-6 animate-fadeIn" id="sls-portal-active-workspace">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-white/10 pb-6 gap-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-cyan-400" />
                <span className="font-mono text-[10px] text-cyan-400 uppercase tracking-widest font-bold">
                  Active Lease: {currentUser.tier} Tier ({currentUser.maxMemoryKB} KB)
                </span>
              </div>
              <h2 className="text-2xl font-serif italic text-white flex items-center gap-2">
                Leaseholder Portal Console: <span className="text-cyan-300 font-sans not-italic text-xl font-normal">{currentUser.username}</span>
              </h2>
              <p className="text-[11px] font-mono text-white/40">
                Authorized Segment Space ID: <strong className="text-white/60">{currentUser.id}</strong> • Organization: <strong className="text-white/60">{currentUser.companyName}</strong>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="bg-[#0F1219] border border-white/10 p-3 flex items-center gap-3 pr-6">
                <DollarSign className="w-5 h-5 text-emerald-400" />
                <div>
                  <span className="text-[9px] text-white/40 block font-mono">Simulated Balance</span>
                  <span className="font-mono text-white font-bold text-sm">${currentUser.balanceUSD.toFixed(2)} USD</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowUpgradeModal(true)}
                  className="bg-[#0B0E14] hover:bg-cyan-400/10 border border-cyan-400/30 text-cyan-400 px-4 py-2.5 font-mono text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <ArrowUpRight className="w-3.5 h-3.5" /> Upgrade Lease
                </button>
                <button
                  type="button"
                  onClick={onLogout}
                  className="bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 px-4 py-2.5 font-mono text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" /> Leave Space
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Column 1: Live Memory Lease Meter */}
            <div className="bg-[#0F1219] border border-white/5 p-5 flex flex-col justify-between">
              <div>
                <span className="font-mono text-[9px] text-cyan-400 uppercase tracking-widest font-bold block mb-2">// allocation pool quota</span>
                <h4 className="text-sm font-bold text-white uppercase mb-3">Memory Segment Leased Meter</h4>
                
                {/* Meter visual */}
                <div className="space-y-3">
                  <div className="h-4 w-full bg-[#0B0E14] border border-white/10 p-0.5 overflow-hidden flex">
                    <div 
                      className={`h-full transition-all duration-500 ${
                        allocationPercent > 90 ? "bg-red-500" : allocationPercent > 70 ? "bg-amber-400" : "bg-cyan-400"
                      }`}
                      style={{ width: `${allocationPercent}%` }}
                    />
                  </div>
                  <div className="flex justify-between font-mono text-[11px]">
                    <span className="text-white/40">Total Usage:</span>
                    <span className="text-white font-semibold">{currentAllocatedKB} KB / {currentUser.maxMemoryKB} KB ({allocationPercent}%)</span>
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-white/50 leading-relaxed font-light mt-4 pt-4 border-t border-white/5">
                Each allocated Virtual Heap Object occupies storage pages (4KB apiece). To claim more space, delete unused segments or expand your lease quota using the control panel.
              </p>
            </div>

            {/* Column 2: Simulated Balance and Deposits */}
            <div className="bg-[#0F1219] border border-white/5 p-5 flex flex-col justify-between space-y-4">
              <div>
                <span className="font-mono text-[9px] text-emerald-400 uppercase tracking-widest font-bold block mb-2">// billing deposits</span>
                <h4 className="text-sm font-bold text-white uppercase">Add Simulated Lease Credits</h4>
                <p className="text-[10px] text-white/50 leading-normal mt-1 font-light">
                  Fund your account with fake credits to test SLA tier upgrading and high-performance page lease expansions!
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex gap-2">
                  <span className="bg-[#0B0E14] border border-white/10 p-2.5 text-xs text-white/50 font-mono font-bold flex items-center">$</span>
                  <input
                    type="number"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="50"
                    min="10"
                    max="10000"
                    className="flex-1 bg-[#0B0E14] border border-white/10 p-2.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-400"
                  />
                  <button
                    onClick={handleDepositFunds}
                    className="bg-emerald-500 hover:bg-emerald-400 text-[#0B0E14] font-mono text-xs font-bold px-4 py-2 cursor-pointer transition-colors"
                  >
                    Deposit
                  </button>
                </div>

                {depositSuccess && (
                  <p className="text-emerald-400 text-[10px] font-mono uppercase tracking-wider text-center">
                    ✓ Credits updated successfully!
                  </p>
                )}
              </div>
            </div>

            {/* Column 3: Subscription Status & Rent info */}
            <div className="bg-[#0F1219] border border-white/5 p-5 flex flex-col justify-between">
              <div>
                <span className="font-mono text-[9px] text-amber-400 uppercase tracking-widest font-bold block mb-2">// billing metrics</span>
                <h4 className="text-sm font-bold text-white uppercase mb-3">Lease Ledger Status</h4>

                <div className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-white/40">Lease Rate:</span>
                    <span className="text-cyan-400">${currentUser.rentCostMonthly.toFixed(2)} / mo</span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-white/40">Billing Cycle:</span>
                    <span className="text-white">Hourly Micro-valloc</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/40">SLA Margin:</span>
                    <span className="text-emerald-400 font-semibold">99.999% Guaranteed</span>
                  </div>
                </div>
              </div>

              <div className="text-[10px] text-white/40 leading-normal font-light mt-4 pt-3 border-t border-white/5 flex items-center gap-1.5 font-mono">
                <Clock className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                Next simulated billing sweep in 24d 18h.
              </div>
            </div>
          </div>

          {/* Address Space Dump & Record Exporter Panel */}
          <div className="border border-white/10 bg-[#0B0E14] p-6 md:p-8 space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-white/10 pb-4 gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4 text-cyan-400" />
                  <span className="font-mono text-[9px] text-cyan-400 uppercase tracking-widest font-bold">Address Space Dump Exporter</span>
                </div>
                <h3 className="text-lg font-serif italic text-white">Download Flat Space Data Records</h3>
                <p className="text-white/50 text-xs font-light">
                  Direct physical export of active memory segments allocated under the leaseholder token <strong className="text-cyan-400 font-mono font-medium">{currentUser.username}</strong>.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleDownloadJson}
                  disabled={objects.length === 0}
                  className="bg-cyan-400 hover:bg-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed text-[#0B0E14] font-mono text-xs font-bold px-4 py-2.5 tracking-wider uppercase flex items-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
                >
                  <Download className="w-4 h-4" /> Export Space Manifest (.JSON)
                </button>
                <button
                  onClick={handleDownloadHexDump}
                  disabled={objects.length === 0}
                  className="bg-[#0F1219] hover:bg-[#151922] border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed text-white font-mono text-xs font-bold px-4 py-2.5 tracking-wider uppercase flex items-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-cyan-400" /> Download Low-level Hex Dump (.TXT)
                </button>
              </div>
            </div>

            {/* List of active segments to be downloaded */}
            <div className="space-y-4">
              <span className="font-mono text-[10px] text-white/40 block uppercase tracking-widest">// active segments queued for export ({objects.length})</span>
              {objects.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[250px] overflow-y-auto pr-2 scrollbar-thin">
                  {objects.map((obj) => (
                    <div key={obj.id} className="bg-[#0F1219] border border-white/5 p-4 flex flex-col justify-between space-y-3">
                      <div className="flex justify-between items-start border-b border-white/5 pb-2">
                        <div>
                          <span className="font-mono text-[9px] text-cyan-400 block tracking-wider">{obj.startAddress}</span>
                          <h4 className="text-xs font-mono font-bold text-white mt-0.5">{obj.name}</h4>
                        </div>
                        <span className="font-mono text-[9px] border border-white/15 px-1.5 py-0.5 text-white/40 uppercase tracking-widest">{obj.tier}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px] font-mono">
                        <span className="text-white/40">Size allocation:</span>
                        <span className="text-white">{obj.sizePages} pages ({obj.sizePages * 4} KB)</span>
                      </div>
                      <div className="bg-[#0B0E14] border border-white/5 p-2 font-mono text-[9px] text-white/50 rounded-none line-clamp-1 leading-normal">
                        <span className="text-cyan-400 font-bold mr-1">// STRUCT:</span> {JSON.stringify(obj.data || {})}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="border border-dashed border-white/10 p-8 text-center bg-[#0F1219]/30">
                  <span className="font-mono text-xs text-white/40 uppercase block mb-1">Your Flat Address Space has no active objects</span>
                  <p className="text-[10px] text-white/30 max-w-sm mx-auto leading-relaxed font-light">
                    Allocate fresh heap segments using the <strong className="text-cyan-400 font-mono">valloc() Heap Object</strong> controller in the Address Space Map tab, and populate payload records before exporting.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Upgrade Lease Dialog / Overlay (Rich visual modal) */}
          {showUpgradeModal && (
            <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-fadeIn">
              <div className="bg-[#0B0E14] border border-white/10 max-w-2xl w-full p-8 space-y-6 relative">
                <button
                  onClick={() => setShowUpgradeModal(false)}
                  className="absolute top-4 right-4 text-white/40 hover:text-white font-mono text-sm uppercase p-2 cursor-pointer"
                >
                  [Close]
                </button>

                <div className="space-y-1">
                  <span className="font-mono text-[9px] tracking-widest text-cyan-400 uppercase font-bold">Lease Broker Desk</span>
                  <h3 className="text-2xl font-serif italic text-white">Upgrade Sovereign Lease Allocation</h3>
                  <p className="text-white/50 text-xs font-light">
                    Select a wider segment of global physical DRAM address space. Your existing heap data structures will be live-re-mapped with zero downtime.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {(["Free", "Developer", "Enterprise", "Sovereign"] as const).map(t => {
                    const det = getTierDetails(t);
                    const isCurrent = currentUser.tier === t;
                    const canAfford = currentUser.balanceUSD >= det.price;

                    return (
                      <div 
                        key={t} 
                        className={`p-4 border ${isCurrent ? "border-cyan-400 bg-cyan-400/5" : "border-white/10 bg-[#0F1219]"} flex flex-col justify-between space-y-3`}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-mono text-xs font-bold text-white uppercase">{t} Segment</span>
                            <span className="text-[9px] text-white/30 block font-mono">{det.kb} KB Max Space</span>
                          </div>
                          <span className="font-mono text-xs font-bold text-cyan-400">
                            ${det.price === 0 ? "Free" : `$${det.price}/mo`}
                          </span>
                        </div>

                        <div className="text-[10px] text-white/50 leading-relaxed font-light">
                          {det.desc}
                        </div>

                        <button
                          type="button"
                          disabled={isCurrent || !canAfford}
                          onClick={() => handleUpgradeTier(t)}
                          className={`w-full py-2 font-mono text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                            isCurrent ? "bg-white/5 border border-white/10 text-white/40 cursor-default" :
                            canAfford ? "bg-cyan-400 text-[#0B0E14] hover:bg-cyan-300 active:scale-[0.98]" :
                            "bg-red-500/5 border border-red-500/20 text-red-400/70"
                          }`}
                        >
                          {isCurrent ? "Current Lease" : canAfford ? `Purchase Upgrade` : `Requires $${det.price} Credits`}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
