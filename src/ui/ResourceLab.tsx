import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useLab } from "../store";
import { bankers, detectDeadlock, resourceAction, type ResourceState } from "../core/resources";

const bankerExample = {
  allocation: [[0,1,0],[2,0,0],[3,0,2],[2,1,1],[0,0,2]],
  maximum: [[7,5,3],[3,2,2],[9,0,2],[2,2,2],[4,3,3]],
  available: [3,3,2],
};
const matrixText = (matrix: number[][]) => matrix.map((row) => row.join(" ")).join("; ");
const vectorText = (vector: number[]) => vector.join(" ");
const sameResource = (a: ResourceState, b: ResourceState) =>
  JSON.stringify(a.available) === JSON.stringify(b.available) &&
  JSON.stringify(a.allocation) === JSON.stringify(b.allocation) &&
  JSON.stringify(a.request) === JSON.stringify(b.request) &&
  JSON.stringify(a.pids) === JSON.stringify(b.pids);
function parseVector(value: string): number[] {
  const entries = value.trim().split(/[\s,]+/).map(Number);
  if (!entries.length || entries.some((n) => !Number.isInteger(n) || n < 0)) throw new Error("Use nonnegative integer resource counts.");
  return entries;
}
function parseMatrix(value: string): number[][] {
  const rows = value.trim().split(";").map(parseVector);
  if (!rows.length || rows.some((row) => row.length !== rows[0].length)) throw new Error("Every matrix row must have the same number of resources. Separate rows with semicolons.");
  return rows;
}
function ResourceGraph({ state, dead }: { state: ResourceState; dead: number[] }) {
  const n = state.allocation.length, m = state.available.length;
  const height = Math.max(260, Math.max(n, m) * 76 + 45);
  const processY = (i: number) => 42 + (i + 0.5) * ((height - 84) / n);
  const resourceY = (j: number) => 42 + (j + 0.5) * ((height - 84) / m);
  return <div className="dynamic-graph" aria-label="Resource allocation graph">
    <svg viewBox={`0 0 720 ${height}`} role="img" aria-label="Processes on the left, resources on the right. Blue arrows allocate instances; orange arrows show pending requests.">
      <defs><marker id="request-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#d98b35" /></marker><marker id="allocation-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#3577d4" /></marker></defs>
      {state.allocation.flatMap((row, i) => row.map((count, j) => count > 0 && <g key={`a-${i}-${j}`}><line x1="535" y1={resourceY(j)+4} x2="186" y2={processY(i)+4} stroke="#3577d4" strokeWidth="2" markerEnd="url(#allocation-arrow)" opacity=".75" /><text x="390" y={(resourceY(j)+processY(i))/2-4} fill="#3577d4" fontSize="12">{count}</text></g>))}
      {state.request.flatMap((row, i) => row.map((count, j) => count > 0 && <g key={`r-${i}-${j}`}><line x1="186" y1={processY(i)-4} x2="535" y2={resourceY(j)-4} stroke="#d98b35" strokeWidth="2" strokeDasharray="6 5" markerEnd="url(#request-arrow)" opacity=".9" /><text x="318" y={(resourceY(j)+processY(i))/2-10} fill="#b97023" fontSize="12">{count}</text></g>))}
      {state.allocation.map((_, i) => <g key={`p-${i}`}><circle cx="154" cy={processY(i)} r="28" fill={dead.includes(i)?"#fff0ed":"#f2f7ff"} stroke={dead.includes(i)?"#d34839":"#90b4e9"} strokeWidth="2" /><text x="154" y={processY(i)+5} textAnchor="middle" fill={dead.includes(i)?"#a52d20":"#244c86"} fontSize="14" fontWeight="700">P{state.pids?.[i] ?? i}</text></g>)}
      {state.available.map((available, j) => <g key={`v-${j}`}><rect x="535" y={resourceY(j)-28} width="78" height="56" rx="12" fill="#eef5ff" stroke="#91b4e9" strokeWidth="2" /><text x="574" y={resourceY(j)-1} textAnchor="middle" fill="#244c86" fontSize="14" fontWeight="700">R{j}</text><text x="574" y={resourceY(j)+15} textAnchor="middle" fill="#62748a" fontSize="10">{available} free</text></g>)}
    </svg>
    <div className="graph-legend"><span><i className="allocation-key" /> Allocation · resource to process</span><span><i className="request-key" /> Pending request · process to resource</span></div>
  </div>;
}

