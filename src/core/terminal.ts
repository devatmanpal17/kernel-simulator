import { changeProcess, metrics, systemCall, type SystemCall } from "./kernel";
import type { KernelState } from "./types";

export function executeCommand(state: KernelState, input: string): { state: KernelState; output: string } {
  const [raw, ...args] = input.trim().split(/\s+/);
  const command = raw?.toLowerCase();
  const pid = Number(args[0]);
  const requirePid = () => {
    if (!Number.isInteger(pid) || !state.processes.some((p) => p.pid === pid))
      throw new Error("Provide an existing PID.");
  };
  const same = (output: string) => ({ state, output });
  switch (command) {
    case "help":
      return same("help | ps | top | kill PID | pause PID | resume PID | nice PID N | free | scheduler | resources | pages | interrupts | fork PID | exec PID NAME BURST | wait PID | exit PID | read PID FILE | write PID FILE TEXT | open PID FILE | close PID FILE | malloc PID KB | clear");
    case "ps":
      return same(state.processes.map((p) => `P${p.pid}  ${p.name.padEnd(15)} ${p.state.padEnd(11)} ${p.remaining}t`).join("\n") || "No processes");
    case "top": {
      const m = metrics(state);
      return same(`CPU ${m.cpu.toFixed(1)}% | RAM ${m.memory.toFixed(1)}% | active ${m.active} | ready ${m.ready} | blocked ${m.blocked}`);
    }
    case "kill":
    case "pause":
    case "resume":
    case "nice": {
      requirePid();
      const action = command === "kill" ? "terminate" : command === "nice" ? "priority" : command;
      const updated = changeProcess(state, pid, action, command === "nice" ? Number(args[1]) : undefined);
      return { state: updated, output: `P${pid}: ${action} applied` };
    }
    case "free":
    case "memory":
      return same(`${state.frameTable.filter(Boolean).length}/${state.frameTable.length} frames used | ${state.config.ramSize} KB RAM | ${state.diskPages.length} swapped pages`);
    case "scheduler":
      return same(`${state.config.scheduler} | quantum ${state.config.quantum} | ${state.contextSwitches} context switches`);
    case "resources":
    case "deadlock":
      return same(`${state.deadlocks} deadlock${state.deadlocks === 1 ? "" : "s"} detected by the current resource experiment`);
    case "pages":
      return same(state.frameTable.map((frame, i) => `F${i}:${frame ? `P${frame.pid}/page${frame.page}` : "free"}`).join(" "));
    case "interrupts":
      return same(state.events.filter((event) => event.eventType === "INTERRUPT").slice(-8).map((event) => `[${event.timestamp}] ${event.description}`).join("\n") || "No interrupts");
    case "fork":
    case "exec":
    case "wait":
    case "exit":
    case "read":
    case "write":
    case "open":
    case "close":
    case "malloc": {
      requirePid();
      const { state: updated, result } = systemCall(state, command as SystemCall, pid, args.slice(1).join(" "));
      return { state: updated, output: result };
    }
    default:
      return same(`Unknown command: ${command ?? ""}. Type help.`);
  }
}
