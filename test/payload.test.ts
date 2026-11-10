// OFFLINE test - no running services needed. The JWT payload backend and the file blacklist: issue, verify, revoke, and the ways a token is rejected. Safe for CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateKeyPair } from "jose";
import { FileBlacklist } from "../src/payload/blacklist.ts";
import { JwtPayloadBackend } from "../src/payload/jwt.ts";

const ROBOT = "urn:stormcatch:robot:SC-M1:SN-2026-000123";
const keys = await generateKeyPair("ES256");
const tmpFile = () => path.join(mkdtempSync(path.join(tmpdir(), "payload-")), "blacklist.json");
const backend = (ttl = 3600, file = tmpFile()) => new JwtPayloadBackend(keys, new FileBlacklist(file), ttl);

test("payload: issue then verify returns the claims", async () => {
  const b = backend();
  const { token, jti } = await b.issue("sc:medicine", ROBOT);
  const v = await b.verify(token);
  assert.ok(v.ok);
  assert.equal(v.claims.jti, jti);
  assert.equal(v.claims.sub, ROBOT);
  assert.equal(v.claims.payload_type, "sc:medicine");
  assert.equal(v.claims.exp - v.claims.iat, 3600);
});

test("payload: contents travel in the token, and are left out when empty", async () => {
  const b = backend();
  const listed = await b.verify((await b.issue("sc:medicine", ROBOT, ["Paracetamol 500 mg x 20", "Insulin pen x 2"])).token);
  assert.ok(listed.ok);
  assert.deepEqual(listed.claims.contents, ["Paracetamol 500 mg x 20", "Insulin pen x 2"]);
  const empty = await b.verify((await b.issue("sc:medicine", ROBOT, [])).token);
  assert.ok(empty.ok);
  assert.equal("contents" in empty.claims, false);
});

test("payload: each issue gets its own jti", async () => {
  const b = backend();
  const a = await b.issue("sc:medicine", ROBOT);
  const c = await b.issue("sc:medicine", ROBOT);
  assert.notEqual(a.jti, c.jti);
});

test("payload: a revoked token is rejected as revoked", async () => {
  const b = backend();
  const { token, jti } = await b.issue("sc:medicine", ROBOT);
  await b.revoke(jti, "received");
  assert.deepEqual(await b.verify(token), { ok: false, reason: "revoked" });
});

test("payload: the blacklist is shared through the file across backends", async () => {
  const file = tmpFile();
  const pickup = backend(3600, file);
  const dropoff = backend(3600, file);
  const { token, jti } = await pickup.issue("sc:medicine", ROBOT);
  await dropoff.revoke(jti);
  assert.deepEqual(await pickup.verify(token), { ok: false, reason: "revoked" });
});

test("payload: an expired token is rejected as expired", async () => {
  const b = backend(-60);
  const { token } = await b.issue("sc:medicine", ROBOT);
  assert.deepEqual(await b.verify(token), { ok: false, reason: "expired" });
});

test("payload: a token signed by another key is rejected", async () => {
  const other = new JwtPayloadBackend(await generateKeyPair("ES256"), new FileBlacklist(tmpFile()), 3600);
  const { token } = await other.issue("sc:medicine", ROBOT);
  assert.deepEqual(await backend().verify(token), { ok: false, reason: "invalid-signature" });
});

test("payload: a tampered token is rejected", async () => {
  const b = backend();
  const { token } = await b.issue("sc:medicine", ROBOT);
  const [h, p, s] = token.split(".");
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  claims.sub = "urn:stormcatch:robot:SC-M1:SN-OTHER";
  const forged = [h, Buffer.from(JSON.stringify(claims)).toString("base64url"), s].join(".");
  assert.deepEqual(await b.verify(forged), { ok: false, reason: "invalid-signature" });
});

test("payload: garbage is rejected as malformed", async () => {
  assert.deepEqual(await backend().verify("not-a-jwt"), { ok: false, reason: "malformed" });
});

test("payload: a verify-only backend (public key alone) cannot mint", async () => {
  const verifier = new JwtPayloadBackend({ publicKey: keys.publicKey }, new FileBlacklist(tmpFile()), 3600);
  await assert.rejects(verifier.issue("sc:medicine", ROBOT), /no payload signing key/);
});

test("blacklist: add is idempotent and has reports membership", async () => {
  const bl = new FileBlacklist(tmpFile());
  assert.equal(await bl.has("j1"), false);
  await bl.add("j1", "received");
  await bl.add("j1", "received");
  assert.equal(await bl.has("j1"), true);
  assert.equal(await bl.has("j2"), false);
});
