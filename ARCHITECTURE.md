# SmartOS Lab architecture

## System and component hierarchy

`App` owns navigation, playback, and the selected process. It renders `Dashboard`, `SchedulingLab`, `MemoryLab`, `ResourceLab`, `SynchronizationLab`, `Analytics`, and `About`. A Zustand store owns the current `Kernel` snapshot and immutable experiment configuration. React components invoke store actions and render snapshots; algorithms never depend on React.

## Data model

`ProcessSpec` is the experiment input: PID, name, arrival, burst, priority, memory size, optional I/O requests, and parent. `PCB` adds state, remaining CPU, program counter, registers, allocated frames, resource holdings, open files, timing metrics, and queue metadata. `KernelState` contains time, PCBs, CPU, ready/wait queues, memory, devices, the simulated file table, resource state, events, and per-tick history. `KernelEvent` has a monotonic ID, timestamp, type, optional PID, description, and payload.

## Event architecture

One call to `stepKernel` advances exactly one simulated time unit. At a time boundary it admits arrivals, grants available resource requests, completes due I/O (including pending simulated file reads and writes), chooses or preempts a process, executes one CPU unit, performs any resulting I/O/page fault/termination transition, and appends structured events. A periodic UI timer calls that same pure function. It cannot move time while paused. Interrupts and system calls are explicit kernel events. A fixed seed drives chaos events.

## Modules and algorithms

`src/core/scheduler.ts`: FCFS, SJF, SRTF, preemptive/nonpreemptive priority, RR, multilevel queue, MLFQ; deterministic arrival/PID ties. `src/core/kernel.ts`: state transitions, clock, interrupt and I/O dispatch, metrics. `src/core/memory.ts`: contiguous first/best/worst/next fit, paging, address translation, FIFO/LRU/Optimal/Clock replacement. `src/core/resources.ts`: multi-instance deadlock detection and Banker's safety algorithm. `src/core/sync.ts`: bounded buffer, readers/writers, philosophers, semaphores. `src/core/analysis.ts`: metric-derived health, anomalies, recommendations. `src/core/scenarios.ts`: repeatable demo workloads.

## Implementation milestones

1. Scaffold, strict data models, event-driven kernel, state store, dashboard.
2. Scheduling algorithms, live clock, timeline, comparison, tests.
3. Allocation, paging, replacement, virtual memory demonstrations.
4. Deadlock graph, resource requests, Banker's algorithm.
5. Synchronization demonstrations and tests.
6. Interrupts, I/O, system calls, terminal.
7. Analytics, scenarios, chaos, exports, presentation mode, documentation and verification.

## Simulation rules

All durations are integer simulation ticks. Arrival and completion events at time `t` are processed before scheduling tick `t`. A CPU tick covers `[t,t+1)`. Completion time is `t+1`. Lower numeric priority means higher priority. Every scheduling tie uses arrival then PID. Quantum expiration places the running process at the tail of its queue after the tick. Context switches count only changes between two non-idle PIDs; an idle dispatch is logged separately. Waiting time is completion minus arrival minus CPU burst minus total I/O service time; response is first dispatch minus arrival. The model uses zero context-switch time and one CPU. These choices are visible in the UI and README.