export default function ResourceLab() {
  const resourceState = useLab((s) => s.kernel.resourceState);
  const processes = useLab((s) => s.kernel.processes);
  const processIds = processes.map((p) => p.pid);
  const setResources = useLab((s) => s.setResources);
  const [allocation, setAllocation] = useState(() => matrixText(resourceState.allocation));
  const [request, setRequest] = useState(() => matrixText(resourceState.request));
  const [available, setAvailable] = useState(() => vectorText(resourceState.available));
  const lastApplied = useRef({ allocation, request, available });
  const [actionPid, setActionPid] = useState(0);
  const [actionResource, setActionResource] = useState(0);
  const [amount, setAmount] = useState(1);
  const [actionMessage, setActionMessage] = useState("Edit the matrices or issue a resource operation.");
  const [bankerAllocation, setBankerAllocation] = useState(matrixText(bankerExample.allocation));
  const [bankerMaximum, setBankerMaximum] = useState(matrixText(bankerExample.maximum));
  const [bankerAvailable, setBankerAvailable] = useState(vectorText(bankerExample.available));
  const detection = useMemo(() => {
    try {
      const rows = parseMatrix(allocation);
      if (rows.length > processIds.length) throw new Error("Add kernel processes before adding resource rows.");
      const pids = rows.length === resourceState.pids.length ? resourceState.pids : processIds.slice(0, rows.length);
      const state = { allocation: rows, request: parseMatrix(request), available: parseVector(available), pids };
      const dead = detectDeadlock(state);
      return { state, dead, error: "" };
    } catch (error) { return { state: null, dead: [] as number[], error: (error as Error).message }; }
  }, [allocation, request, available, processIds.join(","), resourceState.pids.join(",")]);
  const safety = useMemo(() => {
    try {
      const input = { allocation: parseMatrix(bankerAllocation), maximum: parseMatrix(bankerMaximum), available: parseVector(bankerAvailable) };
      return { result: bankers(input), input, error: "" };
    } catch (error) { return { result: null, input: null, error: (error as Error).message }; }
  }, [bankerAllocation, bankerMaximum, bankerAvailable]);
  useEffect(() => {
    const previous = lastApplied.current;
    if (allocation === previous.allocation && request === previous.request && available === previous.available) {
      const current = { allocation: matrixText(resourceState.allocation), request: matrixText(resourceState.request), available: vectorText(resourceState.available) };
      lastApplied.current = current;
      setAllocation(current.allocation); setRequest(current.request); setAvailable(current.available);
    }
  }, [resourceState]);
  useEffect(() => {
    if (detection.state && !sameResource(detection.state, resourceState)) {
      lastApplied.current = { allocation, request, available };
      setResources(detection.state);
    }
  }, [detection.state, resourceState, setResources]);
  const applyAction = (kind: "request" | "release") => {
    if (!detection.state) return;
    try {
      const next = resourceAction(detection.state, kind, actionPid, actionResource, amount);
      setAllocation(matrixText(next.allocation)); setRequest(matrixText(next.request)); setAvailable(vectorText(next.available));
      setActionMessage(kind === "release" ? `P${next.pids?.[actionPid] ?? actionPid} released ${amount} instance(s) of R${actionResource}.` : next.request[actionPid][actionResource] > detection.state.request[actionPid][actionResource] ? `P${next.pids?.[actionPid] ?? actionPid} is waiting for R${actionResource}.` : `P${next.pids?.[actionPid] ?? actionPid} acquired ${amount} instance(s) of R${actionResource}.`);
    } catch (error) { setActionMessage((error as Error).message); }
  };
  return <>
    <div className="page-title"><div><span className="kicker">RESOURCE MANAGEMENT</span><h1>Resource safety</h1><p>Change an allocation or request. The graph and detector update together.</p></div><span className={`badge ${detection.dead.length ? "danger" : "good"}`}>{detection.error ? "INVALID INPUT" : detection.dead.length ? "DEADLOCK DETECTED" : "NO DEADLOCK"}</span></div>
    <div className="two-col resources-layout">
      <section className="card"><div className="card-head"><div><h3>Resource allocation</h3><p>Each row is a process; each column is a resource type</p></div></div>
        {detection.state && <ResourceGraph state={detection.state} dead={detection.dead} />}
        {detection.error && <p className="error-text" role="alert">{detection.error}</p>}
        <div className="matrix-form"><label>Allocation matrix<textarea aria-label="Allocation matrix" value={allocation} onChange={(e) => setAllocation(e.target.value)} /></label><label>Pending requests<textarea aria-label="Request matrix" value={request} onChange={(e) => setRequest(e.target.value)} /></label><label>Available instances<input aria-label="Available resources" value={available} onChange={(e) => setAvailable(e.target.value)} /></label></div>
        <div className="resource-actions"><select aria-label="Resource process" value={actionPid} onChange={(e) => setActionPid(Number(e.target.value))}>{detection.state?.allocation.map((_, i) => <option value={i} key={i}>P{detection.state?.pids?.[i] ?? i}</option>)}</select><select aria-label="Resource type" value={actionResource} onChange={(e) => setActionResource(Number(e.target.value))}>{detection.state?.available.map((_, i) => <option value={i} key={i}>R{i}</option>)}</select><input aria-label="Resource instance count" type="number" min="1" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /><button disabled={!detection.state} onClick={() => applyAction("request")}>Request</button><button disabled={!detection.state} onClick={() => applyAction("release")}>Release</button></div>
        <p className="muted" role="status">{actionMessage}</p><div className={`result-box ${detection.dead.length ? "danger" : ""}`}>{detection.error ? "Correct the matrix input to run detection." : detection.dead.length ? `Deadlocked processes: ${detection.dead.map((i) => `P${detection.state?.pids?.[i] ?? i}`).join(", ")}` : "No deadlocked process holds resources."}</div>
      </section>
      <section className="card"><div className="card-head"><div><h3>Banker's safety test</h3><p>Edit all three inputs to explore safe and unsafe states</p></div></div>
        <div className="matrix-form"><label>Allocation matrix<textarea aria-label="Banker allocation matrix" value={bankerAllocation} onChange={(e) => setBankerAllocation(e.target.value)} /></label><label>Maximum matrix<textarea aria-label="Banker maximum matrix" value={bankerMaximum} onChange={(e) => setBankerMaximum(e.target.value)} /></label><label>Available vector<input aria-label="Banker available vector" value={bankerAvailable} onChange={(e) => setBankerAvailable(e.target.value)} /></label></div>
        {safety.error && <p className="error-text" role="alert">{safety.error}</p>}
        {safety.result && safety.input && <><div className="table-wrap"><table><thead><tr><th>PROCESS</th><th>ALLOCATION</th><th>MAXIMUM</th><th>NEED</th></tr></thead><tbody>{safety.input.allocation.map((row, i) => <tr key={i}><td>P{i}</td><td>{row.join(" · ")}</td><td>{safety.input!.maximum[i].join(" · ")}</td><td>{safety.result!.need[i].join(" · ")}</td></tr>)}</tbody></table></div><div className={`result-box ${safety.result.safe ? "" : "danger"}`}>{safety.result.safe ? "Safe state" : `Unsafe state · unfinished: ${safety.result.unfinished.map((i) => `P${i}`).join(", ")}`}</div><div className="safe-sequence">{safety.result.sequence.map((pid, i) => <span key={i}>P{pid}{i < safety.result!.sequence.length - 1 && <ChevronRight size={15} />}</span>)}</div></>}
        <p className="muted">Need = Maximum − Allocation. A sequence is safe when every process can finish with currently available resources plus those released by earlier processes.</p>
      </section>
    </div>
  </>;
}
