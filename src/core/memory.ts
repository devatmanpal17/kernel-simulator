export type Fit = "FIRST" | "BEST" | "WORST" | "NEXT";
export interface Block {
  start: number;
  size: number;
  pid: number | null;
}
export function allocate(
  blocks: Block[],
  pid: number,
  size: number,
  fit: Fit,
  cursor = 0,
): { blocks: Block[]; cursor: number; start: number | null } {
  if (!Number.isInteger(pid) || pid < 1) throw new Error("PID must be a positive integer.");
  if (!Number.isInteger(size) || size <= 0)
    throw new Error("Memory request must be a positive integer.");
  if (!Number.isInteger(cursor) || cursor < 0) throw new Error("Next-fit cursor must be nonnegative.");
  if (!blocks.length || blocks.some((b, i) => !Number.isInteger(b.start) || b.start < 0 || !Number.isInteger(b.size) || b.size < 1 || (i > 0 && blocks[i - 1].start + blocks[i - 1].size !== b.start)))
    throw new Error("Memory blocks must form a contiguous, nonempty address range.");
  if (blocks.some((b) => b.pid === pid))
    throw new Error("PID already has an allocation.");
  const candidates = blocks
    .map((b, i) => ({ ...b, i }))
    .filter((b) => b.pid === null && b.size >= size);
  if (!candidates.length) return { blocks, cursor, start: null };
  const totalEnd = blocks.at(-1)!.start + blocks.at(-1)!.size;
  const nextPosition = (b: Block) => cursor >= b.start && cursor < b.start + b.size && b.start + b.size - cursor >= size ? cursor : b.start;
  const chosen =
    fit === "BEST"
      ? [...candidates].sort((a, b) => a.size - b.size || a.start - b.start)[0]
      : fit === "WORST"
        ? [...candidates].sort(
            (a, b) => b.size - a.size || a.start - b.start,
          )[0]
        : fit === "NEXT"
          ? [...candidates].sort((a, b) => {
              const aPosition = nextPosition(a);
              const bPosition = nextPosition(b);
              const aDistance = (aPosition >= cursor ? aPosition : aPosition + totalEnd) - cursor;
              const bDistance = (bPosition >= cursor ? bPosition : bPosition + totalEnd) - cursor;
              return aDistance - bDistance;
            })[0]
          : candidates[0];
  const start = fit === "NEXT" ? nextPosition(chosen) : chosen.start;
  const copy = [...blocks];
  copy.splice(
    chosen.i,
    1,
    ...(start > chosen.start ? [{ start: chosen.start, size: start - chosen.start, pid: null }] : []),
    { start, size, pid },
    ...(chosen.start + chosen.size > start + size
      ? [{ start: start + size, size: chosen.start + chosen.size - start - size, pid: null }]
      : []),
  );
  return { blocks: copy, cursor: start + size, start };
}
export function release(blocks: Block[], pid: number): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    const next = { ...b, pid: b.pid === pid ? null : b.pid };
    const last = out.at(-1);
    if (last && last.pid === null && next.pid === null) last.size += next.size;
    else out.push(next);
  }
  return out;
}
export function fragmentation(blocks: Block[], request = 0) {
  const free = blocks.filter((b) => b.pid === null);
  const total = free.reduce((s, b) => s + b.size, 0);
  return {
    totalFree: total,
    largestHole: Math.max(0, ...free.map((b) => b.size)),
    external:
      request > 0 && total >= request && !free.some((b) => b.size >= request)
        ? total
        : total - Math.max(0, ...free.map((b) => b.size)),
    internal: 0,
  };
}
export function translate(
  virtualAddress: number,
  pageSize: number,
  pageTable: Record<number, number>,
  ramSize: number,
) {
  if (
    !Number.isInteger(virtualAddress) ||
    virtualAddress < 0 ||
    !Number.isInteger(pageSize) ||
    pageSize <= 0
  )
    throw new Error("Address and page size must be valid integers.");
  const page = Math.floor(virtualAddress / pageSize),
    offset = virtualAddress % pageSize,
    frame = pageTable[page];
  if (frame === undefined)
    return { page, offset, frame: null, physical: null, fault: true };
  const physical = frame * pageSize + offset;
  if (physical >= ramSize) throw new Error("Frame is outside RAM.");
  return { page, offset, frame, physical, fault: false };
}
export type Replacement = "FIFO" | "LRU" | "OPTIMAL" | "CLOCK";
export interface PageStep {
  reference: number;
  frames: (number | null)[];
  hit: boolean;
  evicted: number | null;
}
export function replacePages(
  references: number[],
  frameCount: number,
  algorithm: Replacement,
): PageStep[] {
  if (!Number.isInteger(frameCount) || frameCount <= 0)
    throw new Error("Frame count must be positive.");
  if (references.some((r) => !Number.isInteger(r) || r < 0))
    throw new Error("Page references must be nonnegative integers.");
  const frames: (number | null)[] = Array(frameCount).fill(null),
    last = new Map<number, number>(),
    arrival = new Map<number, number>(),
    bits = Array(frameCount).fill(0);
  let hand = 0;
  return references.map((ref, i) => {
    let slot = frames.indexOf(ref);
    const hit = slot >= 0;
    let evicted: number | null = null;
    if (hit) {
      last.set(ref, i);
      bits[slot] = 1;
    } else {
      slot = frames.indexOf(null);
      if (slot < 0) {
        if (algorithm === "FIFO")
          slot = frames.reduce<number>(
            (best, p, j) =>
              arrival.get(p!)! < arrival.get(frames[best]!)! ? j : best,
            0,
          );
        else if (algorithm === "LRU")
          slot = frames.reduce<number>(
            (best, p, j) =>
              last.get(p!)! < last.get(frames[best]!)! ? j : best,
            0,
          );
        else if (algorithm === "OPTIMAL") {
          const future = (p: number | null) => {
            const found = references.indexOf(p!, i + 1);
            return found < 0 ? Infinity : found;
          };
          slot = frames.reduce<number>(
            (best, p, j) => (future(p) > future(frames[best]) ? j : best),
            0,
          );
        } else {
          while (bits[hand]) {
            bits[hand] = 0;
            hand = (hand + 1) % frameCount;
          }
          slot = hand;
          hand = (hand + 1) % frameCount;
        }
      }
      evicted = frames[slot];
      frames[slot] = ref;
      arrival.set(ref, i);
      last.set(ref, i);
      bits[slot] = 1;
    }
    return { reference: ref, frames: [...frames], hit, evicted };
  });
}
