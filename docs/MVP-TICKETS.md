# BLACKOUT MVP — GitHub tickets

Approved breakdown: 31 tickets across M1–M9, published with the `ready-for-agent` label.
The ticket bodies contain acceptance criteria and blocking references. Native GitHub dependencies represent the same blocking edges.

[All milestones](https://github.com/the-data-sherpa/project_blackout/milestones) · [Ready-for-agent issues](https://github.com/the-data-sherpa/project_blackout/issues?q=is%3Aissue%20is%3Aopen%20label%3Aready-for-agent)

## Working order

M1–M7 are implemented. Continue with [#25 — Explore observed relationships in a live topology](https://github.com/the-data-sherpa/project_blackout/issues/25).
The [M7 playback guide](M7-PLAYBACK.md) records seek measurements and linked reevaluation evidence.
The [M4 evaluation guide](M4-SCENARIOS.md) records real-API results and unmet targets; the [M3 evaluation guide](JEV-EVALUATION.md) preserves earlier results, misses and input revisions.
Work any ticket whose blocking issues are all complete. A readiness label describes specification readiness; dependencies determine when work can start.
Milestones are completion checkpoints rather than blanket barriers to independent tickets. All tickets and their acceptance criteria are required for full MVP delivery.

## Milestones

| Milestone | Tickets |
| --- | --- |
| [M1 — Deterministic run foundation](https://github.com/the-data-sherpa/project_blackout/milestone/1) | [#1](https://github.com/the-data-sherpa/project_blackout/issues/1), [#2](https://github.com/the-data-sherpa/project_blackout/issues/2) |
| [M2 — Observable telemetry and state](https://github.com/the-data-sherpa/project_blackout/milestone/2) | [#3](https://github.com/the-data-sherpa/project_blackout/issues/3), [#4](https://github.com/the-data-sherpa/project_blackout/issues/4), [#5](https://github.com/the-data-sherpa/project_blackout/issues/5), [#6](https://github.com/the-data-sherpa/project_blackout/issues/6) |
| [M3 — First end-to-end Jev slice](https://github.com/the-data-sherpa/project_blackout/milestone/3) | [#7](https://github.com/the-data-sherpa/project_blackout/issues/7), [#8](https://github.com/the-data-sherpa/project_blackout/issues/8), [#9](https://github.com/the-data-sherpa/project_blackout/issues/9), [#10](https://github.com/the-data-sherpa/project_blackout/issues/10) |
| [M4 — Flagship scenario and evaluation](https://github.com/the-data-sherpa/project_blackout/milestone/4) | [#11](https://github.com/the-data-sherpa/project_blackout/issues/11), [#12](https://github.com/the-data-sherpa/project_blackout/issues/12), [#13](https://github.com/the-data-sherpa/project_blackout/issues/13), [#14](https://github.com/the-data-sherpa/project_blackout/issues/14) |
| [M5 — Interactive controls and timing](https://github.com/the-data-sherpa/project_blackout/milestone/5) | [#15](https://github.com/the-data-sherpa/project_blackout/issues/15), [#16](https://github.com/the-data-sherpa/project_blackout/issues/16), [#17](https://github.com/the-data-sherpa/project_blackout/issues/17), [#18](https://github.com/the-data-sherpa/project_blackout/issues/18) |
| [M6 — Decision console and incident lifecycle](https://github.com/the-data-sherpa/project_blackout/milestone/6) | [#19](https://github.com/the-data-sherpa/project_blackout/issues/19), [#20](https://github.com/the-data-sherpa/project_blackout/issues/20) |
| [M7 — Playback, seeking and reevaluation](https://github.com/the-data-sherpa/project_blackout/milestone/7) | [#21](https://github.com/the-data-sherpa/project_blackout/issues/21), [#22](https://github.com/the-data-sherpa/project_blackout/issues/22), [#23](https://github.com/the-data-sherpa/project_blackout/issues/23), [#24](https://github.com/the-data-sherpa/project_blackout/issues/24) |
| [M8 — Topology and complete console](https://github.com/the-data-sherpa/project_blackout/milestone/8) | [#25](https://github.com/the-data-sherpa/project_blackout/issues/25), [#26](https://github.com/the-data-sherpa/project_blackout/issues/26), [#27](https://github.com/the-data-sherpa/project_blackout/issues/27), [#28](https://github.com/the-data-sherpa/project_blackout/issues/28) |
| [M9 — Full MVP release readiness](https://github.com/the-data-sherpa/project_blackout/milestone/9) | [#29](https://github.com/the-data-sherpa/project_blackout/issues/29), [#30](https://github.com/the-data-sherpa/project_blackout/issues/30), [#31](https://github.com/the-data-sherpa/project_blackout/issues/31) |

## Ticket index

1. **[[M1] Start and inspect a recorded seeded run](https://github.com/the-data-sherpa/project_blackout/issues/1)**
   - **Blocked by:** None
   - **Delivers:** Open BLACKOUT, start one local run from a seed, and watch a minimal deterministic authentication stream that can be inspected from its persisted recording.

2. **[[M1] Recover recordings after a backend restart](https://github.com/the-data-sherpa/project_blackout/issues/2)**
   - **Blocked by:** [#1](https://github.com/the-data-sherpa/project_blackout/issues/1)
   - **Delivers:** Restart the backend and reopen a prior run with its original manifest, events and accurate completion or interruption status.

3. **[[M2] Inspect a synthetic organization and its baseline history](https://github.com/the-data-sherpa/project_blackout/issues/3)**
   - **Blocked by:** [#1](https://github.com/the-data-sherpa/project_blackout/issues/1)
   - **Delivers:** Start a populated synthetic organization and inspect normal authentication against each identity’s generated history before visible simulation time zero.

4. **[[M2] Observe host, DNS and network telemetry](https://github.com/the-data-sherpa/project_blackout/issues/4)**
   - **Blocked by:** [#3](https://github.com/the-data-sherpa/project_blackout/issues/3)
   - **Delivers:** Watch recorded host metrics, DNS lookups and network connections alongside authentication from the same organization.

5. **[[M2] Trace rolling state back to its evidence](https://github.com/the-data-sherpa/project_blackout/issues/5)**
   - **Blocked by:** [#4](https://github.com/the-data-sherpa/project_blackout/issues/4)
   - **Delivers:** Inspect the current observable state, choose a metric or focus identity, and see the recorded events and window that explain it.

6. **[[M2] Compare attack and harmless fixtures without truth leakage](https://github.com/the-data-sherpa/project_blackout/issues/6)**
   - **Blocked by:** [#5](https://github.com/the-data-sherpa/project_blackout/issues/5)
   - **Delivers:** Select a minimal credential-attack fixture or harmless anomaly fixture and inspect how its telemetry changes the observable state.

7. **[[M3] Inspect one real Jev evaluation](https://github.com/the-data-sherpa/project_blackout/issues/7)**
   - **Blocked by:** [#6](https://github.com/the-data-sherpa/project_blackout/issues/6)
   - **Delivers:** Evaluate an observable snapshot with Jev and open a basic Decision Inspector showing exactly what was sent and returned.

8. **[[M3] Inspect deterministic policy consequences](https://github.com/the-data-sherpa/project_blackout/issues/8)**
   - **Blocked by:** [#7](https://github.com/the-data-sherpa/project_blackout/issues/7)
   - **Delivers:** Open a Jev decision and see which versioned policy rules matched and which advisory result the application produced.

9. **[[M3] Evaluate continuously with visible failure and staleness](https://github.com/the-data-sherpa/project_blackout/issues/9)**
   - **Blocked by:** [#7](https://github.com/the-data-sherpa/project_blackout/issues/7)
   - **Delivers:** Watch live decisions at fixed simulation-time checkpoints and see when inference is waiting, stale, failed or unavailable.

10. **[[M3] Measure the first end-to-end model slice](https://github.com/the-data-sherpa/project_blackout/issues/10)**
   - **Blocked by:** [#8](https://github.com/the-data-sherpa/project_blackout/issues/8), [#9](https://github.com/the-data-sherpa/project_blackout/issues/9)
   - **Delivers:** Run baseline, attack and harmless fixtures across several seeds and inspect a saved report linking every measured outcome to its run and decisions.

11. **[[M4] Run the credential-compromise sequence](https://github.com/the-data-sherpa/project_blackout/issues/11)**
   - **Blocked by:** [#7](https://github.com/the-data-sherpa/project_blackout/issues/7)
   - **Delivers:** Launch a declarative sequence from weak authentication signals through unusual successful login and abnormal resource access, then inspect Jev’s actual response.

12. **[[M4] Extend compromise through discovery and lateral movement](https://github.com/the-data-sherpa/project_blackout/issues/12)**
   - **Blocked by:** [#11](https://github.com/the-data-sherpa/project_blackout/issues/11)
   - **Delivers:** Continue a compromised identity’s activity through discovery and second-host access, with all resulting telemetry and decisions inspectable.

13. **[[M4] Run a credible benign anomaly control](https://github.com/the-data-sherpa/project_blackout/issues/13)**
   - **Blocked by:** [#7](https://github.com/the-data-sherpa/project_blackout/issues/7)
   - **Delivers:** Select legitimate unusual activity and observe whether Jev distinguishes it from compromise using only available evidence.

14. **[[M4] Evaluate the flagship, benign control and activity decline](https://github.com/the-data-sherpa/project_blackout/issues/14)**
   - **Blocked by:** [#10](https://github.com/the-data-sherpa/project_blackout/issues/10), [#12](https://github.com/the-data-sherpa/project_blackout/issues/12), [#13](https://github.com/the-data-sherpa/project_blackout/issues/13)
   - **Delivers:** Review a repeatable model-performance report comparing the complete attack, benign control and baseline, including behavior after injection stops.

15. **[[M5] Pause and resume while inference is in flight](https://github.com/the-data-sherpa/project_blackout/issues/15)**
   - **Blocked by:** [#9](https://github.com/the-data-sherpa/project_blackout/issues/9)
   - **Delivers:** Pause the simulation at any point, inspect existing evidence, and resume without allowing late inference to move the frozen live display.

16. **[[M5] Start, stop and reset an interactive attack run](https://github.com/the-data-sherpa/project_blackout/issues/16)**
   - **Blocked by:** [#2](https://github.com/the-data-sherpa/project_blackout/issues/2), [#11](https://github.com/the-data-sherpa/project_blackout/issues/11), [#15](https://github.com/the-data-sherpa/project_blackout/issues/15)
   - **Delivers:** Use normal mode, scenario selection, Begin Attack, Stop Attack and Reset while retaining prior evidence and continuing baseline traffic as appropriate.

17. **[[M5] Change speed without skipping evaluation checkpoints](https://github.com/the-data-sherpa/project_blackout/issues/17)**
   - **Blocked by:** [#15](https://github.com/the-data-sherpa/project_blackout/issues/15)
   - **Delivers:** Choose 0.25×, 0.5×, 1×, 2× or 5× and see requested speed, actual progress and inference waits honestly.

18. **[[M5] Reconnect the console without losing run state](https://github.com/the-data-sherpa/project_blackout/issues/18)**
   - **Blocked by:** [#16](https://github.com/the-data-sherpa/project_blackout/issues/16), [#17](https://github.com/the-data-sherpa/project_blackout/issues/17)
   - **Delivers:** Disconnect and reopen the browser, then resume observing the authoritative run without duplicate events or replayed control actions.

19. **[[M6] Explore the decision timeline and filtered event evidence](https://github.com/the-data-sherpa/project_blackout/issues/19)**
   - **Blocked by:** [#8](https://github.com/the-data-sherpa/project_blackout/issues/8), [#9](https://github.com/the-data-sherpa/project_blackout/issues/9)
   - **Delivers:** Filter telemetry, follow the threat timeline and select any decision to inspect its exact evidence and policy result.

20. **[[M6] Track an investigation separately from activity risk](https://github.com/the-data-sherpa/project_blackout/issues/20)**
   - **Blocked by:** [#14](https://github.com/the-data-sherpa/project_blackout/issues/14), [#16](https://github.com/the-data-sherpa/project_blackout/issues/16), [#19](https://github.com/the-data-sherpa/project_blackout/issues/19)
   - **Delivers:** Observe policy-driven investigation status, acknowledge or close an investigation, and keep its history distinct from Jev’s changing risk assessment.

21. **[[M7] Play a saved run without live inference](https://github.com/the-data-sherpa/project_blackout/issues/21)**
   - **Blocked by:** [#20](https://github.com/the-data-sherpa/project_blackout/issues/20)
   - **Delivers:** Open a saved run in explicitly labeled recorded playback and watch stored telemetry, decisions, policies and investigation actions without an API key or internet.

22. **[[M7] Seek through a recording without future-state leakage](https://github.com/the-data-sherpa/project_blackout/issues/22)**
   - **Blocked by:** [#21](https://github.com/the-data-sherpa/project_blackout/issues/21)
   - **Delivers:** Scrub the recording timeline or jump ±10 seconds and inspect exactly what was known and displayed at that point.

23. **[[M7] Rerun deterministic telemetry from a saved manifest](https://github.com/the-data-sherpa/project_blackout/issues/23)**
   - **Blocked by:** [#12](https://github.com/the-data-sherpa/project_blackout/issues/12), [#16](https://github.com/the-data-sherpa/project_blackout/issues/16)
   - **Delivers:** Choose a saved run and recreate its synthetic telemetry using the same versioned inputs and operator command schedule.

24. **[[M7] Reevaluate recorded snapshots with fresh Jev decisions](https://github.com/the-data-sherpa/project_blackout/issues/24)**
   - **Blocked by:** [#21](https://github.com/the-data-sherpa/project_blackout/issues/21)
   - **Delivers:** Send an existing run’s observable snapshots through Jev again and inspect a separate linked set of new decisions.

25. **[[M8] Explore observed relationships in a live topology](https://github.com/the-data-sherpa/project_blackout/issues/25)**
   - **Blocked by:** [#19](https://github.com/the-data-sherpa/project_blackout/issues/19)
   - **Delivers:** See users, workstations, servers and services connected by observed activity and select a relationship to inspect its evidence.

26. **[[M8] Explain suspicious entity highlighting](https://github.com/the-data-sherpa/project_blackout/issues/26)**
   - **Blocked by:** [#25](https://github.com/the-data-sherpa/project_blackout/issues/25)
   - **Delivers:** Select a highlighted host or identity and see the explicit evidence rule and observations that justify its status.

27. **[[M8] Keep topology and inspection synchronized in playback](https://github.com/the-data-sherpa/project_blackout/issues/27)**
   - **Blocked by:** [#22](https://github.com/the-data-sherpa/project_blackout/issues/22), [#26](https://github.com/the-data-sherpa/project_blackout/issues/26)
   - **Delivers:** Seek a recording, select an entity and inspect its events and decisions with every view anchored to the same recorded moment.

28. **[[M8] Keep the complete console usable under sustained load](https://github.com/the-data-sherpa/project_blackout/issues/28)**
   - **Blocked by:** [#18](https://github.com/the-data-sherpa/project_blackout/issues/18), [#27](https://github.com/the-data-sherpa/project_blackout/issues/27)
   - **Delivers:** Operate the finished dark SOC console by keyboard and read its statuses throughout a full-length run, slow inference, disconnects and playback.

29. **[[M9] Launch BLACKOUT locally with persistent storage](https://github.com/the-data-sherpa/project_blackout/issues/29)**
   - **Blocked by:** [#1](https://github.com/the-data-sherpa/project_blackout/issues/1)
   - **Delivers:** Start the application through Docker Compose and retain its recorded runs across container restarts.

30. **[[M9] Inspect recording storage and delete only selected runs](https://github.com/the-data-sherpa/project_blackout/issues/30)**
   - **Blocked by:** [#21](https://github.com/the-data-sherpa/project_blackout/issues/21), [#29](https://github.com/the-data-sherpa/project_blackout/issues/29)
   - **Delivers:** See stored run sizes and deliberately remove selected inactive recordings without losing other runs or evidence during reset.

31. **[[M9] Verify and document the full MVP demonstration](https://github.com/the-data-sherpa/project_blackout/issues/31)**
   - **Blocked by:** [#23](https://github.com/the-data-sherpa/project_blackout/issues/23), [#24](https://github.com/the-data-sherpa/project_blackout/issues/24), [#28](https://github.com/the-data-sherpa/project_blackout/issues/28), [#30](https://github.com/the-data-sherpa/project_blackout/issues/30)
   - **Delivers:** Complete a clean-machine rehearsal of the full flagship, benign control and offline recording, backed by automated checks and an honest final evaluation report.
