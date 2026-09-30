export interface BankerInput {
  allocation: number[][];
  maximum: number[][];
  available: number[];
}
export function bankers(input: BankerInput) {
  const { allocation, maximum, available } = input;
  const n = allocation.length,
    m = available.length;
  if (
    maximum.length !== n ||
    !available.every((x) => Number.isInteger(x) && x >= 0) ||
    allocation.some(
      (r, i) =>
        r.length !== m ||
        maximum[i].length !== m ||
        r.some(
          (x, j) =>
            !Number.isInteger(x) ||
            x < 0 ||
            !Number.isInteger(maximum[i][j]) ||
            maximum[i][j] < x,
        ),
    )
  )
    throw new Error("Invalid allocation, maximum, or available matrix.");
  const need = allocation.map((row, i) => row.map((x, j) => maximum[i][j] - x));
  const work = [...available],
    done = Array(n).fill(false),
    sequence: number[] = [];
  for (let pass = 0; pass < n; pass++) {
    let found = false;
    for (let i = 0; i < n; i++)
      if (!done[i] && need[i].every((x, j) => x <= work[j])) {
        done[i] = true;
        sequence.push(i);
        allocation[i].forEach((x, j) => (work[j] += x));
        found = true;
      }
    if (!found) break;
  }
  return {
    safe: sequence.length === n,
    sequence,
    need,
    unfinished: done.map((x, i) => (x ? -1 : i)).filter((x) => x >= 0),
  };
}
export interface ResourceState {
  available: number[];
  allocation: number[][];
  request: number[][];
  pids?: number[];
}
export function detectDeadlock(state: ResourceState) {
  const { available, allocation, request } = state,
    n = allocation.length,
    m = available.length;
  if (
    request.length !== n ||
    allocation.some((r, i) => r.length !== m || request[i].length !== m) ||
    [...available, ...allocation.flat(), ...request.flat()].some(
      (x) => !Number.isInteger(x) || x < 0,
    )
  )
    throw new Error("Invalid resource state.");
  const work = [...available],
    finish = allocation.map((r) => r.every((x) => x === 0));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < n; i++)
      if (!finish[i] && request[i].every((x, j) => x <= work[j])) {
        finish[i] = true;
        allocation[i].forEach((x, j) => (work[j] += x));
        changed = true;
      }
  }
  return finish.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
}
export function resourceAction(state: ResourceState, action: "request" | "release", pid: number, resource: number, amount: number): ResourceState {
  detectDeadlock(state);
  if (!Number.isInteger(pid) || pid < 0 || pid >= state.allocation.length ||
      !Number.isInteger(resource) || resource < 0 || resource >= state.available.length ||
      !Number.isInteger(amount) || amount < 1)
    throw new Error("Select a valid process, resource, and positive instance count.");
  const next: ResourceState = {
    available: [...state.available],
    allocation: state.allocation.map((row) => [...row]),
    request: state.request.map((row) => [...row]),
    pids: state.pids ? [...state.pids] : undefined,
  };
  if (action === "release") {
    if (next.allocation[pid][resource] < amount) throw new Error("Process does not hold that many instances.");
    next.allocation[pid][resource] -= amount;
    next.available[resource] += amount;
  } else if (next.available[resource] >= amount) {
    next.available[resource] -= amount;
    next.allocation[pid][resource] += amount;
  } else {
    next.request[pid][resource] += amount;
  }
  return action === "release" ? fulfillAvailableRequests(next) : next;
}
export function fulfillAvailableRequests(state: ResourceState): ResourceState {
  detectDeadlock(state);
  const next: ResourceState = {
    available: [...state.available],
    allocation: state.allocation.map((row) => [...row]),
    request: state.request.map((row) => [...row]),
    pids: state.pids ? [...state.pids] : undefined,
  };
  // Grant complete requests in process row order when all required instances exist.
  for (let i = 0; i < next.request.length; i++) {
    const pending = next.request[i];
    if (pending.some((count) => count > 0) && pending.every((count, j) => count <= next.available[j])) {
      pending.forEach((count, j) => { next.available[j] -= count; next.allocation[i][j] += count; pending[j] = 0; });
    }
  }
  return next;
}
