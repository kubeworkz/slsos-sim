// AeroSLS Type Definitions for Visualizer and Simulator

export enum SlsObjectType {
  DB_TABLE = "DB_TABLE",
  PROGRAM = "PROGRAM",
  USER_PROFILE = "USER_PROFILE",
  SYSTEM_METADATA = "SYSTEM_METADATA",
  RAW_SEGMENT = "RAW_SEGMENT"
}

export enum StorageTier {
  L1_CACHE = "L1_CACHE",      // CPU Fast SRAM
  L2_DRAM = "L2_DRAM",        // Dynamic volatile system RAM
  L3_SSD = "L3_SSD",          // Fast flash storage
  L4_ARCHIVE = "L4_ARCHIVE"   // Deep cold archival tier (swapped + compressed)
}

export enum SlsUser {
  SYSTEM_KERNEL = "SYSTEM_KERNEL",
  DB_ADMIN = "DB_ADMIN",
  APP_USER = "APP_USER",
  GUEST = "GUEST"
}

export interface Permission {
  read: boolean;
  write: boolean;
  execute: boolean;
}

export interface ObjectAcl {
  [SlsUser.SYSTEM_KERNEL]: Permission;
  [SlsUser.DB_ADMIN]: Permission;
  [SlsUser.APP_USER]: Permission;
  [SlsUser.GUEST]: Permission;
}

export interface SlsObject {
  id: string;
  name: string;
  type: SlsObjectType;
  startAddress: string; // Hex string e.g. 0x0000_1A2B_3C4D_5E00
  sizePages: number;    // Size of the object in 4KB virtual pages
  data: Record<string, any>; // Pointer-based key-value content of the object
  pendingData?: Record<string, any>; // Uncommitted transaction changes
  acl: ObjectAcl;
  owner: SlsUser;
  tier: StorageTier;
  lastAccessTime: string;
  isCompressed: boolean;
}

export interface MemoryPage {
  address: string;
  objectId: string | null;
  objectName: string | null;
  tier: StorageTier;
  isDirty: boolean;
}

export interface Transaction {
  id: string;
  state: "ACTIVE" | "COMMITTING" | "COMMITTED" | "ROLLED_BACK";
  startedAt: string;
  updatedKeys: { objectId: string; key: string; oldValue: any; newValue: any }[];
}

export interface WalLogEntry {
  index: number;
  txId: string | null;
  timestamp: string;
  action: "TX_START" | "TX_WRITE" | "TX_COMMIT" | "TX_ABORT" | "ALLOCATE" | "DELETE" | "SYSTEM_CHECKPOINT" | "TIER_MIGRATE" | "DIRECT_WRITE";
  details: string;
  checksum: string; // simulated CRC-32
  verified: boolean;
}

export interface MicrokernelService {
  id: string;
  name: string;
  pid: number;
  state: "ONLINE" | "FAILED" | "REBOOTING";
  latencyMs: number;
  memoryAddress: string;
  restarts: number;
  description: string;
}

export interface SlsSystemMetrics {
  totalAllocatedPages: number;
  pageFaultCount: number;
  totalAccesses: number;
  l1CacheHits: number;
  l2DramHits: number;
  l3SsdHits: number;
  l4ArchiveHits: number;
  compressionRatio: number; // e.g. 2.4 meaning 2.4:1 compression in archive tier
  uptimeSeconds: number;
  // Navigator-Parity Gap Roadmap Phase 2: real kernel telemetry. cpuBusyPercent
  // is already a computed windowed percentage (App.tsx diffs two consecutive
  // /api/metrics polls' cpu_idle_ticks/cpu_total_ticks client-side, per that
  // route's own "cumulative counter, diffed by caller" convention) -- the raw
  // cumulative counters themselves aren't stored here since nothing else needs
  // them. ramAllocatedFrames/ramTotalFrames and diskCapacityBytes are the raw
  // values straight from the kernel (frame_pool.c's live bitmap popcount and
  // nvme_admin.c's cached Identify Namespace capacity, respectively).
  cpuBusyPercent: number;
  ramAllocatedFrames: number;
  ramTotalFrames: number;
  diskCapacityBytes: number;
}

// Navigator-Parity Gap Roadmap Phase 3: one entry from the kernel's real
// GET /api/security/audit feed (kernel/security_audit.c) -- auth failures,
// role changes, and access denials the kernel itself recorded, not anything
// simulated client-side. Field names mirror the JSON shape api_security_
// audit_json() (net/http.c) emits directly.
export interface KernelAuditEntry {
  id: number;
  tick: number;
  uid: number;
  action: string;
  detail: string;
  granted: boolean;
}

export interface SlsApiKey {
  id: string;
  name: string;
  secret: string;
  createdAt: string;
  lastUsed: string;
  status: "active" | "revoked";
}

export interface PortalUser {
  id: string;
  username: string;
  email: string;
  companyName: string;
  tier: "Free" | "Developer" | "Enterprise" | "Sovereign";
  maxMemoryKB: number;
  balanceUSD: number;
  rentCostMonthly: number;
  apiKeys?: SlsApiKey[];
}

