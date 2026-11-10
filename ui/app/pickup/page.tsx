"use client";

import { useState } from "react";
import { DEFAULT_ROBOT, MEDICATION_PRESETS, call, formatTime, saveCarried } from "@/lib/client";

type Check = { pointId: string; allowed: boolean; decision: string | null; determiningPolicies: string[] };
type Issued = { token: string; jti: string; expiresAt?: number };

// The token's expiry, read from its payload for display only; drop-off verifies it properly.
function expiryOf(token: string): number | undefined {
  try {
    const json = atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json).exp;
  } catch {
    return undefined;
  }
}

export default function PickupDesk() {
  const [robotId, setRobotId] = useState(DEFAULT_ROBOT);
  const [check, setCheck] = useState<Check | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [items, setItems] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [issued, setIssued] = useState<Issued | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const allowed = check?.allowed === true;

  function changeRobot(value: string) {
    setRobotId(value);
    setCheck(null);
    setCheckError(null);
  }

  async function runCheck() {
    setBusy(true);
    setCheck(null);
    setCheckError(null);
    const r = await call<Check>("/api/pickup/check", { robotId: robotId.trim() });
    if (r.ok) setCheck(r.data);
    else setCheckError(r.message);
    setBusy(false);
  }

  function addItem(item: string) {
    const v = item.trim();
    if (v && !items.includes(v)) setItems([...items, v]);
  }

  async function issue() {
    setBusy(true);
    setIssueError(null);
    const r = await call<Issued>("/api/pickup", { robotId: robotId.trim(), payloadType: "sc:medicine", contents: items });
    if (r.ok) {
      const result = { ...r.data, expiresAt: expiryOf(r.data.token) };
      setIssued(result);
      saveCarried({ robotId: robotId.trim(), token: r.data.token, jti: r.data.jti, contents: items, issuedAt: new Date().toISOString() });
    } else setIssueError(r.message);
    setBusy(false);
  }

  async function copyToken() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the token is selectable on screen
    }
  }

  function reset() {
    setCheck(null);
    setCheckError(null);
    setItems([]);
    setCustom("");
    setIssued(null);
    setIssueError(null);
  }

  return (
    <>
      <p className="eyebrow">I-1, pharmacy</p>
      <h1>Pickup desk</h1>
      <p className="lead">Check that the robot may collect, list what you load, then issue the payload token it carries to the ward.</p>

      <section className={`step ${check ? "done" : ""}`}>
        <div className="step-head">
          <span className="step-num">1</span>
          <h2>Identify the robot</h2>
        </div>
        <div className="row">
          <div className="grow">
            <label htmlFor="robot">Robot id</label>
            <input id="robot" value={robotId} onChange={(e) => changeRobot(e.target.value)} disabled={!!issued} spellCheck={false} />
          </div>
          <button className="btn" onClick={runCheck} disabled={busy || !robotId.trim() || !!issued}>
            Check robot
          </button>
        </div>
        <p className="note">In the pilot the desk camera reads the robot's QR code; type the id for now.</p>
        {check && (
          <div className={`verdict ${check.allowed ? "ok" : "bad"}`} style={{ marginTop: 14 }}>
            <strong>{check.allowed ? "Allowed to collect medicine" : "Not allowed to collect medicine"}</strong>
            {check.allowed ? "The policy engine permits this robot at the pickup counter." : "Do not load the robot. It returns to its rest location."}
            <div className="detail">
              {check.pointId}: {check.decision ?? "no decision"} {check.determiningPolicies.length ? `(${check.determiningPolicies.join(", ")})` : ""}
            </div>
          </div>
        )}
        {checkError && (
          <div className="verdict bad" style={{ marginTop: 14 }}>
            <strong>Could not check the robot</strong>
            {checkError}
          </div>
        )}
      </section>

      <section className={`step ${!allowed ? "locked" : issued ? "done" : ""}`}>
        <div className="step-head">
          <span className="step-num">2</span>
          <h2>Load the medication</h2>
        </div>
        <div className="chips">
          {MEDICATION_PRESETS.map((m) => (
            <button key={m} className="chip" onClick={() => addItem(m)} disabled={!allowed || !!issued}>
              + {m}
            </button>
          ))}
        </div>
        <div className="row field">
          <div className="grow">
            <label htmlFor="custom">Other item</label>
            <input
              id="custom"
              value={custom}
              placeholder="Name, strength and quantity"
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  addItem(custom);
                  setCustom("");
                }
              }}
              disabled={!allowed || !!issued}
            />
          </div>
          <button
            className="btn secondary"
            onClick={() => {
              addItem(custom);
              setCustom("");
            }}
            disabled={!allowed || !!issued || !custom.trim()}
          >
            Add
          </button>
        </div>
        {items.length === 0 ? (
          <p className="empty">Nothing listed yet.</p>
        ) : (
          <ul className="items">
            {items.map((i) => (
              <li key={i}>
                {i}
                {!issued && (
                  <button className="remove" onClick={() => setItems(items.filter((x) => x !== i))}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button className="btn" onClick={issue} disabled={!allowed || busy || items.length === 0 || !!issued}>
            Loaded, issue payload token
          </button>
        </div>
        {issueError && (
          <div className="verdict bad" style={{ marginTop: 14 }}>
            <strong>No token issued</strong>
            {issueError}
          </div>
        )}
      </section>

      <section className={`step ${!issued ? "locked" : "done"}`}>
        <div className="step-head">
          <span className="step-num">3</span>
          <h2>Payload token on the robot</h2>
        </div>
        {issued ? (
          <>
            <div className="verdict ok">
              <strong>Payload token issued</strong>
              The robot may leave for the ward.
            </div>
            <dl className="kv">
              <dt>Token id</dt>
              <dd className="mono">{issued.jti}</dd>
              <dt>Robot</dt>
              <dd className="mono">{robotId}</dd>
              <dt>Items</dt>
              <dd>{items.length}</dd>
              <dt>Expires</dt>
              <dd>{issued.expiresAt ? formatTime(issued.expiresAt) : "unknown"}</dd>
            </dl>
            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="token">Token</label>
              <textarea id="token" readOnly value={issued.token} />
            </div>
            <p className="note">In the pilot the token goes onto the robot. For now this browser keeps it, and the drop-off desk can load it; or copy it.</p>
            <div className="actions">
              <button className="btn secondary" onClick={copyToken}>
                {copied ? "Copied" : "Copy token"}
              </button>
              <button className="btn secondary" onClick={reset}>
                Next robot
              </button>
            </div>
          </>
        ) : (
          <p className="empty">Issued after loading is confirmed.</p>
        )}
      </section>
    </>
  );
}
