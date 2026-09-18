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

## Verification

The workspace browser tests use the real backend and SQLite for empty, linked,
active, newest-saved, invalid-link and secondary-navigation cases. A separate
case opens an isolated copy of the packaged real-response demonstration without
credentials or model-network access. It checks the desktop composition, narrow
layout, keyboard navigation, and zero model calls or mutation requests on entry
and inspection. The streaming inspection test covers held responses and
completion without resetting the historical selection.

Distribution visualizations, expanded search, detailed graph interactions,
compact operator controls, richer health semantics, and complete shareable
inspection state remain separate tickets (#35–#40).
