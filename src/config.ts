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
};
