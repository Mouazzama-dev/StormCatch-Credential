# Test reports - credential-core

Automated and manual test reports for the credential-core components. This covers what was
built, how the reports are generated, the three levels of automation, and the latest results.

The goal (from the team): generate a test report for each component, and regenerate a report
automatically when a component changes.

## What was built

1. **A per-component report tool** - `scripts/test-report.mjs`. It runs each component's test
   suite and writes a JUnit XML report per component under `reports/`. It uses Node's built-in
   test runner, so there is no new dependency. Run it for all components or a chosen subset:

   ```sh
   node scripts/test-report.mjs                                  # every component in test/
   node scripts/test-report.mjs credentials openapi              # a chosen subset
   ```

2. **A Level 1 CI workflow** - `.github/workflows/test-report.yml` (GitHub Actions). It runs the
   self-contained component reports on every push and pull request that touches a component, and
   uploads the JUnit reports as a downloadable artifact. A report is therefore never stale: when a
   component changes, its report regenerates on its own.

## The three levels

The components fall into three levels by what they need to run. The automation is applied level by
level, not all at once - the lower levels are the cheapest and most stable.

| Level | Components | Needs | In CI? | Why |
|---|---|---|---|---|
| **C1** | credentials, openapi, payload | nothing external | **Yes - automated** | Self-contained; the credential / trust-anchoring logic, the OpenAPI specs and the interaction-point payload token (issue, verify, revoke, blacklist). Cheap and reliable in CI. |
| **C2** | facility, gate, decision, robot | the services running (facility and gate also need Paradym) | No - local for now | CI would have to spin up the services and hold Paradym secrets. It leans on Paradym, which we are moving off, so it is step-by-step work for when the time is right. |
| **C2** | pickup, dropoff (interaction points) | pickup and dropoff running, the MQTT broker, the decision-service and the policy engine; no Paradym | No - local for now | CI would have to run a broker and the engine. The full pickup -> drop-off flow is covered here, including the revoke by proxy over MQTT and refusing a used token. |
| **C3** | end-to-end | the full stack + a public tunnel + Paradym | No - local for now | Needs ngrok/cloudflared and live Paradym inside the runner, which is fragile, and it exercises the webhook/Paradym path being replaced. Runs green locally. |

C2 and C3 reports are generated manually (locally) for now, and can become automated over time, in
line with the demo-ready approach - a full end-to-end / hardware-in-the-loop run is triggered at a
demo or operational setup rather than continuously.

## Latest results

All component suites pass. Service-dependent tests skip cleanly (they do not fail) when their
service or a live Paradym session is absent, so a report is always honest about what was exercised.

| Component | Level | Pass | Fail | Skip |
|---|---|---|---|---|
| credentials (trust-anchoring logic) | C1 | 13 | 0 | 0 |
| openapi (six service specs) | C1 | 12 | 0 | 0 |
| payload (interaction-point token) | C1 | 11 | 0 | 0 |
| decision | C2 | 3 | 0 | 0 |
| facility | C2 | 4 | 0 | 0 |
| gate | C2 | 5 | 0 | 1 |
| robot | C2 | 5 | 0 | 0 |
| pickup (I-1) | C2 | 6 | 0 | 0 |
| dropoff (I-2) | C2 | 5 | 0 | 0 |
| end-to-end (issue, accept, verify, revoke) | C3 | 1 | 0 | 0 |
| **Total** | | **65** | **0** | **1** |

The credentials, openapi, payload, pickup and dropoff rows are from the run of 2026-11-17, against the real policy engine and a Mosquitto broker; the other rows are from the earlier full run.

The one gate skip is a test that needs a live Paradym session key to create a session; it skips
gracefully rather than failing.

## How to generate the reports

| What | Command | Needs |
|---|---|---|
| C1 (offline) | `node scripts/test-report.mjs credentials openapi payload` | nothing |
| C2 (service contracts) | `node scripts/test-report.mjs facility gate decision robot credentials openapi` | the services up (e.g. `docker compose up`, or the engine + each service) |
| C2 (interaction points) | `node scripts/test-report.mjs pickup dropoff` | the broker (`docker compose up -d broker`), the engine, the decision-service, `pnpm pickup` and `pnpm dropoff`; see [interaction-points.md](./interaction-points.md) |
| C3 (end-to-end) | `RUN_E2E=1 node scripts/test-report.mjs e2e` | the full stack + a tunnel + Paradym |
| C1 in CI | automatic on push / pull request | nothing - GitHub runs it |

Each run writes `reports/<component>.junit.xml` and prints a summary table. In CI the reports are
attached to the run as the `component-test-reports` artifact (Actions tab -> the run -> Artifacts).

## Status

- **C1:** automated in CI, green.
- **C2 and C3:** green locally; automation is deferred and grows step by step, as agreed.
