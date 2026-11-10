"use client";

import { useEffect, useState } from "react";
import { DEFAULT_ROBOT, call, formatTime, loadCarried } from "@/lib/client";
import type { CarriedPayload } from "@/lib/client";

type Payload = { status: "valid" | "received"; jti: string; payloadType: string; contents: string[]; issuedAt: number; expiresAt: number };

export default function DropoffDesk() {
  const [robotId, setRobotId] = useState(DEFAULT_ROBOT);
  const [token, setToken] = useState("");
  const [carried, setCarried] = useState<CarriedPayload | null>(null);
  const [checked, setChecked] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [received, setReceived] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setCarried(loadCarried()), []);

  function edit(fn: () => void) {
    fn();
    setChecked(null);
    setError(null);
  }

  function useCarried() {
    if (!carried) return;
    edit(() => {
      setRobotId(carried.robotId);
      setToken(carried.token);
    });
  }

  async function runCheck() {
    setBusy(true);
    setChecked(null);
    setError(null);
    const r = await call<Payload>("/api/dropoff/check", { robotId: robotId.trim(), token: token.trim() });
    if (r.ok) setChecked(r.data);
    else setError(r.message);
    setBusy(false);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const r = await call<Payload>("/api/dropoff", { robotId: robotId.trim(), token: token.trim() });
    if (r.ok) setReceived(r.data);
    else setError(r.message);
    setBusy(false);
  }

  function reset() {
    setToken("");
    setChecked(null);
    setError(null);
    setReceived(null);
    setCarried(loadCarried());
  }

  if (received) {
    return (
      <>
        <p className="eyebrow">I-2, ward</p>
        <h1>Drop-off desk</h1>
        <section className="step done received">
          <div className="tick">&#10003;</div>
          <h2>Receipt confirmed</h2>
          <p>{received.contents.length} item(s) received. The pharmacy has revoked the token, so it cannot be used again.</p>
          <dl className="kv" style={{ textAlign: "left", maxWidth: 460, margin: "18px auto 0" }}>
            <dt>Token id</dt>
            <dd className="mono">{received.jti}</dd>
            <dt>Robot</dt>
            <dd className="mono">{robotId}</dd>
          </dl>
          <div className="actions" style={{ justifyContent: "center" }}>
            <button className="btn" onClick={reset}>
              Next robot
            </button>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <p className="eyebrow">I-2, ward</p>
      <h1>Drop-off desk</h1>
      <p className="lead">Check what the robot carries and that it was issued to this robot, then confirm receipt. Confirming revokes the token at the pharmacy.</p>

      <section className={`step ${checked ? "done" : ""}`}>
        <div className="step-head">
          <span className="step-num">1</span>
          <h2>Read the robot</h2>
        </div>
        <div className="field">
          <label htmlFor="robot">Robot id</label>
          <input id="robot" value={robotId} onChange={(e) => edit(() => setRobotId(e.target.value))} spellCheck={false} />
        </div>
        <div className="field">
          <label htmlFor="token">Payload token</label>
          <textarea id="token" value={token} placeholder="Paste the token the robot carries" onChange={(e) => edit(() => setToken(e.target.value))} spellCheck={false} />
        </div>
        <p className="note">In the pilot the desk scans the robot's QR code and reads the token from the robot.</p>
        <div className="actions">
          <button className="btn" onClick={runCheck} disabled={busy || !robotId.trim() || !token.trim()}>
            Check payload
          </button>
          {carried && (
            <button className="btn secondary" onClick={useCarried}>
              Use the token from the last pickup
            </button>
          )}
        </div>
        {carried && (
          <p className="note">
            Last pickup in this browser: {carried.contents.length} item(s), issued {new Date(carried.issuedAt).toLocaleString()}.
          </p>
        )}
        {error && (
          <div className="verdict bad" style={{ marginTop: 14 }}>
            <strong>Do not accept the payload</strong>
            {error}
          </div>
        )}
      </section>

      <section className={`step ${!checked ? "locked" : ""}`}>
        <div className="step-head">
          <span className="step-num">2</span>
          <h2>Check and confirm receipt</h2>
        </div>
        {checked ? (
          <>
            <div className="verdict ok">
              <strong>Valid payload for this robot</strong>
              Signed by the pharmacy, not expired, not received before, and the robot is allowed at this point.
            </div>
            <dl className="kv">
              <dt>Type</dt>
              <dd className="mono">{checked.payloadType}</dd>
              <dt>Issued</dt>
              <dd>{formatTime(checked.issuedAt)}</dd>
              <dt>Expires</dt>
              <dd>{formatTime(checked.expiresAt)}</dd>
              <dt>Token id</dt>
              <dd className="mono">{checked.jti}</dd>
            </dl>
            <p className="eyebrow" style={{ margin: "16px 0 8px" }}>Contents</p>
            {checked.contents.length === 0 ? (
              <p className="empty">The pharmacy listed no items.</p>
            ) : (
              <ul className="items">
                {checked.contents.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
            <div className="actions">
              <button className="btn" onClick={confirm} disabled={busy}>
                Confirm receipt
              </button>
            </div>
          </>
        ) : (
          <p className="empty">The contents appear here once the payload is checked.</p>
        )}
      </section>
    </>
  );
}
