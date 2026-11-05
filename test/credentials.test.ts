// Which credential is which in a forwarded session, and what the decision service reads
// off the birth certificate. Pure, no service needed. The birth certificate shape is the
// crt-demo sample of 2026-10-08 as Paradym would present it (nested claims under birthEK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BIRTH_CERTIFICATE_VCT,
  X509_ROOT_PREFIX,
  anchoredBirthFacts,
  birthFacts,
  issuerKey,
  pickBirthCertificate,
  pickTaskAuth,
  robotUid,
} from "../src/services/decision/credentials.ts";

// Fixture certificates (certs only, no keys): a self-signed test root and an end-entity leaf
// it signed, plus a leaf signed by a different root. Generated with openssl to mirror the
// crt-demo shape (CA:TRUE pathlen 0 root, CA:FALSE digitalSignature leaf).
const fx = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const rootPem = readFileSync(path.join(fx, "birth-root.pem"), "utf8");
const leafPem = readFileSync(path.join(fx, "birth-leaf.pem"), "utf8");
const otherLeafPem = readFileSync(path.join(fx, "birth-leaf-other.pem"), "utf8");
const rootAnchor = `${X509_ROOT_PREFIX}${Buffer.from(rootPem).toString("base64")}`;

// A birth certificate credential issued by a given X.509 leaf.
const birthSignedBy = (certificate: string) => ({
  ...birth,
  issuer: { certificate, commonName: "Robot Birth Certificate EK" },
});

const TASK_VCT = "https://metadata.paradym.id/types/SvumIWqCOX-StormcatchTaskAuthorization";

const taskAuth = {
  isValid: true,
  issuer: "did:web:metadata.paradym.id:ef433d64-2c1b-4761-907d-3535885857c8",
  presentedAttributes: { vct: TASK_VCT, action: "sc:zone_access", scope: "1", exp: 1792886400 },
};

const birth = {
  isValid: true,
  issuer: { certificate: "-----BEGIN CERTIFICATE-----...", commonName: "Stormcatch Certificate Manager Credential Issuer" },
  presentedAttributes: {
    vct: BIRTH_CERTIFICATE_VCT,
    // The EK certificate's own serial, never the robot's.
    serialNumber: "0c28a9c49bdcabf2bc4802163e401cbb3a578328",
    subject: { C: "NL", O: "Stormcatch", CN: "Robot Birth Certificate EK" },
    birthEK: { serial: "SC-ROBOT-0001", model: "SC-Model-X", hwRev: "Rev-A" },
  },
};

test("task auth is found by vct whichever position the holder gave it", () => {
  assert.equal(pickTaskAuth({ credentials: [birth, taskAuth] }), taskAuth);
  assert.equal(pickTaskAuth({ credentials: [taskAuth, birth] }), taskAuth);
});

test("task auth without a vct is found by its action claim, and a lone credential by position", () => {
  const noVct = { presentedAttributes: { action: "sc:zone_access", scope: "1" } };
  assert.equal(pickTaskAuth({ credentials: [birth, noVct] }), noVct);
  const bare = { presentedAttributes: { exp: 1 } };
  assert.equal(pickTaskAuth({ credentials: [bare] }), bare);
  assert.equal(pickTaskAuth({ credentials: [] }), undefined);
  assert.equal(pickTaskAuth(undefined), undefined);
  assert.equal(pickTaskAuth({ credentials: "nope" }), undefined);
});

test("birth certificate is found by its exact vct and only by it", () => {
  assert.equal(pickBirthCertificate({ credentials: [taskAuth, birth] }), birth);
  assert.equal(pickBirthCertificate({ credentials: [taskAuth] }), undefined);
  const lookalike = { presentedAttributes: { vct: BIRTH_CERTIFICATE_VCT + "-v2", birthEK: { serial: "x", model: "y" } } };
  assert.equal(pickBirthCertificate({ credentials: [lookalike] }), undefined);
});

test("serial and model are read from birthEK, not from the top-level serialNumber", () => {
  assert.deepEqual(birthFacts(birth), { serialNumber: "SC-ROBOT-0001", model: "SC-Model-X" });
});

test("a missing or malformed birthEK field stays absent rather than defaulted", () => {
  assert.deepEqual(birthFacts(undefined), {});
  assert.deepEqual(birthFacts({ presentedAttributes: { vct: BIRTH_CERTIFICATE_VCT } }), {});
  assert.deepEqual(birthFacts({ presentedAttributes: { birthEK: "SC-ROBOT-0001" } }), {});
  assert.deepEqual(birthFacts({ presentedAttributes: { birthEK: { serial: "", model: 7 } } }), {});
  assert.deepEqual(birthFacts({ presentedAttributes: { birthEK: { model: "SC-Model-X" } } }), { model: "SC-Model-X" });
});

