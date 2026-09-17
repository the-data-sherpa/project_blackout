# M8 — Evidence topology and complete console

M8 implements [#25](https://github.com/the-data-sherpa/project_blackout/issues/25), [#26](https://github.com/the-data-sherpa/project_blackout/issues/26), [#27](https://github.com/the-data-sherpa/project_blackout/issues/27) and [#28](https://github.com/the-data-sherpa/project_blackout/issues/28).

## Observable topology

The console derives users, workstations, servers, services and their relationships from the versioned organization and recorded observable events. Authentication, DNS and network observations create selectable links with bounded supporting sequence references. Scenario stages and truth records are not inputs. The current global Jev assessment appears in a separate panel and never colors an entity.

The graph renders every organization entity and the 64 most recently observed relationships. If an older relationship is selected, it remains as one additional rendered item until the selection changes. Each displayed relationship keeps at most 12 recent event references; the complete events remain in the recording. At most 12 recent relationships animate, only while live simulation or recorded playback is moving. Reduced-motion preferences disable the animation.

## Entity evidence rule

`entity-evidence/1` uses the open/closed 30-second window `(cursor - 30 s, cursor]`.

For each identity, the rule assigns three points to each unfamiliar device, location or resource and one point to each authentication failure. A score of four or more is **Suspicious evidence**. A lower score with recent activity is **Normal evidence**. No recent activity is **No recent evidence**.

A host or service is suspicious only when a supporting observation links it to an identity that currently meets the same rule. Every result shows the rule version, boundary, explanation and supporting event sequences. Window expiry can remove a highlight without changing the investigation status.

## Live and recorded selection

Entity, relationship and event selection share one state in `RunInspection`. Selecting topology evidence selects the matching row in the bounded event table. The selected applied Jev decision pins its own observable snapshot. Playback builds topology from the cursor-projected recording, so seeking backward cannot expose future links, evidence, decisions or investigation actions. An event or decision selection clears when a later cursor change makes it invalid; entity selection remains while the versioned entity still exists.

## Sustained-load budgets

The browser scenario uses a complete 120-second `credential-compromise` recording containing 5,240 observable events. On the documented development workstation, Chromium measured:

| Budget                                 |                                                            Limit |                                Observed |
| -------------------------------------- | ---------------------------------------------------------------: | --------------------------------------: |
| Relationship elements                  |                              64, plus one retained selected link |                                      64 |
| Concurrent relationship animations     |                                                               12 | 0 while paused; at most 12 while moving |
| Event rows in the DOM                  |                                                               50 |                                      50 |
| WebSocket update queue                 | 128 messages, then reconnect and authoritative resynchronization |               bounded by implementation |
| Seek-to-render latency                 |                                               less than 1,000 ms |                                137.5 ms |
| JavaScript heap after full-length seek |                                                less than 128 MiB |                                44.7 MiB |

These are local software budgets, not hardware-independent performance guarantees. Complete telemetry remains in SQLite and in the loaded recording while rendered history and animation work stay bounded.

## Validation

Unit checks cover the score boundary, strict evidence-window expiry, supporting host/service references, future relationship exclusion and immunity to truth-shaped metadata. Playback checks cover cursor reconstruction and late decision application. The browser scenario exercises keyboard node selection, correlated event inspection, backward selection clearing, highlight expiry, every playback speed, DOM bounds, heap use and 1,280-, 375- and 320-pixel layouts. Existing console scenarios cover waiting, paused, disconnected, resynchronizing, stale command and recorded states.
