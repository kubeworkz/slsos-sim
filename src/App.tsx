/**
 * @license
 * SPDX-License-Identifier: Apache-2.5
 */

import React, { useState, useEffect } from "react";
import { 
  SlsObject, 
  MemoryPage, 
  StorageTier, 
  SlsUser, 
  ObjectAcl, 
  WalLogEntry, 
  MicrokernelService, 
  SlsSystemMetrics, 
  Transaction,
  SlsObjectType,
  PortalUser
} from "./types/sls";
import { 
  INITIAL_SERVICES, 
  INITIAL_OBJECTS, 
  INITIAL_METRICS, 
  INITIAL_WAL_LOGS, 
  buildMemoryPages, 
  generateChecksum,
  generateRandomAddress,
  DEFAULT_ACL
} from "./lib/slsEngine";

import SlsMemoryMap from "./components/SlsMemoryMap";
import SlsSecurityDashboard from "./components/SlsSecurityDashboard";
import SlsTransactionConsole from "./components/SlsTransactionConsole";
import SlsMicrokernelVisualizer from "./components/SlsMicrokernelVisualizer";
import SlsAiCoprocessor from "./components/SlsAiCoprocessor";
import SlsSystemHealth from "./components/SlsSystemHealth";
import SlsUserPortal from "./components/SlsUserPortal";
import SlsDeepThinkingQuery from "./components/SlsDeepThinkingQuery";

import { 
  Layers, 
  ShieldCheck, 
  Database, 
  Cpu, 
  Sparkles, 
  RefreshCw, 
  AlertTriangle,
  Play,
  CheckCircle,
  Clock,
  ExternalLink,
  Plus,
  User,
  LogOut,
  Brain
} from "lucide-react";

const getInitialObjectsForUser = (user: PortalUser): SlsObject[] => {
  return [
    {
      id: `${user.id}_sys_catalog`,
      name: `KernelObjectCatalog`,
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
        leaseholder_email: user.email,
        lease_tier: user.tier,
        max_quota_kb: `${user.maxMemoryKB} KB`,
        active_address_space: "64-bit Flat SLS",
        company_segment: user.companyName
      }
    },
    {
      id: `${user.id}_db_cust`,
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
        "row_1_name": `${user.username} (Leaseholder)`,
        "row_1_balance": user.balanceUSD,
        "row_2_id": "CUST-003",
        "row_2_name": "Carol Danvers",
        "row_2_balance": 99420.75
      }
    },
    {
      id: `${user.id}_db_prod`,
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
    }
  ];
};

