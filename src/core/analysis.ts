import { metrics } from "./kernel";
import type { KernelState } from "./types";

export function analyze(s: KernelState) {
  const m = metrics(s);
  const ticks = Math.max(1, s.time);
  const faultRate = s.pageFaults / ticks;
  const switchRate = s.contextSwitches / ticks;
  const alerts: { title: string; detail: string; recommendation: string }[] = [];
  if (faultRate > 0.35 && s.time > 6)
    alerts.push({ title: "High page-fault frequency", detail: `${(faultRate * 100).toFixed(0)} faults per 100 ticks.`, recommendation: "Increase frame count or reduce the working set." });
  if (faultRate > 0.35 && m.cpu < 55 && s.time > 8)
    alerts.push({ title: "Possible thrashing", detail: "Page faults are high while CPU utilization is low.", recommendation: "Allocate more frames or reduce concurrent processes." });
  if (switchRate > 0.45 && s.time > 8)
    alerts.push({ title: "Excessive context switching", detail: `${s.contextSwitches} switches in ${s.time} ticks.`, recommendation: "Increase the Round Robin quantum." });
  const starving = s.processes.filter((p) => p.state === "READY" && p.waitingTicks > 20);
  if (starving.length)
    alerts.push({ title: "Starvation risk", detail: `${starving.map((p) => `P${p.pid}`).join(", ")} waited over 20 ticks.`, recommendation: "Consider aging or a fair-share scheduler." });
  if (s.deadlocks)
    alerts.push({ title: "Deadlock detected", detail: `${s.deadlocks} unresolved resource cycle(s).`, recommendation: "Release resources or avoid circular wait." });
  if (m.cpu < 25 && s.time > 10 && m.active > 0)
    alerts.push({ title: "Low CPU utilization", detail: "CPU spends most ticks idle or waiting for pages and I/O.", recommendation: "Increase memory capacity or review device latency." });

  const completed = s.processes.filter((p) => p.completedAt !== undefined);
  const averageBurst = completed.length ? completed.reduce((sum, p) => sum + p.burst, 0) / completed.length : 0;
  const waitingShare = completed.length ? m.waiting / Math.max(1, m.waiting + averageBurst) : 0;
  const cpu = Math.round(m.cpu);
  const memory = Math.round(100 * (1 - s.pageFaults / Math.max(1, s.pageFaults + s.busyTicks)));
  const scheduling = Math.round(100 * (1 - waitingShare) * (1 - Math.min(1, switchRate) * 0.25));
  const resource = s.deadlocks ? 0 : 100;
  const overall = Math.round(cpu * 0.3 + memory * 0.25 + scheduling * 0.3 + resource * 0.15);
  return {
    alerts,
    health: { cpu, memory, scheduling, resource, overall, label: s.time === 0 ? "NO DATA" : overall >= 75 ? "HEALTHY" : overall >= 50 ? "DEGRADED" : "CRITICAL" },
    formula: "Overall = 30% CPU utilization + 25% successful memory accesses + 30% scheduling score + 15% resource safety. Scheduling = (1 − waiting share) × (1 − 0.25 × switches per tick). Waiting share = average wait / (average wait + average burst). Resource safety is zero during a detected deadlock, otherwise 100.",
  };
}