test("an X.509 issuer is keyed by its certificate fingerprint, never by its commonName", () => {
  const der = Buffer.from("not really a certificate, but bytes");
  const pem = `-----BEGIN CERTIFICATE-----\n${der.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----\n`;
  const expected = `sha256:${createHash("sha256").update(der).digest("hex")}`;
  assert.equal(issuerKey({ issuer: { certificate: pem, commonName: "anything" } }), expected);
  assert.equal(issuerKey({ issuer: { certificate: pem.replace(/\n/g, ""), commonName: "x" } }), expected, "line wrapping does not change the key");
  assert.equal(issuerKey({ issuer: "did:web:example" }), "did:web:example");
  assert.equal(issuerKey({ issuer: "" }), undefined);
  assert.equal(issuerKey({ issuer: { commonName: "no certificate" } }), undefined);
  assert.equal(issuerKey(undefined), undefined);
});

test("birth facts are read only from an anchored issuer; an empty anchor list reads nothing", () => {
  const pem = "-----BEGIN CERTIFICATE-----\nAAEC\n-----END CERTIFICATE-----";
  const key = issuerKey({ issuer: { certificate: pem, commonName: "x" } })!;
  const anchoredBirth = { ...birth, issuer: { certificate: pem, commonName: "Stormcatch Certificate Manager Credential Issuer" } };
  assert.deepEqual(anchoredBirthFacts(anchoredBirth, [key]), {
    facts: { serialNumber: "SC-ROBOT-0001", model: "SC-Model-X" },
    issuer: key,
    anchored: true,
  });
  assert.deepEqual(anchoredBirthFacts(anchoredBirth, []), { facts: {}, issuer: key, anchored: false });
  assert.deepEqual(anchoredBirthFacts(anchoredBirth, ["sha256:0000"]), { facts: {}, issuer: key, anchored: false });
  // Same commonName, different certificate: not anchored.
  const lookalike = { ...anchoredBirth, issuer: { certificate: "-----BEGIN CERTIFICATE-----\nAAED\n-----END CERTIFICATE-----", commonName: "Stormcatch Certificate Manager Credential Issuer" } };
  assert.equal(anchoredBirthFacts(lookalike, [key]).anchored, false);
  assert.deepEqual(anchoredBirthFacts(undefined, [key]), { facts: {}, issuer: undefined, anchored: false });
});

test("the robot uid is a URN of model and serial, and absent when either is missing", () => {
  assert.equal(robotUid({ serialNumber: "SC-ROBOT-0001", model: "SC-Model-X" }), "urn:stormcatch:robot:SC-Model-X:SC-ROBOT-0001");
  assert.equal(robotUid({ serialNumber: "SC/ROBOT 1", model: "M:1" }), "urn:stormcatch:robot:M%3A1:SC%2FROBOT%201", "separators in the parts are encoded");
  assert.equal(robotUid({ serialNumber: "SC-ROBOT-0001" }), undefined);
  assert.equal(robotUid({ model: "SC-Model-X" }), undefined);
  assert.equal(robotUid({}), undefined);
});

test("a birth cert whose leaf chains to an x509root anchor is anchored, any leaf under that root", () => {
  const r = anchoredBirthFacts(birthSignedBy(leafPem), [rootAnchor]);
  assert.equal(r.anchored, true, "a leaf signed by the anchored root is trusted");
  assert.deepEqual(r.facts, { serialNumber: "SC-ROBOT-0001", model: "SC-Model-X" });
});

test("a birth cert signed by a different root is not anchored", () => {
  const r = anchoredBirthFacts(birthSignedBy(otherLeafPem), [rootAnchor]);
  assert.equal(r.anchored, false, "a leaf from another root does not chain to the anchor");
  assert.deepEqual(r.facts, {});
});

test("exact fingerprint and x509root anchors coexist; either form anchors", () => {
  // The other-root leaf does not chain to rootAnchor, but pinning its exact fingerprint still
  // anchors it - the two anchor forms live in one list.
  const fp = issuerKey(birthSignedBy(otherLeafPem))!;
  assert.equal(anchoredBirthFacts(birthSignedBy(otherLeafPem), [rootAnchor, fp]).anchored, true);
  // And the root anchor still anchors its own leaf alongside the unrelated pin.
  assert.equal(anchoredBirthFacts(birthSignedBy(leafPem), [rootAnchor, fp]).anchored, true);
});

test("a malformed x509root anchor is skipped, not fatal, and does not anchor", () => {
  assert.equal(anchoredBirthFacts(birthSignedBy(leafPem), [`${X509_ROOT_PREFIX}not-base64-a-cert`]).anchored, false);
  // A good anchor after a bad one still works: one bad entry must not disable the rest.
  assert.equal(anchoredBirthFacts(birthSignedBy(leafPem), [`${X509_ROOT_PREFIX}zzzz`, rootAnchor]).anchored, true);
});

test("a DID-issuer birth cert is never chain-anchored (no certificate to validate)", () => {
  const didBirth = { ...birth, issuer: "did:web:example" };
  assert.equal(anchoredBirthFacts(didBirth, [rootAnchor]).anchored, false);
});
