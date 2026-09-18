# Monitoring workspace

Issues #33–#41 implement and verify the shared inspection cursor and monitoring
composition. See the [acceptance record](MONITORING-ACCEPTANCE.md) for the offline
walkthrough, measured budgets, coverage and known limitations. The environment
uses recorded entity evidence; the four SystemOne summaries describe the global
assessment. The recorded decision path links to events, observable input, the
exact response and policy, and investigation history. These are application
records, not the model's internal reasoning.

## Opening a recording

The dashboard first honors `?run=<id>`. Without an explicit link it opens the
active run, then the newest saved run, then setup if the store is empty. An invalid
or missing linked recording displays an error and a recovery control; it does not
silently substitute another recording. Opening the page makes read requests and
connects to the run stream. It never starts generation or model evaluation.

The header distinguishes a live active run from saved offline playback. The
service checks and saved clock describe the current connection and recording;
the inspection strip shows the separate viewed checkpoint. Recorded playback
starts paused at zero on a fresh page. A live run that finishes keeps its current
inspection and its final playback position.

## Navigation

- **Monitor** returns to the three primary zones. Environment and judgment panels
  sit side by side on desktop, with the recorded decision path below. On narrow
  screens they stack and the path expands with an explicit button.
- **New run** opens explicit setup, including the existing inference opt-in and
  request budget. **Start run** returns to the monitor after saving the run.
- **Recordings & storage** retains pagination, storage accounting, and confirmed
  deletion. Selecting a recording updates the entire workspace.
- **Evaluation reports** retains saved evaluation results and their evidence links.
- The compact **Recording** selector switches among the loaded recording page;
  **Browse all recordings** opens the paginated browser for older recordings.
- **Pause simulation**, **Resume simulation**, and **Simulation speed** control
  the active server run. **Play recording**, **Pause playback**, and playback
  **Speed** affect only the client. Historical inspection does not pause either
  transport. Opening a historical link starts paused.
- **Simulation & details** opens **Simulation controls** on an active run: choose
  a scenario, begin/stop injection, reset, or open new-run setup. Scenario and
  injection status remain visible when collapsed. On a saved run it opens
  recording details, including explicit reset, manifest, command log, telemetry
  rerun, and fresh reevaluation. Reevaluation uses API credits.
- Investigation status and acknowledge/close actions appear below the graph.
  Historical inspection is read-only. Return to live, or to the end of playback,
  to act. Repeated matching judgments do not create duplicate cases; a matching
  judgment after closure reopens the same history. Cessation never closes it.

Selecting a judgment summary pins its applied assessment and opens the exact
inspector. The decision path buttons focus their corresponding detail sections.
The environment retains bounded entity lists and relationships in a scrollable
panel. The detailed inspectors remain below the primary composition and keep
their existing evidence, policy, and investigation controls.

## Judgment distributions

The four cards update from one successfully applied response. Noul displays its
returned probability. Classification and advisory response show every returned
choice probability and mark the selected choice. Severity retains the weighted
0–3 score and all four level probabilities. Expand **Definitions and comparison
details** for the recorded severity legend and confidence interpretation.
Confidence is shown only when returned; absent confidence remains unknown.

Changes compare against the previous successfully applied assessment in this
run. Snapshot age is the distance from that snapshot to the inspected cursor in
simulation seconds. Historical inspection and playback do not age values using
today's wall clock. Selecting an entity filters evidence while the cards continue
to describe the global environment.

Pending requests and retries retain the last applied batch. A failed attempt
labels the prior batch stale; without a prior success, all four values stay
unknown. Responses received during pause are labeled held until application.
**Inspect latest attempt** opens pending, failed or held attempt details. Each
card opens the exact applied request, response, timing, model and provenance in
the existing inspector. None of these actions request another evaluation.

## Searching and selecting evidence

**Recorded events** searches every eligible observation through the shared
cursor, including results beyond the displayed page. Search matches a literal,
case-insensitive substring within any recorded field value, including IDs,
timestamps and numeric values. Leading and trailing query spaces are ignored.
It does not match field names or interpret regular expressions.

Text, entity, event type, warm-up/live period and time filters combine. Both
time bounds are inclusive simulation seconds; negative values address warm-up
history. Empty bounds are unrestricted within the cursor. Reversed bounds show
an error and no matches. Each filter has its own clear action, and **Clear all
event filters** includes both warm-up and live activity. Results show matching
and eligible totals, retain sequence order, and render at most 50 result rows.

Select an event to see every recorded field and related entities. Selecting
supporting evidence in a topology, aggregate or focus view opens this same
detail. A selection outside the current filters stays inspectable with a clear
notice; **Show selected event in results** explicitly clears the filters.
An event or connection that does not exist at an earlier cursor is cleared with
a notice. It does not reappear as a selection on a later seek.

