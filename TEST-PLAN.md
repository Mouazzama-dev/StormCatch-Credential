# Test plan - Stormcatch credential lifecycle (gate authorisation)

Focused test plan for the implemented pilot: the containerised credential stack
(facility, gate, decision, robot) plus the policy engine. It maps each component
to concrete, runnable test cases and marks what is automated versus still a gap.

## Test levels

| Level | What it checks | Needs |
|---|---|---|
| Offline (unit-ish) | OpenAPI specs are well-formed and document the expected routes | nothing |
| Component / contract | each service's HTTP contract: health, input validation, docs | that service running |
| Integration | decision -> policy engine returns a well-formed decision | decision + engine (5174) |
| End-to-end | full headless lifecycle: issue, accept, verify(allow), revoke, verify(deny) | all 4 services + engine + ngrok + Paradym |

Tests **skip** (they do not fail) when their preconditions are absent, so a bare run stays green and reports honestly what was and was not exercised.

## How to run

```bash
# offline + whichever services happen to be up:
pnpm test

# full end-to-end (bring the stack up first: docker compose up -d, engine on
# HOST=0.0.0.0 + token, ngrok -> 4002, pnpm register-webhook <url>):
RUN_E2E=1 pnpm test
```

Runner: Node's built-in test runner via tsx (`node --import tsx --test test/*.test.ts`) - no extra dependency. Service URLs are overridable with `FACILITY_URL` / `GATE_URL` / `DECISION_URL` / `ROBOT_URL`.

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

## Component: decision-service (policy adapter, :4003)

| ID | Test | Type | Precondition | Expected | Automated |
|---|---|---|---|---|---|
| DEC-1 | `GET /health` | contract | decision up | 200, `ok:true` | test/decision.test.ts |
| DEC-2 | `POST /decision` with no `pointId` | contract | decision up | 400 | test/decision.test.ts |
| DEC-3 | `POST /decision` with a session forwards to the engine | integration | decision + engine | 200, `{allowed:boolean, decision, determiningPolicies[]}` (skips on 502) | test/decision.test.ts |
| DEC-4 | deny path: revoked / untrusted issuer | integration | decision + engine | `allowed:false` | GAP (planned) |

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

## End-to-end scenario

| ID | Scenario | Steps | Expected | Automated |
|---|---|---|---|---|
| E2E-1 | Gate-1 authorise then revoke (implemented slice) | reset robot -> facility issue scope-1 -> robot accept -> poll issuance -> verify G-1 -> **allowed** -> revoke -> verify G-1 -> **denied** | both outcomes assert correctly | e2e.test.ts (`RUN_E2E=1`) |
| E2E-2 | Full pilot route | pharmacy load (`PayloadCredential`) -> G-1 -> G-2 (scope 2) -> G-4 -> decontamination G-5 (`StateAttestationCredential`) -> drop-off (payload revoke) | each checkpoint allows/denies per policy | GAP (route + those credential types not built) |

## Coverage and known gaps

Covered now: every service's health, input-validation and docs contract; the decision adapter's contract against the engine; and the core issue/accept/verify/revoke lifecycle end to end (E2E-1).

Not yet covered (and why):
- **E2E-2 full route** (G-2/G-4/G-5 + Payload + StateAttestation) - those gates and credential types are not implemented yet.
- **Unit tests of the decision builders** (`baselineRobot` / `baselineTask` / session -> AuthorizeBody) - the logic lives inside `server.ts` files that call `app.listen()` on import, so it cannot be imported in isolation. A small refactor (export the pure functions, guard the `listen`) would unlock fast offline unit tests.
- **Real did:web issuer trust** - E2E currently passes on the placeholder issuer; a case asserting the real did:web is trusted (and a wrong issuer is refused) should be added once the issuer-forward change is live.
- **Offline / machine-unreachable revoke** behaviour (the design promises revoke works while the machine is off) - not exercised.
- **Negative security cases** - tampered credential, expired credential, wrong scope at a gate - worth adding as component/E2E cases.
