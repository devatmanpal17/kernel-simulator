import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BrainCircuit,
  ChartNoAxesCombined,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cpu,
  Database,
  GitBranch,
  HardDrive,
  Layers3,
  MemoryStick,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  SkipForward,

  Workflow,
  X,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  BarChart,
} from "recharts";
import { useLab } from "../store";
import { InterruptPanel, TerminalConsole } from "./KernelControls";
import SynchronizationLab from "./SynchronizationLab";
import { analyze } from "../core/analysis";
import { makePCB, metrics } from "../core/kernel";
import { compareSchedule, SCHEDULERS } from "../core/scheduler";
import { scenarios } from "../core/scenarios";
import {
  allocate,
  fragmentation,
  release,
  replacePages,
  translate,
  type Block,
  type Fit,
  type Replacement,
} from "../core/memory";
import ResourceLab from "./ResourceLab";
const NAV = [
  ["home", "Overview", Layers3],
  ["dashboard", "Live kernel", Activity],
  ["scheduling", "Scheduling", Cpu],
  ["memory", "Memory", MemoryStick],
  ["resources", "Resources", GitBranch],
  ["sync", "Synchronization", Workflow],
  ["analytics", "Analytics", ChartNoAxesCombined],
  ["scenarios", "Scenario lab", Zap],
  ["architecture", "Architecture", Database],
  ["about", "About", CircleHelp],
] as const;
const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "0");
const tick = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
function Card({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function App() {
  const s = useLab();
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!s.running) return;
    const id = window.setInterval(
      () => useLab.getState().step(),
      Math.max(40, 850 / s.speed),
    );
    return () => clearInterval(id);
  }, [s.running, s.speed]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        )
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        useLab.getState().running
          ? useLab.getState().pause()
          : useLab.getState().start();
      } else if (e.key.toLowerCase() === "r") useLab.getState().reset();
      else if (e.key.toLowerCase() === "s") useLab.getState().step();
      else if (e.key.toLowerCase() === "n")
        document.getElementById("process-name")?.focus();
      else if (["1", "2", "5"].includes(e.key))
        useLab.getState().setSpeed(Number(e.key));
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);
  const exportFile = (kind: "json" | "csv") => {
    const data =
      kind === "json"
        ? JSON.stringify(
            {
              specs: s.specs,
              config: s.kernel.config,
              speed: s.speed,
              state: s.kernel,
              analysis: analyze(s.kernel),
            },
            null,
            2,
          )
        : [
            "time,pid,ready,waiting,memory,faults,switches",
            ...s.kernel.history.map(
              (h) =>
                `${h.time},${h.pid ?? ""},${h.ready},${h.waiting},${h.memory},${h.faults},${h.switches}`,
            ),
          ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([data], {
        type: kind === "json" ? "application/json" : "text/csv",
      }),
    );
    a.download = `smartos-report.${kind}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className={`shell ${s.presentation ? "presentation" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Cpu size={21} />
          </div>
          <div>
            <strong>
              SmartOS<span> Lab</span>
            </strong>
            <small>KERNEL SIMULATION STUDIO</small>
          </div>
        </div>
        <div className="side-caption">WORKSPACE</div>
        <nav>
          {NAV.map(([key, label, Icon]) => (
            <button
              key={key}
              className={s.page === key ? "active" : ""}
              onClick={() => s.setPage(key)}
            >
              <Icon size={17} />
              <span>{label}</span>
              {s.page === key && (
                <ChevronRight size={14} className="nav-chevron" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="online">
            <i /> SIMULATION ENGINE <b>ONLINE</b>
          </div>
          <div className="side-version">v1.0 · deterministic tick engine</div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="crumb">
            <span>SMARTOS LAB</span>
            <ChevronRight size={14} />
            <strong>{NAV.find((n) => n[0] === s.page)?.[1]}</strong>
          </div>
          <div className="top-actions">
            <span className="mode-pill">
              <i /> {s.running ? "RUNNING" : "STANDBY"}
            </span>
            <span className="clock">
              <Clock3 size={14} /> {tick(s.kernel.time)}
            </span>
            <button
              title="Presentation mode"
              className={s.presentation ? "top-button active" : "top-button"}
              onClick={s.togglePresentation}
            >
              <Settings2 size={16} /> Presentation
            </button>
          </div>
        </header>
        {s.error && (
          <div className="error-banner">
            {s.error}
            <button onClick={s.clearError}>
              <X size={16} />
            </button>
          </div>
        )}
        <main className="content">
          {s.page === "home" ? (
            <Home />
          ) : s.page === "dashboard" ? (
            <Dashboard />
          ) : s.page === "scheduling" ? (
            <Scheduling />
          ) : s.page === "memory" ? (
            <MemoryLab />
          ) : s.page === "resources" ? (
            <ResourceLab />
          ) : s.page === "sync" ? (
            <SynchronizationLab />
          ) : s.page === "analytics" ? (
            <Analytics />
          ) : s.page === "scenarios" ? (
            <Scenarios />
          ) : s.page === "architecture" ? (
            <Architecture />
          ) : (
            <About />
          )}
        </main>
        <footer className="footer">
          <span>SMARTOS LAB / SIMULATION ENVIRONMENT</span>
          <span>
            Clock {tick(s.kernel.time)} · {s.kernel.events.length} kernel events
          </span>
        </footer>
      </div>
      <div className="float-tools">
        <button onClick={() => exportFile("json")} title="Export report JSON">
          JSON
        </button>
        <button onClick={() => exportFile("csv")} title="Export timeline CSV">
          CSV
        </button>
        <button onClick={() => window.print()} title="Print report">
          PRINT
        </button>
        <button onClick={() => file.current?.click()} title="Load experiment">
          LOAD
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              try {
                const x = JSON.parse(await f.text());
                s.load(x);
              } catch {
                useLab.setState({ error: "Could not read experiment JSON." });
              }
              e.target.value = "";
            }
          }}
        />
      </div>
    </div>
  );
}
function Home() {
  const set = useLab((x) => x.setPage);
  return (
    <div className="home">
      <div className="eyebrow">
        <span className="pulse-dot" /> INTERACTIVE OS LABORATORY{" "}
        <span className="line" />
      </div>
      <h1>
        See what happens
        <br />
        <em>inside the kernel.</em>
      </h1>
      <p className="hero-text">
        An interactive operating system simulation environment. Explore how
        scheduling, memory, I/O, interrupts and resource allocation work
        together in one running system.
      </p>
      <div className="hero-actions">
        <button className="primary" onClick={() => set("dashboard")}>
          <Play size={16} fill="currentColor" /> Launch kernel simulator{" "}
          <ChevronRight size={16} />
        </button>
        <button className="ghost" onClick={() => set("scenarios")}>
          Explore scenarios <ChevronRight size={16} />
        </button>
      </div>
      <div className="home-strip">
        <div>
          <strong>08</strong>
          <span>Scheduling modes</span>
        </div>
        <div>
          <strong>04</strong>
          <span>Page strategies</span>
        </div>
        <div>
          <strong>10</strong>
          <span>Demo scenarios</span>
        </div>
        <div>
          <strong>01</strong>
          <span>Shared kernel</span>
        </div>
      </div>
      <div className="feature-grid">
        {(
          [
            [
              "CPU scheduling",
              "Live execution, Gantt timelines and fair comparison.",
              Cpu,
              "scheduling",
            ],
            [
              "Memory & paging",
              "Allocation, page tables and virtual address translation.",
              MemoryStick,
              "memory",
            ],
            [
              "Resource safety",
              "Deadlock detection and the Banker safety test.",
              GitBranch,
              "resources",
            ],
            [
              "Synchronization",
              "Bounded buffer, readers–writers and philosophers.",
              Workflow,
              "sync",
            ],
            [
              "Kernel events",
              "Interrupts, system calls and device queues.",
              Zap,
              "dashboard",
            ],
            [
              "Analytics",
              "Real metrics, anomalies and explainable health.",
              ChartNoAxesCombined,
              "analytics",
            ],
          ] as const
        ).map(([title, description, Icon, page]) => (
          <button
            className="feature"
            key={title as string}
            onClick={() => set(page as string)}
          >
            <span className="feature-icon">
              <Icon size={21} />
            </span>
            <strong>{title as string}</strong>
            <p>{description as string}</p>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
    </div>
  );
}
function Controls() {
  const s = useLab();
  return (
    <div className="controls">
      <div className="control-clock">
        <span>SYSTEM CLOCK</span>
        <strong>{tick(s.kernel.time)}</strong>
      </div>
      <div className="control-buttons">
        <button
          className="primary small"
          onClick={s.running ? s.pause : s.start}
        >
          {s.running ? (
            <Pause size={15} fill="currentColor" />
          ) : (
            <Play size={15} fill="currentColor" />
          )}
          {s.running ? "Pause" : "Start"}
        </button>
        <button className="square" title="Step one tick" onClick={s.step}>
          <SkipForward size={16} />
        </button>
        <button className="square" title="Reset experiment" onClick={s.reset}>
          <RotateCcw size={16} />
        </button>
      </div>
      <div className="control-settings">
        <label>
          Speed{" "}
          <select
            value={s.speed}
            onChange={(e) => s.setSpeed(Number(e.target.value))}
          >
            {[0.5, 1, 2, 5, 10].map((x) => (
              <option key={x} value={x}>
                {x}×
              </option>
            ))}
          </select>
        </label>
        <label>
          Scheduler{" "}
          <select
            value={s.kernel.config.scheduler}
            onChange={(e) =>
              s.setScheduler(e.target.value as typeof s.kernel.config.scheduler)
            }
          >
            {SCHEDULERS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Quantum{" "}
          <input
            type="number"
            min="1"
            value={s.kernel.config.quantum}
            onChange={(e) => s.setQuantum(Number(e.target.value))}
          />
        </label>
      </div>
    </div>
  );
}
function Dashboard() {
  const s = useLab(),
    m = metrics(s.kernel),
    a = analyze(s.kernel);
  return (
    <>
      <div className="page-title">
        <div>
          <span className="kicker">OPERATIONS / LIVE MONITOR</span>
          <h1>Kernel dashboard</h1>
          <p>One simulation clock. Every subsystem in view.</p>
        </div>
        <Badge tone={s.running ? "good" : "neutral"}>
          {s.running ? "● LIVE EXECUTION" : "● SYSTEM STANDBY"}
        </Badge>
      </div>
      <Controls />
      <div className="stat-grid">
        {(
          [
            ["CPU UTILIZATION", fmt(m.cpu, 0) + "%", Cpu],
            ["MEMORY LOAD", fmt(m.memory, 0) + "%", MemoryStick],
            ["ACTIVE PROCESSES", m.active, Activity],
            ["CONTEXT SWITCHES", s.kernel.contextSwitches, GitBranch],
            ["PAGE FAULTS", s.kernel.pageFaults, HardDrive],
            ["INTERRUPTS", s.kernel.interrupts, Zap],
          ] as const
        ).map(([label, value, Icon]) => (
          <div className="stat" key={label as string}>
            <span>{label as string}</span>
            <div>
              <strong>{value as string | number}</strong>
              <Icon size={20} />
            </div>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <div className="left-stack">
          <ProcessManager />
          <QueueCard />
          <Card
            title="Kernel intelligence"
            subtitle="Rule-based observations from live metrics"
          >
            <div className="insights">
              {a.alerts.length ? (
                a.alerts.map((x) => (
                  <div className="insight" key={x.title}>
                    <BrainCircuit size={16} />
                    <div>
                      <strong>{x.title}</strong>
                      <p>
                        {x.detail} {x.recommendation}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty compact">
                  No anomaly detected. Continue the experiment to collect more
                  data.
                </div>
              )}
            </div>
          </Card>
        </div>
        <div className="right-stack">
          <KernelMap />
          <Card title="Simulated files" subtitle="Disk operations complete on the shared simulation clock">
            {Object.entries(s.kernel.fileSystem).length ? (
              <div className="table-wrap"><table><thead><tr><th>FILE</th><th>SIZE</th><th>CONTENT</th></tr></thead><tbody>
                {Object.entries(s.kernel.fileSystem).map(([name, content]) => <tr key={name}><td>{name}</td><td>{content.length} chars</td><td>{content || "Empty"}</td></tr>)}
              </tbody></table></div>
            ) : <p className="muted">No files yet. Use open() or the kernel console to create one.</p>}
          </Card>
          <Timeline />
          <InterruptPanel />
          <EventLog />
          <TerminalConsole />
        </div>
      </div>
      <PCBPanel />
    </>
  );
}
function ProcessManager() {
  const s = useLab(),
    [name, setName] = useState(""),
    [burst, setBurst] = useState(6),
    [arrival, setArrival] = useState(0),
    [priority, setPriority] = useState(3),
    [memory, setMemory] = useState(16);
  const add = () => {
    s.add({ pid: s.kernel.nextPid, name, burst, arrival, priority, memory });
    if (name.trim()) setName("");
  };
  return (
    <Card
      title="Process manager"
      subtitle="Create and control process control blocks"
    >
      <div className="process-form">
        <input
          id="process-name"
          placeholder="Process name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="form-row">
          <label>
            Burst
            <input
              type="number"
              min="1"
              value={burst}
              onChange={(e) => setBurst(Number(e.target.value))}
            />
          </label>
          <label>
            Arrival
            <input
              type="number"
              min="0"
              value={arrival}
              onChange={(e) => setArrival(Number(e.target.value))}
            />
          </label>
          <label>
            Priority
            <input
              type="number"
              min="0"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
          </label>
          <label>
            Memory
            <input
              type="number"
              min="1"
              value={memory}
              onChange={(e) => setMemory(Number(e.target.value))}
            />
          </label>
        </div>
        <button className="primary full" onClick={add}>
          <Plus size={15} /> Create process
        </button>
      </div>
      <div className="list-head">
        <span>PROCESS</span>
        <span>STATE</span>
        <span>CPU LEFT</span>
      </div>
      <div className="process-list">
        {s.kernel.processes.map((p) => (
          <button
            className="process-item"
            key={p.pid}
            onClick={() => s.select(p.pid)}
          >
            <span className="pid-chip">P{p.pid}</span>
            <span className="process-name">{p.name}</span>
            <Badge
              tone={
                p.state === "RUNNING"
                  ? "good"
                  : p.state === "WAITING"
                    ? "warn"
                    : p.state === "TERMINATED"
                      ? "muted"
                      : "neutral"
              }
            >
              {p.state}
            </Badge>
            <span className="mono remaining">{p.remaining}t</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
function QueueCard() {
  const ps = useLab((x) => x.kernel.processes);
  return (
    <Card title="Process lifecycle" subtitle="Live state distribution">
      <div className="states">
        {["NEW", "READY", "RUNNING", "WAITING", "SUSPENDED", "TERMINATED"].map(
          (x) => (
            <div className={`state-box ${x.toLowerCase()}`} key={x}>
              <strong>{ps.filter((p) => p.state === x).length}</strong>
              <span>{x}</span>
              <div className="state-pids">
                {ps
                  .filter((p) => p.state === x)
                  .slice(0, 4)
                  .map((p) => `P${p.pid}`)
                  .join(" · ") || "—"}
              </div>
            </div>
          ),
        )}
      </div>
    </Card>
  );
}
function KernelMap() {
  const ps = useLab((x) => x.kernel.processes),
    running = ps.find((p) => p.state === "RUNNING");
  return (
    <Card
      title="Live kernel topology"
      subtitle="Process flow across CPU, memory and devices"
      className="map-card"
    >
      <div className="kernel-map">
        <div className="map-row">
          <div className="map-node">
            <span>01 / DISPATCH</span>
            <Cpu size={25} />
            <strong>CPU CORE</strong>
            <small>
              {running ? `P${running.pid} · ${running.name}` : "IDLE"}
            </small>
          </div>
          <div className="map-link" />
          <div className="map-node">
            <span>02 / MEMORY</span>
            <MemoryStick size={25} />
            <strong>PHYSICAL RAM</strong>
            <small>
              {ps.reduce((a, p) => a + p.allocatedPages.length, 0)} resident
              pages
            </small>
          </div>
        </div>
        <div className="map-row">
          <div className="map-node secondary">
            <span>READY QUEUE</span>
            <div className="token-line">
              {ps
                .filter((p) => p.state === "READY")
                .slice(0, 8)
                .map((p) => (
                  <b key={p.pid}>P{p.pid}</b>
                ))}
              {!ps.some((p) => p.state === "READY") && <small>Empty</small>}
            </div>
          </div>
          <div className="map-link" />
          <div className="map-node secondary">
            <span>DEVICE / DISK QUEUE</span>
            <div className="token-line">
              {ps
                .filter((p) => p.state === "WAITING")
                .slice(0, 8)
                .map((p) => (
                  <b key={p.pid}>P{p.pid}</b>
                ))}
              {!ps.some((p) => p.state === "WAITING") && <small>Empty</small>}
            </div>
          </div>
        </div>
      </div>
      <div className="map-caption">
        <span>
          <i className="green-dot" /> Executing
        </span>
        <span>
          <i className="amber-dot" /> Blocked
        </span>
        <span>
          <i className="blue-dot" /> Ready
        </span>
      </div>
    </Card>
  );
}
function Timeline() {
  const history = useLab((x) => x.kernel.history);
  return (
    <Card
      title="Kernel timeline"
      subtitle="Each cell is one simulated time unit"
    >
      <div className="timeline-head">
        <span>TIME →</span>
        <span>
          {history.length
            ? `${Math.max(0, history.length - 24)}–${history.length - 1}`
            : "0–0"}{" "}
          ticks
        </span>
      </div>
      <div className="timeline-grid">
        <span>CPU</span>
        <div className="tick-track">
          {history.slice(-24).map((h) => (
            <div
              title={`t=${h.time}: ${h.pid ? `P${h.pid}` : "idle"}`}
              className={h.pid ? "active-tick" : "idle-tick"}
              key={h.time}
            >
              {h.pid ? `P${h.pid}` : "·"}
            </div>
          ))}
        </div>
        <span>I/O</span>
        <div className="tick-track">
          {history.slice(-24).map((h) => (
            <div
              title={`t=${h.time}: ${h.waiting} waiting`}
              className={h.waiting ? "io-tick" : "idle-tick"}
              key={h.time}
            >
              {h.waiting || "·"}
            </div>
          ))}
        </div>
        <span>EVENT</span>
        <div className="tick-track">
          {history.slice(-24).map((h) => (
            <div
              title={h.eventTypes.join(", ") || "none"}
              className={
                h.eventTypes.includes("PAGE_FAULT")
                  ? "fault-tick"
                  : h.eventTypes.includes("INTERRUPT")
                    ? "io-tick"
                    : "idle-tick"
              }
              key={h.time}
            >
              {h.eventTypes.includes("PAGE_FAULT")
                ? "F"
                : h.eventTypes.includes("INTERRUPT")
                  ? "I"
                  : "·"}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
function EventLog() {
  const events = useLab((x) => x.kernel.events),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("ALL");
  const filtered = events
    .filter(
      (e) =>
        (filter === "ALL" || e.eventType.includes(filter)) &&
        `${e.description} ${e.eventType} ${e.processId ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .slice(-70)
    .reverse();
  return (
    <Card
      title="Kernel event log"
      subtitle={`${events.length} structured events recorded`}
    >
      <div className="log-filters">
        <input
          placeholder="Search events or PID..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          {[
            "ALL",
            "PROCESS",
            "CPU",
            "IO",
            "PAGE",
            "INTERRUPT",
            "CONTEXT",
            "SYSTEM",
            "MEMORY",
            "DEADLOCK",
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </div>
      <div className="log-list">
        {filtered.map((e) => (
          <div className="log-row" key={e.id}>
            <span className="mono">[{tick(e.timestamp)}]</span>
            <b className={e.eventType.includes("FAULT") ? "warning" : ""}>
              {e.eventType}
            </b>
            <span>{e.description}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
function PCBPanel() {
  const s = useLab(),
    p = s.kernel.processes.find((x) => x.pid === s.selectedPid);
  if (!p) return null;
  const wait =
    p.completedAt !== undefined
      ? Math.max(0, p.completedAt - p.arrival - p.burst - p.ioService)
      : p.waitingTicks;
  return (
    <div className="modal-backdrop" onClick={() => s.select(null)}>
      <div className="pcb-panel" onClick={(e) => e.stopPropagation()}>
        <div className="pcb-header">
          <div>
            <span>PROCESS CONTROL BLOCK</span>
            <h2>
              P{p.pid} / {p.name}
            </h2>
          </div>
          <button onClick={() => s.select(null)}>
            <X size={19} />
          </button>
        </div>
        <div className="pcb-body">
          <Badge
            tone={
              p.state === "RUNNING"
                ? "good"
                : p.state === "WAITING"
                  ? "warn"
                  : "neutral"
            }
          >
            {p.state}
          </Badge>
          <div className="pcb-grid">
            {[
              ["PID", p.pid],
              ["Parent", p.parent ?? "—"],
              ["Arrival", p.arrival],
              ["Burst", p.burst],
              ["Remaining", p.remaining],
              ["Priority", p.priority],
              ["Program counter", p.programCounter],
              ["Memory request", `${p.memory} KB`],
              ["Waiting", wait],
              [
                "Turnaround",
                p.completedAt !== undefined ? p.completedAt - p.arrival : "—",
              ],
              [
                "Response",
                p.firstRun !== undefined ? p.firstRun - p.arrival : "—",
              ],
              ["I/O requests", p.io?.length ?? 0],
              ["Heap reserved", `${p.heapBytes} KB`],
            ].map(([k, v]) => (
              <div key={k}>
                <span>{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          <h3>CPU registers</h3>
          <div className="registers">
            {Object.entries(p.registers).map(([k, v]) => (
              <div key={k}>
                <span>{k.toUpperCase()}</span>
                <b>{v}</b>
              </div>
            ))}
          </div>
          <h3>Page table</h3>
          <div className="page-chips">
            {p.allocatedPages.length
              ? p.allocatedPages.map((page) => (
                  <Badge key={page}>
                    Page {page} → frame{" "}
                    {s.kernel.frameTable.findIndex(
                      (x) => x?.pid === p.pid && x.page === page,
                    )}
                  </Badge>
                ))
              : "No resident pages"}
          </div>
          <h3>Resources</h3>
          <p className="muted">
            {Object.keys(p.resources).length
              ? JSON.stringify(p.resources)
              : "No resources held"}
          </p>
          <h3>Open files</h3>
          <p className="muted">{p.openFiles.length ? p.openFiles.join(", ") : "No open files"}</p>
          {p.lastRead !== undefined && <p className="muted">Last read: {p.lastRead || "Empty file"}</p>}
          <div className="pcb-actions">
            <button
              onClick={() =>
                s.change(p.pid, p.state === "SUSPENDED" ? "resume" : "pause")
              }
            >
              {p.state === "SUSPENDED" ? "Resume" : "Suspend"}
            </button>
            <button
              onClick={() =>
                s.change(p.pid, "priority", Math.max(0, p.priority - 1))
              }
            >
              Raise priority
            </button>
            <button onClick={() => s.change(p.pid, "terminate")}>
              Terminate
            </button>
            <button
              onClick={() => {
                s.change(p.pid, "delete");
                s.select(null);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
function Scheduling() {
  const s = useLab(),
    ps = s.specs,
    rows = useMemo(
      () =>
        SCHEDULERS.map((name) =>
          compareSchedule(ps.map(makePCB), name, s.kernel.config.quantum),
        ),
      [ps, s.kernel.config.quantum],
    ),
    current = rows.find((x) => x.name === s.kernel.config.scheduler)!;
  const bestWait = [...rows].sort(
      (a, b) => a.averageWaiting - b.averageWaiting,
    )[0],
    bestResponse = [...rows].sort(
      (a, b) => a.averageResponse - b.averageResponse,
    )[0];
  return (
    <>
      <div className="page-title">
        <div>
          <span className="kicker">LAB / CPU SCHEDULING</span>
          <h1>Scheduling laboratory</h1>
          <p>
            Run the same workload under eight policies. Lower priority number
            wins.
          </p>
        </div>
        <Badge tone="blue">{ps.length} PROCESSES</Badge>
      </div>
      <Controls />
      <div className="two-col">
        <Card
          title="Algorithm comparison"
          subtitle="Pure scheduling model · I/O excluded for apples-to-apples comparison"
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ALGORITHM</th>
                  <th>AVG WAIT</th>
                  <th>TURNAROUND</th>
                  <th>RESPONSE</th>
                  <th>SWITCHES</th>
                  <th>CPU %</th>
                  <th>THROUGHPUT</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.name}
                    className={
                      r.name === s.kernel.config.scheduler ? "selected-row" : ""
                    }
                  >
                    <td>
                      <strong>{r.name}</strong>
                    </td>
                    <td>{fmt(r.averageWaiting)}</td>
                    <td>{fmt(r.averageTurnaround)}</td>
                    <td>{fmt(r.averageResponse)}</td>
                    <td>{r.contextSwitches}</td>
                    <td>{fmt(r.utilization)}%</td>
                    <td>{fmt(r.throughput, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="note">
            Best average wait: <b>{bestWait.name}</b>. Best response:{" "}
            <b>{bestResponse.name}</b>. Scheduler choice depends on workload and
            fairness goals.
          </div>
        </Card>
        <Card
          title="Waiting time by scheduler"
          subtitle="Measured in simulation ticks"
        >
          <div className="chart medium">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows}
                margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
              >
                <CartesianGrid stroke="#e7e7eb" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#83838c", fontSize: 10 }}
                />
                <YAxis tick={{ fill: "#83838c", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: "#ffffff",
                    border: "1px solid #e5e5ea",
                    color: "#1d1d1f",
                  }}
                />
                <Bar
                  dataKey="averageWaiting"
                  fill="#0071e3"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
      <Card
        title={`${current.name} execution trace`}
        subtitle="Deterministic Gantt chart for the configured workload"
      >
        <div className="gantt">
          {current.timeline.map((pid, i) => (
            <div
              key={i}
              className={`gantt-cell ${pid ? "filled" : ""}`}
              title={`t=${i}–${i + 1} · ${pid ? `P${pid}` : "Idle"}`}
            >
              <span>{pid ? `P${pid}` : "·"}</span>
              <small>{i}</small>
            </div>
          ))}
        </div>
        <div className="metric-row">
          <span>
            Average wait <b>{fmt(current.averageWaiting)}t</b>
          </span>
          <span>
            Average turnaround <b>{fmt(current.averageTurnaround)}t</b>
          </span>
          <span>
            Average response <b>{fmt(current.averageResponse)}t</b>
          </span>
          <span>
            Switches <b>{current.contextSwitches}</b>
          </span>
        </div>
      </Card>
      <Card
        title="Process results"
        subtitle="Completion − arrival = turnaround; turnaround − burst = waiting"
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>PID</th>
                <th>PROCESS</th>
                <th>ARRIVAL</th>
                <th>BURST</th>
                <th>COMPLETION</th>
                <th>WAIT</th>
                <th>TURNAROUND</th>
                <th>RESPONSE</th>
              </tr>
            </thead>
            <tbody>
              {ps.map((p) => (
                <tr key={p.pid}>
                  <td>P{p.pid}</td>
                  <td>{p.name}</td>
                  <td>{p.arrival}</td>
                  <td>{p.burst}</td>
                  <td>{current.completion[p.pid]}</td>
                  <td>{current.waiting[p.pid]}</td>
                  <td>{current.turnaround[p.pid]}</td>
                  <td>{current.response[p.pid]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
function MemoryLab() {
  const s = useLab(),
    [blocks, setBlocks] = useState<Block[]>([
      { start: 0, size: 32, pid: null },
      { start: 32, size: 24, pid: 10 },
      { start: 56, size: 16, pid: null },
      { start: 72, size: 20, pid: 11 },
      { start: 92, size: 36, pid: null },
    ]),
    [fit, setFit] = useState<Fit>("FIRST"),
    [size, setSize] = useState(12),
    [pid, setPid] = useState(12),
    [cursor, setCursor] = useState(0),
    [memMessage, setMessage] = useState(
      "Select a fit strategy and allocate a block.",
    ),
    [refs, setRefs] = useState("7 0 1 2 0 3 0 4 2 3 0 3 2"),
    [frames, setFrames] = useState(3),
    [replacement, setReplacement] = useState<Replacement>("FIFO"),
    [address, setAddress] = useState(17),
    [selected, setSelected] = useState(s.kernel.processes[0]?.pid ?? 1);
  const numbers = refs.trim()
    ? refs
        .trim()
        .split(/[\s,]+/)
        .map(Number)
    : [];
  let steps: ReturnType<typeof replacePages> = [],
    pageError = "";
  try {
    steps = replacePages(numbers, frames, replacement);
  } catch (e) {
    pageError = (e as Error).message;
  }
  const frag = fragmentation(blocks, size),
    proc = s.kernel.processes.find((p) => p.pid === selected),
    pageTable = Object.fromEntries(
      s.kernel.frameTable.flatMap((x, i) =>
        x?.pid === selected ? [[x.page, i]] : [],
      ),
    );
  let translation: ReturnType<typeof translate> | null = null;
  try {
    translation = translate(
      address,
      s.kernel.config.pageSize,
      pageTable,
      s.kernel.config.ramSize,
    );
  } catch {
    translation = null;
  }
  return (
    <>
      <div className="page-title">
        <div>
          <span className="kicker">LAB / PHYSICAL & VIRTUAL MEMORY</span>
          <h1>Memory laboratory</h1>
          <p>
            Contiguous allocation, paging, replacement and address translation.
          </p>
        </div>
        <Badge tone="blue">
          {s.kernel.frameTable.filter(Boolean).length}/
          {s.kernel.frameTable.length} FRAMES
        </Badge>
      </div>
      <form
        className="memory-config"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          s.load({
            specs: s.specs,
            config: {
              ...s.kernel.config,
              ramSize: Number(data.get("ram")),
              pageSize: Number(data.get("page")),
              frameCount: Number(data.get("frames")),
            },
            speed: s.speed,
          });
        }}
      >
        <span>SHARED KERNEL MEMORY</span>
        <label>
          RAM KB{" "}
          <input
            name="ram"
            type="number"
            min="1"
            key={`ram-${s.kernel.config.ramSize}`}
            defaultValue={s.kernel.config.ramSize}
          />
        </label>
        <label>
          PAGE KB{" "}
          <input
            name="page"
            type="number"
            min="1"
            key={`page-${s.kernel.config.pageSize}`}
            defaultValue={s.kernel.config.pageSize}
          />
        </label>
        <label>
          FRAMES{" "}
          <input
            name="frames"
            type="number"
            min="1"
            key={`frames-${s.kernel.config.frameCount}`}
            defaultValue={s.kernel.config.frameCount}
          />
        </label>
        <button type="submit">Apply & reset</button>
      </form>
      <div className="two-col">
        <Card
          title="Contiguous allocation"
          subtitle="Place processes into free holes"
        >
          <div className="inline-form">
            <select value={fit} onChange={(e) => setFit(e.target.value as Fit)}>
              {["FIRST", "BEST", "WORST", "NEXT"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              value={pid}
              title="PID"
              onChange={(e) => setPid(Number(e.target.value))}
            />
            <input
              type="number"
              min="1"
              value={size}
              title="Size in KB"
              onChange={(e) => setSize(Number(e.target.value))}
            />
            <button
              className="primary small"
              onClick={() => {
                try {
                  const r = allocate(blocks, pid, size, fit, cursor);
                  setBlocks(r.blocks);
                  setCursor(r.cursor);
                  setMessage(
                    r.start === null
                      ? "Allocation failed: no fitting free hole."
                      : `P${pid} allocated at address ${r.start}.`,
                  );
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              Allocate
            </button>
          </div>
          <div className="field-hint">PID · SIZE KB</div>
          <div className="memory-bar">
            {blocks.map((b, i) => (
              <button
                key={`${b.start}-${i}`}
                className={b.pid === null ? "free" : "occupied"}
                style={{ flex: b.size }}
                title={`${b.pid === null ? "Free" : `P${b.pid}`} · ${b.start}–${b.start + b.size - 1} KB`}
                onClick={() => {
                  if (b.pid !== null) {
                    setBlocks(release(blocks, b.pid));
                    setMessage(
                      `P${b.pid} released. Adjacent free holes coalesced.`,
                    );
                  }
                }}
              >
                {b.pid === null ? "FREE" : `P${b.pid}`}
                <small>{b.size} KB</small>
              </button>
            ))}
          </div>
          <p className="muted">{memMessage}</p>
          <div className="metric-row">
            <span>
              Free <b>{frag.totalFree} KB</b>
            </span>
            <span>
              Largest hole <b>{frag.largestHole} KB</b>
            </span>
            <span>
              External fragments <b>{frag.external} KB</b>
            </span>
            <span>
              Internal <b>0 KB</b>
            </span>
          </div>
        </Card>
        <Card
          title="Live physical frames"
          subtitle="Pages currently resident in the shared kernel"
        >
          <div className="frame-grid">
            {s.kernel.frameTable.map((x, i) => (
              <div className={x ? "frame used" : "frame"} key={i}>
                <small>F{String(i).padStart(2, "0")}</small>
                <strong>{x ? `P${x.pid} / ${x.page}` : "FREE"}</strong>
              </div>
            ))}
          </div>
          <div className="metric-row">
            <span>
              RAM <b>{s.kernel.config.ramSize} KB</b>
            </span>
            <span>
              Page size <b>{s.kernel.config.pageSize} KB</b>
            </span>
            <span>
              Faults <b>{s.kernel.pageFaults}</b>
            </span>
          </div>
        </Card>
      </div>
      <div className="two-col">
        <Card
          title="Page replacement"
          subtitle="Enter a reference string and compare real algorithm traces"
        >
          <div className="inline-form">
            <input
              className="wide"
              value={refs}
              onChange={(e) => setRefs(e.target.value)}
              aria-label="Page references"
            />
            <select
              value={replacement}
              onChange={(e) => setReplacement(e.target.value as Replacement)}
            >
              {["FIFO", "LRU", "OPTIMAL", "CLOCK"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              max="12"
              value={frames}
              onChange={(e) => setFrames(Number(e.target.value))}
            />
          </div>
          {pageError ? (
            <p className="error-text">{pageError}</p>
          ) : (
            <>
              <div className="metric-row">
                <span>
                  Faults <b>{steps.filter((x) => !x.hit).length}</b>
                </span>
                <span>
                  Hits <b>{steps.filter((x) => x.hit).length}</b>
                </span>
                <span>
                  Fault rate{" "}
                  <b>
                    {fmt(
                      steps.length
                        ? (steps.filter((x) => !x.hit).length / steps.length) *
                            100
                        : 0,
                      0,
                    )}
                    %
                  </b>
                </span>
              </div>
              <div className="page-trace">
                {steps.map((x, i) => (
                  <div
                    className={`page-step ${x.hit ? "hit" : "fault"}`}
                    key={i}
                  >
                    <small>{i + 1}</small>
                    <strong>{x.reference}</strong>
                    <div>
                      {x.frames.map((v, j) => (
                        <span key={j}>{v ?? "–"}</span>
                      ))}
                    </div>
                    <em>{x.hit ? "HIT" : "FAULT"}</em>
                  </div>
                ))}
              </div>
              <div className="replacement-compare">
                {(["FIFO", "LRU", "OPTIMAL", "CLOCK"] as Replacement[]).map(
                  (x) => (
                    <span key={x}>
                      {x}{" "}
                      <b>
                        {
                          replacePages(numbers, frames, x).filter((y) => !y.hit)
                            .length
                        }{" "}
                        faults
                      </b>
                    </span>
                  ),
                )}
              </div>
            </>
          )}
        </Card>
        <Card
          title="Virtual address translation"
          subtitle="Virtual page + offset → page table → physical frame"
        >
          <div className="inline-form">
            <select
              value={selected}
              onChange={(e) => setSelected(Number(e.target.value))}
            >
              {s.kernel.processes.map((p) => (
                <option key={p.pid} value={p.pid}>
                  P{p.pid} · {p.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              max={Math.max(0, (proc?.memory ?? 1) - 1)}
              value={address}
              onChange={(e) => setAddress(Number(e.target.value))}
            />
          </div>
          <div className="translation-flow">
            <div>
              <small>VIRTUAL ADDRESS</small>
              <strong>{address}</strong>
            </div>
            <ChevronRight />
            <div>
              <small>PAGE / OFFSET</small>
              <strong>
                {translation
                  ? `${translation.page} / ${translation.offset}`
                  : "—"}
              </strong>
            </div>
            <ChevronRight />
            <div>
              <small>FRAME</small>
              <strong>{translation?.frame ?? "FAULT"}</strong>
            </div>
            <ChevronRight />
            <div>
              <small>PHYSICAL</small>
              <strong>{translation?.physical ?? "—"}</strong>
            </div>
          </div>
          {address >= (proc?.memory ?? 0) ? (
            <p className="error-text">Address exceeds process size.</p>
          ) : translation?.fault ? (
            <p className="muted">
              Page is not resident. The running kernel will issue a page-fault
              trap when accessed.
            </p>
          ) : (
            <p className="muted">
              Translated using P{selected}'s current page table.
            </p>
          )}
          <h4>Swap space</h4>
          <div className="page-chips">
            {s.kernel.diskPages.length ? (
              s.kernel.diskPages.slice(-16).map((x, i) => (
                <Badge key={i}>
                  P{x.pid} · page {x.page}
                </Badge>
              ))
            ) : (
              <span className="muted">No pages swapped out yet.</span>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
function Analytics() {
  const s = useLab(),
    m = metrics(s.kernel),
    a = analyze(s.kernel);
  let executed = 0;
  const chart = s.kernel.history.map((h) => {
    if (h.pid !== null) executed++;
    return { ...h, cpu: Math.round((executed / (h.time + 1)) * 100) };
  });
  return (
    <>
      <div className="page-title">
        <div>
          <span className="kicker">TELEMETRY / PERFORMANCE</span>
          <h1>Kernel analytics</h1>
          <p>
            Every chart and recommendation is derived from the active
            simulation.
          </p>
        </div>
        <Badge
          tone={
            a.health.overall >= 75
              ? "good"
              : a.health.overall >= 50
                ? "warn"
                : "danger"
          }
        >
          {a.health.label}
        </Badge>
      </div>
      <div className="stat-grid">
        {(
          [
            ["CPU UTILIZATION", `${fmt(m.cpu, 0)}%`],
            ["AVG WAIT", `${fmt(m.waiting)}t`],
            ["AVG TURNAROUND", `${fmt(m.turnaround)}t`],
            ["THROUGHPUT", fmt(m.throughput, 2)],
            ["PAGE FAULTS", s.kernel.pageFaults],
            ["CONTEXT SWITCHES", s.kernel.contextSwitches],
          ] as const
        ).map(([k, v]) => (
          <div className="stat" key={k}>
            <span>{k}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <div className="two-col">
        <Card
          title="System load over time"
          subtitle="Actual frame utilization, ready and blocked queue lengths"
        >
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart}>
                <CartesianGrid stroke="#e7e7eb" vertical={false} />
                <XAxis
                  dataKey="time"
                  tick={{ fill: "#83838c", fontSize: 11 }}
                />
                <YAxis tick={{ fill: "#83838c", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: "#ffffff",
                    border: "1px solid #e5e5ea",
                    color: "#1d1d1f",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="memory"
                  stroke="#0071e3"
                  fill="#0071e322"
                  name="Memory %"
                />
                <Area
                  type="monotone"
                  dataKey="ready"
                  stroke="#54a0f6"
                  fill="#54a0f622"
                  name="Ready"
                />
                <Area
                  type="monotone"
                  dataKey="waiting"
                  stroke="#e0a045"
                  fill="#e0a04522"
                  name="Blocked"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card
          title="Kernel health"
          subtitle="Transparent weighted score from observed metrics"
        >
          <div className="health-score">
            <strong>{a.health.overall}</strong>
            <span>/ 100</span>
          </div>
          {[
            ["CPU efficiency", a.health.cpu],
            ["Memory health", a.health.memory],
            ["Scheduling health", a.health.scheduling],
            ["Resource safety", a.health.resource],
          ].map(([k, v]) => (
            <div className="health-row" key={k}>
              <span>{k}</span>
              <div>
                <i style={{ width: `${v}%` }} />
              </div>
              <b>{v}%</b>
            </div>
          ))}
          <p className="muted small-text">{a.formula}</p>
        </Card>
      </div>
      <Card
        title="Kernel intelligence engine"
        subtitle="Explainable rules; no external AI service"
      >
        <div className="insights grid">
          {a.alerts.length ? (
            a.alerts.map((x) => (
              <div className="insight" key={x.title}>
                <BrainCircuit size={18} />
                <div>
                  <strong>{x.title}</strong>
                  <p>{x.detail}</p>
                  <p>
                    <b>Recommendation:</b> {x.recommendation}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="empty">
              No anomalies at this time. Advance the simulation to collect
              telemetry.
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
function Scenarios() {
  const s = useLab(),
    [seed, setSeed] = useState(s.kernel.config.seed);
  return (
    <>
      <div className="page-title">
        <div>
          <span className="kicker">EXPERIMENTS / DEMO PRESETS</span>
          <h1>Scenario laboratory</h1>
          <p>Repeatable demonstrations configured in one click.</p>
        </div>
      </div>
      <div className="scenario-grid">
        {scenarios.map((sc, i) => (
          <button
            className="scenario"
            key={sc.name}
            onClick={() => s.scenario(i)}
          >
            <span>SCENARIO {String(i + 1).padStart(2, "0")}</span>
            <strong>{sc.name}</strong>
            <p>{sc.description}</p>
            <div>
              <span>{sc.processes.length} processes</span>
              <ChevronRight size={17} />
            </div>
          </button>
        ))}
      </div>
      <Card
        title="Kernel chaos mode"
        subtitle="Seeded, repeatable event generation"
      >
        <div className="inline-form">
          <label>
            Simulation seed{" "}
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
            />
          </label>
          <button
            onClick={() => {
              s.setSeed(seed);
              s.setChaos(true);
              s.start();
            }}
          >
            Start chaos
          </button>
          <button onClick={s.pause}>Pause chaos</button>
          <button
            onClick={() => {
              s.setChaos(false);
              s.pause();
            }}
          >
            Stop chaos
          </button>
        </div>
        <p className="muted">
          The same seed and starting scenario reproduce the same generated
          process and interrupt sequence.
        </p>
      </Card>
    </>
  );
}
function Architecture() {
  const [selected, setSelected] = useState("Kernel");
  const layers = [
    ["Applications", "User processes and terminal commands"],
    ["System call interface", "Controlled transition into kernel mode"],
    ["Kernel", "Shared deterministic event-driven simulation"],
    ["Process manager", "PCB lifecycle, queues and state changes"],
    ["Scheduler", "Eight CPU scheduling modes"],
    ["Memory manager", "Frames, page faults and swap space"],
    ["Resource manager", "Deadlock and safety algorithms"],
    ["I/O manager", "Disk, keyboard, printer and network events"],
    ["Hardware simulator", "One CPU, RAM frames and simulated devices"],
  ];
  return (
    <>
      <div className="page-title">
        <div>
          <span className="kicker">SYSTEM / DESIGN</span>
          <h1>Kernel architecture</h1>
          <p>Click a subsystem to inspect its role in the simulation.</p>
        </div>
      </div>
      <div className="architecture">
        {layers.map(([name, description], i) => (
          <button
            className={`arch-layer ${selected === name ? "active" : ""}`}
            key={name}
            onClick={() => setSelected(name)}
          >
            <span>{String(i + 1).padStart(2, "0")}</span>
            <strong>{name}</strong>
            <ChevronRight size={16} />
            <small>{description}</small>
          </button>
        ))}
      </div>
      <Card title={selected} subtitle="Architecture detail">
        <p className="muted">
          {layers.find((x) => x[0] === selected)?.[1]}. The UI subscribes to
          immutable snapshots. Pure TypeScript modules calculate transitions and
          results, while one simulation clock coordinates CPU, paging, I/O and
          interrupts.
        </p>
      </Card>
    </>
  );
}
function About() {
  return (
    <>
      <div className="page-title">
        <div>
          <span className="kicker">PROJECT / DOCUMENTATION</span>
          <h1>About SmartOS Lab</h1>
          <p>A serious operating systems teaching environment.</p>
        </div>
      </div>
      <div className="two-col">
        <Card title="Problem statement">
          <p className="prose">
            Operating System algorithms are often taught independently using
            static diagrams and numerical examples, making it difficult to
            understand how scheduling, memory management, interrupts,
            synchronization and resource allocation interact inside a running
            system. SmartOS Lab provides an interactive kernel simulation
            environment that shows these mechanisms working together.
          </p>
        </Card>
        <Card title="Project objective">
          <p className="prose">
            Build an interactive OS kernel simulator that demonstrates how a
            kernel coordinates CPU scheduling, process management, memory,
            synchronization, I/O, interrupts, virtual memory and resource
            allocation through real-time visualization.
          </p>
        </Card>
        <Card title="Algorithms and concepts">
          <p className="prose">
            FCFS, SJF, SRTF, priority scheduling, Round Robin, multilevel queue
            and feedback queue; contiguous allocation; FIFO, LRU, Optimal and
            Clock replacement; deadlock detection and Banker's safety algorithm;
            bounded-buffer, reader-writer and dining philosopher demonstrations.
          </p>
        </Card>
        <Card title="Technology and assumptions">
          <p className="prose">
            React, TypeScript, Vite, Zustand, Recharts and Lucide. Discrete
            integer time, one CPU, zero dispatch cost and deterministic
            arrival/PID ties. The kernel uses FIFO frame eviction; the memory
            lab compares four replacement policies. Detailed design and
            limitations are documented in the repository.
          </p>
        </Card>
      </div>
    </>
  );
}
export default App;
