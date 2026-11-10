import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SignJWT, errors, exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, importSPKI, jwtVerify } from "jose";
import type { CryptoKey } from "jose";
import type { Blacklist } from "./blacklist.ts";
import type { PayloadBackend, PayloadClaims, VerifyResult } from "./types.ts";

// Pilot payload backend: the payload is an ES256-signed JWT. Pickup holds the private key and mints; gates and drop-off hold only the public key, so they can verify but never mint.
const ALG = "ES256";

export type JwtKeys = { privateKey?: CryptoKey; publicKey: CryptoKey };

export class JwtPayloadBackend implements PayloadBackend {
  constructor(
    private readonly keys: JwtKeys,
    private readonly blacklist: Blacklist,
    private readonly ttlSeconds: number
  ) {}

  async issue(payloadType: string, robotId: string, contents?: string[]): Promise<{ token: string; jti: string }> {
    if (!this.keys.privateKey) throw new Error("this service has no payload signing key (PAYLOAD_PRIVATE_KEY)");
    const jti = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ payload_type: payloadType, ...(contents?.length ? { contents } : {}) })
      .setProtectedHeader({ alg: ALG, typ: "JWT" })
      .setJti(jti)
      .setSubject(robotId)
      .setIssuedAt(now)
      .setExpirationTime(now + this.ttlSeconds)
      .sign(this.keys.privateKey);
    return { token, jti };
  }

  async verify(token: string): Promise<VerifyResult> {
    let claims: PayloadClaims;
    try {
      const { payload } = await jwtVerify(token, this.keys.publicKey, {
        algorithms: [ALG],
        requiredClaims: ["jti", "sub", "iat", "exp", "payload_type"],
      });
      claims = payload as unknown as PayloadClaims;
    } catch (err) {
      if (err instanceof errors.JWTExpired) return { ok: false, reason: "expired" };
      if (err instanceof errors.JWSSignatureVerificationFailed) return { ok: false, reason: "invalid-signature" };
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

// Keys from PAYLOAD_PRIVATE_KEY / PAYLOAD_PUBLIC_KEY (PEM: PKCS8 / SPKI). With neither set, a dev keypair is generated once into `devFile` so pickup and drop-off on one machine agree. A deployed verifier sets only PAYLOAD_PUBLIC_KEY.
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

  if (!existsSync(devFile)) {
    const { privateKey, publicKey } = await generateKeyPair(ALG, { extractable: true });
    mkdirSync(path.dirname(devFile), { recursive: true });
    const tmp = `${devFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ privateKey: await exportPKCS8(privateKey), publicKey: await exportSPKI(publicKey) }, null, 2), { mode: 0o600 });
    // link() fails if the file exists, so when pickup and drop-off start together exactly one keypair lands and the other service reads it instead of overwriting it.
    try {
      linkSync(tmp, devFile);
      console.warn(`[payload] no PAYLOAD_*_KEY set, generated a DEV keypair at ${devFile}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    } finally {
      unlinkSync(tmp);
    }
  }
  const dev = JSON.parse(readFileSync(devFile, "utf8")) as { privateKey: string; publicKey: string };
  return { privateKey: await importPKCS8(dev.privateKey, ALG), publicKey: await importSPKI(dev.publicKey, ALG) };
}
