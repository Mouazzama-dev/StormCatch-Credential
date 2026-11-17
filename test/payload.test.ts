// OFFLINE test - no running services needed. The task token (the format agreed with Martin) and the file blacklist: issue, verify, revoke, the point checks, and the ways a token is rejected. Safe for CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decodeProtectedHeader, generateKeyPair } from "jose";
import { FileBlacklist } from "../src/payload/blacklist.ts";
import { JwtPayloadBackend } from "../src/payload/jwt.ts";
import { pointUrn, routeOf, toPointId } from "../src/payload/points.ts";
import type { Task } from "../src/payload/types.ts";

const ROBOT = "urn:stormcatch:robot:SC-M1:SN-2026-000123";
const ISSUER = "urn:stormcatch:central";
const keys = await generateKeyPair("ES256");
const tmpFile = () => path.join(mkdtempSync(path.join(tmpdir(), "payload-")), "blacklist.json");
const backend = (ttl = 3600, file = tmpFile(), issuer = ISSUER) => new JwtPayloadBackend(keys, new FileBlacklist(file), ttl, issuer);

const task = (to = "I-2"): Task => ({
  id: "task-0001",
  type: "medicine-delivery",
  from: "I-1",
  to,
  items: [
    { code: "PARACETAMOL-500", name: "Paracetamol 500 mg", quantity: 20 },
    { code: "AMOXICILLIN-250", name: "Amoxicillin 250 mg", quantity: 14 },
  ],
  gates: routeOf("I-1", to)!,
  parentTaskId: null,
});

test("payload: issue then verify returns Martin's claim structure", async () => {
  const b = backend();
  const { token, jti } = await b.issue(ROBOT, task());
  const header = decodeProtectedHeader(token);
  assert.equal(header.alg, "ES256");
  assert.equal(header.typ, "task+jwt");
  assert.equal(typeof header.kid, "string");
  const v = await b.verify(token);
  assert.ok(v.ok);
  assert.equal(v.claims.iss, ISSUER);
  assert.equal(v.claims.sub, ROBOT);
  assert.equal(v.claims.jti, jti);
  assert.deepEqual(v.claims.aud, ["I-1", "G-1", "G-2", "G-3", "I-2"].map(pointUrn));
  assert.equal(v.claims.nbf, v.claims.iat);
  assert.equal(v.claims.exp - v.claims.iat, 3600);
  assert.deepEqual(v.claims.task, task());
  assert.equal("cnf" in v.claims, false, "no cnf without a PIC thumbprint");
});

test("payload: a PIC thumbprint travels as cnf.x5t#S256", async () => {
  const b = backend();
  const v = await b.verify((await b.issue(ROBOT, task(), { cnfThumbprint: "PtAI6v9TOOgOHUhoLHlldTkWJvt9fx9DI0Qu3yXVx4g" })).token);
  assert.ok(v.ok);
  assert.deepEqual(v.claims.cnf, { "x5t#S256": "PtAI6v9TOOgOHUhoLHlldTkWJvt9fx9DI0Qu3yXVx4g" });
});

test("payload: a point on the route accepts the token, a point off it refuses it", async () => {
  const b = backend();
  const { token } = await b.issue(ROBOT, task("I-2"));
  assert.ok((await b.verify(token, pointUrn("I-2"))).ok);
  assert.ok((await b.verify(token, pointUrn("G-3"))).ok);
  assert.deepEqual(await b.verify(token, pointUrn("I-3")), { ok: false, reason: "wrong-point" });
});

test("payload: a token from another issuer is refused", async () => {
  const other = backend(3600, tmpFile(), "urn:stormcatch:somebody-else");
  const { token } = await other.issue(ROBOT, task());
  assert.deepEqual(await backend().verify(token), { ok: false, reason: "invalid-issuer" });
});

test("payload: each issue gets its own jti", async () => {
  const b = backend();
  assert.notEqual((await b.issue(ROBOT, task())).jti, (await b.issue(ROBOT, task())).jti);
});

test("payload: a revoked token is rejected as revoked", async () => {
  const b = backend();
  const { token, jti } = await b.issue(ROBOT, task());
  await b.revoke(jti, "received");
  assert.deepEqual(await b.verify(token), { ok: false, reason: "revoked" });
});

test("payload: the blacklist is shared through the file across backends", async () => {
  const file = tmpFile();
  const central = backend(3600, file);
  const other = backend(3600, file);
  const { token, jti } = await central.issue(ROBOT, task());
  await other.revoke(jti);
  assert.deepEqual(await central.verify(token), { ok: false, reason: "revoked" });
});

test("payload: an expired token is rejected as expired", async () => {
  const b = backend(-60);
  const { token } = await b.issue(ROBOT, task());
  assert.deepEqual(await b.verify(token), { ok: false, reason: "expired" });
});

