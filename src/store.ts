import { create } from "zustand";
import {
  addProcess,
  changeProcess,
  createKernel,
  defaultConfig,
  requestIO,
  restoreKernel,
  stepKernel,
  systemCall,
  triggerInterrupt,
  updateResources,
} from "./core/kernel";
import { demoProcesses, scenarios } from "./core/scenarios";
import { executeCommand } from "./core/terminal";
import type { Device, KernelState, ProcessSpec, Scheduler } from "./core/types";
import type { SystemCall } from "./core/kernel";
import type { ResourceState } from "./core/resources";
const specifications = (kernel: KernelState, previous: ProcessSpec[]): ProcessSpec[] => kernel.processes
  .filter((p) => previous.some((spec) => spec.pid === p.pid) || p.parent !== undefined)
  .map((p) => ({ pid: p.pid, name: p.name, arrival: p.arrival, burst: p.burst, priority: p.priority, memory: p.memory, io: p.io, parent: p.parent }));
interface Store {
  kernel: KernelState;
  running: boolean;
  speed: number;
  selectedPid: number | null;
  page: string;
  presentation: boolean;
  error: string | null;
  specs: ProcessSpec[];
  scenarioIndex: number | null;
  setResources: (resource: ResourceState) => void;
  step: () => void;
  start: () => void;
  pause: () => void;
  reset: () => void;
  setSpeed: (v: number) => void;
  setScheduler: (v: Scheduler) => void;
  setQuantum: (v: number) => void;
  setPage: (v: string) => void;
  select: (v: number | null) => void;
  add: (v: ProcessSpec) => void;
  change: (
    pid: number,
    action: "pause" | "resume" | "terminate" | "delete" | "priority",
    value?: number,
  ) => void;
  interrupt: (v: Device | "TIMER" | "PAGE_FAULT" | "SYSTEM_CALL") => void;
  io: (pid: number, device: Device, duration: number) => void;
  syscall: (v: SystemCall, pid: number, argument?: string) => string;
  command: (input: string) => string;
  scenario: (i: number) => void;
  setChaos: (v: boolean) => void;
  setSeed: (v: number) => void;
  togglePresentation: () => void;
  load: (data: {
    specs: ProcessSpec[];
    config: KernelState["config"];
    speed: number;
    state?: KernelState;
  }) => void;
  clearError: () => void;
}
export const useLab = create<Store>((set, get) => ({
  kernel: createKernel(demoProcesses),
  running: false,
  speed: 1,
  selectedPid: null,
  page: "home",
  presentation: false,
  error: null,
  specs: demoProcesses,
  scenarioIndex: null,
  setResources: (resource) => {
    try { set((x) => ({ kernel: updateResources(x.kernel, resource), error: null })); }
    catch (e) { set({ error: (e as Error).message }); }
  },
  step: () =>
    set((x) => {
      const kernel = stepKernel(x.kernel);
      return {
        kernel,
        running:
          x.running &&
          (kernel.config.chaos ||
            kernel.processes.some((p) => p.state !== "TERMINATED")),
      };
    }),
  start: () => set({ running: true }),
  pause: () => set({ running: false }),
  reset: () =>
    set((x) => ({
      running: false,
      kernel: createKernel(x.specs, x.kernel.config),
      error: null,
    })),
  setSpeed: (v) => set({ speed: v }),
  setScheduler: (v) =>
    set((x) => ({
      kernel: { ...x.kernel, config: { ...x.kernel.config, scheduler: v } },
    })),
  setQuantum: (v) => {
    if (!Number.isInteger(v) || v < 1) {
      set({ error: "Quantum must be a positive integer." });
      return;
    }
    set((x) => ({
      kernel: { ...x.kernel, config: { ...x.kernel.config, quantum: v } },
    }));
  },
  setPage: (v) => set({ page: v }),
  select: (v) => set({ selectedPid: v }),
  add: (v) => {
    try {
      set((x) => ({
        kernel: addProcess(x.kernel, v),
        specs: [...x.specs, v],
        error: null,
      }));
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
  change: (pid, action, value) => {
    try {
      set((x) => ({
        kernel: changeProcess(x.kernel, pid, action, value),
        specs:
          action === "delete"
            ? x.specs.filter((p) => p.pid !== pid)
            : action === "priority"
              ? x.specs.map((p) =>
                  p.pid === pid ? { ...p, priority: value! } : p,
                )
              : x.specs,
        error: null,
      }));
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
  interrupt: (v) => set((x) => ({ kernel: triggerInterrupt(x.kernel, v) })),
  io: (pid, device, duration) => {
    try {
      set((x) => ({
        kernel: requestIO(x.kernel, pid, device, duration),
        error: null,
      }));
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
  syscall: (v, pid, argument = "") => {
    try {
      const { state, result } = systemCall(get().kernel, v, pid, argument);
      set({ kernel: state, specs: specifications(state, get().specs), error: null });
      return result;
    } catch (e) {
      const message = (e as Error).message;
      set({ error: message });
      return message;
    }
  },
  command: (input) => {
    try {
      const { state, output } = executeCommand(get().kernel, input);
      set({ kernel: state, specs: specifications(state, get().specs), error: null });
      return output;
    } catch (e) {
      const message = (e as Error).message;
      set({ error: message });
      return message;
    }
  },
  scenario: (i) => {
    const sc = scenarios[i];
    if (!sc) return;
    const config = {
      ...defaultConfig,
      scheduler: sc.scheduler ?? defaultConfig.scheduler,
      quantum: sc.quantum ?? defaultConfig.quantum,
      frameCount: sc.frameCount ?? defaultConfig.frameCount,
    };
    const base = createKernel(sc.processes, config);
    const kernel = i === 3 && sc.processes.length >= 2
      ? updateResources(base, { available: [0, 0], allocation: [[1, 0], [0, 1]], request: [[0, 1], [1, 0]], pids: sc.processes.slice(0, 2).map((p) => p.pid) })
      : base;
    set({
      running: false,
      specs: sc.processes,
      kernel,
      page:
        i === 3 || i === 4
          ? "resources"
          : i === 5
            ? "memory"
            : i === 7 || i === 8
              ? "sync"
              : "dashboard",
      scenarioIndex: i,
      error: null,
    });
  },
  setChaos: (v) =>
    set((x) => ({
      kernel: { ...x.kernel, config: { ...x.kernel.config, chaos: v } },
    })),
  setSeed: (v) =>
    set((x) => ({
      kernel: {
        ...x.kernel,
        rng: v >>> 0,
        config: { ...x.kernel.config, seed: v >>> 0 },
      },
    })),
  togglePresentation: () => {
    const next = !get().presentation;
    if (next) get().scenario(0);
    set({ presentation: next, page: "dashboard" });
  },
  load: (data) => {
    try {
      set({
        running: false,
        specs: data.specs,
        kernel: data.state
          ? restoreKernel(data.state, data.specs, data.config)
          : createKernel(data.specs, data.config),
        speed: [0.5, 1, 2, 5, 10].includes(data.speed) ? data.speed : 1,
        error: null,
      });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
  clearError: () => set({ error: null }),
}));