export default function App() {
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<"memory" | "security" | "transactions" | "microkernel" | "coprocessor" | "portal" | "deepthink">("portal");

  // Portal User Subscription State
  const [currentPortalUser, setCurrentPortalUser] = useState<PortalUser | null>(() => {
    const saved = localStorage.getItem("sls_current_portal_user");
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { return null; }
    }
    return null;
  });

  // Global Operating System states
  const [objects, setObjects] = useState<SlsObject[]>([]);
  const [memoryPages, setMemoryPages] = useState<MemoryPage[]>([]);
  const [services, setServices] = useState<MicrokernelService[]>([]);
  const [walLogs, setWalLogs] = useState<WalLogEntry[]>([]);
  const [systemMetrics, setSystemMetrics] = useState<SlsSystemMetrics>(INITIAL_METRICS);
  const [activeTx, setActiveTx] = useState<Transaction | null>(null);
  const [activeUser, setActiveUser] = useState<SlsUser>(SlsUser.SYSTEM_KERNEL);
  const [systemState, setSystemState] = useState<"RUNNING" | "CRASHED" | "RECOVERING">("RUNNING");

  // Automated Tiering daemon configuration states
  const [autoTierEnabled, setAutoTierEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem("sls_auto_tier_enabled");
    return saved ? saved === "true" : true;
  });
  const [ssdThreshold, setSsdThreshold] = useState<number>(() => {
    const saved = localStorage.getItem("sls_ssd_threshold");
    return saved ? parseInt(saved, 10) : 15;
  });
  const [archiveThreshold, setArchiveThreshold] = useState<number>(() => {
    const saved = localStorage.getItem("sls_archive_threshold");
    return saved ? parseInt(saved, 10) : 30;
  });

  // Automated demotion background daemon
  useEffect(() => {
    if (!autoTierEnabled || systemState !== "RUNNING") return;

    const daemonTimer = setInterval(() => {
      setObjects(prevObjects => {
        const now = Date.now();
        let hasChanges = false;
        const autoLogs: WalLogEntry[] = [];

        const nextObjects = prevObjects.map(obj => {
          const inactiveSec = (now - new Date(obj.lastAccessTime).getTime()) / 1000;
          let targetTier = obj.tier;

          if (inactiveSec >= archiveThreshold && obj.tier !== StorageTier.L4_ARCHIVE) {
            targetTier = StorageTier.L4_ARCHIVE;
          } else if (inactiveSec >= ssdThreshold && obj.tier !== StorageTier.L4_ARCHIVE && obj.tier !== StorageTier.L3_SSD) {
            targetTier = StorageTier.L3_SSD;
          }

          if (targetTier !== obj.tier) {
            hasChanges = true;
            autoLogs.push({
              index: 0,
              txId: null,
              timestamp: new Date().toISOString(),
              action: "TIER_MIGRATE",
              details: `Daemon automatically demoted [${obj.name}] to ${targetTier} after ${Math.floor(inactiveSec)}s inactivity.`,
              checksum: generateChecksum(obj.id + targetTier + "AUTO"),
              verified: true
            });

            return {
              ...obj,
              tier: targetTier,
              isCompressed: targetTier === StorageTier.L4_ARCHIVE,
              lastAccessTime: new Date().toISOString()
            };
          }

          return obj;
        });

        if (hasChanges) {
          setWalLogs(prevWal => {
            const nextWal = [...prevWal];
            autoLogs.forEach(log => {
              log.index = nextWal.length + 1;
              nextWal.push(log);
            });
            saveStateToStorage(nextObjects, services, nextWal, systemMetrics, systemState);
            return nextWal;
          });
          setMemoryPages(buildMemoryPages(nextObjects));
          return nextObjects;
        }

        return prevObjects;
      });
    }, 1000);

    return () => clearInterval(daemonTimer);
  }, [autoTierEnabled, ssdThreshold, archiveThreshold, systemState, services, systemMetrics]);

  // Create Object Dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newObjName, setNewObjName] = useState("");
  const [newObjType, setNewObjType] = useState<SlsObjectType>(SlsObjectType.DB_TABLE);
  const [newObjOwner, setNewObjOwner] = useState<SlsUser>(SlsUser.DB_ADMIN);
  const [newObjSize, setNewObjSize] = useState(4);
  const [allocationError, setAllocationError] = useState<string | null>(null);

  // Initialize and persist state using local storage dynamically for current portal user
  const loadUserData = (user: PortalUser | null) => {
    if (!user) {
      setObjects([]);
      setMemoryPages([]);
      setWalLogs([]);
      setSystemMetrics(INITIAL_METRICS);
      setSystemState("RUNNING");
      return;
    }

    const savedObjects = localStorage.getItem(`sls_objects_${user.id}`);
    const savedServices = localStorage.getItem(`sls_services_${user.id}`);
    const savedWalLogs = localStorage.getItem(`sls_wal_logs_${user.id}`);
    const savedMetrics = localStorage.getItem(`sls_metrics_${user.id}`);
    const savedSystemState = localStorage.getItem(`sls_system_state_${user.id}`);

    let loadedObjects = getInitialObjectsForUser(user);
    if (savedObjects) {
      try { loadedObjects = JSON.parse(savedObjects); } catch (e) {}
    }
    setObjects(loadedObjects);

    let loadedServices = INITIAL_SERVICES;
    if (savedServices) {
      try { loadedServices = JSON.parse(savedServices); } catch (e) {}
    }
    setServices(loadedServices);

    let loadedWal = [
      {
        index: 1,
        txId: null,
        timestamp: new Date().toISOString(),
        action: "SYSTEM_CHECKPOINT" as const,
        details: `Sovereign flat memory space established for leaseholder [${user.username}]. Space pool quota: ${user.maxMemoryKB} KB.`,
        checksum: "CRC32-A9F2012B",
        verified: true
      }
    ];
    if (savedWalLogs) {
      try { loadedWal = JSON.parse(savedWalLogs); } catch (e) {}
    }
    setWalLogs(loadedWal);

    let loadedMetrics = {
      totalAllocatedPages: loadedObjects.reduce((acc, o) => acc + o.sizePages, 0),
      pageFaultCount: 0,
      totalAccesses: 120,
      l1CacheHits: 40,
      l2DramHits: 60,
      l3SsdHits: 15,
      l4ArchiveHits: 5,
      compressionRatio: 2.8,
      uptimeSeconds: 150
    };
    if (savedMetrics) {
      try { loadedMetrics = JSON.parse(savedMetrics); } catch (e) {}
    }
    setSystemMetrics(loadedMetrics);

    let loadedSysState: any = "RUNNING";
    if (savedSystemState) {
      loadedSysState = savedSystemState;
    }
    setSystemState(loadedSysState);

    // Build memory map from loaded objects
    setMemoryPages(buildMemoryPages(loadedObjects));
  };

  useEffect(() => {
    loadUserData(currentPortalUser);
  }, [currentPortalUser]);

  // Save changes to localStorage on modifications
  const saveStateToStorage = (
    currentObjects: SlsObject[],
    currentServices: MicrokernelService[],
    currentWalLogs: WalLogEntry[],
    currentMetrics: SlsSystemMetrics,
    currentSysState: string
  ) => {
    if (!currentPortalUser) return;
    localStorage.setItem(`sls_objects_${currentPortalUser.id}`, JSON.stringify(currentObjects));
    localStorage.setItem(`sls_services_${currentPortalUser.id}`, JSON.stringify(currentServices));
    localStorage.setItem(`sls_wal_logs_${currentPortalUser.id}`, JSON.stringify(currentWalLogs));
    localStorage.setItem(`sls_metrics_${currentPortalUser.id}`, JSON.stringify(currentMetrics));
    localStorage.setItem(`sls_system_state_${currentPortalUser.id}`, currentSysState);
  };

  // Keep ticking uptime metrics in background
  useEffect(() => {
    const timer = setInterval(() => {
      if (!currentPortalUser) return;
      setSystemMetrics(prev => {
        const next = { ...prev, uptimeSeconds: prev.uptimeSeconds + 1 };
        localStorage.setItem(`sls_metrics_${currentPortalUser.id}`, JSON.stringify(next));
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [currentPortalUser]);

  // Action: Allocate a fresh heap object (Persistent Heap Management)
  const handleAllocateObject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newObjName.trim()) return;

    // Verify current portal user memory space quota lease limits
    const currentPages = objects.reduce((acc, obj) => acc + obj.sizePages, 0);
    const maxPages = (currentPortalUser?.maxMemoryKB || 128) / 4;
    if (currentPages + newObjSize > maxPages) {
      setAllocationError(`LEASE ALLOCATION EXCEEDED: Your current ${currentPortalUser?.tier || "Free"} Lease tier allows a maximum of ${currentPortalUser?.maxMemoryKB || 128} KB (${maxPages} pages). This segment requires ${newObjSize} pages (${newObjSize * 4} KB), but you only have ${maxPages - currentPages} pages remaining. Please delete an existing object or upgrade your subscription tier in the Sovereign Portal tab!`);
      return;
    }

    const startAddress = generateRandomAddress(0x2000);
    
    // Seed initial payload depending on selected SlsObjectType
    let initialPayload: Record<string, any> = { data_version: "1.0" };
    if (newObjType === SlsObjectType.DB_TABLE) {
      initialPayload = {
        "col_id": "REC_001",
        "col_name": "Allocated Table Row",
        "col_metric": Math.floor(Math.random() * 1000)
      };
    } else if (newObjType === SlsObjectType.PROGRAM) {
      initialPayload = {
        "instruction_count": 128,
        "entry_point": `${startAddress}+0x40`,
        "stack_bounds": "0x0000_7FFF_E000"
      };
    }

    const newObj: SlsObject = {
      id: `heap_obj_${Date.now()}`,
      name: newObjName,
      type: newObjType,
      startAddress,
      sizePages: newObjSize,
      tier: StorageTier.L2_DRAM,
      owner: newObjOwner,
      lastAccessTime: new Date().toISOString(),
      isCompressed: false,
      acl: DEFAULT_ACL(newObjOwner),
      data: initialPayload
    };

    const updatedObjs = [...objects, newObj];
    setObjects(updatedObjs);
    
    // Re-build virtual memory grid
    const updatedPages = buildMemoryPages(updatedObjs);
    setMemoryPages(updatedPages);

    // Update WAL logs
    const newWal: WalLogEntry = {
      index: walLogs.length + 1,
      txId: null,
      timestamp: new Date().toISOString(),
      action: "ALLOCATE",
      details: `Persistent heap allocated: [${newObj.name}] type [${newObj.type}] at [${startAddress}], size: ${newObjSize} pages.`,
      checksum: generateChecksum(newObj.name + startAddress),
      verified: true
    };
    const updatedWal = [...walLogs, newWal];
    setWalLogs(updatedWal);

    // Update system metrics
    const updatedMetrics = {
      ...systemMetrics,
      totalAllocatedPages: systemMetrics.totalAllocatedPages + newObjSize
    };
    setSystemMetrics(updatedMetrics);

    // Reset create dialog
    setNewObjName("");
    setAllocationError(null);
    setShowCreateDialog(false);

    saveStateToStorage(updatedObjs, services, updatedWal, updatedMetrics, systemState);
  };

  // Action: Move memory page tiers (High-Speed Archival Storage Tiering)
  const handleMigrateObjectTier = (objectId: string, targetTier: StorageTier) => {
    const updated = objects.map(obj => {
      if (obj.id === objectId) {
        return {
          ...obj,
          tier: targetTier,
          isCompressed: targetTier === StorageTier.L4_ARCHIVE,
          lastAccessTime: new Date().toISOString()
        };
      }
      return obj;
    });

    setObjects(updated);
    setMemoryPages(buildMemoryPages(updated));

    // Append log to WAL
    const targetObj = objects.find(o => o.id === objectId);
    if (targetObj) {
      const newWal: WalLogEntry = {
        index: walLogs.length + 1,
        txId: null,
        timestamp: new Date().toISOString(),
        action: "TIER_MIGRATE",
        details: `Migrated object [${targetObj.name}] to ${targetTier}. ${targetTier === StorageTier.L4_ARCHIVE ? "Enabled LZX compression." : "Decompressed."}`,
        checksum: generateChecksum(targetObj.id + targetTier),
        verified: true
      };
      const updatedWal = [...walLogs, newWal];
      setWalLogs(updatedWal);
      saveStateToStorage(updated, services, updatedWal, systemMetrics, systemState);
    }
  };

  // Action: Read / Dereference Pointer Address (Pointer-based Data Access with latency metrics)
  const handleAccessAddress = (address: string) => {
    // Find if this address is occupied by an object
    const page = memoryPages.find(p => p.address === address);
    
    let latency = 0.01; // default L1 SRAM latency
    let isPageFault = false;
    let hitLocation = StorageTier.L1_CACHE;

    if (page && page.objectId) {
      hitLocation = page.tier;
      switch (page.tier) {
        case StorageTier.L1_CACHE:
          latency = 0.01;
          break;
        case StorageTier.L2_DRAM:
          latency = 0.10;
          break;
        case StorageTier.L3_SSD:
          latency = 1.50;
          break;
        case StorageTier.L4_ARCHIVE:
          // Level 4 storage tier is cold and compressed. Accessing it triggers a "Page Fault"
          // Swapping it back up to RAM, decompressing it, and adding extra translation delay!
          latency = 12.50; 
          isPageFault = true;
          break;
      }

      // Update the accessed object's last access time to reset its idle sweep timer
      setObjects(prev => {
        const next = prev.map(o => {
          if (o.id === page.objectId) {
            return { ...o, lastAccessTime: new Date().toISOString() };
          }
          return o;
        });
        saveStateToStorage(next, services, walLogs, systemMetrics, systemState);
        return next;
      });
    }

    // Adjust metrics state
    setSystemMetrics(prev => {
      const next = {
        ...prev,
        totalAccesses: prev.totalAccesses + 1,
        pageFaultCount: isPageFault ? prev.pageFaultCount + 1 : prev.pageFaultCount,
        l1CacheHits: hitLocation === StorageTier.L1_CACHE ? prev.l1CacheHits + 1 : prev.l1CacheHits,
        l2DramHits: hitLocation === StorageTier.L2_DRAM ? prev.l2DramHits + 1 : prev.l2DramHits,
        l3SsdHits: hitLocation === StorageTier.L3_SSD ? prev.l3SsdHits + 1 : prev.l3SsdHits,
        l4ArchiveHits: hitLocation === StorageTier.L4_ARCHIVE ? prev.l4ArchiveHits + 1 : prev.l4ArchiveHits,
      };
      localStorage.setItem("sls_metrics", JSON.stringify(next));
      return next;
    });

    // If it was a page fault, let's automatically promote the object back to L2_DRAM!
    if (isPageFault && page && page.objectId) {
      setTimeout(() => {
        handleMigrateObjectTier(page.objectId!, StorageTier.L2_DRAM);
      }, 500);
    }

    return { hit: page?.objectId !== null, latency, pageFault: isPageFault };
  };

  // Action: Begin ACID Transaction (Transactional Memory Support)
  const handleBeginTransaction = () => {
    const txId = `TX-${Math.floor(1000 + Math.random() * 9000)}`;
    const newTx: Transaction = {
      id: txId,
      state: "ACTIVE",
      startedAt: new Date().toISOString(),
      updatedKeys: []
    };
    setActiveTx(newTx);

    // WAL Log
    const newWal: WalLogEntry = {
      index: walLogs.length + 1,
      txId: txId,
      timestamp: new Date().toISOString(),
      action: "TX_START",
      details: `Transaction bounds established by User [${activeUser}]. Flat address locks acquired.`,
      checksum: generateChecksum(txId + "START"),
      verified: true
    };
    const updatedWal = [...walLogs, newWal];
    setWalLogs(updatedWal);
    saveStateToStorage(objects, services, updatedWal, systemMetrics, systemState);
  };

  // Action: Stage a write operation inside active Transaction
  const handleAddTxWrite = (objectId: string, key: string, newValue: any) => {
    if (!activeTx) return;

    const targetObj = objects.find(o => o.id === objectId);
    if (!targetObj) return;

    const oldValue = targetObj.data[key] !== undefined ? targetObj.data[key] : "NULL";

    const updatedTx: Transaction = {
      ...activeTx,
      updatedKeys: [
        ...activeTx.updatedKeys,
        { objectId, key, oldValue, newValue }
      ]
    };
    setActiveTx(updatedTx);

    // Flash the visual memory map segment to DIRTY to showcase transactional staging
    setMemoryPages(prev => prev.map(page => {
      if (page.objectId === objectId) {
        return { ...page, isDirty: true };
      }
      return page;
    }));

    // Append write logs
    const newWal: WalLogEntry = {
      index: walLogs.length + 1,
      txId: activeTx.id,
      timestamp: new Date().toISOString(),
      action: "TX_WRITE",
      details: `Staged segment write at pointer offset. Object: [${targetObj.name}], Field: [${key}], Old: ${oldValue}, New: ${newValue}.`,
      checksum: generateChecksum(activeTx.id + key + String(newValue)),
      verified: true
    };
    const updatedWal = [...walLogs, newWal];
    setWalLogs(updatedWal);
    saveStateToStorage(objects, services, updatedWal, systemMetrics, systemState);
  };

  // Action: Commit Transaction (ACID writeback to heap, flushes dirty pages)
  const handleCommitTransaction = () => {
    if (!activeTx) return;

    // Apply all updates permanently to objects
    const updatedObjs = objects.map(obj => {
      const txUpdates = activeTx.updatedKeys.filter(u => u.objectId === obj.id);
      if (txUpdates.length > 0) {
        const nextData = { ...obj.data };
        txUpdates.forEach(update => {
          nextData[update.key] = update.newValue;
        });
        return {
          ...obj,
          data: nextData,
          lastAccessTime: new Date().toISOString()
        };
      }
      return obj;
    });

    setObjects(updatedObjs);
    
    // De-stage dirty indicators on memory map
    setMemoryPages(buildMemoryPages(updatedObjs));

    // Append Commit record
    const newWal: WalLogEntry = {
      index: walLogs.length + 1,
      txId: activeTx.id,
      timestamp: new Date().toISOString(),
      action: "TX_COMMIT",
      details: `Transaction ${activeTx.id} committed. Changes written permanently to SLS flash. Virtual lock released.`,
      checksum: generateChecksum(activeTx.id + "COMMIT"),
      verified: true
    };
    const updatedWal = [...walLogs, newWal];
    setWalLogs(updatedWal);
    setActiveTx(null);

    saveStateToStorage(updatedObjs, services, updatedWal, systemMetrics, systemState);
  };

  // Action: Abort / Rollback Transaction (Discards pending states)
  const handleAbortTransaction = () => {
    if (!activeTx) return;

    // Clear dirty flags on memory pages
    setMemoryPages(buildMemoryPages(objects));

    // Append Abort WAL entry
    const newWal: WalLogEntry = {
      index: walLogs.length + 1,
      txId: activeTx.id,
      timestamp: new Date().toISOString(),
      action: "TX_ABORT",
      details: `Transaction ${activeTx.id} aborted by user instruction. Changes rolled back, pointers restored.`,
      checksum: generateChecksum(activeTx.id + "ABORT"),
      verified: true
    };
    const updatedWal = [...walLogs, newWal];
    setWalLogs(updatedWal);
    setActiveTx(null);

    saveStateToStorage(objects, services, updatedWal, systemMetrics, systemState);
  };

  // Action: Direct, non-transactional write directly to heap bypass
  const handleDirectWrite = (objectId: string, key: string, newValue: any) => {
    const targetObj = objects.find(o => o.id === objectId);
    if (!targetObj) return;

    const updatedObjs = objects.map(obj => {
      if (obj.id === objectId) {
        return {
          ...obj,
          data: {
            ...obj.data,
            [key]: newValue
          },
          lastAccessTime: new Date().toISOString()
        };
      }
      return obj;
    });

    setObjects(updatedObjs);
    setMemoryPages(buildMemoryPages(updatedObjs));

    const newWal: WalLogEntry = {
      index: walLogs.length + 1,
      txId: null,
      timestamp: new Date().toISOString(),
      action: "DIRECT_WRITE",
      details: `Direct heap bypass (NON-TRANSACTIONAL). Object: [${targetObj.name}], Field: [${key}], Value: ${newValue}.`,
      checksum: generateChecksum(objectId + key + String(newValue)),
      verified: true
    };
    const updatedWal = [...walLogs, newWal];
    setWalLogs(updatedWal);
    saveStateToStorage(updatedObjs, services, updatedWal, systemMetrics, systemState);
  };

  // Portal Account Handlers
  const handlePortalLogin = (user: PortalUser) => {
    setCurrentPortalUser(user);
    localStorage.setItem("sls_current_portal_user", JSON.stringify(user));
    setActiveTab("memory"); // Transition to active memory map on login!
  };

  const handlePortalLogout = () => {
    setCurrentPortalUser(null);
    localStorage.removeItem("sls_current_portal_user");
    setActiveTab("portal");
  };

  const handleUpdatePortalUser = (updatedUser: PortalUser) => {
    setCurrentPortalUser(updatedUser);
    localStorage.setItem("sls_current_portal_user", JSON.stringify(updatedUser));
    
    // Update in global list
    const savedRegistry = localStorage.getItem("sls_portal_users");
    let registry = [];
    if (savedRegistry) {
      try { registry = JSON.parse(savedRegistry); } catch (e) {}
    }
    const updatedRegistry = registry.map((u: any) => u.id === updatedUser.id ? updatedUser : u);
    localStorage.setItem("sls_portal_users", JSON.stringify(updatedRegistry));
  };

  // Action: Crash OS Service (Microkernel Fault Isolation & Autoreboot simulation)
  const handleCrashService = (serviceId: string) => {
    const updatedSrvs = services.map(srv => {
      if (srv.id === serviceId) {
        return { ...srv, state: "FAILED" as const, latencyMs: 999.0 };
      }
      return srv;
    });
    setServices(updatedSrvs);
    saveStateToStorage(objects, updatedSrvs, walLogs, systemMetrics, systemState);

    // Trigger Watchdog recovery: reboot process after 1.5 seconds
    setTimeout(() => {
      setServices(prev => prev.map(srv => {
        if (srv.id === serviceId) {
          return { ...srv, state: "REBOOTING" as const, latencyMs: 4.5 };
        }
        return srv;
      }));
    }, 1500);

    // Restore online after 2.5 seconds
    setTimeout(() => {
      setServices(prev => {
        const next = prev.map(srv => {
          if (srv.id === serviceId) {
            return {
              ...srv,
              state: "ONLINE" as const,
              latencyMs: serviceId === "mem_mgr" ? 1.2 :
                         serviceId === "sec_mgr" ? 1.8 :
                         serviceId === "db_mgr" ? 2.5 :
                         serviceId === "tier_mgr" ? 0.9 : 1.4,
              restarts: srv.restarts + 1
            };
          }
          return srv;
        });
        localStorage.setItem("sls_services", JSON.stringify(next));
        return next;
      });
    }, 2800);
  };

  // Action: Crash Operating System (Power Loss simulation / Wipe Volatile memory)
  const handleCrashSystem = () => {
    // Revert dirty states in volatile memory map
    setMemoryPages(buildMemoryPages(objects));
    
    // Wipes active transaction context immediately
    setActiveTx(null);
    setSystemState("CRASHED");

    // Add crash log in WAL (simulates the abrupt log cut off)
    const newWal: WalLogEntry = {
      index: walLogs.length + 1,
      txId: null,
      timestamp: new Date().toISOString(),
      action: "TX_ABORT",
      details: `CATASTROPHIC_POWER_FAILURE: RAM page caches disrupted. Memory registers wiped. SLS catalog status suspect.`,
      checksum: "CRC32-00000000",
      verified: false // Corrupted or partial log entry
    };
    const updatedWal = [...walLogs, newWal];
    setWalLogs(updatedWal);

    saveStateToStorage(objects, services, updatedWal, systemMetrics, "CRASHED");
  };

  // Action: Reboot & Run Verification Services (Automated Log Replay / Redo and Undo loops)
  const handleRebootAndRecover = () => {
    setSystemState("RECOVERING");

    const auditLogs: string[] = [];
    let redoneCount = 0;
    let undoneCount = 0;

    auditLogs.push(`[BOOT] Initiating SLS recovery scan. Checking physical disk sectors...`);
    auditLogs.push(`[BOOT] Found Write-Ahead Log (WAL) at sector offset 0x00A0_F200.`);

    // Chronological Scan of WAL entries
    walLogs.forEach(log => {
      // 1. Recalculate checksums to detect storage sector corruption
      const computedHash = log.checksum === "CRC32-00000000" ? "CRC32-00000000" : generateChecksum(log.details + (log.txId || ""));
      auditLogs.push(`[AUDIT] Validating log entry #${log.index.toString().padStart(3, "0")} checksum: target=${log.checksum}, computed=${computedHash}`);
    });

    // 2. Identify committed vs uncommitted transactions
    const committedTxIds = new Set<string>();
    const abortedTxIds = new Set<string>();
    const startedTxIds = new Set<string>();

    walLogs.forEach(log => {
      if (log.txId) {
        if (log.action === "TX_START") startedTxIds.add(log.txId);
        if (log.action === "TX_COMMIT") committedTxIds.add(log.txId);
        if (log.action === "TX_ABORT") abortedTxIds.add(log.txId);
      }
    });

    // Determine interrupted transactions that started but never committed
    const interruptedTxIds = Array.from(startedTxIds).filter(id => !committedTxIds.has(id) && !abortedTxIds.has(id));

    auditLogs.push(`[ANALYSIS] Scan complete. Interrupted transactions detected: [${interruptedTxIds.join(", ") || "None"}].`);
    auditLogs.push(`[ANALYSIS] Committed transactions verified for write-back replay: [${Array.from(committedTxIds).join(", ") || "None"}].`);

    // 3. Perform UNDO for interrupted active transactions to roll back staged values
    interruptedTxIds.forEach(txId => {
      undoneCount++;
      auditLogs.push(`[UNDO] Transaction ${txId} was uncommitted during power loss. Discarding staged memory edits, restoring pointer integrity.`);
    });

    // 4. Perform REDO for committed transactions to guarantee absolute durability
    committedTxIds.forEach(txId => {
      redoneCount++;
      auditLogs.push(`[REDO] Transaction ${txId} was successfully committed. Replaying modifications to database tables...`);
    });

    // Complete recovery sequence
    setTimeout(() => {
      setSystemState("RUNNING");
      
      // Seed a successful recovery WAL log
      const recoveryWal: WalLogEntry = {
        index: walLogs.length + 1,
        txId: null,
        timestamp: new Date().toISOString(),
        action: "SYSTEM_CHECKPOINT",
        details: `RECOVERY_VERIFICATION_COMPLETE. Validated all logs. Database consistency at 100% parity.`,
        checksum: generateChecksum("RECOVERY"),
        verified: true
      };
      
      const nextWal = [...walLogs, recoveryWal];
      setWalLogs(nextWal);
      saveStateToStorage(objects, services, nextWal, systemMetrics, "RUNNING");
    }, 2200);

    return { redoneCount, undoneCount, auditLogs };
  };

  // Action: Update Object-level Security ACLs (Object Security Management)
  const handleUpdatePermission = (objectId: string, updatedAcl: ObjectAcl) => {
    const updated = objects.map(obj => {
      if (obj.id === objectId) {
        return { ...obj, acl: updatedAcl };
      }
      return obj;
    });
    setObjects(updated);
    saveStateToStorage(updated, services, walLogs, systemMetrics, systemState);
  };

  return (
    <div className="min-h-screen bg-[#0B0E14] text-[#E0E2E5] flex flex-col font-sans select-none">
      
      {/* 1. TOP STATUS BAR (EDITORIAL AESTHETIC HEADER) */}
      <header className="border-b border-white/10 bg-[#0B0E14] sticky top-0 z-40 px-8 py-5 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-3 h-3 bg-cyan-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.5)]"></div>
          <div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs tracking-widest text-cyan-400 uppercase">System Kernel 4.0 // SLSOS</span>
              <span className="text-[9px] font-mono border border-cyan-400/25 text-cyan-400 px-1.5 py-0.5 rounded uppercase tracking-wider">
                Active Simulator
              </span>
            </div>
            <h1 className="text-3xl font-serif italic text-white tracking-tight leading-tight mt-1 flex items-center gap-2">
              Single Level Storage OS
            </h1>
            {currentPortalUser && (
              <div className="flex items-center gap-1.5 mt-1 font-mono text-[10px] text-cyan-400 uppercase tracking-widest">
                <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-ping"></span>
                <span>Workspace Leased: <strong className="text-white font-semibold">{currentPortalUser.username}</strong> ({currentPortalUser.tier})</span>
              </div>
            )}
          </div>
        </div>

        {/* Operating System General Metrics with Technical/Editorial styling */}
        <div className="flex flex-wrap items-center gap-3 md:gap-6 text-[10px] font-mono uppercase tracking-wider text-white/50">
          <div className="flex items-center gap-2 border-r border-white/10 pr-4">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span>Uptime: <strong className="text-white font-medium">{systemMetrics.uptimeSeconds}s</strong></span>
          </div>

          <div className="flex items-center gap-2 border-r border-white/10 pr-4">
            <div className={`w-1.5 h-1.5 rounded-full ${
              systemState === "RUNNING" ? "bg-emerald-400" :
              systemState === "CRASHED" ? "bg-red-500" : "bg-amber-400 animate-spin"
            }`} />
            <span>Node Status: <strong className={systemState === "RUNNING" ? "text-emerald-400 font-medium" : "text-amber-400 font-medium"}>{systemState}</strong></span>
          </div>

          <div className="flex items-center border-r border-white/10 pr-4">
            <SlsSystemHealth systemMetrics={systemMetrics} setSystemMetrics={setSystemMetrics} />
          </div>

          <button
            onClick={() => {
              setAllocationError(null);
              setShowCreateDialog(true);
            }}
            className="bg-cyan-400 hover:bg-cyan-300 text-[#0B0E14] font-mono text-xs font-bold px-4 py-2 tracking-wide flex items-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 stroke-[3]" /> valloc() Heap Object
          </button>
        </div>
      </header>

      {/* 2. SUB-HERO EXPLANATORY STRIP (EDITORIAL SIGNATURE PANEL) */}
      <div className="bg-[#0F1219] border-b border-white/10 px-8 py-5 flex flex-col lg:flex-row justify-between gap-6">
        <p className="text-sm font-light text-white/60 leading-relaxed max-w-3xl">
          Modeled after the legacy IBM AS/400 hardware pointer architecture, <span className="text-white font-medium">SLSOS</span> eliminates the boundaries between storage files and volatile RAM. Every byte resides in a flat, globally addressable virtual memory space, protected by hardware-enforced capabilities and transaction logs.
        </p>
        <div className="grid grid-cols-2 gap-4 text-[10px] font-mono tracking-wider uppercase text-white/40">
          <div>
            <span className="text-cyan-400 block mb-0.5">ADDRESS SPACE</span>
            <span className="text-white font-medium">64-Bit Pointer-Addressable</span>
          </div>
          <div>
            <span className="text-orange-500 block mb-0.5">RECOVERY MATRIX</span>
            <span className="text-white font-medium">WAL Engine Active</span>
          </div>
        </div>
      </div>

      {/* 3. TABBED VIEW NAVIGATION (Sharp Editorial Tabs) */}
      {currentPortalUser && (
        <nav className="bg-[#0B0E14] border-b border-white/10 px-8 flex flex-wrap gap-0">
          {[
            { key: "memory", label: "01 // Address Space Map", icon: <Layers className="w-3.5 h-3.5" /> },
            { key: "security", label: "02 // Protection Rings", icon: <ShieldCheck className="w-3.5 h-3.5" /> },
            { key: "transactions", label: "03 // Transactional Log", icon: <Database className="w-3.5 h-3.5" /> },
            { key: "microkernel", label: "04 // Microkernel Bus", icon: <Cpu className="w-3.5 h-3.5" /> },
            { key: "coprocessor", label: "05 // AI Co-Processor", icon: <Sparkles className="w-3.5 h-3.5" /> },
            { key: "deepthink", label: "06 // Deep Thinking Query", icon: <Brain className="w-3.5 h-3.5" /> },
            { key: "portal", label: "07 // Sovereign Portal", icon: <User className="w-3.5 h-3.5" /> },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-5 py-4 text-xs font-mono tracking-widest uppercase flex items-center gap-2 border-r border-white/10 transition-all cursor-pointer relative ${
                activeTab === tab.key
                  ? "bg-[#0F1219] text-white border-t-2 border-t-cyan-400 font-semibold"
                  : "text-white/40 hover:text-white/80 hover:bg-[#0F1219]/30"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      )}

      {/* 4. CORE INTERACTIVE CONTAINER */}
      <main className="flex-1 p-8 overflow-y-auto bg-[#0F1219]">
        {!currentPortalUser ? (
          <SlsUserPortal
            currentUser={currentPortalUser}
            onLogin={handlePortalLogin}
            onLogout={handlePortalLogout}
            onUpdateUser={handleUpdatePortalUser}
            objects={objects}
          />
        ) : (
          <>
            {activeTab === "portal" && (
              <SlsUserPortal
                currentUser={currentPortalUser}
                onLogin={handlePortalLogin}
                onLogout={handlePortalLogout}
                onUpdateUser={handleUpdatePortalUser}
                objects={objects}
              />
            )}

            {activeTab === "memory" && (
              <SlsMemoryMap
                objects={objects}
                memoryPages={memoryPages}
                onMigrateObjectTier={handleMigrateObjectTier}
                onAccessAddress={handleAccessAddress}
                onSelectObject={(objId) => console.log("Selected Object: ", objId)}
                systemMetrics={systemMetrics}
                autoTierEnabled={autoTierEnabled}
                setAutoTierEnabled={setAutoTierEnabled}
                ssdThreshold={ssdThreshold}
                setSsdThreshold={setSsdThreshold}
                archiveThreshold={archiveThreshold}
                setArchiveThreshold={setArchiveThreshold}
              />
            )}

            {activeTab === "security" && (
              <SlsSecurityDashboard
                objects={objects}
                onUpdateObjectAcl={handleUpdatePermission}
                selectedUser={activeUser}
                onSelectUser={setActiveUser}
              />
            )}

            {activeTab === "transactions" && (
              <SlsTransactionConsole
                objects={objects}
                activeTx={activeTx}
                onBeginTx={handleBeginTransaction}
                onAddTxWrite={handleAddTxWrite}
                onCommitTx={handleCommitTransaction}
                onAbortTx={handleAbortTransaction}
                walLogs={walLogs}
                onCrashSystem={handleCrashSystem}
                onRebootAndRecover={handleRebootAndRecover}
                systemState={systemState}
                onDirectWrite={handleDirectWrite}
              />
            )}

            {activeTab === "microkernel" && (
              <SlsMicrokernelVisualizer
                services={services}
                onCrashService={handleCrashService}
                systemMetrics={systemMetrics}
              />
            )}

            {activeTab === "coprocessor" && (
              <SlsAiCoprocessor
                objects={objects}
                services={services}
                systemMetrics={systemMetrics}
                activeUser={activeUser}
              />
            )}

            {activeTab === "deepthink" && (
              <SlsDeepThinkingQuery
                objects={objects}
                services={services}
                systemMetrics={systemMetrics}
                activeUser={activeUser}
              />
            )}
          </>
        )}
      </main>

      {/* FOOTER */}
      <footer className="h-12 bg-[#0B0E14] border-t border-white/10 flex items-center justify-between px-8 text-[10px] font-mono text-white/30 tracking-widest uppercase">
        <div>SLSOS ARCHITECT // IBM HARDWARE PERSISTENT SIMULATION</div>
        <div className="flex gap-6">
          <span>Build: 4.1.0-EDITORIAL</span>
          <span>License: MIT/PROPRIETARY</span>
        </div>
      </footer>

      {/* 5. MODAL: ALLOCATE HEAP OBJECT (Styled Editorial) */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <form
            onSubmit={handleAllocateObject}
            className="bg-[#0F1219] border border-white/10 rounded-none p-8 w-full max-w-md space-y-6 animate-scaleUp relative"
          >
            <div className="flex justify-between items-center border-b border-white/10 pb-4">
              <h3 className="text-xl font-serif italic text-white flex items-center gap-2">
                Allocate Heap Segment
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateDialog(false)}
                className="text-white/40 hover:text-white font-mono text-xs cursor-pointer uppercase tracking-widest"
              >
                [ Close ]
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {allocationError && (
                <div className="bg-red-950/20 border border-red-900/40 p-3.5 text-red-400 font-mono text-[11px] leading-relaxed">
                  ⚠️ {allocationError}
                </div>
              )}

              {/* Name */}
              <div>
                <label className="block text-white/50 mb-1.5 font-mono uppercase tracking-widest text-[10px]">1. Identifier Name:</label>
                <input
                  type="text"
                  required
                  value={newObjName}
                  onChange={(e) => setNewObjName(e.target.value)}
                  placeholder="e.g. SalesLedgerJuly"
                  className="w-full bg-[#0B0E14] border border-white/10 p-3 text-white font-mono focus:outline-none focus:border-cyan-400 placeholder-white/20 rounded-none text-xs"
                />
              </div>

              {/* Object Type */}
              <div>
                <label className="block text-white/50 mb-1.5 font-mono uppercase tracking-widest text-[10px]">2. Object Sub-Class:</label>
                <select
                  value={newObjType}
                  onChange={(e) => setNewObjType(e.target.value as SlsObjectType)}
                  className="w-full bg-[#0B0E14] border border-white/10 p-3 text-white font-mono focus:outline-none focus:border-cyan-400 rounded-none cursor-pointer text-xs"
                >
                  <option value={SlsObjectType.DB_TABLE}>DB_TABLE (Relational Store)</option>
                  <option value={SlsObjectType.PROGRAM}>PROGRAM (Executable Block)</option>
                  <option value={SlsObjectType.SYSTEM_METADATA}>SYSTEM_METADATA (OS Core)</option>
                </select>
              </div>

              {/* Owner */}
              <div>
                <label className="block text-white/50 mb-1.5 font-mono uppercase tracking-widest text-[10px]">3. Object Owner Profile:</label>
                <select
                  value={newObjOwner}
                  onChange={(e) => setNewObjOwner(e.target.value as SlsUser)}
                  className="w-full bg-[#0B0E14] border border-white/10 p-3 text-white font-mono focus:outline-none focus:border-cyan-400 rounded-none cursor-pointer text-xs"
                >
                  <option value={SlsUser.DB_ADMIN}>DB_ADMIN</option>
                  <option value={SlsUser.SYSTEM_KERNEL}>SYSTEM_KERNEL</option>
                  <option value={SlsUser.APP_USER}>APP_USER</option>
                </select>
              </div>

              {/* Segment Size in pages */}
              <div>
                <label className="block text-white/50 mb-1.5 font-mono uppercase tracking-widest text-[10px]">4. Virtual Allocation Size (Pages):</label>
                <div className="flex items-center gap-4 bg-[#0B0E14] border border-white/10 p-3">
                  <input
                    type="range"
                    min={1}
                    max={12}
                    value={newObjSize}
                    onChange={(e) => setNewObjSize(Number(e.target.value))}
                    className="flex-1 accent-cyan-400 cursor-pointer"
                  />
                  <span className="font-mono text-cyan-400 font-bold tracking-tight text-xs">
                    {newObjSize} pgs ({newObjSize * 4}KB)
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-white/10 flex gap-3">
              <button
                type="submit"
                className="flex-1 bg-cyan-400 hover:bg-cyan-300 text-[#0B0E14] font-mono text-xs font-bold py-3 uppercase tracking-wider transition-all cursor-pointer"
              >
                valloc_segment()
              </button>
              <button
                type="button"
                onClick={() => setShowCreateDialog(false)}
                className="bg-[#0B0E14] hover:bg-[#0B0E14]/70 border border-white/10 text-white/60 hover:text-white px-5 py-3 font-mono text-xs uppercase tracking-wider transition-all cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}