Selecting an identity, host or service shows its recorded profile and the
existing `entity-evidence/1` rule result. Host details include the newest eight
eligible CPU/memory samples with event links and recorded timestamps. A sample
is stale after more than 30 simulation seconds relative to the inspected cursor;
this is a display freshness threshold, not a model or connection judgment.
Missing samples stay unknown. Use the entity and host-metric filters to search
all older samples. No other host metric is inferred.

## Verification

The workspace browser tests use the real backend and SQLite for empty, linked,
active, newest-saved, invalid-link and secondary-navigation cases. A separate
case opens an isolated copy of the packaged real-response demonstration without
credentials or model-network access. It checks the desktop composition, narrow
layout, keyboard navigation, and zero model calls or mutation requests on entry
and inspection. The streaming inspection test covers held responses and
completion without resetting the historical selection.

The judgment/evidence tests exercise controlled responses through the real
evaluator, SQLite, HTTP and WebSocket paths into the browser. They cover complete
distributions, weighted severity, omitted confidence, retries, held responses,
failure retention, pinning and database reopen. Evidence cases use a 120-second
recording with more than 5,000 events, combined filters, exact time boundaries,
warm-up search, evidence navigation and sparse host samples. Existing browser
coverage retains the relationship, animation, seek and heap budgets and tests
legacy recordings and the packaged real-response demo. These deterministic
test responses do not measure model accuracy.

## Recorded decision graph

The compact path summarizes observations → snapshot → four judgments → policy →
investigation. **Expand decision path** reveals every output and every stored
condition, including the review fallback, unmatched conditions and unevaluable
inputs. All incident gates must match; advisory response is not a fifth incident
gate. The graph uses recorded expressions and policy version, so custom thresholds
and older policies retain their meaning.

Select a node for exact available questions, answers, comparisons and timing.
**Open full inspector** reaches its recorded detail. **Open recorded members**
clears entity/text/type restrictions and searches observations through the graph's
snapshot, including warm-up. Snapshot aggregates link their contributing members
in the existing evidence inspector. No graph interaction requests inference.

Received/held results are explicitly not applied and cannot claim a transition.
The transition node identifies the selected attempt's actual event, or says that
it caused none. It shows the most recent five history events; the investigation
panel retains the full ordered history and triggering-decision links. Legacy
application timing is identified as unavailable rather than reconstructed.

## Health and freshness

The top strip describes the current live run independently of historical
inspection, or the recorded end state for saved playback. The inspection strip
separately describes the assessment at the viewed cursor. Connection labels come
from the stream's Connected, Disconnected and Resynchronizing states; controls
remain disabled until synchronization succeeds. Saved playback explicitly has
no live transport.

Telemetry becomes quiet/stale after more than 30 **simulation seconds** without
an observation. Pausing or waiting for inference does not consume simulation time
or prove a broken connection. The browser's most recent telemetry receipt age is
in **wall seconds**, while request latency comes from the recorded wall-time
measurement. Missing latency is unknown. The expandable timing detail gives the
last applied success, its receipt timestamp and its simulation-time age.

Pending, retrying, received/held, applied success, failed/unavailable and
never-evaluated states are distinct. A failure retains the prior successful
judgment and labels it stale; it cannot turn unknown risk into zero risk.

## Exact inspection links

**Copy inspection link** copies a historical URL for the currently viewed
checkpoint, recording, selected decision and judgment card, selected entity and
event, and all event filters. A success message confirms copying. If clipboard
access fails, a selectable URL provides a manual fallback.

The view URL uses `view=1`, integer simulation milliseconds in `time`, stable
`run`, `decision`, `judgment`, `entity` and `event` references, plus `q`, `type`,
`period`, `from` and `through` filters. Optional `phase` preserves a pending or
received/held decision even if that attempt subsequently applies. Copied links
also include `boundary=1`, the latest `attempt` and `atPhase`, and the last included
`history` and `commands` sequence numbers. These preserve a pending or held view
even without a selected decision, and exclude later operator actions that happen
at the same simulation timestamp. No request or
event payloads or credentials are included. The destination still needs access
to the same recording; a copied link does not transfer a database.

The URL restores after refresh and browser back/forward navigation. Explicit
view changes add history entries; live ticks add none. Copying freezes the link's
cursor without changing the current transport or issuing a server command.
Existing `?run=…&decision=…` links still resolve to the decision's recorded
checkpoint. Return to live clears the historical cursor and decision selection.

A missing recording gives recovery to setup. Invalid checkpoints pin to zero
with a notice. Unavailable decisions or events are cleared explicitly; unknown
entity filters remain restrictive and show no future evidence. Invalid time
filters retain the existing validation error. A mismatched decision/cursor clears
the decision and retains the requested valid cursor. An inconsistent explicit
boundary pins to zero with a recovery notice.
