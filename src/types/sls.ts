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

