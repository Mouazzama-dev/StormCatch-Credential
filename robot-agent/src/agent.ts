import {
  Agent,
  DidsModule,
  KeyDidRegistrar,
  KeyDidResolver,
  JwkDidRegistrar,
  JwkDidResolver,
} from "@credo-ts/core";
import { agentDependencies } from "@credo-ts/node";
import { AskarModule } from "@credo-ts/askar";
import { ariesAskar } from "@hyperledger/aries-askar-nodejs";
import { OpenId4VcHolderModule } from "@credo-ts/openid4vc";

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
        resolvers: [new KeyDidResolver(), new JwkDidResolver()],
      }),
      openId4VcHolder: new OpenId4VcHolderModule(),
    },
  });
  await agent.initialize();
  return agent;
}