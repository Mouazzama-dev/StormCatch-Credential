import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env variable: ${name} — check your .env file`);
  }
  return value;
}

// This process talks to ONE wallet, chosen by its role:
//   SERVICE_ROLE=facility -> issuer wallet (issue, revoke, credential templates)
//   SERVICE_ROLE=gate     -> verifier wallet (verify, presentation templates, webhook, trust)
const role = process.env.SERVICE_ROLE === "gate" ? "gate" : "facility";
const facilityWalletId = required("PARADYM_FACILITY_WALLET_ID");
const gateWalletId = required("PARADYM_GATE_WALLET_ID");

export const config = {
  apiKey: required("PARADYM_API_KEY"),
  baseUrl: "https://api.paradym.id",
  role,
  walletId: role === "gate" ? gateWalletId : facilityWalletId,
  facilityWalletId,
  gateWalletId,
  didId: process.env.PARADYM_DID_ID ?? "",
  payloadTemplateId: process.env.PARADYM_PAYLOAD_TEMPLATE_ID ?? "",
  payloadType: process.env.PARADYM_PAYLOAD_TYPE ?? "",
  presentationTemplateId: process.env.PARADYM_PRESENTATION_TEMPLATE_ID ?? "",
  taskAuthTemplateId: process.env.PARADYM_TASKAUTH_TEMPLATE_ID ?? "",
  taskAuthType: process.env.PARADYM_TASKAUTH_TYPE ?? "",
  gate2TemplateId: process.env.PARADYM_GATE2_TEMPLATE_ID ?? "",
  gate1TemplateId: process.env.PARADYM_GATE1_TEMPLATE_ID ?? "",
  trustedEntityId: process.env.PARADYM_TRUSTED_ENTITY_ID ?? "",
};