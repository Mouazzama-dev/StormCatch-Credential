// The seam pickup, drop-off and (later) the transit gates are written against. The pilot runs the JWT backend (./jwt.ts); a VC backend over src/templates/payload.ts + Paradym issuance can implement the same interface once Paradym issuance/verification is stable.

export interface PayloadClaims {
  jti: string;
  payload_type: string;
  // The robot id the payload was handed to.
  sub: string;
  iat: number;
  exp: number;
  // What was loaded, as the pickup desk listed it (the medication is virtual in the pilot). Absent when the desk listed nothing.
  contents?: string[];
}

export type VerifyResult =
  | { ok: true; claims: PayloadClaims }
  | { ok: false; reason: "malformed" | "invalid-signature" | "expired" | "revoked" };

export interface PayloadBackend {
  issue(payloadType: string, robotId: string, contents?: string[]): Promise<{ token: string; jti: string }>;
  // Signature, expiry and blacklist. Binding to a robot (sub == robotId) is the caller's check.
  verify(token: string): Promise<VerifyResult>;
  revoke(jti: string, reason?: string): Promise<void>;
}
