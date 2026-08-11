import { listCredentialTemplates, listDids } from "./dids/index.ts";



console.log("=== TEMPLATES ==="); console.log(JSON.stringify(await listCredentialTemplates(), null, 2)); console.log("=== DIDS ==="); console.log(JSON.stringify(await listDids(), null, 2));
