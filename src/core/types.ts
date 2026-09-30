export type ProcessState =
  "NEW" | "READY" | "RUNNING" | "WAITING" | "SUSPENDED" | "TERMINATED";
export type Scheduler =
  | "FCFS"
  | "SJF"
  | "SRTF"
  | "PRIORITY"
  | "PRIORITY_PREEMPTIVE"
  | "RR"
  | "MLQ"
  | "MLFQ";
export type Device = "DISK" | "KEYBOARD" | "PRINTER" | "NETWORK";
export interface IORequest {
  at: number;
  duration: number;
  device: Device;
}
export interface ProcessSpec {
  pid: number;
  name: string;
  arrival: number;
  burst: number;
  priority: number;
  memory: number;
  io?: IORequest[];
  parent?: number;
}
export interface PCB extends ProcessSpec {
  state: ProcessState;
  remaining: number;
  executed: number;
  programCounter: number;
  registers: { ax: number; bx: number; cx: number; sp: number };
  firstRun?: number;
  completedAt?: number;
  blockedUntil?: number;
  blockedDevice?: Device;
  pendingPage?: number;
  pausedFrom?: ProcessState;
  allocatedPages: number[];
  resources: Record<string, number>;
  queueLevel: number;
  quantumUsed: number;
  readySince?: number;
  waitingTicks: number;
  ioService: number;
  openFiles: string[];
  heapBytes: number;
  pendingFile?: { action: "read" | "write"; name: string; data?: string };
  lastRead?: string;
  waitingForChild?: boolean;
  resourceWait?: boolean;
}
export type EventType =
  | "PROCESS_CREATED"
  | "PROCESS_READY"
  | "PROCESS_SCHEDULED"
  | "CPU_EXECUTE"
  | "IO_REQUEST"
  | "IO_COMPLETE"
  | "PAGE_FAULT"
  | "PAGE_LOADED"
  | "RESOURCE_REQUEST"
  | "RESOURCE_ALLOCATED"
  | "INTERRUPT"
  | "CONTEXT_SWITCH"
  | "PROCESS_TERMINATED"
  | "PROCESS_SUSPENDED"
  | "PROCESS_RESUMED"
  | "SYSTEM_CALL"
  | "MEMORY"
  | "DEADLOCK";
export interface KernelEvent {
  id: number;
  timestamp: number;
  eventType: EventType;
  processId?: number;
  description: string;
  payload?: Record<string, unknown>;
}
export interface Tick {
  time: number;
  pid: number | null;
  ready: number;
  waiting: number;
  memory: number;
  faults: number;
  switches: number;
  eventTypes: EventType[];
}
export interface KernelConfig {
  scheduler: Scheduler;
  quantum: number;
  ramSize: number;
  pageSize: number;
  frameCount: number;
  seed: number;
  chaos: boolean;
}
export interface KernelState {
  time: number;
  processes: PCB[];
  running: number | null;
  lastCpu: number | null;
  events: KernelEvent[];
  history: Tick[];
  contextSwitches: number;
  interrupts: number;
  pageFaults: number;
  busyTicks: number;
  nextEventId: number;
  nextPid: number;
  rng: number;
  config: KernelConfig;
  frameTable: (null | {
    pid: number;
    page: number;
    loaded: number;
    lastUsed: number;
  })[];
  diskPages: { pid: number; page: number }[];
  nextFrame: number;
  deadlocks: number;
  resourceState: { available: number[]; allocation: number[][]; request: number[][]; pids: number[] };
  fileSystem: Record<string, string>;
}
