import { chooseProcess } from "./scheduler";
import { detectDeadlock, fulfillAvailableRequests, resourceAction, type ResourceState } from "./resources";
import type {
  KernelConfig,
  KernelEvent,
  KernelState,
  PCB,
  ProcessSpec,
  EventType,
  Device,
} from "./types";
export const defaultConfig: KernelConfig = {
  scheduler: "RR",
  quantum: 3,
  ramSize: 128,
  pageSize: 8,
  frameCount: 16,
  seed: 42891,
  chaos: false,
};
export function validateSpec(p: ProcessSpec, existing: ProcessSpec[] = []) {
  if (
    !Number.isInteger(p.pid) ||
    p.pid <= 0 ||
    existing.some((x) => x.pid === p.pid)
  )
    throw new Error("PID must be unique and positive.");
  if (!p.name.trim()) throw new Error("Process name is required.");
  for (const [key, value, minimum] of [
    ["arrival", p.arrival, 0],
    ["burst", p.burst, 1],
    ["priority", p.priority, 0],
    ["memory", p.memory, 1],
  ] as const)
    if (!Number.isInteger(value) || value < minimum)
      throw new Error(`${key} must be an integer of at least ${minimum}.`);
  if (
    p.io?.some(
      (x) =>
        !Number.isInteger(x.at) ||
        x.at < 1 ||
        x.at >= p.burst ||
        !Number.isInteger(x.duration) ||
        x.duration < 1,
    )
  )
    throw new Error(
      "I/O must start within the CPU burst and have positive duration.",
    );
}
export function makePCB(p: ProcessSpec): PCB {
  return {
    ...p,
    io: p.io?.map((x) => ({ ...x })) ?? [],
    state: "NEW",
    remaining: p.burst,
    executed: 0,
    programCounter: 0,
    registers: { ax: 0, bx: 0, cx: 0, sp: 4096 },
    allocatedPages: [],
    resources: {},
    queueLevel: 0,
    quantumUsed: 0,
    waitingTicks: 0,
    ioService: 0,
    openFiles: [],
    heapBytes: 0,
  };
}
export function createKernel(
  specs: ProcessSpec[],
  config: KernelConfig = defaultConfig,
): KernelState {
  if (
    !Number.isInteger(config.quantum) ||
    config.quantum < 1 ||
    !Number.isInteger(config.pageSize) ||
    config.pageSize < 1 ||
    !Number.isInteger(config.ramSize) ||
    config.ramSize < 1 ||
    !Number.isInteger(config.frameCount) ||
    config.frameCount < 1 ||
    config.frameCount * config.pageSize > config.ramSize
  )
    throw new Error("Invalid clock or memory configuration.");
  const seen: ProcessSpec[] = [];
  for (const p of specs) {
    validateSpec(p, seen);
    seen.push(p);
  }
  return {
    time: 0,
    processes: specs.map(makePCB),
    running: null,
    lastCpu: null,
    events: [
      {
        id: 1,
        timestamp: 0,
        eventType: "MEMORY",
        description: "Kernel initialized",
      },
    ],
    history: [],
    contextSwitches: 0,
    interrupts: 0,
    pageFaults: 0,
    busyTicks: 0,
    nextEventId: 2,
    nextPid: Math.max(0, ...specs.map((p) => p.pid)) + 1,
    rng: config.seed >>> 0,
    config: { ...config },
    frameTable: Array(config.frameCount).fill(null),
    diskPages: [],
    nextFrame: 0,
    deadlocks: 0,
    resourceState: {
      available: [1, 1],
      allocation: specs.slice(0, 2).map(() => [0, 0]),
      request: specs.slice(0, 2).map(() => [0, 0]),
      pids: specs.slice(0, 2).map((p) => p.pid),
    },
    fileSystem: {},
  };
}
export function restoreKernel(snapshot: KernelState, specs: ProcessSpec[], config: KernelConfig): KernelState {
  const fresh = createKernel(specs, config);
  if (!snapshot || !Number.isInteger(snapshot.time) || snapshot.time < 0 ||
      !Array.isArray(snapshot.processes) || !Array.isArray(snapshot.events) ||
      !Array.isArray(snapshot.history) || !Array.isArray(snapshot.frameTable) ||
      snapshot.frameTable.length !== config.frameCount || snapshot.history.length !== snapshot.time ||
      !Number.isInteger(snapshot.nextEventId) || !Number.isInteger(snapshot.nextPid))
    throw new Error("Saved simulation snapshot is invalid.");
  const allowed = new Set(["NEW", "READY", "RUNNING", "WAITING", "SUSPENDED", "TERMINATED"]);
  const pids = new Set<number>();
  for (const p of snapshot.processes) {
    if (!Number.isInteger(p.pid) || pids.has(p.pid) || !allowed.has(p.state) ||
        !Number.isInteger(p.remaining) || p.remaining < 0 ||
        !Array.isArray(p.allocatedPages) || !Array.isArray(p.openFiles))
      throw new Error("Saved process state is invalid.");
    pids.add(p.pid);
  }
  if (snapshot.running !== null && !snapshot.processes.some((p) => p.pid === snapshot.running && p.state === "RUNNING"))
    throw new Error("Saved CPU state is inconsistent.");
  for (const frame of snapshot.frameTable) if (frame && (!pids.has(frame.pid) || !Number.isInteger(frame.page) || frame.page < 0))
    throw new Error("Saved frame table is inconsistent.");
  if (snapshot.events.some((e, i) => !Number.isInteger(e.id) || (i > 0 && e.id <= snapshot.events[i - 1].id)))
    throw new Error("Saved event log is invalid.");
  if (snapshot.resourceState) detectDeadlock(snapshot.resourceState);
  if (snapshot.fileSystem && (typeof snapshot.fileSystem !== "object" || Object.values(snapshot.fileSystem).some((value) => typeof value !== "string")))
    throw new Error("Saved file table is invalid.");
  return { ...fresh, ...snapshot, fileSystem: { ...(snapshot.fileSystem ?? {}) }, resourceState: snapshot.resourceState ?? fresh.resourceState, config: { ...config }, processes: snapshot.processes.map((p) => ({ ...p, openFiles: [...p.openFiles], allocatedPages: [...p.allocatedPages], registers: { ...p.registers }, resources: { ...p.resources } })) };
}
const log = (
  s: KernelState,
  eventType: EventType,
  description: string,
  processId?: number,
  payload?: Record<string, unknown>,
) => {
  const e: KernelEvent = {
    id: s.nextEventId++,
    timestamp: s.time,
    eventType,
    description,
    processId,
    payload,
  };
  s.events.push(e);
};
function releaseProcessMemory(s: KernelState, p: PCB) {
  const frames = s.frameTable.filter((frame) => frame?.pid === p.pid).length;
  s.frameTable = s.frameTable.map((frame) => frame?.pid === p.pid ? null : frame);
  s.diskPages = s.diskPages.filter((page) => page.pid !== p.pid);
  p.allocatedPages = [];
  if (frames) log(s, "MEMORY", `Released ${frames} frame(s) from P${p.pid}`, p.pid);
}
function releaseProcessResources(s: KernelState, pid: number) {
  let resource: ResourceState = s.resourceState;
  const row = resource.pids?.indexOf(pid) ?? -1;
  if (row < 0) return;
  const holdings = [...resource.allocation[row]];
  for (let column = 0; column < holdings.length; column++)
    if (holdings[column] > 0) resource = resourceAction(resource, "release", row, column, holdings[column]);
  if (resource !== s.resourceState) Object.assign(s, updateResources(s, resource));
}
const transition = (
  s: KernelState,
  p: PCB,
  state: PCB["state"],
  reason: string,
) => {
  p.state = state;
  if (state === "READY") p.readySince = s.time;
  log(
    s,
    state === "READY"
      ? "PROCESS_READY"
      : state === "TERMINATED"
        ? "PROCESS_TERMINATED"
        : state === "SUSPENDED"
          ? "PROCESS_SUSPENDED"
          : "IO_REQUEST",
    `P${p.pid} ${state.toLowerCase()} · ${reason}`,
    p.pid,
  );
};
function loadPage(s: KernelState, p: PCB, page: number) {
  let frame = s.frameTable.findIndex((x) => x === null);
  if (frame < 0) {
    frame = s.nextFrame % s.frameTable.length;
    s.nextFrame = (frame + 1) % s.frameTable.length;
    const old = s.frameTable[frame]!;
    const owner = s.processes.find((x) => x.pid === old.pid);
    if (owner)
      owner.allocatedPages = owner.allocatedPages.filter((x) => x !== old.page);
    s.diskPages.push({ pid: old.pid, page: old.page });
    log(s, "MEMORY", `P${old.pid} page ${old.page} swapped to disk`, old.pid);
  }
  s.frameTable[frame] = { pid: p.pid, page, loaded: s.time, lastUsed: s.time };
  p.allocatedPages.push(page);
  s.diskPages = s.diskPages.filter(
    (x) => !(x.pid === p.pid && x.page === page),
  );
  log(
    s,
    "PAGE_LOADED",
    `P${p.pid} page ${page} loaded into frame ${frame}`,
    p.pid,
    { frame, page },
  );
}
function chaos(s: KernelState) {
  if (!s.config.chaos) return;
  s.rng = (Math.imul(1664525, s.rng) + 1013904223) >>> 0;
  const x = s.rng / 4294967296;
  if (
    x < 0.055 &&
    s.processes.filter((p) => p.state !== "TERMINATED").length < 30
  ) {
    const pid = s.nextPid++;
    const p = makePCB({
      pid,
      name: `chaos-${pid}`,
      arrival: s.time,
      burst: 2 + (s.rng % 9),
      priority: s.rng % 8,
      memory: 8 + (s.rng % 5) * 8,
    });
    s.processes.push(p);
    log(s, "PROCESS_CREATED", `Chaos created P${pid}`, pid);
  } else if (x > 0.94) {
    s.interrupts++;
    log(s, "INTERRUPT", "Network interrupt · deterministic chaos event");
  }
}
export function stepKernel(previous: KernelState): KernelState {
  const s: KernelState = {
    ...previous,
    processes: previous.processes.map((p) => ({
      ...p,
      registers: { ...p.registers },
      allocatedPages: [...p.allocatedPages],
      resources: { ...p.resources },
      openFiles: [...p.openFiles],
    })),
    events: [...previous.events],
    history: [...previous.history],
    frameTable: previous.frameTable.map((x) => (x ? { ...x } : null)),
    diskPages: [...previous.diskPages],
    fileSystem: { ...previous.fileSystem },
  };
  const start = s.events.length;
  let executedPid: number | null = null;
  chaos(s);
  const granted = fulfillAvailableRequests(s.resourceState);
  if (JSON.stringify(granted) !== JSON.stringify(s.resourceState))
    Object.assign(s, updateResources(s, granted));
  for (const p of s.processes) {
    if (p.state === "NEW" && p.arrival <= s.time) {
      if (p.resourceWait) {
        p.state = "WAITING";
        log(s, "RESOURCE_REQUEST", `P${p.pid} blocked waiting for a resource`, p.pid);
      } else transition(s, p, "READY", "arrival");
    }
    if (
      p.state === "WAITING" &&
      p.waitingForChild &&
      s.processes.filter((child) => child.parent === p.pid).every((child) => child.state === "TERMINATED")
    ) {
      p.waitingForChild = false;
      transition(s, p, "READY", "child exited");
    }
    if (
      p.state === "WAITING" &&
      p.blockedUntil !== undefined &&
      p.blockedUntil <= s.time
    ) {
      if (p.pendingPage !== undefined) {
        loadPage(s, p, p.pendingPage);
        p.pendingPage = undefined;
      }
      if (p.pendingFile) {
        const operation = p.pendingFile;
        if (operation.action === "write") {
          s.fileSystem[operation.name] = (s.fileSystem[operation.name] ?? "") + (operation.data ?? "");
          p.registers.ax = (operation.data ?? "").length;
          log(s, "SYSTEM_CALL", `P${p.pid} wrote ${p.registers.ax} characters to ${operation.name}`, p.pid);
        } else {
          p.lastRead = s.fileSystem[operation.name] ?? "";
          p.registers.ax = p.lastRead.length;
          log(s, "SYSTEM_CALL", `P${p.pid} read ${p.registers.ax} characters from ${operation.name}`, p.pid);
        }
        p.pendingFile = undefined;
      }
      p.blockedUntil = undefined;
      const device = p.blockedDevice;
      p.blockedDevice = undefined;
      s.interrupts++;
      log(
        s,
        "INTERRUPT",
        `${device ?? "Disk"} completion interrupt for P${p.pid}`,
        p.pid,
      );
      log(
        s,
        "IO_COMPLETE",
        `P${p.pid} ${device ?? "Disk"} operation complete`,
        p.pid,
      );
      transition(s, p, "READY", "I/O complete");
    }
  }
  const selected = chooseProcess(
    s.processes,
    s.running,
    s.config.scheduler,
    s.config.quantum,
  );
  if (s.running !== null && selected !== s.running) {
    const old = s.processes.find((p) => p.pid === s.running);
    if (old?.state === "RUNNING") {
      old.state = "READY";
      old.readySince = s.time;
      old.quantumUsed = 0;
      log(s, "PROCESS_READY", `P${old.pid} preempted`, old.pid);
    }
  }
  if (selected !== null) {
    const p = s.processes.find((x) => x.pid === selected)!;
    if (s.lastCpu !== null && s.lastCpu !== selected) {
      s.contextSwitches++;
      log(
        s,
        "CONTEXT_SWITCH",
        `Saved P${s.lastCpu} PCB; loaded P${selected} PCB`,
        selected,
        { from: s.lastCpu, to: selected },
      );
    }
    if (p.state === "READY") {
      p.state = "RUNNING";
      p.quantumUsed = 0;
      log(s, "PROCESS_SCHEDULED", `Scheduler dispatched P${p.pid}`, p.pid);
    }
    p.firstRun ??= s.time;
    s.running = p.pid;
    const pages = Math.max(1, Math.ceil(p.memory / s.config.pageSize));
    const page = Math.floor(p.executed / 2) % pages;
    const frame = s.frameTable.findIndex(
      (x) => x?.pid === p.pid && x.page === page,
    );
    if (frame < 0) {
      s.pageFaults++;
      s.interrupts++;
      p.state = "WAITING";
      p.blockedDevice = "DISK";
      p.blockedUntil = s.time + 2;
      p.pendingPage = page;
      p.ioService += 2;
      s.running = null;
      log(
        s,
        "PAGE_FAULT",
        `P${p.pid} page ${page} absent; disk read queued`,
        p.pid,
        { page },
      );
      log(s, "INTERRUPT", `Page-fault trap entered kernel mode`, p.pid);
    } else {
      s.frameTable[frame]!.lastUsed = s.time;
      p.remaining--;
      p.executed++;
      p.programCounter++;
      p.quantumUsed++;
      p.registers.ax = p.executed;
      p.registers.bx = page;
      p.registers.cx = frame;
      s.busyTicks++;
      executedPid = p.pid;
      log(
        s,
        "CPU_EXECUTE",
        `P${p.pid} executed instruction ${p.programCounter}`,
        p.pid,
      );
      const io = p.io?.find((x) => x.at === p.executed);
      if (p.remaining === 0) {
        p.completedAt = s.time + 1;
        p.state = "TERMINATED";
        s.running = null;
        p.openFiles = [];
        p.pendingFile = undefined;
        releaseProcessMemory(s, p);
        releaseProcessResources(s, p.pid);
        log(s, "PROCESS_TERMINATED", `P${p.pid} completed`, p.pid);
      } else if (io) {
        p.state = "WAITING";
        p.blockedUntil = s.time + 1 + io.duration;
        p.blockedDevice = io.device;
        p.ioService += io.duration;
        s.running = null;
        log(
          s,
          "IO_REQUEST",
          `P${p.pid} requested ${io.device} for ${io.duration} ticks`,
          p.pid,
        );
      } else if (
        ["RR", "MLQ", "MLFQ"].includes(s.config.scheduler) &&
        p.quantumUsed >=
          s.config.quantum *
            (s.config.scheduler === "MLFQ" ? 2 ** p.queueLevel : 1)
      ) {
        p.state = "READY";
        p.readySince = s.time + 1;
        p.quantumUsed = 0;
        if (s.config.scheduler === "MLFQ")
          p.queueLevel = Math.min(2, p.queueLevel + 1);
        s.running = null;
        log(s, "INTERRUPT", `Timer quantum expired for P${p.pid}`, p.pid);
        s.interrupts++;
      }
    }
    s.lastCpu = selected;
  } else {
    s.running = null;
    s.lastCpu = null;
  }
  for (const p of s.processes) if (p.state === "READY") p.waitingTicks++;
  s.history.push({
    time: s.time,
    pid: executedPid,
    ready: s.processes.filter((p) => p.state === "READY").length,
    waiting: s.processes.filter((p) => p.state === "WAITING").length,
    memory: (s.frameTable.filter(Boolean).length / s.frameTable.length) * 100,
    faults: s.pageFaults,
    switches: s.contextSwitches,
    eventTypes: s.events.slice(start).map((e) => e.eventType),
  });
  s.time++;
  return s;
}
export function addProcess(s: KernelState, spec: ProcessSpec): KernelState {
  validateSpec(spec, s.processes);
  const next = {
    ...s,
    processes: [...s.processes, makePCB(spec)],
    events: [...s.events],
    nextPid: Math.max(s.nextPid, spec.pid + 1),
  };
  log(next, "PROCESS_CREATED", `P${spec.pid} ${spec.name} created`, spec.pid);
  return next;
}
export function updateResources(s: KernelState, resource: ResourceState): KernelState {
  const dead = detectDeadlock(resource);
  const pids = resource.pids ?? s.processes.slice(0, resource.allocation.length).map((p) => p.pid);
  if (resource.allocation.length > s.processes.length || pids.length !== resource.allocation.length ||
      new Set(pids).size !== pids.length || pids.some((pid) => !s.processes.some((p) => p.pid === pid)))
    throw new Error("Resource rows must map to distinct existing processes.");
  const next: KernelState = {
    ...s,
    processes: s.processes.map((p) => ({ ...p, resources: { ...p.resources } })),
    events: [...s.events],
    resourceState: { available: [...resource.available], allocation: resource.allocation.map((row) => [...row]), request: resource.request.map((row) => [...row]), pids: [...pids] },
    deadlocks: dead.length ? 1 : 0,
  };
  if (JSON.stringify(resource.allocation) !== JSON.stringify(s.resourceState.allocation) ||
      JSON.stringify(resource.available) !== JSON.stringify(s.resourceState.available))
    log(next, "RESOURCE_ALLOCATED", "Resource allocation table updated", undefined, { available: [...resource.available] });
  for (let i = 0; i < pids.length; i++) {
    const p = next.processes.find((candidate) => candidate.pid === pids[i])!;
    p.resources = Object.fromEntries(resource.allocation[i].flatMap((count, index) => count > 0 ? [[`R${index}`, count] as const] : []));
    const pending = resource.request[i].some((count) => count > 0);
    if (pending && !p.resourceWait) {
      p.resourceWait = true;
      if (p.state === "READY" || p.state === "RUNNING") {
        p.state = "WAITING";
        if (next.running === p.pid) next.running = null;
      }
      log(next, "RESOURCE_REQUEST", `P${p.pid} waiting for resources`, p.pid);
    } else if (!pending && p.resourceWait) {
      p.resourceWait = false;
      if (p.state === "WAITING" && p.blockedUntil === undefined && !p.waitingForChild) {
        p.state = "READY";
        p.readySince = next.time;
      }
      log(next, "RESOURCE_ALLOCATED", `P${p.pid} acquired requested resources`, p.pid);
    }
  }
  if (dead.length && !s.deadlocks)
    log(next, "DEADLOCK", `Deadlock detected among ${dead.map((i) => `P${pids[i]}`).join(", ")}`);
  else if (!dead.length && s.deadlocks)
    log(next, "DEADLOCK", "Deadlock resolved");
  return next;
}
export function changeProcess(
  s: KernelState,
  pid: number,
  action: "pause" | "resume" | "terminate" | "delete" | "priority",
  value?: number,
): KernelState {
  const next = {
    ...s,
    processes: s.processes.map((p) => ({ ...p })),
    events: [...s.events],
  };
  const p = next.processes.find((x) => x.pid === pid);
  if (!p) throw new Error(`P${pid} does not exist.`);
  if (action === "delete") {
    releaseProcessMemory(next, p);
    releaseProcessResources(next, pid);
    const row = next.resourceState.pids.indexOf(pid);
    if (row >= 0) {
      next.resourceState = {
        ...next.resourceState,
        pids: next.resourceState.pids.filter((_, i) => i !== row),
        allocation: next.resourceState.allocation.filter((_, i) => i !== row),
        request: next.resourceState.request.filter((_, i) => i !== row),
      };
    }
    next.processes = next.processes.filter((x) => x.pid !== pid);
    if (next.running === pid) next.running = null;
    log(next, "PROCESS_TERMINATED", `P${pid} deleted`, pid);
    return next;
  }
  if (action === "priority") {
    if (!Number.isInteger(value) || value! < 0)
      throw new Error("Priority must be a nonnegative integer.");
    p.priority = value!;
    log(next, "PROCESS_READY", `P${pid} priority changed to ${value}`, pid);
    return next;
  }
  if (action === "terminate") {
    p.state = "TERMINATED";
    p.completedAt = next.time;
    p.openFiles = [];
    p.pendingFile = undefined;
    releaseProcessMemory(next, p);
    releaseProcessResources(next, pid);
    if (next.running === pid) next.running = null;
    log(next, "PROCESS_TERMINATED", `P${pid} terminated by user`, pid);
  }
  if (
    action === "pause" &&
    p.state !== "TERMINATED" &&
    p.state !== "SUSPENDED"
  ) {
    p.pausedFrom = p.state;
    p.state = "SUSPENDED";
    if (next.running === pid) next.running = null;
    log(next, "PROCESS_SUSPENDED", `P${pid} suspended`, pid);
  }
  if (action === "resume" && p.state === "SUSPENDED") {
    p.state = p.pausedFrom === "WAITING" && (p.blockedUntil !== undefined || p.waitingForChild)
      ? "WAITING"
      : p.arrival > next.time ? "NEW" : "READY";
    if (p.state === "READY") p.readySince = next.time;
    p.pausedFrom = undefined;
    log(next, "PROCESS_RESUMED", `P${pid} resumed`, pid);
  }
  return next;
}
export function triggerInterrupt(
  s: KernelState,
  device: Device | "TIMER" | "PAGE_FAULT" | "SYSTEM_CALL",
) {
  const next = { ...s, events: [...s.events], interrupts: s.interrupts + 1 };
  log(
    next,
    "INTERRUPT",
    `${device} interrupt · CPU state saved, handler executed, state restored`,
    s.running ?? undefined,
  );
  return next;
}
export type SystemCall = "fork" | "exec" | "wait" | "exit" | "read" | "write" | "open" | "close" | "malloc";
export function systemCall(s: KernelState, call: SystemCall, pid: number, argument = ""): { state: KernelState; result: string } {
  const existing = s.processes.find((p) => p.pid === pid);
  if (!existing || existing.state === "TERMINATED") throw new Error(`P${pid} is not an active process.`);
  let next: KernelState = {
    ...s,
    processes: s.processes.map((p) => ({ ...p, openFiles: [...p.openFiles], allocatedPages: [...p.allocatedPages] })),
    frameTable: [...s.frameTable],
    events: [...s.events],
  };
  const p = next.processes.find((x) => x.pid === pid)!;
  log(next, "SYSTEM_CALL", `P${pid} entered kernel mode via ${call}()`, pid);
  let result: string;
  switch (call) {
    case "fork": {
      const childPid = next.nextPid;
      next = addProcess(next, { pid: childPid, name: `${p.name}-child`, arrival: next.time, burst: Math.max(1, Math.ceil(p.remaining / 2)), priority: p.priority, memory: p.memory, parent: pid });
      next.processes.find((child) => child.pid === childPid)!.openFiles = [...p.openFiles];
      result = `Created child P${childPid}`;
      break;
    }
    case "exec": {
      const parts = argument.trim().split(/\s+/);
      const name = parts[0];
      const burst = Number(parts[1]);
      if (!name || !Number.isInteger(burst) || burst < 1) throw new Error("exec requires a program name and positive CPU burst.");
      releaseProcessMemory(next, p);
      p.name = name;
      p.burst = burst;
      p.remaining = burst;
      p.executed = 0;
      p.programCounter = 0;
      p.firstRun = undefined;
      p.completedAt = undefined;
      p.io = [];
      p.quantumUsed = 0;
      p.pendingPage = undefined;
      p.blockedUntil = undefined;
      p.blockedDevice = undefined;
      p.waitingForChild = false;
      p.pendingFile = undefined;
      p.state = "READY";
      p.readySince = next.time;
      if (next.running === pid) next.running = null;
      result = `P${pid} now runs ${name} (${burst} CPU ticks)`;
      break;
    }
    case "wait": {
      const activeChildren = next.processes.filter((child) => child.parent === pid && child.state !== "TERMINATED");
      if (activeChildren.length) {
        p.state = "WAITING";
        p.waitingForChild = true;
        p.blockedUntil = undefined;
        p.blockedDevice = undefined;
        if (next.running === pid) next.running = null;
        result = `P${pid} waits for ${activeChildren.map((child) => `P${child.pid}`).join(", ")}`;
      } else result = `P${pid} has no active children`;
      break;
    }
    case "exit":
      next = changeProcess(next, pid, "terminate");
      result = `P${pid} exited`;
      break;
    case "read":
    case "write": {
      const [specifiedName, ...content] = argument.trim().split(/\s+/);
      const name = specifiedName || p.openFiles[0];
      if (!name || !p.openFiles.includes(name)) throw new Error(`Open a file before ${call}().`);
      if (call === "write" && !content.length) throw new Error("write requires file name and text.");
      next = requestIO(next, pid, "DISK", 2);
      next.processes.find((process) => process.pid === pid)!.pendingFile = { action: call, name, data: content.join(" ") };
      result = `P${pid} ${call} queued for ${name}; completes after disk I/O`;
      break;
    }
    case "open": {
      const path = argument.trim();
      if (!path) throw new Error("open requires a file name.");
      if (p.openFiles.includes(path)) throw new Error(`${path} is already open for P${pid}.`);
      next.fileSystem = { ...next.fileSystem, [path]: next.fileSystem[path] ?? "" };
      p.openFiles.push(path);
      result = `P${pid} opened ${path} (fd ${p.openFiles.length + 2})`;
      break;
    }
    case "close": {
      const path = argument.trim();
      if (!p.openFiles.includes(path)) throw new Error(`${path || "File"} is not open for P${pid}.`);
      p.openFiles = p.openFiles.filter((file) => file !== path);
      result = `P${pid} closed ${path}`;
      break;
    }
    case "malloc": {
      const bytes = Number(argument);
      if (!Number.isInteger(bytes) || bytes < 1) throw new Error("malloc requires a positive integer size in KB.");
      p.memory += bytes;
      p.heapBytes += bytes;
      log(next, "MEMORY", `P${pid} extended virtual memory by ${bytes} KB`, pid);
      result = `P${pid} reserved ${bytes} KB of virtual memory`;
      break;
    }
  }
  log(next, "SYSTEM_CALL", `P${pid} returned to user mode: ${result}`, pid);
  return { state: next, result };
}
export function requestIO(
  s: KernelState,
  pid: number,
  device: Device,
  duration: number,
): KernelState {
  if (!Number.isInteger(duration) || duration < 1)
    throw new Error("I/O duration must be positive.");
  const next = {
    ...s,
    processes: s.processes.map((p) => ({ ...p })),
    events: [...s.events],
  };
  const p = next.processes.find((x) => x.pid === pid);
  if (
    !p ||
    p.state === "TERMINATED" ||
    p.state === "SUSPENDED" ||
    p.state === "NEW" ||
    p.state === "WAITING"
  )
    throw new Error("Process must be active to request I/O.");
  p.state = "WAITING";
  p.blockedDevice = device;
  p.blockedUntil = s.time + duration;
  p.ioService += duration;
  if (next.running === pid) next.running = null;
  log(
    next,
    "IO_REQUEST",
    `P${pid} requested ${device} I/O for ${duration} ticks`,
    pid,
  );
  return next;
}
export function metrics(s: KernelState) {
  const done = s.processes.filter((p) => p.completedAt !== undefined);
  const avg = (f: (p: PCB) => number) =>
    done.length ? done.reduce((v, p) => v + f(p), 0) / done.length : 0;
  return {
    cpu: s.time ? (s.busyTicks / s.time) * 100 : 0,
    memory: (s.frameTable.filter(Boolean).length / s.frameTable.length) * 100,
    active: s.processes.filter((p) => p.state !== "TERMINATED").length,
    ready: s.processes.filter((p) => p.state === "READY").length,
    blocked: s.processes.filter((p) => p.state === "WAITING").length,
    waiting: avg((p) =>
      Math.max(0, p.completedAt! - p.arrival - p.burst - p.ioService),
    ),
    turnaround: avg((p) => p.completedAt! - p.arrival),
    response: avg((p) => (p.firstRun ?? p.arrival) - p.arrival),
    throughput: s.time ? done.length / s.time : 0,
  };
}
