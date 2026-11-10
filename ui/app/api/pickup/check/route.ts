import { SERVICES, forward } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => forward(SERVICES.pickup, "/pickup/check", req);
