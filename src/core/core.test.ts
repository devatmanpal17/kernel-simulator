import { describe, it, expect } from "vitest";
import { compareSchedule } from "./scheduler";
import {
  makePCB,
  createKernel,
  stepKernel,
  defaultConfig,
  requestIO,
  restoreKernel,
  systemCall,
  changeProcess,
  updateResources,
} from "./kernel";
import { allocate, release, replacePages, translate } from "./memory";
import { bankers, detectDeadlock, resourceAction } from "./resources";
import { Semaphore, bufferAction, philosophers, readerWriter, createReaderWriter, readerWriterAction } from "./sync";
import { executeCommand } from "./terminal";
import type { ProcessSpec } from "./types";
const input: ProcessSpec[] = [
  { pid: 1, name: "A", arrival: 0, burst: 5, priority: 2, memory: 8 },
  { pid: 2, name: "B", arrival: 1, burst: 3, priority: 1, memory: 8 },
  { pid: 3, name: "C", arrival: 2, burst: 1, priority: 0, memory: 8 },
];
const run = (name: Parameters<typeof compareSchedule>[1], q = 2) =>
  compareSchedule(input.map(makePCB), name, q);
describe("CPU scheduling textbook workload", () => {
  it("FCFS handles arrivals and computes waiting, turnaround and response", () => {
    const x = run("FCFS");
    expect(x.completion).toEqual({ 1: 5, 2: 8, 3: 9 });
    expect(x.waiting).toEqual({ 1: 0, 2: 4, 3: 6 });
    expect(x.turnaround).toEqual({ 1: 5, 2: 7, 3: 7 });
    expect(x.response).toEqual({ 1: 0, 2: 4, 3: 6 });
  });
  it("SJF is nonpreemptive", () => {
    const x = run("SJF");
    expect(x.completion).toEqual({ 1: 5, 2: 9, 3: 6 });
    expect(x.waiting).toEqual({ 1: 0, 2: 5, 3: 3 });
  });
  it("SRTF preempts for shorter remaining work", () => {
    const x = run("SRTF");
    expect(x.completion).toEqual({ 1: 9, 2: 5, 3: 3 });
    expect(x.waiting).toEqual({ 1: 4, 2: 1, 3: 0 });
  });
  it("priority can be preemptive or nonpreemptive", () => {
    expect(run("PRIORITY").completion).toEqual({ 1: 5, 2: 9, 3: 6 });
    expect(run("PRIORITY_PREEMPTIVE").completion).toEqual({ 1: 9, 2: 5, 3: 3 });
  });
  it("Round Robin respects quantum and arrival order", () => {
    const x = run("RR");
    expect(x.completion).toEqual({ 1: 9, 2: 8, 3: 7 });
    expect(x.waiting).toEqual({ 1: 4, 2: 4, 3: 4 });
    expect(x.response).toEqual({ 1: 0, 2: 1, 3: 4 });
  });
  it("idle CPU is represented in Gantt trace", () => {
    const x = compareSchedule(
      [makePCB({ ...input[0], arrival: 3 })],
      "FCFS",
      2,
    );
    expect(x.timeline.slice(0, 3)).toEqual([null, null, null]);
    expect(x.utilization).toBeCloseTo(62.5);
  });
  it("rejects invalid quantum", () => expect(() => run("RR", 0)).toThrow());
});
describe("memory algorithms", () => {
  const holes = [
    { start: 0, size: 10, pid: null },
    { start: 10, size: 8, pid: 9 },
    { start: 18, size: 30, pid: null },
    { start: 48, size: 8, pid: 8 },
    { start: 56, size: 20, pid: null },
  ];
  it("first, best and worst fit choose the documented hole", () => {
    expect(allocate(holes, 1, 9, "FIRST").start).toBe(0);
    expect(allocate(holes, 1, 9, "BEST").start).toBe(0);
    expect(allocate(holes, 1, 9, "WORST").start).toBe(18);
    expect(allocate(holes, 1, 9, "NEXT", 30).start).toBe(30);
    expect(allocate(holes, 1, 9, "NEXT", 30).blocks).toContainEqual({ start: 18, size: 12, pid: null });
  });
  it("release coalesces adjacent holes", () => {
    const b = allocate(holes, 1, 9, "FIRST").blocks;
    expect(release(b, 1)[0]).toEqual({ start: 0, size: 10, pid: null });
  });
  it("replacement distinguishes FIFO from recency and future knowledge", () => {
    const refs = [1, 2, 3, 1, 4, 1];
    expect(replacePages(refs, 3, "FIFO").filter((x) => !x.hit)).toHaveLength(5);
    expect(replacePages(refs, 3, "LRU").filter((x) => !x.hit)).toHaveLength(4);
    expect(replacePages(refs, 3, "OPTIMAL").filter((x) => !x.hit)).toHaveLength(
      4,
    );
    expect(replacePages(refs, 3, "CLOCK")).toHaveLength(6);
  });
  it("translates page and offset, reporting faults", () => {
    expect(translate(21, 8, { 2: 3 }, 64)).toEqual({
      page: 2,
      offset: 5,
      frame: 3,
      physical: 29,
      fault: false,
    });
    expect(translate(21, 8, {}, 64).fault).toBe(true);
  });
});
describe("resources and synchronization", () => {
  it("Banker returns a safe sequence for the standard example", () => {
    const x = bankers({
      allocation: [
        [0, 1, 0],
        [2, 0, 0],
        [3, 0, 2],
        [2, 1, 1],
        [0, 0, 2],
      ],
      maximum: [
        [7, 5, 3],
        [3, 2, 2],
        [9, 0, 2],
        [2, 2, 2],
        [4, 3, 3],
      ],
      available: [3, 3, 2],
    });
    expect(x.safe).toBe(true);
    expect(x.sequence).toEqual([1, 3, 4, 0, 2]);
    expect(x.need[0]).toEqual([7, 4, 3]);
  });
  it("detects a multi-process cycle", () => {
    expect(
      detectDeadlock({
        available: [0, 0],
        allocation: [
          [1, 0],
          [0, 1],
        ],
        request: [
          [0, 1],
          [1, 0],
        ],
      }),
    ).toEqual([0, 1]);
    expect(
      detectDeadlock({
        available: [1, 0],
        allocation: [
          [1, 0],
          [0, 1],
        ],
        request: [
          [0, 1],
          [1, 0],
        ],
      }),
    ).toEqual([]);
  });
  it("resource operations update availability and pending requests", () => {
    const initial = { available: [0], allocation: [[1], [0]], request: [[0], [0]] };
    const queued = resourceAction(initial, "request", 1, 0, 1);
    expect(queued.request[1][0]).toBe(1);
    const released = resourceAction(queued, "release", 0, 0, 1);
    expect(released.available[0]).toBe(0);
    expect(released.allocation[1][0]).toBe(1);
    expect(released.request[1][0]).toBe(0);
    expect(detectDeadlock(released)).toEqual([]);
  });
  it("semaphore queues and wakes one waiter", () => {
    const sem = new Semaphore(1);
    expect(sem.wait(1)).toBe(true);
    expect(sem.wait(2)).toBe(false);
    expect(sem.signal()).toBe(2);
    expect(sem.snapshot().value).toBe(0);
  });
  it("bounded buffer blocks at capacity", () => {
    const a = bufferAction(
      { capacity: 1, items: [], produced: 0, consumed: 0, message: "" },
      "produce",
    );
    expect(a.items).toEqual([1]);
    expect(bufferAction(a, "produce").message).toContain("BLOCKED");
    expect(bufferAction(a, "consume").items).toEqual([]);
  });
  it("reader-writer exclusion and philosopher deadlock", () => {
    expect(readerWriter(1, false, "write", "reader", 0).granted).toBe(false);
    expect(readerWriter(2, false, "read", "reader", 0).granted).toBe(true);
    expect(philosophers("naive", [0, 1, 2, 3, 4]).deadlocked).toBe(true);
    expect(philosophers("ordered", [0, 1, 2, 3, 4]).deadlocked).toBe(false);
  });
  it("waiting writer receives the lock after readers release it", () => {
    let state = createReaderWriter("writer");
    state = readerWriterAction(state, "request-read");
    state = readerWriterAction(state, "request-write");
    state = readerWriterAction(state, "request-read");
    expect(state.waitingReaders).toHaveLength(1);
    state = readerWriterAction(state, "release-reader");
    expect(state.writer).toBe(2);
    state = readerWriterAction(state, "release-writer");
    expect(state.readers).toEqual([3]);
  });
});
describe("shared kernel", () => {
  it("one step advances exactly one unit and page fault completes through disk", () => {
    let s = createKernel([input[0]], defaultConfig);
    s = stepKernel(s);
    expect(s.time).toBe(1);
    expect(s.pageFaults).toBe(1);
    expect(s.processes[0].state).toBe("WAITING");
    s = stepKernel(s);
    s = stepKernel(s);
    expect(s.processes[0].allocatedPages).toEqual([0]);
    expect(s.events.some((e) => e.eventType === "IO_COMPLETE")).toBe(true);
  });
  it("explicit I/O blocks and later readies process", () => {
    let s = createKernel([input[0]]);
    s = stepKernel(s);
    s = stepKernel(s);
    s = stepKernel(s);
    s = requestIO(s, 1, "DISK", 2);
    expect(s.processes[0].state).toBe("WAITING");
    s = stepKernel(s);
    s = stepKernel(s);
    s = stepKernel(s);
    expect(s.events.some((e) => e.eventType === "IO_COMPLETE")).toBe(true);
  });
  it("fork, wait, and exit change PCBs and wake the parent", () => {
    let state = createKernel([input[0]]);
    const forked = systemCall(state, "fork", 1);
    state = forked.state;
    expect(state.processes[1].parent).toBe(1);
    expect(forked.result).toContain("child P2");
    state = systemCall(state, "wait", 1).state;
    expect(state.processes[0].state).toBe("WAITING");
    state = systemCall(state, "exit", 2).state;
    state = stepKernel(state);
    expect(state.processes[0].waitingForChild).toBe(false);
    expect(state.events.some((event) => event.eventType === "PROCESS_READY" && event.description.includes("child exited"))).toBe(true);
  });
  it("exec, open, close, malloc, and disk calls change actual state", () => {
    let state = createKernel([input[0]]);
    state = systemCall(state, "open", 1, "notes.txt").state;
    expect(state.processes[0].openFiles).toEqual(["notes.txt"]);
    state = systemCall(state, "close", 1, "notes.txt").state;
    expect(state.processes[0].openFiles).toEqual([]);
    state = systemCall(state, "malloc", 1, "8").state;
    expect(state.processes[0].memory).toBe(16);
    state = systemCall(state, "exec", 1, "worker 4").state;
    expect(state.processes[0].name).toBe("worker");
    expect(state.processes[0].remaining).toBe(4);
    state = systemCall(state, "open", 1, "notes.txt").state;
    state = systemCall(state, "write", 1, "notes.txt hello-world").state;
    expect(state.processes[0].state).toBe("WAITING");
    expect(() => systemCall(state, "read", 1, "missing.txt")).toThrow();
    state = stepKernel(stepKernel(stepKernel(state)));
    expect(state.fileSystem["notes.txt"]).toBe("hello-world");
    while (state.processes[0].state === "WAITING") state = stepKernel(state);
    state = systemCall(state, "read", 1, "notes.txt").state;
    state = stepKernel(stepKernel(stepKernel(state)));
    expect(state.processes[0].lastRead).toBe("hello-world");
  });
  it("terminal commands use the same kernel actions", () => {
    let state = createKernel([input[0]]);
    const response = executeCommand(state, "fork 1");
    state = response.state;
    expect(response.output).toContain("child P2");
    expect(state.processes).toHaveLength(2);
    state = executeCommand(state, "nice 1 0").state;
    expect(state.processes[0].priority).toBe(0);
    expect(() => executeCommand(state, "nice 1 -1")).toThrow();
  });
  it("saved snapshots restore the exact simulation tick and events", () => {
    const original = stepKernel(createKernel([input[0]]));
    const restored = restoreKernel(JSON.parse(JSON.stringify(original)), [input[0]], defaultConfig);
    expect(restored.time).toBe(1);
    expect(restored.events).toEqual(original.events);
    expect(stepKernel(restored).time).toBe(2);
  });
  it("termination frees occupied frames and paused I/O can resume", () => {
    let state = createKernel([input[0]]);
    for (let i = 0; i < 3; i++) state = stepKernel(state);
    expect(state.frameTable.filter(Boolean).length).toBeGreaterThan(0);
    state = requestIO(state, 1, "DISK", 2);
    state = changeProcess(state, 1, "pause");
    state = changeProcess(state, 1, "resume");
    expect(state.processes[0].state).toBe("WAITING");
    state = changeProcess(state, 1, "terminate");
    expect(state.frameTable.filter(Boolean)).toHaveLength(0);
  });
  it("resource deadlock blocks real PCBs and resolves after a resource becomes available", () => {
    let state = createKernel(input.slice(0, 2));
    state = updateResources(state, { available: [0, 0], allocation: [[1, 0], [0, 1]], request: [[0, 1], [1, 0]], pids: [1, 2] });
    expect(state.deadlocks).toBe(1);
    expect(state.processes[0].resources).toEqual({ R0: 1 });
    state = stepKernel(state);
    expect(state.processes[0].state).toBe("WAITING");
    state = updateResources(state, { ...state.resourceState, available: [1, 0] });
    state = stepKernel(state);
    expect(state.deadlocks).toBe(0);
    expect(state.processes[1].resourceWait).toBe(false);
    expect(state.events.some((event) => event.eventType === "RESOURCE_ALLOCATED")).toBe(true);
  });
  it("releasing a process returns held resource instances", () => {
    let state = createKernel(input.slice(0, 2));
    state = updateResources(state, { available: [0], allocation: [[1], [0]], request: [[0], [1]], pids: [1, 2] });
    state = changeProcess(state, 1, "terminate");
    expect(state.resourceState.allocation[1][0]).toBe(1);
    expect(state.resourceState.request[1][0]).toBe(0);
  });
});
