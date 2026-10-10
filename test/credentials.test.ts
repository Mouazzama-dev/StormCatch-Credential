// Which credential is which in a forwarded session, and what the decision service reads
// off the birth certificate. Pure, no service needed. The birth certificate shape is the
// crt-demo sample of 2026-10-08 as Paradym would present it (nested claims under birthEK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  BIRTH_CERTIFICATE_VCT,
  anchoredBirthFacts,
  birthFacts,
  issuerKey,
  pickBirthCertificate,
  pickTaskAuth,
  robotUid,
} from "../src/services/decision/credentials.ts";

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
