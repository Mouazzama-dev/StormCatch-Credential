import {
  Agent,
  DidsModule,
  KeyDidRegistrar,
  KeyDidResolver,
  JwkDidRegistrar,
  JwkDidResolver,
  WebDidResolver,
} from "@credo-ts/core";
import { agentDependencies } from "@credo-ts/node";
import { AskarModule } from "@credo-ts/askar";
import { ariesAskar } from "@hyperledger/aries-askar-nodejs";
import { OpenId4VcHolderModule } from "@credo-ts/openid4vc";
import { KeyType } from "@credo-ts/core";

// The robot's headless holder agent: askar storage + a DID + the OpenID4VC
// holder module (OID4VCI receive + OID4VP present). SD-JWT VC works out of the box.
export async function setupAgent() {
  const agent = new Agent({
    config: {
      label: "robot-holder",
      walletConfig: { id: "robot-holder", key: "insecure-demo-key" },
    },
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({ ariesAskar }),
      dids: new DidsModule({
        registrars: [new KeyDidRegistrar(), new JwkDidRegistrar()],
        resolvers: [new KeyDidResolver(), new JwkDidResolver(), new WebDidResolver()],
      }),
      openId4VcHolder: new OpenId4VcHolderModule(),
    },
  });
  await agent.initialize();
  return agent;
}

// Accept a Paradym credential offer (OID4VCI) and store the credential.
// The credentialBindingResolver creates a holder key/DID to bind the credential to (cnf).
export async function acceptOffer(
  agent: Awaited<ReturnType<typeof setupAgent>>,
  offerUri: string
) {
  const resolved = await agent.modules.openId4VcHolder.resolveCredentialOffer(offerUri);

  const credentials = await agent.modules.openId4VcHolder.acceptCredentialOfferUsingPreAuthorizedCode(
    resolved,
    {
      credentialBindingResolver: async ({ keyType, supportedDidMethods }) => {
        const method = supportedDidMethods?.some((m) => m.includes("jwk")) ? "jwk" : "key";
        const created = await agent.dids.create({
          method,
          options: { keyType: keyType ?? KeyType.P256 },
        });
        const vm = created.didState.didDocument?.verificationMethod?.[0];
        return { method: "did", didUrl: vm!.id };
      },
    }
  );

  return credentials;
}