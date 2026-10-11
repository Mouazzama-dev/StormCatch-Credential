# Test plan - Stormcatch credential lifecycle (gate authorisation)

Focused test plan for the implemented pilot: the containerised credential stack
(facility, gate, decision, robot) plus the policy engine, and the certificate
bridge that issues the robot's identity credential. It maps each component to
concrete, runnable test cases and marks what is automated versus still a gap.

Two credentials flow in this system:
- the **task-authorisation** credential (Paradym SD-JWT VC: action + scope), presented at a gate; and
- the **birth-certificate identity** credential (Martin's crt-demo issues an X.509 cert as an SD-JWT VC over OpenID4VCI, x5c-signed), which the robot holds and presents alongside the task auth so the engine can read its real identity (serial, model).

## Test levels

| Level | What it checks | Needs |
|---|---|---|
| Offline (unit-ish) | OpenAPI specs are well-formed and document the expected routes | nothing |
| Component / contract | each service's HTTP contract: health, input validation, docs | that service running |
| Integration | decision -> policy engine returns a well-formed decision; bridge issue -> holder accept | the two services in the pair |
| End-to-end | full headless lifecycle: issue, accept, present, gate verify, engine decide, revoke | all services + engine + ngrok + Paradym (+ crt-demo issuer for the identity credential) |

Tests **skip** (they do not fail) when their preconditions are absent, so a bare run stays green and reports honestly what was and was not exercised.

## How to run

```bash
# offline + whichever services happen to be up:
pnpm test

# full end-to-end (bring the stack up first: docker compose up -d, engine on
# HOST=0.0.0.0 + token, ngrok -> 4002, pnpm register-webhook <url>):
RUN_E2E=1 pnpm test
```

The phase-system blocks (structure, mocked flow, first-contact) live in the demo repo and run with `node --test "tests/phase-<n>/**/*.test.js"`; 3a drives the real engine and 3b drives the real crt-demo bridge, both skipping when their service is down.

Runner: Node's built-in test runner via tsx - no extra dependency. Service URLs are overridable with `FACILITY_URL` / `GATE_URL` / `DECISION_URL` / `ROBOT_URL`; the issuer with `ISSUER_WS_URL` / `ISSUER_HTTP_URL`.

## Component: facility-service (issuer, :4001)

| ID | Test | Type | Precondition | Expected | Automated |
|---|---|---|---|---|---|
| FAC-1 | `GET /health` | contract | facility up | 200, `ok:true` | test/facility.test.ts |
| FAC-2 | `POST /issue` with no action/scope | contract | facility up | 400 | test/facility.test.ts |
| FAC-3 | `POST /revoke` with empty `credentialIds` | contract | facility up | 400 | test/facility.test.ts |
| FAC-4 | `GET /openapi.json` served, documents `/issue` | contract | facility up | 200 | test/facility.test.ts |
| FAC-5 | `POST /issue {action,scope}` issues over OID4VCI | integration | facility + Paradym | 200, `{issuanceId, offerUri}`; issuance later `completed` | e2e.test.ts |

## Component: gate-service (verifier, :4002)

| ID | Test | Type | Precondition | Expected | Automated |
|---|---|---|---|---|---|
| GT-1 | `GET /health` | contract | gate up | 200, `ok:true` | test/gate.test.ts |
| GT-2 | `POST /verify` with an unconfigured gate | contract | gate up | 400 | test/gate.test.ts |
| GT-3 | `GET /result/:id` unknown session | contract | gate up | 404 | test/gate.test.ts |
| GT-4 | `GET /openapi.json` served, documents `/verify` | contract | gate up | 200 | test/gate.test.ts |
| GT-5 | `POST /verify` creates a request; webhook drives allow/deny | e2e | full stack | request URI returned; result resolves | e2e.test.ts |
| GT-6 | presentation requests the birth cert **optionally** alongside task auth | e2e | gate + Paradym (birth-cert template) | a task-auth-only robot still passes; a robot holding a birth cert presents both | GAP (needs Paradym birth-cert template + trusted entity) |

## Component: decision-service (policy adapter, :4003)

| ID | Test | Type | Precondition | Expected | Automated |
|---|---|---|---|---|---|
| DEC-1 | `GET /health` | contract | decision up | 200, `ok:true` | test/decision.test.ts |
| DEC-2 | `POST /decision` with no `pointId` | contract | decision up | 400 | test/decision.test.ts |
| DEC-3 | `POST /decision` with a session forwards to the engine (3a first contact) | integration | decision + engine | 200, `{allowed, decision, determiningPolicies[]}` (skips on 502) | test/decision.test.ts; demo tests/phase-3/3a |
| DEC-4 | deny path: wrong scope / untrusted issuer / expired | integration | decision + engine | `allowed:false` with the engine's reason | demo tests/phase-3/3a (verdict cases) |

## Component: certificate bridge + birth-cert holding (crt-demo issuer :8787, holder :4004)

| ID | Test | Type | Precondition | Expected | Automated |
|---|---|---|---|---|---|
| BRG-1 | bridge issues an SD-JWT VC offer for a birth certificate | integration | crt-demo issuer | `credential.offer` returns `vct urn:stormcatch:vct:birth-certificate`, `offerUri`, claims | demo tests/phase-3/3b |
| BRG-2 | holder accepts the offer and stores the credential (3b accept) | integration | issuer + robot | `{ok:true, stored>=1}`; credential is `dc+sd-jwt`, x5c-signed | demo tests/phase-3/3b |
| BRG-3 | holder rejects a malformed offer | integration | issuer + robot | `{ok:false}` | demo tests/phase-3/3b |

## Component: robot-service (headless holder, :4004)

| ID | Test | Type | Precondition | Expected | Automated |
|---|---|---|---|---|---|
| ROB-1 | `GET /health` | contract | robot up | 200, `ok:true` | test/robot.test.ts |
| ROB-2 | `POST /accept` with no `offerUri` | contract | robot up | 400 | test/robot.test.ts |
| ROB-3 | `POST /present` with no `requestUri` | contract | robot up | 400 | test/robot.test.ts |
| ROB-4 | `POST /reset` clears the wallet | contract | robot up | 200, `{ok, cleared:number}` | test/robot.test.ts |
| ROB-5 | `GET /openapi.json` served, documents `/present` | contract | robot up | 200 | test/robot.test.ts |
| ROB-6 | accept + DCQL present happy path | e2e | full stack | credential stored; presentation accepted | e2e.test.ts |

## Cross-cutting: API documentation

| ID | Test | Type | Precondition | Expected | Automated |
|---|---|---|---|---|---|
| OAS-1..8 | each service spec is valid OpenAPI 3 and documents its routes | offline | none | pass | test/openapi.test.ts |
| OAS-drift | routes in code match the spec | offline-ish | src present | pass | `pnpm docs:check` |

## End-to-end scenarios

| ID | Scenario | Steps | Expected | Automated |
|---|---|---|---|---|
| E2E-1 | Gate-1 authorise then revoke (task auth) | reset robot -> facility issue scope-1 -> robot accept -> poll issuance -> verify G-1 -> **allowed** -> revoke -> verify G-1 -> **denied** | both outcomes assert correctly | e2e.test.ts (`RUN_E2E=1`) |
| E2E-2 | Birth-cert identity at the gate (deny-list lifecycle) | robot holds task auth + birth cert -> verify G-1 -> engine reads real id (serial from `birthEK`) -> **permit** -> add serial to deny list -> verify -> **deny** -> remove -> verify -> **permit** | identity comes from the credential, not the baseline; deny list keys on the real serial | validated on the gate device (janus) by the engine team; local automation is a GAP (needs Paradym birth-cert template + Martin's CA root as a trusted entity) |
| E2E-3 | Full pilot route | pharmacy load (`PayloadCredential`) -> G-1 -> G-2 (scope 2) -> G-4 -> decontamination G-5 (`StateAttestationCredential`) -> drop-off (payload revoke) | each checkpoint allows/denies per policy | GAP (route + those credential types not built) |

## Coverage and known gaps

Covered now: every service's health, input-validation and docs contract; the decision adapter's contract against the real engine (3a, with verdict cases); the certificate bridge issuing and the holder accepting the birth cert end to end (3b); and the core issue/accept/verify/revoke task-auth lifecycle (E2E-1). The birth-cert identity path through the gate and engine (E2E-2) is wired and validated on the gate device by the engine team.

Not yet covered (and why):
- **E2E-2 local automation** - presenting the birth cert at our local gate needs a Paradym birth-cert presentation template and Martin's CA root registered as a trusted entity; those are not set up locally yet. The engine side (serial/model derived from `birthEK`, deny list on the serial, issuer anchored on the CA root) is done.
- **Birth-cert issuer trust is demo-grade** - the holder's X509 module trusts the presented leaf (trust-on-presentation), and the engine pins the sample's signing cert / the CA root; a stable, rotated CA root and a tampered/untrusted-issuer refusal case should be added.
- **E2E-3 full route** (G-2/G-4/G-5 + Payload + StateAttestation) - those gates and credential types are not implemented yet.
- **Unit tests of the decision builders** (`baselineRobot` / `baselineTask` / session -> AuthorizeBody) - the logic lives inside `server.ts` files that call `app.listen()` on import, so it cannot be imported in isolation. A small refactor (export the pure functions, guard the `listen`) would unlock fast offline unit tests. The demo repo's `tests/phase-2/reference` mirrors this logic in the meantime.
- **Offline / machine-unreachable revoke** behaviour (the design promises revoke works while the machine is off) - not exercised.
- **Negative security cases** - tampered credential, expired credential, wrong scope at a gate - partly covered by the engine verdict cases; worth adding as component/E2E cases.
