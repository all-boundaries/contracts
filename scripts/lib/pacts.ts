import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Pact } from "./contract-diff";

export type LocalPact = { file: string; pact: Pact };
export type PactSelection = { publishable: LocalPact[]; skipped: { file: string; reason: string }[] };

export async function readLocalPacts(dir: string): Promise<LocalPact[]> {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
  return Promise.all(names.map(async (name) => ({ file: join(dir, name), pact: (await Bun.file(join(dir, name)).json()) as Pact })));
}

// Only a pact this service wrote about another team service may reach the broker. A pact about a third party (the
// card processor) can never be verified by its provider, so publishing it would make can-i-deploy fail forever.
export function selectPublishable(service: string, teamServices: string[], pacts: LocalPact[]): PactSelection {
  const selection: PactSelection = { publishable: [], skipped: [] };
  for (const local of pacts) {
    const { consumer, provider } = local.pact;
    if (consumer.name !== service) selection.skipped.push({ file: local.file, reason: `consumer is ${consumer.name}, not ${service}` });
    else if (!teamServices.includes(provider.name)) selection.skipped.push({ file: local.file, reason: `${provider.name} is not a team service` });
    else selection.publishable.push(local);
  }
  return selection;
}
