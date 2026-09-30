export class Semaphore {
  private value: number;
  private waiting: number[] = [];
  constructor(value: number) {
    if (!Number.isInteger(value) || value < 0)
      throw new Error("Semaphore value must be nonnegative.");
    this.value = value;
  }
  wait(pid: number) {
    if (this.value > 0) {
      this.value--;
      return true;
    }
    if (!this.waiting.includes(pid)) this.waiting.push(pid);
    return false;
  }
  signal() {
    const pid = this.waiting.shift();
    if (pid === undefined) this.value++;
    return pid ?? null;
  }
  snapshot() {
    return { value: this.value, waiting: [...this.waiting] };
  }
}
export interface BufferState {
  capacity: number;
  items: number[];
  produced: number;
  consumed: number;
  message: string;
}
export function bufferAction(
  state: BufferState,
  action: "produce" | "consume",
): BufferState {
  if (!Number.isInteger(state.capacity) || state.capacity < 1 || state.items.length > state.capacity)
    throw new Error("Buffer capacity must be a positive integer.");
  if (action === "produce") {
    if (state.items.length >= state.capacity)
      return { ...state, message: "PRODUCER BLOCKED · buffer full" };
    return {
      ...state,
      items: [...state.items, state.produced + 1],
      produced: state.produced + 1,
      message: "Producer acquired mutex and inserted an item.",
    };
  }
  if (!state.items.length)
    return { ...state, message: "CONSUMER BLOCKED · buffer empty" };
  return {
    ...state,
    items: state.items.slice(1),
    consumed: state.consumed + 1,
    message: "Consumer acquired mutex and removed an item.",
  };
}
export interface ReaderWriterState {
  readers: number[];
  writer: number | null;
  waitingReaders: number[];
  waitingWriters: number[];
  preference: "reader" | "writer";
  nextId: number;
  message: string;
}
export function createReaderWriter(preference: "reader" | "writer" = "reader"): ReaderWriterState {
  return { readers: [], writer: null, waitingReaders: [], waitingWriters: [], preference, nextId: 1, message: "Shared database is idle." };
}
export function readerWriterAction(state: ReaderWriterState, action: "request-read" | "request-write" | "release-reader" | "release-writer" | "preference", preference?: "reader" | "writer"): ReaderWriterState {
  const next: ReaderWriterState = { ...state, readers: [...state.readers], waitingReaders: [...state.waitingReaders], waitingWriters: [...state.waitingWriters] };
  if (action === "preference") {
    if (!preference) throw new Error("Select reader or writer preference.");
    next.preference = preference;
    next.message = `${preference} preference selected.`;
  } else if (action === "request-read") {
    const id = next.nextId++;
    if (next.writer === null && (next.preference === "reader" || next.waitingWriters.length === 0)) {
      next.readers.push(id);
      next.message = `Reader ${id} entered the shared critical section.`;
    } else {
      next.waitingReaders.push(id);
      next.message = `Reader ${id} queued for the database.`;
    }
  } else if (action === "request-write") {
    const id = next.nextId++;
    if (next.writer === null && next.readers.length === 0) {
      next.writer = id;
      next.message = `Writer ${id} acquired exclusive access.`;
    } else {
      next.waitingWriters.push(id);
      next.message = `Writer ${id} queued for exclusive access.`;
    }
  } else if (action === "release-reader") {
    if (!next.readers.length) return { ...next, message: "No reader holds the database." };
    next.message = `Reader ${next.readers.shift()} released the database.`;
  } else {
    if (next.writer === null) return { ...next, message: "No writer holds the database." };
    next.message = `Writer ${next.writer} released the database.`;
    next.writer = null;
  }
  if (next.writer === null && next.readers.length === 0) {
    if (next.preference === "writer" && next.waitingWriters.length) next.writer = next.waitingWriters.shift()!;
    else if (next.waitingReaders.length) next.readers.push(...next.waitingReaders.splice(0));
    else if (next.waitingWriters.length) next.writer = next.waitingWriters.shift()!;
  }
  return next;
}
export function readerWriter(
  readers: number,
  writer: boolean,
  request: "read" | "write",
  preference: "reader" | "writer",
  waitingWriters: number,
) {
  if (request === "write")
    return {
      granted: readers === 0 && !writer,
      reason: readers
        ? "Readers hold the shared database."
        : writer
          ? "Writer holds the database."
          : "Exclusive writer lock acquired.",
    };
  return {
    granted: !writer && (preference === "reader" || waitingWriters === 0),
    reason: writer
      ? "Writer holds the database."
      : preference === "writer" && waitingWriters > 0
        ? "Writer preference queues new readers."
        : "Shared read lock acquired.",
  };
}
export function philosophers(
  mode: "naive" | "ordered" | "semaphore",
  hungry: number[],
) {
  if (hungry.some((p) => !Number.isInteger(p) || p < 0 || p >= 5)) throw new Error("Philosopher IDs must be 0 through 4.");
  const forkOwners: (number | null)[] = Array(5).fill(null);
  const eating: number[] = [];
  const waiting: number[] = [];
  const contenders = [...new Set(hungry)];
  if (mode === "naive") {
    // Everyone grabs the left fork before attempting the right fork.
    for (const p of contenders) if (forkOwners[p] === null) forkOwners[p] = p;
    for (const p of contenders) {
      const right = (p + 1) % 5;
      if (forkOwners[p] === p && forkOwners[right] === null) { forkOwners[right] = p; eating.push(p); }
      else waiting.push(p);
    }
  } else {
    // Ordered forks and the four-seat semaphore both prevent circular wait.
    for (const p of mode === "semaphore" ? contenders.slice(0, 4) : contenders) {
      const left = p, right = (p + 1) % 5;
      if (forkOwners[left] === null && forkOwners[right] === null) { forkOwners[left] = p; forkOwners[right] = p; eating.push(p); }
      else waiting.push(p);
    }
    if (mode === "semaphore") waiting.push(...contenders.slice(4));
  }
  return { eating, waiting, deadlocked: waiting.length > 0 && eating.length === 0 && contenders.length === 5 && mode === "naive", forks: forkOwners.map((owner) => owner !== null), forkOwners };
}
