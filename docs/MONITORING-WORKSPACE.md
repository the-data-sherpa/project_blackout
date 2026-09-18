# Monitoring workspace

Issues [#33](https://github.com/the-data-sherpa/project_blackout/issues/33) and
[#34](https://github.com/the-data-sherpa/project_blackout/issues/34) establish the
shared inspection cursor and the approved monitoring composition. The environment
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
- **Simulation & details** opens the existing simulation controls, manifest,
  command log, telemetry rerun, and fresh reevaluation tools. Rerun and
  reevaluation remain explicit actions; reevaluation still uses API credits.

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

Detailed graph interactions, compact operator controls, richer health semantics,
and complete shareable inspection state remain separate tickets (#37–#40).
