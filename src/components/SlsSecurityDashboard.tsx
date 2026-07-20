import React, { useState } from "react";
import { SlsObject, SlsUser, Permission, ObjectAcl, SlsObjectType } from "../types/sls";
import { Shield, ShieldAlert, ShieldCheck, User, Settings, Check, X, Terminal, HelpCircle } from "lucide-react";

interface SlsSecurityDashboardProps {
  objects: SlsObject[];
  onUpdateObjectAcl: (objectId: string, acl: ObjectAcl) => void;
  selectedUser: SlsUser;
  onSelectUser: (user: SlsUser) => void;
}

export default function SlsSecurityDashboard({
  objects,
  onUpdateObjectAcl,
  selectedUser,
  onSelectUser
}: SlsSecurityDashboardProps) {
  const [selectedObjectId, setSelectedObjectId] = useState<string>(objects[0]?.id || "");
  const [testAction, setTestAction] = useState<"read" | "write" | "execute">("read");
  const [executionResult, setExecutionResult] = useState<{
    success: boolean;
    message: string;
    details: string;
    timestamp: string;
  } | null>(null);
  const [securityLogs, setSecurityLogs] = useState<{
    timestamp: string;
    user: SlsUser;
    objectName: string;
    action: string;
    status: "GRANTED" | "VIOLATION";
    address: string;
  }[]>([]);

  const selectedObj = objects.find(o => o.id === selectedObjectId);

  const handleUpdatePermission = (userKey: SlsUser, permKey: keyof Permission, value: boolean) => {
    if (!selectedObj) return;

    const updatedAcl = {
      ...selectedObj.acl,
      [userKey]: {
        ...selectedObj.acl[userKey],
        [permKey]: value
      }
    };

    onUpdateObjectAcl(selectedObj.id, updatedAcl);
  };

  const handleExecuteOperation = () => {
    if (!selectedObj) return;

    const timestamp = new Date().toLocaleTimeString();
    const address = selectedObj.startAddress;
    const userPerms = selectedObj.acl[selectedUser];
    const isAllowed = userPerms[testAction];

    if (isAllowed) {
      const successMsg = {
        success: true,
        message: `ACCESS GRANTED: Pointer Dereferenced`,
        details: `User [${selectedUser}] successfully executed [${testAction.toUpperCase()}] instruction on memory address [${address}]. Payload integrity verified.`,
        timestamp
      };
      setExecutionResult(successMsg);
      setSecurityLogs(prev => [
        {
          timestamp,
          user: selectedUser,
          objectName: selectedObj.name,
          action: testAction.toUpperCase(),
          status: "GRANTED",
          address
        },
        ...prev
      ]);
    } else {
      const failureMsg = {
        success: false,
        message: `SECURITY EXCEPTION: Access Violation`,
        details: `Hardware protection trap triggered! User [${selectedUser}] attempted unauthorized [${testAction.toUpperCase()}] on segment [${selectedObj.name}] at [${address}]. Execution halted with CPU Exception 0x0D (General Protection Fault).`,
        timestamp
      };
      setExecutionResult(failureMsg);
      setSecurityLogs(prev => [
        {
          timestamp,
          user: selectedUser,
          objectName: selectedObj.name,
          action: testAction.toUpperCase(),
          status: "VIOLATION",
          address
        },
        ...prev
      ]);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8" id="sls-security-dashboard">
      
      {/* 1. OPERATIONS PANEL & ACTIVE USER SIMULATOR */}
      <div className="bg-[#0B0E14] p-8 border border-white/10 flex flex-col justify-between">
        <div>
          <span className="font-mono text-[10px] tracking-widest text-indigo-400 uppercase">Interactive Privilege Simulation</span>
          <h3 className="text-2xl font-serif italic text-white mt-1 border-b border-white/10 pb-4 mb-6">
            Security Context Simulator
          </h3>
          <p className="text-white/60 text-xs font-light leading-relaxed mb-6">
            In an AeroSLS, pointer manipulation is hardware-restricted. The memory subsystem checks credentials directly upon address load.
          </p>

          <div className="space-y-6">
            {/* Active User Selection */}
            <div>
              <label className="block text-[10px] font-mono text-white/50 uppercase tracking-widest mb-2.5">
                1. Select Active Security Profile
              </label>
              <div className="grid grid-cols-2 gap-2">
                {Object.values(SlsUser).map((user) => (
                  <button
                    key={user}
                    onClick={() => onSelectUser(user)}
                    className={`p-3 border text-left text-xs font-mono flex items-center gap-2 cursor-pointer transition-all ${
                      selectedUser === user
                        ? "bg-[#0F1219] border-indigo-400 text-indigo-300 ring-1 ring-indigo-400"
                        : "bg-[#0F1219]/40 border-white/5 hover:border-white/10 text-white/50"
                    }`}
                  >
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      user === SlsUser.SYSTEM_KERNEL ? "bg-red-400" :
                      user === SlsUser.DB_ADMIN ? "bg-amber-400" :
                      user === SlsUser.APP_USER ? "bg-cyan-400" : "bg-zinc-500"
                    }`} />
                    <span className="truncate">{user.replace("SlsUser.", "")}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Target Object Selection */}
            <div>
              <label className="block text-[10px] font-mono text-white/50 uppercase tracking-widest mb-2.5">
                2. Select Target Memory Segment
              </label>
              <select
                value={selectedObjectId}
                onChange={(e) => setSelectedObjectId(e.target.value)}
                className="w-full bg-[#0F1219] border border-white/10 text-white font-mono p-3 rounded-none text-xs cursor-pointer focus:outline-none focus:border-indigo-400"
              >
                {objects.map((obj) => (
                  <option key={obj.id} value={obj.id}>
                    {obj.name} ({obj.startAddress})
                  </option>
                ))}
              </select>
            </div>

            {/* Target Action Selection */}
            <div>
              <label className="block text-[10px] font-mono text-white/50 uppercase tracking-widest mb-2.5">
                3. Choose CPU Instruction
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(["read", "write", "execute"] as const).map((act) => (
                  <button
                    key={act}
                    onClick={() => setTestAction(act)}
                    className={`py-2 px-1 border font-mono text-center text-xs uppercase cursor-pointer transition-all ${
                      testAction === act
                        ? "bg-[#0F1219] border-indigo-400 text-indigo-300 ring-1 ring-indigo-400"
                        : "bg-[#0F1219]/40 border-white/5 hover:border-white/10 text-white/50"
                    }`}
                  >
                    {act}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Trigger execution */}
        <div className="pt-6 mt-8 border-t border-white/10">
          <button
            onClick={handleExecuteOperation}
            className="w-full bg-indigo-500 hover:bg-indigo-400 text-white font-mono text-xs font-bold py-3 uppercase tracking-wider cursor-pointer transition-all active:scale-[0.98]"
          >
            Dispatch Memory Instruction
          </button>
        </div>
      </div>

      {/* 2. OBJECT ACCESS CONTROL LIST (ACL) EDITOR */}
      <div className="bg-[#0B0E14] p-8 border border-white/10 flex flex-col justify-between">
        <div>
          <span className="font-mono text-[10px] tracking-widest text-emerald-400 uppercase">Protection Rings</span>
          <h3 className="text-2xl font-serif italic text-white mt-1 border-b border-white/10 pb-4 mb-6">
            Object Protection Rules
          </h3>
          <p className="text-white/60 text-xs font-light leading-relaxed mb-6">
            Viewing and editing active capabilities for: <strong className="text-indigo-400">{selectedObj?.name}</strong>. System catalog is hardware-restricted.
          </p>

          {selectedObj ? (
            <div className="bg-[#0F1219] border border-white/10 p-4">
              <table className="w-full text-left text-xs text-white/70 font-mono">
                <thead>
                  <tr className="border-b border-white/10 text-[9px] uppercase tracking-widest text-white/40">
                    <th className="pb-3">Security Role</th>
                    <th className="pb-3 text-center">Read</th>
                    <th className="pb-3 text-center">Write</th>
                    <th className="pb-3 text-center">Exec</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {Object.values(SlsUser).map((user) => {
                    const permissions = selectedObj.acl[user];
                    const isSystemKernel = user === SlsUser.SYSTEM_KERNEL;

                    return (
                      <tr key={user} className="hover:bg-white/5">
                        <td className="py-3 font-semibold text-white flex flex-col">
                          <span>{user.replace("SlsUser.", "")}</span>
                          <span className="text-[9px] font-normal text-white/40">
                            {user === SlsUser.SYSTEM_KERNEL ? "Kernel Ring 0" :
                             user === SlsUser.DB_ADMIN ? "Database Subsystem" :
                             user === SlsUser.APP_USER ? "User-space process" : "Guest environment"}
                          </span>
                        </td>
                        <td className="py-3 text-center">
                          <button
                            disabled={isSystemKernel}
                            onClick={() => handleUpdatePermission(user, "read", !permissions.read)}
                            className={`p-1 hover:bg-white/10 inline-flex transition-colors ${
                              permissions.read ? "text-emerald-400" : "text-white/20"
                            } disabled:opacity-30 disabled:cursor-not-allowed`}
                          >
                            {permissions.read ? <Check className="w-4 h-4 stroke-[3]" /> : <X className="w-4 h-4" />}
                          </button>
                        </td>
                        <td className="py-3 text-center">
                          <button
                            disabled={isSystemKernel}
                            onClick={() => handleUpdatePermission(user, "write", !permissions.write)}
                            className={`p-1 hover:bg-white/10 inline-flex transition-colors ${
                              permissions.write ? "text-emerald-400" : "text-white/20"
                            } disabled:opacity-30 disabled:cursor-not-allowed`}
                          >
                            {permissions.write ? <Check className="w-4 h-4 stroke-[3]" /> : <X className="w-4 h-4" />}
                          </button>
                        </td>
                        <td className="py-3 text-center">
                          <button
                            disabled={isSystemKernel}
                            onClick={() => handleUpdatePermission(user, "execute", !permissions.execute)}
                            className={`p-1 hover:bg-white/10 inline-flex transition-colors ${
                              permissions.execute ? "text-emerald-400" : "text-white/20"
                            } disabled:opacity-30 disabled:cursor-not-allowed`}
                          >
                            {permissions.execute ? <Check className="w-4 h-4 stroke-[3]" /> : <X className="w-4 h-4" />}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-white/35 italic font-mono text-center p-8">[ No Object Selected ]</p>
          )}
        </div>

        {/* Security Concept Insight */}
        <div className="bg-[#0F1219] border border-indigo-500/20 p-5 mt-6 text-[11px] text-white/70 font-light leading-relaxed">
          <p className="font-mono text-[10px] tracking-widest text-indigo-400 uppercase font-semibold mb-1.5 flex items-center gap-1.5">
            <HelpCircle className="w-3.5 h-3.5 text-indigo-400" /> Object-Level Database Integrity
          </p>
          By embedding security rules into individual heap segments rather than relying on file system pathways, SLS prevents SQL injection or privilege escalation at the lowest hardware level.
        </div>
      </div>

      {/* 3. EXECUTION DISPATCH MONITOR & SECURITY FAULT LOGS */}
      <div className="bg-[#0B0E14] p-8 border border-white/10 flex flex-col justify-between xl:col-span-1">
        <div className="flex flex-col h-full justify-between space-y-6">
          
          {/* Active Operation Output */}
          <div>
            <h4 className="text-[10px] font-mono uppercase tracking-widest text-white/50 mb-3 border-b border-white/5 pb-1">
              CPU Exception Registers
            </h4>
            {executionResult ? (
              <div className={`p-5 border ${
                executionResult.success 
                  ? "bg-emerald-950/20 border-emerald-900/45 text-emerald-300"
                  : "bg-red-950/20 border-red-900/45 text-red-300"
              } animate-fadeIn`}>
                <div className="flex items-start gap-3">
                  {executionResult.success ? (
                    <ShieldCheck className="w-5.5 h-5.5 text-emerald-400 shrink-0" />
                  ) : (
                    <ShieldAlert className="w-5.5 h-5.5 text-red-400 shrink-0 animate-bounce" />
                  )}
                  <div>
                    <h5 className="font-mono font-bold text-xs">{executionResult.message}</h5>
                    <p className="text-[10px] text-white/60 mt-1.5 leading-relaxed font-mono">
                      {executionResult.details}
                    </p>
                    <span className="text-[9px] text-white/30 font-mono mt-3.5 block text-right">
                      Logged at: {executionResult.timestamp}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="border border-white/10 p-6 text-center text-white/30 font-mono text-[10px] italic">
                [ Waiting for memory instruction dispatch... ]
              </div>
            )}
          </div>

          {/* Real-time Hardware Security Log */}
          <div className="flex-1 flex flex-col justify-end">
            <h4 className="text-[10px] font-mono uppercase tracking-widest text-white/50 mb-3 flex justify-between items-center border-b border-white/5 pb-1">
              <span>Security Event Log</span>
              <Terminal className="w-3.5 h-3.5 text-white/20" />
            </h4>
            <div className="bg-[#0F1219] border border-white/10 p-4 font-mono text-[10px] space-y-3 h-44 overflow-y-auto scrollbar-thin">
              {securityLogs.length > 0 ? (
                securityLogs.map((log, i) => (
                  <div
                    key={i}
                    className="flex flex-col pb-2.5 border-b border-white/5 last:border-b-0 last:pb-0"
                  >
                    <div className="flex justify-between">
                      <span className="text-white/30">[{log.timestamp}]</span>
                      <span className={`font-semibold ${
                        log.status === "GRANTED" ? "text-emerald-400" : "text-red-400"
                      }`}>
                        {log.status}
                      </span>
                    </div>
                    <p className="text-white/80 mt-1">
                      User <strong className="text-white">{log.user}</strong> invoked {log.action} on {log.objectName} ({log.address})
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-white/20 italic font-mono">[ No security events logged in current boot cycle ]</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
