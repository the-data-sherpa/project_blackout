# PROJECT: BLACKOUT
## Interactive AI Security Decision & Incident Simulation Platform

**Document Status:** Draft v1.1 — reviewed MVP decisions and roadmap  
**Product Type:** Interactive security simulation / Jev decision-model showcase  
**Primary Audience:** Security engineers, detection engineers, SOC analysts, AI engineers, technical leadership, developers  
**Working Name:** PROJECT: BLACKOUT

---

# Reviewed MVP Decisions — 2026-09-17

The owner accepted the following decisions during PRD review. These decisions and
[the full MVP roadmap](MVP-ROADMAP.md) govern MVP scope and behavior where the
original vision, examples, or future-facing sections below differ. Numerical
probabilities, confidence values, and latencies in examples are illustrative.

- **Purpose:** an inspectable Jev showcase that honestly displays uncertainty and
  misses. Software acceptance and measured model effectiveness are separate.
- **Deployment and stack:** one active local run with saved recordings; Next.js,
  a long-running Node/TypeScript backend, WebSockets, SQLite, TypeScript generators,
  Jev, and Docker Compose. Backend modules do not require separate services.
- **Scenario scope:** credential compromise through lateral movement plus a benign
  anomaly control. Standalone operational failure and elaborate presentation modes
  are deferred. Basic identity profiles and inspectable baseline history are in MVP.
- **Time:** fixed simulation-time evaluation checkpoints; slow/wait visibly when
  live inference cannot keep pace. Record bounded failures and let baseline
  telemetry continue during an outage rather than waiting indefinitely.
- **Pause:** freeze simulation time and the visible timeline. Record any in-flight
  response against its original snapshot; apply it to the live display on resume.
- **Baseline:** generate deterministic inspectable history before visible time zero
  to populate rolling windows and behavioral profiles.
- **Incident semantics:** STOP ATTACK stops injection only. Declining activity risk
  does not establish remediation or resolve an incident. Operator acknowledgement
  and closure are explicit recorded actions. Responses remain advisory; containment
  mechanics are deferred.
- **Evidence:** select focus identities and highlight hosts from observable
  evidence. Keep global model judgments separate from rule-derived host evidence.
- **Playback:** distinguish recorded playback, deterministic telemetry reruns, and
  fresh model reevaluation. Label offline playback and never silently substitute it
  for unavailable live inference.
- **Delivery:** recording and deterministic time start in M1; the first end-to-end
  Jev slice and basic inspector arrive in M3. Full MVP completion requires M1–M9.

