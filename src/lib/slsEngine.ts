import { 
  SlsObject, 
  SlsObjectType, 
  StorageTier, 
  SlsUser, 
  ObjectAcl, 
  WalLogEntry, 
  MicrokernelService, 
  SlsSystemMetrics, 
  Transaction,
  MemoryPage
} from "../types/sls";

// Helper to generate hexadecimal virtual addresses
export function generateRandomAddress(prefixNum: number = 0x0000): string {
  const segment = Math.floor(Math.random() * 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
  const offset1 = Math.floor(Math.random() * 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
  const offset2 = Math.floor(Math.random() * 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
  return `0x${prefixNum.toString(16).toUpperCase().padStart(4, "0")}_${segment}_${offset1}_${offset2}`;
}

export function generateChecksum(data: string): string {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `CRC32-${Math.abs(hash).toString(16).toUpperCase().substring(0, 8)}`;
}

// Initial seed data
export const INITIAL_SERVICES: MicrokernelService[] = [
  {
    id: "mem_mgr",
    name: "VirtualMemoryMgr",
    pid: 101,
    state: "ONLINE",
    latencyMs: 1.2,
    memoryAddress: "0x0000_0000_1000_1000",
    restarts: 0,
    description: "Manages SLS address translation, page faults, and persistent heap page allocation."
  },
  {
    id: "sec_mgr",
    name: "ObjectSecurityMgr",
    pid: 102,
    state: "ONLINE",
    latencyMs: 1.8,
    memoryAddress: "0x0000_0000_1000_2000",
    restarts: 0,
    description: "Enforces ACL validation per object pointer access at hardware/kernel boundary."
  },
  {
    id: "db_mgr",
    name: "NativeDbStoreMgr",
    pid: 103,
    state: "ONLINE",
    latencyMs: 2.5,
    memoryAddress: "0x0000_0000_1000_3000",
    restarts: 0,
    description: "Coordinates pointer-based transactional memory commits and ACID updates."
  },
  {
    id: "tier_mgr",
    name: "StorageTierMgr",
    pid: 104,
    state: "ONLINE",
    latencyMs: 0.9,
    memoryAddress: "0x0000_0000_1000_4000",
    restarts: 0,
    description: "Automates background compression, page-tier demotion, and fast swaps."
  },
  {
    id: "log_mgr",
    name: "RecoveryLogVerifier",
    pid: 105,
    state: "ONLINE",
    latencyMs: 1.4,
    memoryAddress: "0x0000_0000_1000_5000",
    restarts: 0,
    description: "Appends WAL logs, verifies checksum integrity, and orchestrates crash recovery."
  }
];

export const DEFAULT_ACL = (owner: SlsUser): ObjectAcl => ({
  [SlsUser.SYSTEM_KERNEL]: { read: true, write: true, execute: true },
  [SlsUser.DB_ADMIN]: { 
    read: owner === SlsUser.SYSTEM_KERNEL ? false : true, 
    write: owner === SlsUser.DB_ADMIN || owner === SlsUser.APP_USER, 
    execute: true 
  },
  [SlsUser.APP_USER]: { 
    read: owner === SlsUser.APP_USER, 
    write: owner === SlsUser.APP_USER, 
    execute: owner === SlsUser.APP_USER 
  },
  [SlsUser.GUEST]: { read: false, write: false, execute: false }
});

export const INITIAL_OBJECTS: SlsObject[] = [
  {
    id: "sys_catalog",
    name: "KernelObjectCatalog",
    type: SlsObjectType.SYSTEM_METADATA,
    startAddress: "0x0000_0000_0100_0000",
    sizePages: 4,
    tier: StorageTier.L1_CACHE,
    owner: SlsUser.SYSTEM_KERNEL,
    lastAccessTime: new Date().toISOString(),
    isCompressed: false,
    acl: {
      [SlsUser.SYSTEM_KERNEL]: { read: true, write: true, execute: true },
      [SlsUser.DB_ADMIN]: { read: true, write: false, execute: true },
      [SlsUser.APP_USER]: { read: false, write: false, execute: false },
      [SlsUser.GUEST]: { read: false, write: false, execute: false }
    },
    data: {
      version: "v9.4-SLS",
      page_size: "4096",
      supported_architectures: "POWER9, z15, RISC-V",
      active_address_space: "64-bit Flat SLS",
      kernel_vbr: "0x0000_0000_0000_1000"
    }
  },
  {
    id: "db_cust",
    name: "CustomerLedger",
    type: SlsObjectType.DB_TABLE,
    startAddress: "0x0000_1000_A200_0000",
    sizePages: 8,
    tier: StorageTier.L2_DRAM,
    owner: SlsUser.DB_ADMIN,
    lastAccessTime: new Date().toISOString(),
    isCompressed: false,
    acl: {
      [SlsUser.SYSTEM_KERNEL]: { read: true, write: true, execute: true },
      [SlsUser.DB_ADMIN]: { read: true, write: true, execute: true },
      [SlsUser.APP_USER]: { read: true, write: false, execute: false },
      [SlsUser.GUEST]: { read: false, write: false, execute: false }
    },
    data: {
      "row_0_id": "CUST-001",
      "row_0_name": "Alice Sterling",
      "row_0_balance": 15750.50,
      "row_1_id": "CUST-002",
      "row_1_name": "Bob Vance",
      "row_1_balance": 820.00,
      "row_2_id": "CUST-003",
      "row_2_name": "Carol Danvers",
      "row_2_balance": 99420.75
    }
  },
  {
    id: "db_prod",
    name: "InventoryCatalog",
    type: SlsObjectType.DB_TABLE,
    startAddress: "0x0000_1000_B450_0000",
    sizePages: 6,
    tier: StorageTier.L3_SSD,
    owner: SlsUser.DB_ADMIN,
    lastAccessTime: new Date().toISOString(),
    isCompressed: false,
    acl: {
      [SlsUser.SYSTEM_KERNEL]: { read: true, write: true, execute: true },
      [SlsUser.DB_ADMIN]: { read: true, write: true, execute: true },
      [SlsUser.APP_USER]: { read: true, write: true, execute: false },
      [SlsUser.GUEST]: { read: true, write: false, execute: false }
    },
    data: {
      "item_0_id": "PROD-81",
      "item_0_name": "Single-Level Processor Unit",
      "item_0_stock": 42,
      "item_1_id": "PROD-102",
      "item_1_name": "Dynamic DRAM Cell Array",
      "item_1_stock": 128
    }
  },
  {
    id: "user_sec",
    name: "SystemUserAclDB",
    type: SlsObjectType.USER_PROFILE,
    startAddress: "0x0000_0000_0900_0000",
    sizePages: 2,
    tier: StorageTier.L2_DRAM,
    owner: SlsUser.SYSTEM_KERNEL,
    lastAccessTime: new Date().toISOString(),
    isCompressed: false,
    acl: {
      [SlsUser.SYSTEM_KERNEL]: { read: true, write: true, execute: true },
      [SlsUser.DB_ADMIN]: { read: true, write: false, execute: false },
      [SlsUser.APP_USER]: { read: false, write: false, execute: false },
      [SlsUser.GUEST]: { read: false, write: false, execute: false }
    },
    data: {
      "user_SYSTEM_KERNEL": "ROLE_SUPER_KERNEL",
      "user_DB_ADMIN": "ROLE_DB_ADMINISTRATOR",
      "user_APP_USER": "ROLE_STANDARD_DEV",
      "user_GUEST": "ROLE_GUEST_READER"
    }
  },
  {
    id: "archive_tx_history",
    name: "HistoricalLedger2025",
    type: SlsObjectType.DB_TABLE,
    startAddress: "0x0000_2000_FF00_0000",
    sizePages: 16,
    tier: StorageTier.L4_ARCHIVE,
    owner: SlsUser.DB_ADMIN,
    lastAccessTime: new Date(Date.now() - 3600000 * 24 * 30).toISOString(),
    isCompressed: true,
    acl: DEFAULT_ACL(SlsUser.DB_ADMIN),
    data: {
      "q1_total_tx": "452,891",
      "q1_total_vol": "$12,408,129.50",
      "q2_total_tx": "509,102",
      "q2_total_vol": "$15,200,980.20",
      "audit_checksum": "SHA256-4AA9EF782B"
    }
  }
];

export const INITIAL_METRICS: SlsSystemMetrics = {
  totalAllocatedPages: 36,
  pageFaultCount: 14,
  totalAccesses: 450,
  l1CacheHits: 120,
  l2DramHits: 240,
  l3SsdHits: 72,
  l4ArchiveHits: 18,
  compressionRatio: 2.8,
  uptimeSeconds: 1250
};

// Seed 64 visual pages (8x8) representing a slice of the SLS flat workspace
export function buildMemoryPages(objects: SlsObject[]): MemoryPage[] {
  const pages: MemoryPage[] = [];
  // Build 64 segments
  for (let i = 0; i < 64; i++) {
    const addressNum = 0x1000 + i * 4;
    const address = `0x0000_1000_${addressNum.toString(16).toUpperCase().padStart(4, "0")}_0000`;
    
    // Distribute objects across memory space to make the visual interesting
    let mappedObject: SlsObject | null = null;
    if (i >= 2 && i < 6) mappedObject = objects.find(o => o.id === "sys_catalog") || null;
    else if (i >= 12 && i < 20) mappedObject = objects.find(o => o.id === "db_cust") || null;
    else if (i >= 24 && i < 30) mappedObject = objects.find(o => o.id === "db_prod") || null;
    else if (i >= 32 && i < 34) mappedObject = objects.find(o => o.id === "user_sec") || null;
    else if (i >= 44 && i < 60) mappedObject = objects.find(o => o.id === "archive_tx_history") || null;

    pages.push({
      address,
      objectId: mappedObject ? mappedObject.id : null,
      objectName: mappedObject ? mappedObject.name : null,
      tier: mappedObject ? mappedObject.tier : StorageTier.L2_DRAM,
      isDirty: false
    });
  }
  return pages;
}

export const INITIAL_WAL_LOGS: WalLogEntry[] = [
  {
    index: 1,
    txId: null,
    timestamp: new Date(Date.now() - 50000).toISOString(),
    action: "SYSTEM_CHECKPOINT",
    details: "System snapshot. Checkpoint catalog successfully written to SSD.",
    checksum: "CRC32-4E90B2E1",
    verified: true
  },
  {
    index: 2,
    txId: "TX-9021",
    timestamp: new Date(Date.now() - 40000).toISOString(),
    action: "TX_START",
    details: "Transaction started by DB_ADMIN.",
    checksum: "CRC32-FE2319A5",
    verified: true
  },
  {
    index: 3,
    txId: "TX-9021",
    timestamp: new Date(Date.now() - 30000).toISOString(),
    action: "TX_WRITE",
    details: "Pointer-based write to CustomerLedger [CUST-001]. old_balance: 15750.50, new_balance: 16250.50",
    checksum: "CRC32-A2903FE3",
    verified: true
  },
  {
    index: 4,
    txId: "TX-9021",
    timestamp: new Date(Date.now() - 20000).toISOString(),
    action: "TX_COMMIT",
    details: "Transaction TX-9021 committed. Pointer links updated in hardware page table.",
    checksum: "CRC32-901B2C7E",
    verified: true
  }
];
