import express from "express";
import {
  DidKey,
  DidJwk,
  Kms,
  X509Module,
  W3cCredentialRecord,
  W3cV2CredentialRecord,
  MdocRecord,
  Agent,
} from "@credo-ts/core";
import { agentDependencies } from "@credo-ts/node";
import { AskarModule } from "@credo-ts/askar";
import { askar } from "@openwallet-foundation/askar-nodejs";
import { OpenId4VcModule } from "@credo-ts/openid4vc";

export async function setupAgent() {
  const app = express();
  const agent = new Agent({
    config: { label: "robot-holder" },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({ askar, store: { id: "robot-holder", key: "insecure-demo-key" } }),
      openid4vc: new OpenId4VcModule({ app }),
      x509: new X509Module({
        getTrustedCertificatesForVerification: (_ctx, { certificateChain }) => [certificateChain[0].toString("pem")],
      }),
    },
  });
  await agent.initialize();
  return agent;
}

export async function acceptOffer(agent, offerUri, txCode) {
  const holder = agent.modules.openid4vc.holder;
  const resolved = await holder.resolveCredentialOffer(offerUri);
  const tokenResponse = await holder.requestToken({ resolvedCredentialOffer: resolved, txCode });
  const credentialResponse = await holder.requestCredentials({
    resolvedCredentialOffer: resolved,
    credentialConfigurationIds: Object.keys(resolved.offeredCredentialConfigurations),
    credentialBindingResolver: async ({ supportedDidMethods, supportsAllDidMethods, proofTypes }) => {
      const key = await agent.kms.createKeyForSignatureAlgorithm({
        algorithm: proofTypes.jwt?.supportedSignatureAlgorithms[0] ?? "EdDSA",
      });
      const publicJwk = Kms.PublicJwk.fromPublicJwk(key.publicJwk);
      if (supportsAllDidMethods || supportedDidMethods?.includes("did:key")) {
        await agent.dids.create({ method: "key", options: { keyId: key.keyId } });
        const didKey = new DidKey(publicJwk);
        return { method: "did", didUrls: [`${didKey.did}#${didKey.publicJwk.fingerprint}`] };
      }
      if (supportedDidMethods?.includes("did:jwk")) {
        const didJwk = DidJwk.fromPublicJwk(publicJwk);
        await agent.dids.create({ method: "jwk", options: { keyId: key.keyId } });
        return { method: "did", didUrls: [`${didJwk.did}#0`] };
      }
      return { method: "jwk", keys: [publicJwk] };
    },
    ...tokenResponse,
  });
  const stored = await Promise.all(
    credentialResponse.credentials.map((c) => {
      if (c.record instanceof W3cCredentialRecord) return agent.w3cCredentials.store({ record: c.record });
      if (c.record instanceof W3cV2CredentialRecord) return agent.w3cV2Credentials.store({ record: c.record });
      if (c.record instanceof MdocRecord) return agent.mdoc.store({ record: c.record });
      return agent.sdJwtVc.store({ record: c.record });
    })
  );
  return stored;
}

export async function presentCredential(agent, requestUri) {
  const holder = agent.modules.openid4vc.holder;
  const resolved = await holder.resolveOpenId4VpAuthorizationRequest(requestUri);
  if (!resolved.presentationExchange && !resolved.dcql) {
    throw new Error("Request has neither DCQL nor Presentation Exchange");
  }
  return await holder.acceptOpenId4VpAuthorizationRequest({
    authorizationRequestPayload: resolved.authorizationRequestPayload,
    dcql: resolved.dcql
      ? { credentials: holder.selectCredentialsForDcqlRequest(resolved.dcql.queryResult) }
      : undefined,
    presentationExchange: resolved.presentationExchange
      ? { credentials: holder.selectCredentialsForPresentationExchangeRequest(resolved.presentationExchange.credentialsForRequest) }
      : undefined,
  });
}