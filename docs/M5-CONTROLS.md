# M5: interactive controls and timing

Milestone 5 adds operator controls and reconnect recovery to the recorded
simulation. Scheduled fixtures remain available for the M3 and M4 evaluation
suites. Interactive runs begin with baseline traffic; scenario metadata never
enters Jev's observable input.

## Walkthrough

1. Select **Interactive mode**, enter a seed and duration, and choose whether to
   evaluate with Jev. Select **Start run**. Interactive mode defaults to 95 seconds.
2. Under **Simulation controls**, choose **Credential compromise** or **Benign
   maintenance**. Choose **Begin Attack** or **Begin Control**. The first injected
   observations arrive on the next simulation tick. Each sequence lasts 30
   simulation seconds unless stopped sooner or the run reaches its duration.
3. Choose **Pause**. Generation, window expiry, snapshot age and the live decision
   display freeze. Snapshot and Decision Inspector selections remain available.
   Jev's in-flight request and bounded retries can finish while paused. The saved
   attempt records its response arrival; it does not enter the live display yet.
4. Choose **Resume** to apply held results at the frozen simulation time and
   continue. The inspector distinguishes **Response received** from **Applied to
   live display**, including the application simulation time.
5. Choose **Stop Attack** or **Stop Control**, including while paused. The command
   ends injection. Existing evidence remains in its windows and baseline traffic
   continues after resume. Stopping does not imply containment or remediation.
6. Choose a requested speed: **0.25×**, **0.5×**, **1×**, **2×**, or **5×**. The
   console shows average achieved progress since run start, including pauses and
   inference waits. **Waiting for Jev** means the simulation is holding its
   checkpoint. It never skips evaluation to meet a speed request.
7. Choose **Reset run**. A new run uses the same seed, duration and mode, with
   speed 1× and no operator-triggered injection. An active previous run becomes
   **Interrupted** with reason `reset`; a finished recording retains its terminal
   status and end time. Both recordings remain available in **Stored runs**.
   Resetting a saved recording is available when no other run is active.

Scheduled fixtures also support pause, resume, speed and reset. Their full
scenarios support an early Stop. Small M3 fixtures retain their fixed injection
schedule. Evaluation reports accept scheduled runs; operator-defined timing in
interactive runs does not belong to the fixed M3/M4 benchmark cohorts.

## Disconnection and uncertain commands

Generation belongs to the backend, so a closed browser does not stop it. The
console displays **Disconnected** and then **Resynchronizing**, retrying with a
bounded delay of 0.5–5 seconds. It loads a saved recording and a fresh WebSocket
snapshot before enabling live controls. Pause, speed, pending inference, held
responses and last-decision age survive reconnect.

Duplicate or older updates are ignored. A missing revision, missing event,
missing command, invalid payload or unexpected run ID causes resynchronization.
If another browser resets the run during disconnection, the old recording stays
selected and **View active run** opens the replacement. Reconnection does not
replay controls.

If the acknowledgement for a command is lost, **Retry unconfirmed command**
sends the same command ID. The backend returns its recorded result without
applying the action again. A rejected transition explains why it could not run.

Backend restart retains the existing rule: unfinished runs become Interrupted;
generation does not resume automatically. Saved controls remain inspectable.

## API and recording contract

`POST /api/runs` accepts `interactive: true` with fixture `baseline` and an
optional UUID `commandId`. Repeating an identical start with that ID returns the
same run. Interactive manifests pin `interactiveScenarioVersion: scenarios/1`.

Send controls to `POST /api/runs/:id/commands`:

```json
{ "commandId": "550e8400-e29b-41d4-a716-446655440000", "type": "pause" }
```

Supported types are `pause`, `resume`, `reset`, `stop-injection`,
`begin-injection` (requires `fixture`: `credential-compromise` or
`benign-maintenance`), and `set-speed` (requires `speed`: 0.25, 0.5, 1, 2 or 5).
The response is the current saved recording, or the replacement recording for
reset. Accepted commands record their ordered sequence, simulation time, wall
arrival time and request. Reusing an ID for a different request or run returns
HTTP 409. Invalid fields return 400; storage failure returns 503. A stale run ID
cannot control a different active run.

`run.controls` persists pause, requested speed, inference waiting state, held
application state, injection state, the frozen live attempt and elapsed wall
time. Pause is a control state on the single active `running` recording, rather
than a second active status. `run.revision` orders every committed update,
including inference and controls that share an event sequence or simulation time.
Legacy recordings read with revision zero and without the new control fields.

Attempts retain `completedAt` as response/failure arrival time. `appliedAt` and
`appliedSimulationTimeMs` are null until application. Both are absent in legacy
attempts. Resume commits held applications and its command together. Reset saves
the old terminal record, reset command and replacement recording in one SQLite
transaction; a failed replacement rolls the operation back. Old evaluator tasks
keep their original run and snapshot identity, including cancellation failures.

The scheduler checks wall time every 25 ms and advances a single simulation tick
when due. Speed changes set the next due time. Pauses and inference waits do not
accumulate a catch-up backlog. Timeouts and retries continue to use wall time.
Checkpoint positions remain 0, 5, 10, … seconds and the terminal snapshot with
default evaluator settings.

The browser batches rendering at 50 ms and limits queued messages to 128 before
resynchronizing. The server disconnects clients whose outbound buffer exceeds
the initial recording transfer plus 1 MiB. Neither browser rendering nor socket
backpressure advances or stops the authoritative simulation clock.

## Validation

`apps/server/test/controls.test.ts` exercises late success, paused timeout,
terminal checkpoint pause, resume rollback, reset rollback, pending-inference
reset, repeated commands, stale IDs, restart, automatic scenario cessation,
benign restart, early stop and retained window evidence. Cross-speed checks
compare complete ordered telemetry, snapshot inputs and checkpoint positions
across all five requested speeds. A delayed transport verifies that 5× does not
skip checkpoints or burst after a wait.

Transport checks cover authoritative reconnect snapshots, missing, duplicate and
out-of-order messages, wrong-run messages, and bounded server backpressure. The
browser flow covers keyboard pause, stop during pause, speed restoration after
reload, a lost acknowledgement, a missing update, and reset during disconnection,
including the 375-pixel viewport.

These checks validate application timing and recording integrity. They do not
measure new Jev detection performance; the existing M3/M4 reports remain the
model evidence.
