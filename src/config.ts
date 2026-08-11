import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env variable: ${name} — check your .env file`);
  }
  return value;
}

export const config = {
  apiKey: required("PARADYM_API_KEY"),
  walletId: required("PARADYM_WALLET_ID"),
  baseUrl:"https://api.paradym.id",
  didId: required("PARADYM_DID_ID"),
  payloadTemplateId: required("PARADYM_PAYLOAD_TEMPLATE_ID"),
  payloadType: required("PARADYM_PAYLOAD_TYPE"),
  presentationTemplateId: required("PARADYM_PRESENTATION_TEMPLATE_ID"),
  taskAuthTemplateId: required("PARADYM_TASKAUTH_TEMPLATE_ID"),
  taskAuthType: required("PARADYM_TASKAUTH_TYPE"),
  gate2TemplateId: process.env.PARADYM_GATE2_TEMPLATE_ID ?? "",
  gate1TemplateId: process.env.PARADYM_GATE1_TEMPLATE_ID ?? "",
  trustedEntityId: process.env.PARADYM_TRUSTED_ENTITY_ID ?? "",
};

