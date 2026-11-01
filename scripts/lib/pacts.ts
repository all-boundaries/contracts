import { join } from "node:path";
import type { Pact } from "./contract-diff";

export type LocalPact = { file: string; pact: Pact };
export type PactSelection = { publishable: LocalPact[]; skipped: { file: string; reason: string }[] };

// `pactDirs` are relative to the repository and may use `*` for one path segment (features/*/pacts).
export async function readLocalPacts(repo: string, pactDirs: string[] = ["pacts"]): Promise<LocalPact[]> {
  const files = pactDirs.flatMap((dir) => [...new Bun.Glob(join(dir, "*.json")).scanSync({ cwd: repo, absolute: true })]).sort();
  return Promise.all(files.map(async (file) => ({ file, pact: (await Bun.file(file).json()) as Pact })));
}

// Only a pact this service wrote about another team service may reach the broker. A pact about a third party (the
// card processor) can never be verified by its provider, so publishing it would make can-i-deploy fail forever.
export function selectPublishable(pacticipants: string | string[], teamServices: string[], pacts: LocalPact[]): PactSelection {
  const own = [pacticipants].flat();
  const selection: PactSelection = { publishable: [], skipped: [] };
  for (const local of pacts) {
    const { consumer, provider } = local.pact;
    if (!own.includes(consumer.name)) selection.skipped.push({ file: local.file, reason: `consumer is ${consumer.name}, not ${own.join(" or ")}` });
    else if (!teamServices.includes(provider.name)) selection.skipped.push({ file: local.file, reason: `${provider.name} is not a team service` });
    else selection.publishable.push(local);
  }
  return selection;
}
