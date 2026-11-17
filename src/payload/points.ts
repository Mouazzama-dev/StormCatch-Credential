// The policy engine's point ids (stormcatch-policy-sdk, topology.ts) are the names the token uses, so the token and the engine talk about the same places. Martin's demo names are accepted and mapped.

export const pointUrn = (pointId: string) => `urn:stormcatch:point:${pointId}`;

// Routes of the pilot procedures (stormcatch-design, pilot/umv/procedure): A ends at the ward I-2, B at the clean-room ward I-3 via the decontamination point I-4.
const ROUTES: Record<string, string[]> = {
  "I-1>I-2": ["I-1", "G-1", "G-2", "G-3", "I-2"],
  "I-1>I-3": ["I-1", "G-1", "G-2", "G-4", "I-4", "G-5", "I-3"],
};

// Martin's names from his task demo, for tokens or requests written in them.
const ALIASES: Record<string, string> = {
  "gate-pharmacy": "I-1",
  "gate-ward-3b": "I-2",
};

export function toPointId(name: string): string {
  return ALIASES[name] ?? name;
}

export function routeOf(from: string, to: string): string[] | undefined {
  return ROUTES[`${from}>${to}`];
}
