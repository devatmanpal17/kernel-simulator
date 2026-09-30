import { useState } from "react";
import { Terminal } from "lucide-react";
import { useLab } from "../store";
import type { Device } from "../core/types";
import type { SystemCall } from "../core/kernel";

const calls: SystemCall[] = ["fork", "exec", "wait", "exit", "read", "write", "open", "close", "malloc"];

export function InterruptPanel() {
  const { kernel, io, interrupt, syscall } = useLab();
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [device, setDevice] = useState<Device>("DISK");
  const [duration, setDuration] = useState(3);
  const [call, setCall] = useState<SystemCall>("fork");
  const [argument, setArgument] = useState("");
  const [result, setResult] = useState("");
  const active = kernel.processes.filter((p) => p.state !== "TERMINATED");
  const pid = active.some((p) => p.pid === selectedPid) ? selectedPid! : active[0]?.pid;
  const needsArgument = ["exec", "read", "write", "open", "close", "malloc"].includes(call);
  const placeholder = call === "exec" ? "program-name burst" : call === "malloc" ? "size in KB" : call === "write" ? "file-name text to append" : "file name";
  return (
    <section className="card">
      <div className="card-head"><div><h3>Kernel controls</h3><p>Issue real I/O requests, interrupts, and system calls</p></div></div>
      <div className="inline-form">
        <label>Process<select aria-label="Process for kernel action" value={pid ?? ""} onChange={(e) => setSelectedPid(Number(e.target.value))}>{active.map((p) => <option key={p.pid} value={p.pid}>P{p.pid} · {p.name}</option>)}</select></label>
        <label>Device<select aria-label="I/O device" value={device} onChange={(e) => setDevice(e.target.value as Device)}>{(["DISK", "KEYBOARD", "PRINTER", "NETWORK"] as Device[]).map((name) => <option key={name}>{name}</option>)}</select></label>
        <label>Duration<input aria-label="I/O duration" type="number" min="1" value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></label>
        <button disabled={pid === undefined} onClick={() => { io(pid!, device, duration); setResult(`P${pid} requested ${device} I/O`); }}>Request I/O</button>
        <button onClick={() => { interrupt("TIMER"); setResult("Timer interrupt handled"); }}>Timer interrupt</button>
      </div>
      <div className="inline-form second-line">
        <label>System call<select aria-label="System call" value={call} onChange={(e) => setCall(e.target.value as SystemCall)}>{calls.map((name) => <option key={name}>{name}</option>)}</select></label>
        {needsArgument && <input aria-label="System call argument" className="wide" value={argument} placeholder={placeholder} onChange={(e) => setArgument(e.target.value)} />}
        <button disabled={pid === undefined} onClick={() => setResult(syscall(call, pid!, argument))}>Invoke {call}()</button>
      </div>
      <p className="muted" role="status">{result || "Select a process and an action. The event log records each transition."}</p>
    </section>
  );
}

export function TerminalConsole() {
  const command = useLab((s) => s.command);
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<string[]>(["SmartOS console · type help for commands"]);
  const run = () => {
    const raw = input.trim();
    if (!raw) return;
    if (raw.toLowerCase() === "clear") setLines([]);
    else setLines((previous) => [...previous.slice(-90), `kernel> ${raw}`, command(raw)]);
    setInput("");
  };
  return (
    <section className="card">
      <div className="card-head"><div><h3>Kernel console</h3><p>Commands operate on the same kernel state as the dashboard</p></div></div>
      <div className="terminal-body" role="log">{lines.map((line, index) => <div key={index}>{line}</div>)}</div>
      <form className="terminal-input" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <Terminal size={16} /><span>kernel&gt;</span>
        <input aria-label="Kernel command" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a command…" />
        <button type="submit">Run</button>
      </form>
    </section>
  );
}
