import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

// Dev-only secrets (the keypair, the issuer token) are written once to a gitignored file so all services on one machine share them. link() fails if the file exists, so when several services start together exactly one value lands and the others read it instead of overwriting it.
export async function devFileOnce(file: string, make: () => Promise<string>, label: string): Promise<string> {
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, await make(), { mode: 0o600 });
    try {
      linkSync(tmp, file);
      console.warn(`[payload] generated a DEV ${label} at ${file}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    } finally {
      unlinkSync(tmp);
    }
  }
  return readFileSync(file, "utf8");
}
