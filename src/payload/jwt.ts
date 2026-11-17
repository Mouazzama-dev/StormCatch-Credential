import { randomUUID } from "node:crypto";
import { SignJWT, calculateJwkThumbprint, errors, exportJWK, exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, importSPKI, jwtVerify } from "jose";
import type { CryptoKey } from "jose";
import type { Blacklist } from "./blacklist.ts";
import { devFileOnce } from "./devfile.ts";
import { pointUrn } from "./points.ts";
import type { IssueOptions, PayloadBackend, Task, TaskClaims, VerifyResult } from "./types.ts";

// Pilot payload backend: the task is an ES256-signed JWT (`typ: task+jwt`, the format agreed with Martin). The central server holds the private key and mints; the desks and gates hold only the public key, so they can verify but never mint.
const ALG = "ES256";
const TYP = "task+jwt";

export type JwtKeys = { privateKey?: CryptoKey; publicKey: CryptoKey };

export class JwtPayloadBackend implements PayloadBackend {
  private kid?: Promise<string>;

  constructor(
    private readonly keys: JwtKeys,
    private readonly blacklist: Blacklist,
    private readonly ttlSeconds: number,
    private readonly issuer: string
  ) {}

  // The key id is the public key's JWK thumbprint, so a verifier holding several keys can pick the right one.
  private keyId(): Promise<string> {
    this.kid ??= exportJWK(this.keys.publicKey).then((jwk) => calculateJwkThumbprint(jwk));
    return this.kid;
  }

  async issue(robotId: string, task: Task, options: IssueOptions = {}): Promise<{ token: string; jti: string }> {
    if (!this.keys.privateKey) throw new Error("this service has no signing key (PAYLOAD_PRIVATE_KEY): only the central server issues");
    const jti = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      ...(options.cnfThumbprint ? { cnf: { "x5t#S256": options.cnfThumbprint } } : {}),
      task,
    })
      .setProtectedHeader({ alg: ALG, typ: TYP, kid: await this.keyId() })
      .setIssuer(this.issuer)
      .setSubject(robotId)
      .setAudience(task.gates.map(pointUrn))
      .setJti(jti)
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(now + this.ttlSeconds)
      .sign(this.keys.privateKey);
    return { token, jti };
  }

  async verify(token: string, audience?: string): Promise<VerifyResult> {
    let claims: TaskClaims;
    try {
      const { payload } = await jwtVerify(token, this.keys.publicKey, {
        algorithms: [ALG],
        typ: TYP,
        issuer: this.issuer,
        ...(audience ? { audience } : {}),
        requiredClaims: ["iss", "sub", "aud", "jti", "iat", "nbf", "exp", "task"],
      });
      claims = payload as unknown as TaskClaims;
    } catch (err) {
      if (err instanceof errors.JWTExpired) return { ok: false, reason: "expired" };
      if (err instanceof errors.JWSSignatureVerificationFailed) return { ok: false, reason: "invalid-signature" };
      if (err instanceof errors.JWTClaimValidationFailed) {
        if (err.claim === "iss") return { ok: false, reason: "invalid-issuer" };
        if (err.claim === "nbf") return { ok: false, reason: "not-yet-valid" };
        if (err.claim === "aud") return { ok: false, reason: "wrong-point" };
      }
      return { ok: false, reason: "malformed" };
    }
    if (await this.blacklist.has(claims.jti)) return { ok: false, reason: "revoked" };
    return { ok: true, claims };
  }

  async revoke(jti: string, reason = "revoked"): Promise<void> {
    await this.blacklist.add(jti, reason);
  }
}

// PEM from env; a .env value may carry its line breaks as literal "\n".
const pem = (v: string) => v.replace(/\\n/g, "\n");

// Keys from PAYLOAD_PRIVATE_KEY / PAYLOAD_PUBLIC_KEY (PEM: PKCS8 / SPKI). With neither set, a dev keypair is generated once into `devFile` so the services on one machine agree. A deployed desk or gate sets only PAYLOAD_PUBLIC_KEY.
export async function loadJwtKeys(devFile: string): Promise<JwtKeys> {
  const priv = process.env.PAYLOAD_PRIVATE_KEY;
  const pub = process.env.PAYLOAD_PUBLIC_KEY;
  if (pub) {
    return {
      publicKey: await importSPKI(pem(pub), ALG),
      privateKey: priv ? await importPKCS8(pem(priv), ALG) : undefined,
    };
  }
  if (priv) throw new Error("PAYLOAD_PRIVATE_KEY is set without PAYLOAD_PUBLIC_KEY");

  const raw = await devFileOnce(
    devFile,
    async () => {
      const { privateKey, publicKey } = await generateKeyPair(ALG, { extractable: true });
      return JSON.stringify({ privateKey: await exportPKCS8(privateKey), publicKey: await exportSPKI(publicKey) }, null, 2);
    },
    "keypair (no PAYLOAD_*_KEY set)"
  );
  const dev = JSON.parse(raw) as { privateKey: string; publicKey: string };
  return { privateKey: await importPKCS8(dev.privateKey, ALG), publicKey: await importSPKI(dev.publicKey, ALG) };
}
