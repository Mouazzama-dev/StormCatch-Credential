// The browser never talks to the services directly: these routes forward to them server-side, so the services need no CORS and their addresses stay in the UI's environment.
export const SERVICES = {
  pickup: process.env.PICKUP_URL ?? "http://localhost:4005",
  dropoff: process.env.DROPOFF_URL ?? "http://localhost:4006",
};

export async function forward(base: string, path: string, req: Request): Promise<Response> {
  try {
    const r = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await req.text(),
      cache: "no-store",
    });
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: `service at ${base} is not reachable`, reason: "service-down" }, { status: 503 });
  }
}
