import { SERVICES } from "@/lib/proxy";

export const dynamic = "force-dynamic";

async function up(base: string): Promise<boolean> {
  try {
    return (await fetch(`${base}/health`, { cache: "no-store", signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const [pickup, dropoff] = await Promise.all([up(SERVICES.pickup), up(SERVICES.dropoff)]);
  return Response.json({ pickup, dropoff });
}