Jev confidence describes concentration of the returned distribution, not measured
correctness. Noul provides a yes-probability without a separate confidence field.
Use the actual response contract rather than inventing fields shown in examples.
See the official [confidence](https://docs.typesafe.ai/confidence) and
[Noul](https://docs.typesafe.ai/primitives/noul) documentation.

---

# 1. Executive Summary

PROJECT: BLACKOUT is an interactive blue-team security operations environment designed to demonstrate how a decision-focused AI model such as Jev can continuously evaluate live operational state and make typed, probabilistic decisions during normal operation, emerging anomalies, active attacks, containment, and recovery.

Unlike a prerecorded visualization or scripted attack animation, BLACKOUT processes an actual stream of synthetic security and telemetry events through a live pipeline.

The environment continuously generates realistic baseline activity such as successful authentication, failed authentication, endpoint activity, DNS requests, application telemetry, resource utilization, network connections, and other operational events.

An operator can then inject a predefined attack scenario into that same event stream.

The attack is not represented by changing the UI directly.

Instead:

**Synthetic events → ingestion pipeline → state aggregation → Jev → decision engine → policy engine → visualization**

Jev therefore sees the same simulated telemetry that a detection or automation system would see.

During the attack, the operator can observe Jev's decisions evolving from normal to suspicious to increasingly confident indications of compromise.

When attack generation is stopped, the simulated environment returns toward baseline. Jev should similarly recognize normalization and reduce its estimated threat state.

The entire experience must be controllable, reproducible, inspectable, and replayable.

BLACKOUT is intended to demonstrate a larger concept:

> AI decision models can become continuously operating decision layers between telemetry and automation.

---

# 2. Product Vision

The product should feel like a genuine next-generation SOC console rather than an AI demonstration wrapped in charts.

A viewer should be able to watch the environment operating normally and ask:

**"What does Jev think is happening right now?"**

Then trigger an attack and watch the answer change.

The defining moment of the demonstration should occur when Jev crosses from uncertainty into high-confidence recognition.

For example:

**NORMAL**

Threat probability: 0.03

Then:

**ANOMALOUS**

Threat probability: 0.27

Then:

**SUSPICIOUS AUTHENTICATION ACTIVITY**

Threat probability: 0.61

Then:

**CREDENTIAL COMPROMISE LIKELY**

Threat probability: 0.88

Then:

**ACTIVE INTRUSION**

Threat probability: 0.96

The operator should then be able to pause the simulation and inspect exactly what state was presented to Jev and what decisions it returned.

The viewer should never have to trust that the demo was scripted.

The product should make the distinction obvious:

**The attack scenario is scripted.  
The telemetry is generated.  
The AI decisions are not predetermined.**

---

# 3. Core Product Principle

BLACKOUT must maintain a strict separation between three concepts:

### Scenario Truth

The simulation engine knows what is actually happening.

Example:

`attack_stage = credential_stuffing`

This information exists internally for orchestration and evaluation but MUST NOT be passed directly to Jev.

### Observable State

The system exposes only what an actual security tool could reasonably observe.

Example:

- Authentication attempts
- Failure rates
- Source IP diversity
- Geo changes
- Endpoint activity
- DNS activity
- Network connections
- Process activity
- CPU
- Memory
- HTTP behavior

Jev receives this state.

### Model Decision

Jev independently evaluates that observable state.

Example:

`credential_attack_probability = 0.82`

The separation is essential.

Without it, BLACKOUT becomes a scripted animation.

With it, BLACKOUT becomes an actual AI decision-system demonstration.

---

# 4. Product Goals

BLACKOUT should demonstrate that Jev can:

- Continuously evaluate changing operational state.
- Differentiate normal behavior from abnormal behavior.
- Detect emerging security conditions.
- Express uncertainty before sufficient evidence exists.
- Increase confidence as evidence accumulates.
- Classify likely incident types.
- Score incident severity.
- Recommend responses from predefined actions.
- Detect when attack activity stops.
- Recognize recovery toward baseline.
- Make decisions repeatedly at low enough latency for near-real-time operation.
- Expose its typed outputs clearly enough for an audience to understand.
- Operate on actual synthetic event data rather than precomputed scenario labels.

BLACKOUT should also provide a compelling interactive visual experience suitable for:

- Live demonstrations
- Conference presentations
- Recorded videos
- Developer demonstrations
- Security training
- AI architecture discussions
- Internal proof-of-concept testing

---

# 5. Non-Goals

The MVP is NOT intended to become:

- A production SIEM.
- A replacement for existing EDR platforms.
- A production autonomous incident-response system.
- A real endpoint containment service.
- An offensive security platform.
- A malware execution environment.
- A live attack platform against external systems.

All MVP event sources should be simulated or safely replayed from synthetic/sanitized datasets.

Any response actions such as "isolate host" should modify the simulation environment rather than actual infrastructure.

---

# 6. Primary User Experience

The operator opens BLACKOUT.

The environment shows:

**SYSTEM STATE: NORMAL**

Authentication events flow across the screen.

Hosts communicate.

Users authenticate.

DNS queries occur.

Applications generate logs.

CPU and memory fluctuate.

The topology is largely green.

A status panel shows:

```
Environment
-----------
Events/sec:      128
Hosts:           24
Users:           61
Active sessions: 37
Health:          98%

Jev
---
Risk score:      0.07
Incident state:  NORMAL
Confidence:      94%
Decision latency: 91 ms
```

Nothing dramatic happens.

That is important.

BLACKOUT must establish what "normal" looks like before demonstrating abnormal behavior.

The operator then clicks:

**BEGIN ATTACK**

A scenario begins injecting malicious-looking activity into the exact same pipeline.

No special "attack signal" is sent to Jev.

Jev only sees the resulting telemetry.

Over time:

Authentication failures rise.

One account experiences repeated authentication attempts.

An unusual source succeeds.

A new session appears.

The compromised identity accesses another resource.

Network behavior changes.

Potential lateral movement begins.

The UI gradually moves from green to amber to red as Jev's decisions change.

---

# 7. Simulation Controls

The control bar should include:

**NORMAL MODE**

Environment runs baseline traffic indefinitely.

**BEGIN ATTACK**

Starts the currently selected attack scenario.

**PAUSE**

Freezes simulated time and event generation.

All existing events and decisions remain inspectable.

**RESUME**

Continues simulation from the paused point.

**STOP ATTACK**

Stops malicious event injection without stopping baseline telemetry.

This is different from PAUSE.

Normal traffic continues.

This allows the audience to watch Jev recognize recovery.

**RESET**

Returns the environment to its deterministic starting state.

**REPLAY**

Restarts the same scenario using the same random seed.

**SPEED**

Supported simulation rates:

0.25×  
0.5×  
1×  
2×  
5×

For demonstrations, 1× should intentionally move relatively slowly.

The goal is comprehension rather than maximum throughput.

---

# 8. Critical Demo Sequence

A default demonstration should take approximately 5–10 minutes.

### Phase A — Baseline

Duration: 60–120 seconds

Normal users authenticate.

Occasional authentication failures occur.

CPU varies.

DNS activity occurs.

Normal application activity flows.

Jev maintains a low threat probability.

### Phase B — Weak Signal

One user begins experiencing unusual failed authentication attempts.

The activity should initially be ambiguous.

Jev should ideally show uncertainty.

Example:

```
Account behavior:
normal       0.54
suspicious   0.34
malicious    0.12
```

This ambiguity is desirable.

### Phase C — Credential Attack

Failed authentication increases across multiple source IPs.

Indicators begin correlating.

Jev confidence should begin rising naturally.

### Phase D — Successful Authentication

The attacker successfully authenticates using the target account.

The source context differs from baseline behavior.

Jev reassesses.

### Phase E — Post-Authentication Activity

The identity accesses unusual systems.

Additional telemetry appears.

Potential discovery activity occurs.

### Phase F — Lateral Movement

A second system receives authentication/activity from the compromised identity or endpoint.

The network graph visibly expands the suspected incident.

### Phase G — Incident

Jev reaches high confidence that active compromise is occurring.

Example:

```
Incident classification

normal                  0.01
credential_attack       0.05
account_compromise      0.17
lateral_movement        0.72
unknown                 0.05

Confidence: 0.91
```

### Phase H — Stop Attack

The operator clicks:

**STOP ATTACK**

Attack-generated events cease.

Normal events continue.

### Phase I — Recovery

Suspicious activity falls away.

The relevant rolling windows clear.

Risk decreases.

The UI transitions from:

RED → AMBER → GREEN

Jev eventually returns to:

**NORMAL OPERATIONS**

The audience has now seen the complete lifecycle:

**Normal → anomaly → suspicion → attack → escalation → cessation → recovery**

---

# 9. Event Architecture

Recommended logical architecture:

```text
                     ┌──────────────────────┐
                     │   Baseline Generator │
                     └──────────┬───────────┘
                                │
                                │
                     ┌──────────▼───────────┐
                     │   Event Bus / Stream │◄─────────────┐
                     └──────────┬───────────┘              │
                                │                          │
                  ┌─────────────▼────────────┐             │
                  │ Normalization / Enrichment│             │
                  └─────────────┬────────────┘             │
                                │                          │
                  ┌─────────────▼────────────┐             │
                  │ State / Window Aggregator │             │
                  └─────────────┬────────────┘             │
                                │                          │
                        ┌───────▼───────┐                  │
                        │      Jev      │                  │
                        └───────┬───────┘                  │
                                │                          │
                   ┌────────────▼────────────┐             │
                   │ Decision / Policy Engine │             │
                   └────────────┬────────────┘             │
                                │                          │
                ┌───────────────▼───────────────┐          │
                │       BLACKOUT Console        │          │
                └───────────────────────────────┘          │
                                                           │
                     ┌──────────────────────┐              │
                     │   Scenario Injector  │──────────────┘
                     └──────────────────────┘
```

The baseline generator and attack injector must output events using the same schema.

Consumers should not need to know whether an event came from normal generation or scenario injection.

---

# 10. Event Schema

Every event should contain a common envelope.

Example:

```json
{
  "event_id": "evt_019384",
  "timestamp": "2026-09-17T01:02:14.128Z",
  "event_type": "authentication",
  "source": "identity-provider",
  "host": "WS-017",
  "user": "jdoe",
  "severity": "info",
  "data": {}
}
```

Authentication example:

```json
{
  "event_id": "evt_019385",
  "timestamp": "2026-09-17T01:02:16.411Z",
  "event_type": "authentication",
  "source": "identity-provider",
  "host": "WS-017",
  "user": "jdoe",
  "data": {
    "result": "failure",
    "source_ip": "203.0.113.47",
    "destination": "vpn-gateway",
    "protocol": "oidc",
    "country": "DE",
    "device_known": false
  }
}
```

Telemetry example:

```json
{
  "event_id": "evt_019401",
  "timestamp": "2026-09-17T01:03:02.016Z",
  "event_type": "host_metric",
  "host": "APP-03",
  "data": {
    "cpu_percent": 67.4,
    "memory_percent": 71.1,
    "connections": 84
  }
}
```

DNS example:

```json
{
  "event_id": "evt_019419",
  "timestamp": "2026-09-17T01:03:17.998Z",
  "event_type": "dns",
  "host": "WS-017",
  "user": "jdoe",
  "data": {
    "query": "internal-file-01.blackout.local",
    "record_type": "A",
    "result": "10.10.4.19"
  }
}
```

---

# 11. State Aggregation

Jev should NOT necessarily receive every raw event individually.

BLACKOUT should maintain rolling state windows.

Recommended windows:

- 10 seconds
- 30 seconds
- 1 minute
- 5 minutes
- 15 minutes

The aggregator should calculate meaningful features.

Example state:

```json
{
  "environment": {
    "current_event_rate": 142,
    "baseline_event_rate": 127,
    "active_hosts": 24
  },

  "authentication": {
    "successes_1m": 42,
    "failures_1m": 19,
    "baseline_failures_1m": 3.2,
    "unique_failed_users_1m": 4,
    "unique_source_ips_1m": 11
  },

  "focus_identity": {
    "user": "jdoe",
    "failures_5m": 36,
    "successful_logins_5m": 2,
    "new_source_ips": 4,
    "new_countries": 1,
    "new_device": true
  },

  "network": {
    "new_connections_1m": 41,
    "unusual_internal_connections": 3
  }
}
```

This is the "state" evaluated by Jev.

Raw events remain available for inspection and replay.

---

# 12. Jev Decision Layer

Each inference cycle should send the current observable state to Jev with several independent questions.

The exact API format should follow the Jev SDK/API available during implementation.

Conceptually:

### Noul

Question:

**"Is the current activity consistent with an active security compromise?"**

Output:

```
0.82
```

### Choice

Question:

**"Which condition best describes the current environment?"**

Choices:

```
normal
operational_anomaly
credential_attack
account_compromise
lateral_movement
service_failure
unknown
```

Output:

```
normal                0.01
operational_anomaly   0.03
credential_attack     0.08
account_compromise    0.21
lateral_movement      0.62
service_failure       0.01
unknown               0.04
```

### Score

Question:

**"Rate the current security severity."**

Rubric:

```
0 - Normal
1 - Informational
2 - Suspicious
3 - Investigation warranted
4 - High severity
5 - Critical
```

Example:

```
Score: 4.2
Confidence: 0.88
```

### Response Choice

Question:

**"Which response best fits the current observable state?"**

Options:

```
continue_monitoring
increase_observation
create_investigation
alert_analyst
recommend_account_lock
recommend_host_isolation
escalate_incident
```

This should remain advisory in the MVP.

---

# 13. Decision Policy Layer

Jev should provide judgments.

Application code should control deterministic consequences.

Example:

```text
IF compromise_probability > 0.85
AND severity >= 4
AND confidence > 0.75

THEN display:
HIGH CONFIDENCE INCIDENT
```

This distinction should be visible in the UI.

The interface should show:

**MODEL DECISION**

followed by:

**POLICY RESULT**

This demonstrates how probabilistic AI decisions can safely interact with deterministic software.

---

# 14. Decision Inspector

This is arguably the most important screen in the entire application.

Clicking any decision opens:

## Decision #2481

**Timestamp**

01:04:37.226

**Model**

jev-latest

**Latency**

87 ms

**Primitive**

Choice

**Question**

Which condition best describes current activity?

**Selected**

account_compromise

**Confidence**

88%

**Probability Distribution**

```
normal                 █ 2%
operational_anomaly    ██ 5%
credential_attack      ████ 11%
account_compromise     ██████████████████████████ 68%
lateral_movement       ███ 9%
unknown                ██ 5%
```

Below this:

**STATE SENT TO JEV**

The exact input payload should be viewable.

Below that:

**POLICY EVALUATION**

```
classification == account_compromise    TRUE
confidence >= .80                        TRUE
severity >= 3                            TRUE
```

Result:

**OPEN INVESTIGATION**

This allows the presenter to pause and say:

> "This isn't a UI animation. Here is exactly what the model saw, exactly what we asked, the probability distribution it returned, and what our application did with that decision."

That is the heart of the demo.

---

# 15. Main Console Layout

The primary screen should contain five major visual areas.

### Environment Topology

Interactive graph showing:

Users → Workstations → Servers → Services

Healthy entities:

Green

Questionable activity:

Yellow

Suspicious activity:

Orange

High-confidence incident:

Red

Connections should animate when events occur.

### Incident Timeline

Horizontal or vertical timeline showing:

```
NORMAL
   |
Auth anomaly
   |
Credential failures increase
   |
Successful unusual login
   |
Account compromise suspected
   |
Lateral activity
   |
INCIDENT
   |
Attack stopped
   |
Recovery detected
   |
NORMAL
```

### Live Event Stream

Scrolling event stream resembling a SIEM.

Filters:

Auth  
DNS  
Network  
Endpoint  
Telemetry  
Jev Decisions

### Jev Decision Panel

Always-visible current state:

```
JEV

Current classification:
ACCOUNT COMPROMISE

Probability:
87%

Confidence:
91%

Severity:
4.1 / 5

Recommended action:
ALERT ANALYST

Latency:
82 ms
```

### Control Panel

```
Scenario:
Credential Compromise → Lateral Movement

[ BEGIN ATTACK ]

[ PAUSE ] [ STOP ATTACK ] [ RESET ]

Speed: 1×

Seed: blackout-demo-001
```

---

# 16. Decision Timeline

Every Jev evaluation should become a point on a timeline.

Graph:

Y-axis:

Threat probability

X-axis:

Simulation time

This should make the evolution of model judgment visible.

Example:

```
1.0 |                         ███████
    |                      ███
.75 |                  ████
    |              ████
.50 |          ████
    |       ███
.25 |    ███
    |████
0.0 +-----------------------------------
     normal       attack        recovery
```

When the attack stops, the line should gradually fall rather than instantly reset.

This visually communicates recovery.

---

# 17. Attack Scenario Engine

Attack scenarios should be declarative.

Example conceptual scenario:

```yaml
name: credential-compromise

seed: blackout-demo-001

stages:

  - name: reconnaissance
    duration: 60
    events:
      authentication_failures:
        rate: 2/minute

  - name: password_attack
    duration: 120
    events:
      authentication_failures:
        rate: 15/minute
        sources: 8

  - name: compromise
    events:
      successful_login:
        user: jdoe
        new_device: true
        unusual_location: true

  - name: discovery
    duration: 90

  - name: lateral_movement
    duration: 120
```

The scenario engine knows the scenario.

Jev does not.

---

# 18. Baseline Generator

Normal traffic must continue indefinitely.

The baseline generator should create realistic variation rather than static random noise.

Entities:

- Users
- Workstations
- Servers
- Applications
- DNS server
- Identity provider
- VPN gateway
- File server
- Database
- Web server

Normal behaviors should differ by user.

Example:

`jdoe`

Usually logs in between 08:00 and 17:00.

Usually accesses:

APP-01  
FILE-01  
GITHUB

Normally operates from:

US-East

Normally uses:

WS-017

This gives abnormal behavior context.

The environment should include occasional harmless anomalies so Jev cannot simply treat every unusual event as an attack.

Examples:

- Mistyped passwords
- CPU spike
- New legitimate device
- Large file transfer
- DNS burst
- Administrator login
- Application restart

That makes model behavior much more interesting.

---

# 19. Recommended Initial Scenarios

MVP contains the flagship credential-compromise-to-lateral-movement sequence
and a benign anomaly control. The standalone operational-failure scenario below
is deferred; credential compromise is the first portion of the flagship sequence.

## Scenario 1 — Credential Compromise

Normal authentication  
→ password attack  
→ unusual successful login  
→ abnormal resource access  
→ suspected account compromise

## Scenario 2 — Credential Compromise + Lateral Movement

Scenario 1  
→ internal discovery  
→ unusual server access  
→ second-host activity  
→ high-confidence intrusion

This should be the flagship demo.

## Scenario 3 — Operational Failure (Post-MVP)

CPU rises  
→ application latency increases  
→ errors increase  
→ service becomes degraded

No malicious authentication behavior occurs.

This scenario demonstrates something extremely important:

Jev should be capable of differentiating:

**SECURITY INCIDENT**

from:

**OPERATIONAL INCIDENT**

That makes BLACKOUT much more compelling than a simple attack detector.

---

# 20. Combination Scenario

A later scenario should combine both.

Example:

An attacker compromises an application identity.

The compromised workload begins making excessive requests.

CPU rises.

Application latency increases.

Errors occur.

Now the system must distinguish:

Cause:

Security compromise

Effects:

Operational degradation

The UI can visualize the causal sequence.

This would make an excellent advanced demonstration.

---

# 21. Replay and Determinism

Every scenario must support deterministic replay.

A scenario run receives a seed:

```
blackout-demo-001
```

That seed controls:

- User selection
- IP generation
- event intervals
- target systems
- authentication timings
- telemetry variation

Running the same scenario with the same seed should produce functionally identical telemetry.

Jev's responses should still be logged independently.

This allows two interesting comparisons:

**Same telemetry / different model versions**

and

**Same telemetry / different decision policies**

This could eventually become a Jev evaluation harness in addition to a demo.

---

# 22. Run Recording

Every run should produce a complete record.

Suggested run object:

```json
{
  "run_id": "run_0182",
  "scenario": "credential-lateral",
  "seed": "blackout-demo-001",
  "started_at": "...",
  "events": [],
  "states": [],
  "jev_requests": [],
  "jev_responses": [],
  "policy_actions": []
}
```

Runs should be replayable.

---

# 23. Replay Mode

Replay mode should allow the operator to scrub through time.

Controls:

```
◀ 10s
▶ Play
❚❚ Pause
10s ▶
```

Moving the timeline updates:

- topology
- telemetry
- events
- Jev state
- probability graphs
- decisions

The presenter can stop at:

**01:04:37**

and say:

> "This is the exact moment the model transitioned from suspicious activity to likely account compromise."

Then open the Decision Inspector.

This feature would dramatically improve presentations.

---

# 24. Recovery Detection

Recovery should not be hard-coded.

When attack injection stops:

Baseline traffic continues.

Suspicious rolling-window metrics gradually expire.

Jev continues evaluating state.

The expected progression might be:

```
ACTIVE INCIDENT

↓ 

ATTACK ACTIVITY DECLINING

↓

POST-INCIDENT OBSERVATION

↓

RECOVERING

↓

NORMAL
```

The model may not produce precisely those states initially.

BLACKOUT should display what the model actually reports.

This uncertainty is valuable.

---

# 25. Model Comparison — Future Feature

The architecture should allow another decision model or traditional detector to evaluate the same state.

Possible columns:

```
JEV
RULE ENGINE
LLM
```

This would allow comparison of:

- Latency
- Cost
- Classification
- Confidence
- Detection timing

However, model comparison is not required for MVP.

---

# 26. MITRE ATT&CK Visualization

Scenario stages may optionally map to MITRE ATT&CK techniques.

Example:

Credential activity

`T1110 — Brute Force`

Valid account usage

`T1078 — Valid Accounts`

Remote access

`T1021 — Remote Services`

Important:

These mappings should come from the scenario metadata or detection logic.

They should not falsely imply that Jev itself identified a MITRE technique unless Jev was explicitly asked to classify the behavior.

---

# 27. Recommended Technology Stack

A practical implementation could use:

Frontend:

**Next.js / React**

Visualization:

**React Flow** or **Cytoscape.js**

Charts:

**Recharts**, **ECharts**, or similar

Backend:

**Python FastAPI**

or

**Node/TypeScript**

Streaming:

For MVP:

WebSockets

Later:

Redis Streams  
NATS  
Kafka/Redpanda

State:

PostgreSQL

Fast ephemeral state:

Redis

Scenario definitions:

YAML / JSON

Containerization:

Docker Compose

This lets the entire demonstration run locally.

Example:

```bash
docker compose up
```

Then:

```
http://localhost:3000
```

---

# 28. Suggested Internal Services

The architecture should contain logical services such as:

```text
blackout-ui

blackout-api

event-generator

scenario-engine

event-bus

state-aggregator

jev-evaluator

policy-engine

run-recorder
```

For MVP these do NOT need to be independent microservices.

A modular monolith is preferable.

Avoid unnecessary infrastructure complexity.

---

# 29. Evaluation Frequency

Jev should not necessarily be called for every event.

Suggested default:

Aggregate events continuously.

Evaluate state:

**once every 1–2 seconds**

or when a significant state change occurs.

Example:

```
events
events
events
events
       ↓
state window
       ↓
Jev decision
```

This creates a continuous-looking decision stream without unnecessary API calls.

Configurable frequencies should include:

500 ms  
1 second  
2 seconds  
5 seconds  
10 seconds

---

# 30. Transparency Metrics

The dashboard should display:

```
EVENTS PROCESSED

JEV DECISIONS

AVERAGE LATENCY

P95 LATENCY

CURRENT CONFIDENCE

MODEL CALLS

DECISIONS/MINUTE

INCIDENT STATE
```

If model cost information is available from API usage metadata, BLACKOUT can optionally show:

**Estimated inference cost**

This would be particularly powerful for comparing decision models with conventional generative LLM workflows.

---

# 31. Safety Boundaries

MVP BLACKOUT must operate entirely within synthetic infrastructure.

Simulation actions such as:

`ISOLATE HOST`

should update the simulated graph.

Example:

Before:

```
WS-017 ─── FILE-01
```

After simulated containment:

```
WS-017    X    FILE-01
```

No real firewall changes should occur.

No real identity account should be disabled.

No malware should execute.

No external systems should be attacked.

---

# 32. MVP Scope

The first usable version should contain:

- Continuous normal authentication telemetry.
- Basic host telemetry.
- DNS/network events.
- One synthetic organization.
- 10–25 hosts.
- 20–60 users.
- Streaming event pipeline.
- Rolling state aggregation.
- Live Jev API integration.
- Choice primitive display.
- Score primitive display.
- Noul primitive display.
- Full probabilities/confidence where available.
- Credential-compromise scenario.
- Lateral-movement scenario.
- Begin Attack.
- Stop Attack.
- Pause.
- Resume.
- Reset.
- Replay.
- Deterministic seeds.
- Live topology.
- Event stream.
- Threat probability timeline.
- Jev decision panel.
- Decision Inspector.
- Recovery behavior.
- Complete run logging.

---

# 33. Phase Two

Potential additions:

- Multiple simultaneous incidents.
- Operational failure simulations.
- Advanced identity behavior profiles (basic profiles are required in MVP).
- Endpoint process telemetry.
- Cloud telemetry.
- Kubernetes telemetry.
- MITRE ATT&CK visualization.
- Detection-rule comparison.
- Multiple Jev configurations.
- Traditional rule engine comparison.
- LLM comparison.
- Human analyst annotation.
- Saved scenario editor.
- Scenario marketplace/imports.
- OpenTelemetry input.
- Syslog input.
- JSON ingestion.
- Splunk HEC-compatible ingestion.
- Webhook ingestion.

---

# 34. External Event Ingestion

BLACKOUT should eventually support real input formats.

Example:

```http
POST /api/events
```

Payload:

```json
{
  "event_type": "authentication",
  "timestamp": "...",
  "user": "jdoe",
  "result": "failure",
  "source_ip": "203.0.113.47"
}
```

This opens a much larger possibility.

BLACKOUT could accept synthetic logs from:

- Python generators
- replay scripts
- SIEM exports
- security datasets
- log-generation tools
- OpenTelemetry collectors

The visualization becomes an actual AI decision observability layer.

---

# 35. Success Criteria

The demo succeeds when an observer can clearly answer these questions without explanation from the developer:

**What data is entering the system?**

**What does Jev currently believe?**

**How certain is it?**

**What decision primitive was used?**

**What alternatives did it consider?**

**What action did the application take because of that decision?**

**When did Jev first notice abnormal behavior?**

**When did it become confident an attack was occurring?**

**What happened when the attack stopped?**

**Did the system recover?**

If those answers are obvious from the interface, BLACKOUT has succeeded.

---

# 36. Acceptance Criteria

A successful MVP run must demonstrate the following sequence:

1. Application launches in normal mode.
2. Synthetic baseline events continuously flow.
3. Jev evaluates baseline state.
4. Threat probability remains generally low.
5. Operator selects an attack scenario.
6. Operator clicks BEGIN ATTACK.
7. Attack events enter the same event pipeline as baseline traffic.
8. Jev receives no explicit knowledge that an attack has begun.
9. Observable anomalies accumulate.
10. Jev's decisions visibly change.
11. Probability distributions are displayed.
12. Confidence values are displayed where supplied.
13. The operator can pause.
14. The operator can inspect the state sent to Jev.
15. The operator can inspect Jev's exact typed response.
16. The operator can inspect the deterministic policy consequence.
17. The operator can resume.
18. The attack can progress further.
19. The operator can click STOP ATTACK.
20. Baseline traffic continues.
21. Suspicious telemetry declines.
22. Jev continues evaluating.
23. The UI displays whether and how model risk changes as observable activity normalizes.
24. The UI shows actual activity-risk evolution separately from unresolved incident status; no return-to-normal model output is forced.
25. The entire run can be replayed.
26. The same seed, versioned initial state/generators, and simulation-time command sequence recreate the same synthetic event sequence.

---

# 37. Testing Strategy

BLACKOUT needs two distinct types of tests.

### Software Tests

Verify:

Event schemas  
Scenario timing  
Replay determinism  
State aggregation  
WebSocket behavior  
UI state transitions  
Run recording  
API reliability

### Model Evaluation Tests

Given known scenario truth, measure:

Time to first anomaly recognition  
Time to incident classification  
False positives during baseline  
Confidence progression  
Recovery time  
Classification stability

The scenario engine provides ground truth.

Jev never receives ground truth.

This creates an evaluation dataset automatically.

---

# 38. Product Metrics

Useful evaluation metrics include:

**Mean Time to Suspicion**

Time from first malicious event until Jev meaningfully departs from baseline.

**Mean Time to Detection**

Time until incident probability crosses a configured threshold.

**False Positive Rate**

How frequently baseline traffic produces incident-level decisions.

**Confidence Calibration**

Whether high-confidence decisions correlate with scenario truth.

**Recovery Detection Time**

Time from stopping attack activity until the model recognizes normalization.

**Inference Latency**

P50 / P95 / P99.

---

# 39. Demo Mode

A dedicated presentation mode should simplify the screen.

Large text:

```
CURRENT STATE

ACCOUNT COMPROMISE

92% CONFIDENCE
```

Large topology.

Large threat timeline.

Minimal technical controls.

A keyboard shortcut could open the detailed Decision Inspector.

This would work particularly well on conference screens or recorded demonstrations.

---

# 40. Analyst Mode

Analyst mode exposes everything.

- Raw events
- Aggregated state
- Model requests
- Model responses
- Policies
- Timeline
- Scenario metadata
- Evaluation metrics
- Replay controls

This mode proves that BLACKOUT is not simply visual theater.

---

# 41. Product Identity

The experience should have a dark SOC aesthetic without becoming cliché.

Possible visual language:

Black / charcoal environment.

Subtle grid background.

Green indicates stable systems.

Amber indicates uncertainty.

Orange indicates suspicion.

Red indicates high-confidence incidents.

Blue/purple may distinguish AI decisions from raw telemetry.

Animations should communicate information rather than merely decorate the interface.

The visual hierarchy should always prioritize:

**DATA → DECISION → ACTION**

---

# 42. Most Important Architectural Rule

The scenario engine MUST NEVER tell the Jev evaluator:

```
attack = true
```

or:

```
current_stage = lateral_movement
```

Instead, the scenario engine generates observable evidence.

Jev must infer what that evidence means.

That single requirement determines whether BLACKOUT is a genuine decision-model demonstration or just a theatrical simulation.

---

# 43. MVP Effort Assessment

This is a very reasonable project for one strong developer, especially with AI-assisted development.

The difficult portions are not the attack simulation itself.

Synthetic authentication data is straightforward.

The primary engineering challenges are:

- Designing useful state aggregation.
- Designing good Jev questions.
- Determining decision cadence.
- Building deterministic replay.
- Making model-state evolution visually understandable.
- Avoiding accidental leakage of scenario truth into model context.

The project does NOT initially require Kafka, Kubernetes, actual endpoints, a SIEM, or real attack infrastructure.

A strong MVP can operate entirely from a laptop using:

```
Next.js
FastAPI/Node
WebSockets
Postgres or SQLite
Jev API
Docker Compose
```

That keeps the engineering surface manageable.

---

# 44. Full MVP Development Roadmap

The detailed [MVP roadmap](MVP-ROADMAP.md) defines deliverables, dependencies,
verification, and exit criteria for every milestone through the complete MVP.

| Milestone | Outcome |
| --- | --- |
| M1 | Deterministic run foundation and durable recording |
| M2 | Observable telemetry, baseline history, and state aggregation |
| M3 | First live Jev slice and basic Decision Inspector |
| M4 | Complete flagship scenario and benign control evaluation |
| M5 | Reliable interactive controls and simulation timing |
| M6 | Full decision console, policies, and incident lifecycle |
| M7 | Recorded playback, seeking, and fresh reevaluation |
| M8 | Evidence-based topology and complete console experience |
| M9 | Packaged, verified full MVP |

M3 is an early validation checkpoint, not the project endpoint. Model quality is
measured before heavy visualization work. Recording and determinism are foundations,
not features added after the console. All nine milestones are required for delivery.

---

# 45. Flagship Demonstration

The final presentation should begin with almost nothing happening.

The presenter says:

> "Right now we're generating synthetic enterprise telemetry. Jev has not been told whether the system is healthy or under attack."

Display:

```
127 EVENTS / SEC

JEV:
NORMAL

Threat Probability:
4%
```

Then:

> "I'm going to start a credential-compromise scenario. Nothing in the AI integration changes. We're simply going to inject events into the telemetry stream."

Click:

**BEGIN ATTACK**

The viewer watches authentication failures accumulate.

Jev remains uncertain.

Then confidence increases.

A successful unusual login occurs.

Jev changes classification.

Potential lateral activity follows.

The topology begins showing affected systems.

Then pause the entire simulation.

Open:

**DECISION #418**

Show:

State received by Jev.

Primitive:

**CHOICE**

Distribution.

Confidence.

Policy decision.

Then say:

> "The scenario engine knows this is an attack. Jev doesn't. All Jev knows is the telemetry you see here."

Resume.

Allow the incident to progress.

Then click:

**STOP ATTACK**

Normal telemetry continues.

The graph gradually returns toward normal.

Jev's probabilities decrease.

Eventually:

```
CURRENT STATE

NORMAL

Threat Probability:
6%
```

That ending is as important as attack detection.

It demonstrates that BLACKOUT is not simply waiting for a trigger to turn the screen red.

It is continuously making decisions about changing state.

---

# 46. Longer-Term Vision

BLACKOUT could ultimately become more than a Jev demo.

Its architecture naturally evolves into a generic decision-model observability and evaluation platform.

Users could supply:

**Telemetry**

+

**Decision questions**

+

**Scenario definitions**

and evaluate how decision models behave over time.

That could support:

Security  
SRE  
Observability  
Fraud detection  
Infrastructure automation  
Agent supervision  
Industrial telemetry  
Incident response

The underlying concept becomes:

> **Observe state. Ask atomic questions. Watch probabilistic decisions evolve over time.**

PROJECT: BLACKOUT is simply the security-focused, highly visual demonstration of that idea.
