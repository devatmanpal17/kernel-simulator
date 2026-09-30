import type { PCB, Scheduler } from "./types";
const tie = (a: PCB, b: PCB) => a.arrival - b.arrival || a.pid - b.pid;
export function chooseProcess(
  processes: PCB[],
  running: number | null,
  algorithm: Scheduler,
  quantum: number,
): number | null {
  if (!Number.isInteger(quantum) || quantum <= 0)
    throw new Error("Quantum must be a positive integer.");
  const current = processes.find(
    (p) => p.pid === running && p.state === "RUNNING",
  );
  const ready = processes.filter((p) => p.state === "READY");
  if (!ready.length) return current?.pid ?? null;
  const ordered = (compare: (a: PCB, b: PCB) => number) =>
    [...ready].sort((a, b) => compare(a, b) || tie(a, b))[0].pid;
  if (algorithm === "FCFS" || algorithm === "SJF" || algorithm === "PRIORITY") {
    if (current) return current.pid;
    return algorithm === "FCFS"
      ? ordered(tie)
      : algorithm === "SJF"
        ? ordered((a, b) => a.remaining - b.remaining)
        : ordered((a, b) => a.priority - b.priority);
  }
  if (algorithm === "RR")
    return current && current.quantumUsed < quantum
      ? current.pid
      : [...ready].sort(
          (a, b) => (a.readySince ?? 0) - (b.readySince ?? 0) || a.pid - b.pid,
        )[0].pid;
  if (algorithm === "MLQ") {
    const tier = (p: PCB) => (p.priority <= 2 ? 0 : p.priority <= 5 ? 1 : 2);
    if (
      current &&
      tier(current) <= Math.min(...ready.map(tier)) &&
      current.quantumUsed < quantum
    )
      return current.pid;
    return ordered(
      (a, b) => tier(a) - tier(b) || (a.readySince ?? 0) - (b.readySince ?? 0),
    );
  }
  if (algorithm === "MLFQ") {
    const best = Math.min(...ready.map((p) => p.queueLevel));
    if (
      current &&
      current.queueLevel <= best &&
      current.quantumUsed < quantum * 2 ** current.queueLevel
    )
      return current.pid;
    return ordered(
      (a, b) =>
        a.queueLevel - b.queueLevel ||
        (a.readySince ?? 0) - (b.readySince ?? 0),
    );
  }
  const contenders = current ? [...ready, current] : ready;
  return [...contenders].sort(
    (a, b) =>
      (algorithm === "SRTF"
        ? a.remaining - b.remaining
        : a.priority - b.priority) || tie(a, b),
  )[0].pid;
}
export interface ScheduleResult {
  name: Scheduler;
  completion: Record<number, number>;
  waiting: Record<number, number>;
  turnaround: Record<number, number>;
  response: Record<number, number>;
  averageWaiting: number;
  averageTurnaround: number;
  averageResponse: number;
  contextSwitches: number;
  utilization: number;
  throughput: number;
  timeline: (number | null)[];
}
export function compareSchedule(
  input: PCB[],
  name: Scheduler,
  quantum: number,
): ScheduleResult {
  const ps: PCB[] = input.map((p) => ({
    ...p,
    io: [],
    state: "NEW",
    remaining: p.burst,
    executed: 0,
    quantumUsed: 0,
    queueLevel: 0,
    readySince: undefined,
    firstRun: undefined,
    completedAt: undefined,
  }));
  const timeline: (number | null)[] = [];
  let running: number | null = null,
    prev: number | null = null,
    switches = 0,
    busy = 0;
  const limit =
    Math.max(1000, ...ps.map((p) => p.arrival + p.burst + 1)) *
      Math.max(1, ps.length) +
    100;
  for (let t = 0; t < limit && ps.some((p) => p.state !== "TERMINATED"); t++) {
    for (const p of ps)
      if (p.state === "NEW" && p.arrival <= t) {
        p.state = "READY";
        p.readySince = t;
      }
    const selected = chooseProcess(ps, running, name, quantum);
    if (running !== null && selected !== running) {
      const old = ps.find((p) => p.pid === running)!;
      if (old.state === "RUNNING") {
        old.state = "READY";
        old.readySince = t;
        old.quantumUsed = 0;
      }
    }
    if (selected !== null) {
      const p = ps.find((p) => p.pid === selected)!;
      if (prev !== null && prev !== selected) switches++;
      if (p.state === "READY") {
        p.state = "RUNNING";
        p.quantumUsed = 0;
      }
      p.firstRun ??= t;
      p.remaining--;
      p.executed++;
      p.quantumUsed++;
      busy++;
      if (p.remaining === 0) {
        p.state = "TERMINATED";
        p.completedAt = t + 1;
        running = null;
      } else if (
        (name === "RR" || name === "MLQ" || name === "MLFQ") &&
        p.quantumUsed >= quantum * (name === "MLFQ" ? 2 ** p.queueLevel : 1)
      ) {
        p.state = "READY";
        p.readySince = t + 1;
        p.quantumUsed = 0;
        if (name === "MLFQ") p.queueLevel = Math.min(2, p.queueLevel + 1);
        running = null;
      } else running = selected;
    } else running = null;
    timeline.push(selected);
    prev = selected;
  }
  const completion = Object.fromEntries(
    ps.map((p) => [p.pid, p.completedAt ?? 0]),
  );
  const turnaround = Object.fromEntries(
    ps.map((p) => [p.pid, (p.completedAt ?? 0) - p.arrival]),
  );
  const waiting = Object.fromEntries(
    ps.map((p) => [p.pid, turnaround[p.pid] - p.burst]),
  );
  const response = Object.fromEntries(
    ps.map((p) => [p.pid, (p.firstRun ?? p.arrival) - p.arrival]),
  );
  const avg = (x: Record<number, number>) =>
    ps.length ? Object.values(x).reduce((a, b) => a + b, 0) / ps.length : 0;
  return {
    name,
    completion,
    turnaround,
    waiting,
    response,
    averageWaiting: avg(waiting),
    averageTurnaround: avg(turnaround),
    averageResponse: avg(response),
    contextSwitches: switches,
    utilization: timeline.length ? (busy / timeline.length) * 100 : 0,
    throughput: timeline.length ? ps.length / timeline.length : 0,
    timeline,
  };
}
export const SCHEDULERS: Scheduler[] = [
  "FCFS",
  "SJF",
  "SRTF",
  "PRIORITY",
  "PRIORITY_PREEMPTIVE",
  "RR",
  "MLQ",
  "MLFQ",
];
