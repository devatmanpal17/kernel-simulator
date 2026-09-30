import { useEffect, useState } from "react";
import { useLab } from "../store";
import { bufferAction, createReaderWriter, philosophers, readerWriterAction, type BufferState } from "../core/sync";

export default function SynchronizationLab() {
  const scenarioIndex = useLab((s) => s.scenarioIndex);
  const [buffer, setBuffer] = useState<BufferState>({ capacity: 5, items: [], produced: 0, consumed: 0, message: "Buffer initialized." });
  const [auto, setAuto] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [nextAuto, setNextAuto] = useState<"produce" | "consume">("produce");
  const [rw, setRw] = useState(createReaderWriter);
  const [hungry, setHungry] = useState<number[]>(scenarioIndex === 8 ? [0,1,2,3,4] : []);
  const [mode, setMode] = useState<"naive" | "ordered" | "semaphore">(scenarioIndex === 8 ? "naive" : "ordered");
  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => {
      setBuffer((current) => bufferAction(current, nextAuto));
      setNextAuto((current) => current === "produce" ? "consume" : "produce");
    }, Math.max(120, 900 / speed));
    return () => window.clearInterval(timer);
  }, [auto, speed, nextAuto]);
  const table = philosophers(mode, hungry);
  return <>
    <div className="page-title"><div><span className="kicker">CONCURRENCY LAB</span><h1>Synchronization</h1><p>Watch locks, queues, and resource ownership change after each action.</p></div></div>
    <div className="two-col">
      <section className="card"><div className="card-head"><div><h3>Producer & consumer</h3><p>Bounded buffer with atomic semaphore transitions</p></div></div>
        <div className="buffer">{Array.from({ length: buffer.capacity }, (_, i) => <div className={buffer.items[i] !== undefined ? "occupied" : ""} key={i}>{buffer.items[i] ?? "—"}</div>)}</div>
        <div className="metric-row"><span>empty<b>{buffer.capacity - buffer.items.length}</b></span><span>full<b>{buffer.items.length}</b></span><span>mutex<b>1</b></span><span>Produced / consumed<b>{buffer.produced} / {buffer.consumed}</b></span></div>
        <div className="button-row"><button className="primary small" onClick={() => setBuffer(bufferAction(buffer, "produce"))}>Produce item</button><button onClick={() => setBuffer(bufferAction(buffer, "consume"))}>Consume item</button><button onClick={() => setAuto(!auto)}>{auto ? "Pause auto" : "Run auto"}</button><label>Speed<select aria-label="Buffer speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{[0.5,1,2,5].map((value) => <option key={value} value={value}>{value}×</option>)}</select></label></div>
        <p className="muted" role="status">{buffer.message}</p>
      </section>
      <section className="card"><div className="card-head"><div><h3>Reader & writer</h3><p>Concurrent readers, one exclusive writer, and a real waiting queue</p></div></div>
        <div className="inline-form"><label>Policy<select aria-label="Reader writer preference" value={rw.preference} onChange={(e) => setRw(readerWriterAction(rw, "preference", e.target.value as "reader" | "writer"))}><option value="reader">Reader preference</option><option value="writer">Writer preference</option></select></label></div>
        <div className="rw-lanes"><div><small>ACTIVE READERS</small><strong>{rw.readers.length ? rw.readers.map((id) => `R${id}`).join("  ") : "None"}</strong></div><div><small>ACTIVE WRITER</small><strong>{rw.writer === null ? "None" : `W${rw.writer}`}</strong></div><div><small>WAITING READERS</small><strong>{rw.waitingReaders.length ? rw.waitingReaders.map((id) => `R${id}`).join("  ") : "None"}</strong></div><div><small>WAITING WRITERS</small><strong>{rw.waitingWriters.length ? rw.waitingWriters.map((id) => `W${id}`).join("  ") : "None"}</strong></div></div>
        <div className="button-row"><button onClick={() => setRw(readerWriterAction(rw, "request-read"))}>Request read</button><button onClick={() => setRw(readerWriterAction(rw, "request-write"))}>Request write</button><button onClick={() => setRw(readerWriterAction(rw, "release-reader"))}>Release reader</button><button onClick={() => setRw(readerWriterAction(rw, "release-writer"))}>Release writer</button></div><p className="muted" role="status">{rw.message}</p>
      </section>
    </div>
    <section className="card"><div className="card-head"><div><h3>Dining philosophers</h3><p>Five philosophers, five forks, three acquisition policies</p></div></div>
      <div className="inline-form"><label>Policy<select aria-label="Philosopher policy" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="naive">Left fork first · may deadlock</option><option value="ordered">Atomic ordered acquisition</option><option value="semaphore">Four-seat semaphore</option></select></label><button onClick={() => setHungry([0,1,2,3,4])}>All hungry</button><button onClick={() => setHungry([])}>Clear table</button></div>
      <div className="philosopher-row">{Array.from({ length: 5 }, (_, i) => <button key={i} className={`philosopher ${table.eating.includes(i) ? "eating" : hungry.includes(i) ? "hungry" : ""}`} onClick={() => setHungry(hungry.includes(i) ? hungry.filter((x) => x !== i) : [...hungry, i])}>P{i}<small>{table.eating.includes(i) ? "EATING" : hungry.includes(i) ? "WAITING" : "THINKING"}</small></button>)}</div>
      <div className="fork-status">{table.forkOwners.map((owner, i) => <span key={i}>Fork {i}: <b>{owner === null ? "free" : `P${owner}`}</b></span>)}</div>
      <div className={`result-box ${table.deadlocked ? "danger" : ""}`}>{table.deadlocked ? "Deadlock: every philosopher holds a left fork and waits for a right fork." : `Eating: ${table.eating.map((id) => `P${id}`).join(", ") || "none"}. Waiting: ${table.waiting.map((id) => `P${id}`).join(", ") || "none"}.`}</div>
    </section>
  </>;
}
