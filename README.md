# Stormcatch — Credential Lifecycle Demo

A minimal, working demonstration of the full verifiable-credential lifecycle
built on [Paradym](https://paradym.id): **issue → present/verify → revoke →
verify (now failing)**.

The demo issues a short-lived `PayloadCredential` (proving an autonomous robot
carries an authorized payload, e.g. `payload_type: sc:medicine`), verifies it,
revokes it, and then shows the same credential failing verification — all over
OpenID4VC, with results delivered back through a webhook.

## Stack

- **Paradym** — hosted issuer + verifier (DID, credential/presentation
  templates, status list)
- **Paradym Wallet** — holder wallet (mobile app) that stores and presents the
  credential
- **Node + TypeScript scripts** — drive issuance, verification and revocation
  through the Paradym API
- **Express webhook server + ngrok** — receive verification results in real time

## Protocols

| Phase | Protocol | Paradym endpoint |
|---|---|---|
| Issue | OID4VCI | `openid4vc/issuance/offer` |
| Present / verify | OID4VP | `openid4vc/verification/request` |
| Revoke | status list (no wallet exchange) | `revocation/batch` |

---

## Lifecycle sequence diagrams

### 1. Issue — OID4VCI

The script asks Paradym to create an issuance offer. Paradym returns a URL that
renders as a QR code; the wallet scans it, completes the OID4VCI exchange, and
the credential lands in the wallet as a card. A webhook confirms completion.

```mermaid
sequenceDiagram
    participant S as Demo script
    participant P as Paradym
    participant W as Wallet (phone)
    participant H as Webhook server

    S->>P: POST issuance/offer (payload_type: sc:medicine)
    P-->>S: offerUri + session id
    Note over S,W: User opens URL, scans QR
    W->>P: accept offer (OID4VCI)
    P->>W: issue credential
    P->>H: webhook: issuance.completed
    Note over W: Credential card now in wallet
```

### 2. Verify — OID4VP (passing)

The script creates a verification request from a presentation template. The
wallet scans the QR and presents the credential. Paradym checks the signature,
validity window, status list, and issuer, then delivers the result — here,
`verified` — to the webhook.

```mermaid
sequenceDiagram
    participant S as Demo script
    participant P as Paradym (verifier)
    participant W as Wallet (phone)
    participant H as Webhook server

    S->>P: POST verification/request (presentation template)
    P-->>S: authorizationRequestUri + session id
    Note over S,W: User scans QR, approves
    W->>P: present credential (OID4VP)
    P->>P: check signature, expiry, status list, issuer
    P->>H: webhook: verification.data (status: verified)
    Note over H: verified: true, payload_type: sc:medicine
```

### 3. Revoke — status list

Revocation is a pure issuer-side operation: the script looks up the issued
credential id and flips its entry on the status list. The wallet is never
contacted — the credential stays in the wallet, but is now marked revoked. This
is what lets revocation work even when the holder (the robot) is offline.

```mermaid
sequenceDiagram
    participant S as Demo script
    participant P as Paradym (issuer)
    participant SL as Status list

    S->>P: GET issuance session
    P-->>S: issued credential id
    S->>P: POST revocation/batch (notifyWallet: true)
    P->>SL: flip status entry to revoked
    Note over P: Credential stays in wallet,<br/>but now marked revoked
```

### 4. Verify after revoke — OID4VP (failing)

Structurally identical to step 2 — same request, same presentation — but the
status-list check now returns `revoked`, so Paradym reports
`verification.failed`. Same credential, opposite outcome, without ever touching
the credential itself.

```mermaid
sequenceDiagram
    participant S as Demo script
    participant P as Paradym (verifier)
    participant W as Wallet (phone)
    participant SL as Status list
    participant H as Webhook server

    S->>P: POST verification/request
    P-->>S: authorizationRequestUri
    W->>P: present same credential (OID4VP)
    P->>SL: check status
    SL-->>P: revoked
    P->>H: webhook: verification.failed
    Note over H: "One or more credentials have been revoked"
```

---

## Running the demo

Prerequisites: Node 20+, pnpm, a Paradym account (API key + wallet id + DID),
and ngrok.

1. Start ngrok: `ngrok http 3000`
2. Register the webhook to the ngrok URL:
   `pnpm register-webhook https://<your>.ngrok-free.dev`
3. Run the full lifecycle: `pnpm demo`

The pipeline walks through issue → verify (pass) → revoke → verify (fail),
pausing for you to scan each QR with the Paradym Wallet.