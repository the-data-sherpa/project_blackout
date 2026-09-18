# Monitoring dashboard acceptance

This record covers issues #37–#41 and their integration with the shared cursor,
four judgment summaries and evidence search from #33–#36. The
[operator guide](MONITORING-WORKSPACE.md) describes the controls and URL format;
[M9 packaging](M9-RELEASE.md#install-the-recorded-demonstration) describes installing
the offline archive into a fresh database without overwriting existing data.

## Offline operator rehearsal

Install `demo/blackout-demo.sqlite.gz` through `npm run demo:install` or the
isolated Compose instructions in M9. Open the saved credential-compromise run
from the compact Recording selector. Its header says recorded playback. Playback
starts paused; its controls operate the client clock. Leave `JEV_API_KEY` absent.

1. Seek to 0 seconds. Show the baseline events and the four recorded judgments.
2. Seek to 5 seconds, when injection begins. Inspect a suspicious entity's
   evidence, then the recorded decision path and exact policy comparisons.
3. Seek to 15 and 30 seconds. Open a judgment's full inspector, read its stored
   questions and response, and follow its triggering investigation transition.
4. Seek to 35 seconds, when injection stops, then 95 seconds. Show the actual
   decline and the still-open investigation. Cessation does not close it.
5. Pin an earlier decision, combine entity/text/type/time filters, select an event
   and copy its inspection link. Refresh and use browser back/forward; the cursor,
   selected evidence and assessment phase must remain fixed.
6. Return to playback and repeat with the baseline and benign-maintenance runs.
   These controls contain real judgment fluctuations as well as normal periods.

The browser rehearsal compares all four displayed values to the actual stored
response at 0, 5, 15, 30, 35 and 95 seconds for each of the three packaged runs.
It opens the stored `advisory-policy/2` comparisons and records model version,
attempt IDs and investigation transitions in the acceptance artifact. The server
has no model key. Opening, seeking, filtering and inspecting make no mutations
and no inference calls.

The archive's attack run does not immediately cross the incident gates. At
5 seconds it reports 67% compromise probability, suspicious classification and
1.72 severity. At 15 seconds, the 80% probability and compromise classification
still accompany severity 1.94, below the incident gate of 2. The investigation
opens at 20 seconds. At 30 seconds the values are 84%, compromise and 2.20;
at 95 seconds they are 43%, compromise and 1.87. The investigation remains open.
These are recorded outcomes, not forced detections or proof of remediation.

The baseline has suspicious/review judgments at 15 and 30 seconds, and the benign
control briefly reaches suspicious/review at 5 seconds. Neither opens an
investigation. The sample is three synthetic recordings from `jev-1.13.0`; it
does not establish real-traffic detection rates or calibrated confidence. Earlier
misses and latency measurements remain in the M9 evaluation reports.

## Integration and regression coverage

Controlled model responses in the integration tests are separate from the real
responses displayed in the offline rehearsal. They make the following edge cases
repeatable without spending API credits.

| Behavior                                                                                                              | Evidence                                                                             |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Begin/stop injection, simulation pause/speed, held receipt and application, acknowledge/close/reopen                  | `tests/e2e/dashboard.spec.ts`, server `controls` and `console` tests                 |
| Missing confidence, failed/unavailable evaluation, prior success retained as stale, no false transition               | `dashboard.spec.ts`, `monitoring-evidence.spec.ts`, evaluator/console tests          |
| Global assessment plus entity evidence, pinned history while live data arrives, Return to live                        | `inspection.spec.ts`, `monitoring-evidence.spec.ts`, `dashboard.spec.ts`             |
| Full URL restoration, filter combinations, invalid-link recovery, clipboard fallback and browser history              | `dashboard.spec.ts`, `inspection.spec.ts`                                            |
| Same-timestamp pending/held/application boundaries and later operator history                                         | server `console.test.ts`, held-link navigation in `dashboard.spec.ts`                |
| Initial run resolution, setup, recordings, reports, storage, legacy records, reconnect and idempotent control retries | `workspace.spec.ts`, `runs.spec.ts`, `cleanup.spec.ts`, server storage/release tests |
| Offline archive playback, desktop/narrow composition, keyboard navigation                                             | `workspace.spec.ts`, packaged release verification                                   |
| Large recording, retained relationship selection, focus visibility, reduced motion                                    | `m8.spec.ts`                                                                         |

Health distinguishes live stream state from the inspected checkpoint. A saved
recording has no live transport. The current live failure remains visible while
an earlier successful assessment is inspected. Telemetry freshness uses simulation
time; receipt age and measured request latency use wall time. Missing historical
latency remains unknown. An explicit burst of 129 queued stream messages forces
resynchronization before live controls become available again.

## Layout and accessibility

At 1440 × 1100, the environment and four judgment summaries share the first row;
the compact decision path is visible below them without scrolling. At 375 and
320 pixels the zones stack without page-wide horizontal overflow. The graph has
an explicit expansion button and keyboard-operable detail buttons. Expanded
stages scroll internally and all conditions remain available. Keyboard inspection
uses visible focus, semantic buttons and non-color status text. Reduced motion
removes relationship animation while retaining the evidence.

The [approved mock](https://github.com/the-data-sherpa/project_blackout/tree/0873f4b9ed969f9a98468b19c73f284dcad68237/apps/web/prototypes/monitoring-dashboard)
remains a separate design reference. Production retains its three-zone composition,
compact operator controls and progressive disclosure. It uses bounded evidence
lists instead of inventing geographic positions; four distributions and policy
nodes come from stored responses. The compact path expands on both desktop and
mobile to accommodate every condition and arbitrary recorded values. Deep raw
inspectors remain below the primary zones. Mock values and sample logic were not
promoted into the application.

## Performance budgets and reproducibility

Run from a clean checkout with the Node version in `mise.toml`:

```bash
npm ci
npm run check
npm run build
npx playwright install chromium
npm run test:e2e -- --workers=2
npm run test:release
```

The browser suite writes `test-results/monitoring-performance.json` and
`test-results/monitoring-offline-rehearsal.json`; packaged verification writes
`test-results/release-verification.json`. Preserve them before another browser
run replaces the results directory. Release verification uses its own Compose
project and volume, clears the model key, and removes only its own test storage.

| Budget                               | Acceptance threshold                 |
| ------------------------------------ | ------------------------------------ |
| Recording                            | 120 seconds, more than 5,000 events  |
| Event rows                           | At most 50                           |
| Relationships                        | 64, plus one retained selection      |
| Simultaneous relationship animations | At most 12; none with reduced motion |
| Stream queue                         | 128 entries, then resynchronize      |
| Seek to rendered evidence            | Less than 1,000 ms                   |
| Browser JS heap                      | Less than 128 MiB                    |

Measurements are local observations on the recorded browser and hardware, not
universal latency guarantees. The application loads the complete bounded recording;
longer or unbounded recordings remain outside the 120-second MVP contract. The
keyboard and narrow-layout checks are targeted regression coverage, not a complete
assistive-technology audit. Copied links require access to the same local database;
they do not transfer recordings. No fresh paid benchmark was run for this work.

## Review

Standards review found no documented-standard violations. It identified optional
consolidation of lifecycle labels and repeated recording-navigation URL cleanup;
these are maintainability suggestions, not release blockers.

Spec review identified historical-boundary and URL-restoration errors. Fixes
preserve receipt/application phase, command and history sequence cutoffs, the
current saved-playback cursor, and projected attempts when opening details. Graph
details between checkpoints now pin the assessment's checkpoint before generating
a URL. Follow-up review found no remaining material issue in these fixes.

## Final validation

Final clean-checkout results and measured artifacts are recorded here after the
complete suite and packaged rehearsal finish.
