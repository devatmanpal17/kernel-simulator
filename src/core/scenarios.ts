import type { ProcessSpec } from "./types";
export const demoProcesses: ProcessSpec[] = [
  {
    pid: 1,
    name: "browser",
    arrival: 0,
    burst: 9,
    priority: 3,
    memory: 24,
    io: [{ at: 4, duration: 3, device: "DISK" }],
  },
  {
    pid: 2,
    name: "compiler",
    arrival: 1,
    burst: 7,
    priority: 1,
    memory: 16,
    io: [{ at: 3, duration: 2, device: "DISK" }],
  },
  { pid: 3, name: "editor", arrival: 2, burst: 5, priority: 5, memory: 16 },
  {
    pid: 4,
    name: "renderer",
    arrival: 3,
    burst: 8,
    priority: 2,
    memory: 32,
    io: [{ at: 5, duration: 2, device: "NETWORK" }],
  },
];
export const scenarios: {
  name: string;
  description: string;
  processes: ProcessSpec[];
  scheduler?: "RR" | "PRIORITY" | "FCFS";
  quantum?: number;
  frameCount?: number;
}[] = [
  {
    name: "CPU scheduling comparison",
    description: "Staggered CPU bursts expose arrival and preemption effects.",
    processes: demoProcesses,
  },
  {
    name: "Round Robin quantum experiment",
    description:
      "Short quantum increases switches and improves initial response.",
    processes: demoProcesses,
    scheduler: "RR",
    quantum: 1,
  },
  {
    name: "Priority starvation",
    description:
      "Low priority work waits behind a burst of high priority arrivals.",
    processes: [
      {
        pid: 1,
        name: "background",
        arrival: 0,
        burst: 15,
        priority: 9,
        memory: 8,
      },
      ...Array.from({ length: 8 }, (_, i) => ({
        pid: i + 2,
        name: `urgent-${i + 1}`,
        arrival: i + 1,
        burst: 3,
        priority: 0,
        memory: 8,
      })),
    ],
    scheduler: "PRIORITY",
  },
  {
    name: "Deadlock",
    description: "Loads the two-process resource cycle in the resource lab.",
    processes: demoProcesses,
  },
  {
    name: "Banker's safe state",
    description: "Loads the textbook five-process safety example.",
    processes: demoProcesses,
  },
  {
    name: "Page replacement comparison",
    description: "Small RAM produces a visible replacement trace.",
    processes: demoProcesses,
    frameCount: 4,
  },
  {
    name: "Thrashing",
    description: "Many processes compete for very few frames.",
    processes: demoProcesses,
    frameCount: 2,
  },
  {
    name: "Producer consumer",
    description: "Opens a bounded-buffer synchronization scenario.",
    processes: demoProcesses,
  },
  {
    name: "Dining philosophers deadlock",
    description: "Shows circular wait with five philosophers.",
    processes: demoProcesses,
  },
  {
    name: "Heavy system load",
    description: "Twenty deterministic processes stress the scheduler.",
    processes: Array.from({ length: 20 }, (_, i) => ({
      pid: i + 1,
      name: `worker-${i + 1}`,
      arrival: Math.floor(i / 3),
      burst: 3 + (i % 8),
      priority: i % 9,
      memory: 8 + (i % 4) * 8,
    })),
  },
];