test("payload: a token signed by another key is rejected", async () => {
  const other = new JwtPayloadBackend(await generateKeyPair("ES256"), new FileBlacklist(tmpFile()), 3600, ISSUER);
  const { token } = await other.issue(ROBOT, task());
  assert.deepEqual(await backend().verify(token), { ok: false, reason: "invalid-signature" });
});

test("payload: a tampered token is rejected", async () => {
  const b = backend();
  const { token } = await b.issue(ROBOT, task());
  const [h, p, s] = token.split(".");
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  claims.task.items[0].quantity = 200;
  const forged = [h, Buffer.from(JSON.stringify(claims)).toString("base64url"), s].join(".");
  assert.deepEqual(await b.verify(forged), { ok: false, reason: "invalid-signature" });
});

test("payload: garbage is rejected as malformed", async () => {
  assert.deepEqual(await backend().verify("not-a-jwt"), { ok: false, reason: "malformed" });
});

test("payload: a verify-only backend (public key alone) cannot mint", async () => {
  const verifier = new JwtPayloadBackend({ publicKey: keys.publicKey }, new FileBlacklist(tmpFile()), 3600, ISSUER);
  await assert.rejects(verifier.issue(ROBOT, task()), /only the central server issues/);
});

test("points: routes follow the procedures, Martin's names map to engine ids", () => {
  assert.deepEqual(routeOf("I-1", "I-2"), ["I-1", "G-1", "G-2", "G-3", "I-2"]);
  assert.deepEqual(routeOf("I-1", "I-3"), ["I-1", "G-1", "G-2", "G-4", "I-4", "G-5", "I-3"]);
  assert.equal(routeOf("I-2", "I-1"), undefined);
  assert.equal(toPointId("gate-pharmacy"), "I-1");
  assert.equal(toPointId("gate-ward-3b"), "I-2");
  assert.equal(toPointId("I-3"), "I-3");
});

test("blacklist: add is idempotent and has reports membership", async () => {
  const bl = new FileBlacklist(tmpFile());
  assert.equal(await bl.has("j1"), false);
  await bl.add("j1", "received");
  await bl.add("j1", "received");
  assert.equal(await bl.has("j1"), true);
  assert.equal(await bl.has("j2"), false);
});

test("tasks: the store lists newest first, filters by robot and status, and updates in place", async () => {
  const { TaskStore } = await import("../src/payload/tasks.ts");
  const store = new TaskStore(tmpFile());
  const rec = (id: string, robotId: string, createdAt: string) => ({ robotId, status: "planned" as const, task: { ...task(), id }, createdAt, updatedAt: createdAt });
  store.put(rec("t1", "r1", "2026-11-17T10:00:00Z"));
  store.put(rec("t2", "r2", "2026-11-17T11:00:00Z"));
  assert.deepEqual(store.list().map((r) => r.task.id), ["t2", "t1"]);
  assert.deepEqual(store.list({ robotId: "r1" }).map((r) => r.task.id), ["t1"]);
  store.update("t1", (r) => {
    r.status = "issued";
    r.jti = "j1";
  });
  assert.equal(store.byJti("j1")?.task.id, "t1");
  assert.deepEqual(store.list({ status: "planned" }).map((r) => r.task.id), ["t2"]);
  assert.equal(store.update("nope", () => {}), undefined);
});

test("tasks: the activity log is newest first and filters by task", async () => {
  const { ActivityLog } = await import("../src/payload/tasks.ts");
  const log = new ActivityLog(tmpFile());
  log.add({ event: "task.planned", taskId: "t1" });
  log.add({ event: "task.planned", taskId: "t2" });
  log.add({ event: "task.issued", taskId: "t1" });
  assert.deepEqual(log.list().map((e) => e.event + ":" + e.taskId), ["task.issued:t1", "task.planned:t2", "task.planned:t1"]);
  assert.deepEqual(log.list({ taskId: "t1" }).map((e) => e.event), ["task.issued", "task.planned"]);
  assert.equal(log.list({ limit: 1 }).length, 1);
});

test("tasks: items are validated as the desks send them", async () => {
  const { readItems } = await import("../src/payload/tasks.ts");
  assert.deepEqual(readItems([{ name: " Paracetamol ", quantity: 2, code: "P-1" }]), [{ code: "P-1", name: "Paracetamol", quantity: 2 }]);
  assert.equal(readItems([]), null);
  assert.equal(readItems([{ name: "x", quantity: 0 }]), null);
  assert.equal(readItems([{ name: "x", quantity: 1.5 }]), null);
  assert.equal(readItems([{ name: "", quantity: 1 }]), null);
  assert.equal(readItems("Paracetamol"), null);
});
