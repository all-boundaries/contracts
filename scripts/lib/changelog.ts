import { type ContractChange, describeChanges, diffPacts } from "./contract-diff";
import type { LocalPact } from "./pacts";
import { fetchPact } from "./pact-queries";
import { type Bump, type Release, formatSemver, type Semver } from "./version";

export type ReleaseNotes = {
  semver: Semver;
  previous: Release;
  bump: Bump;
  subjects: string[];
  contractChanges: string[];
};

export function formatTagMessage(notes: ReleaseNotes): string {
  const changes = notes.subjects.map((subject) => `- ${subject}`);
  const contract = notes.contractChanges.length > 0 ? notes.contractChanges : ["No change to the pacts this service publishes."];
  return [
    `Release ${formatSemver(notes.semver)}`,
    "",
    `Changes since ${notes.previous.tag} (${notes.bump} bump)`,
    ...(changes.length > 0 ? changes : ["- none"]),
    "",
    "Contract changes",
    ...contract,
    "",
  ].join("\n");
}

// Compares the pacts about to be published with the ones the previous release published, as the broker holds them.
export async function contractChangeLines(pacts: LocalPact[], previousVersion: string): Promise<string[]> {
  const lines: string[] = [];
  for (const { pact } of pacts) {
    const before = await fetchPact(pact.provider.name, pact.consumer.name, previousVersion);
    const changes: ContractChange[] = diffPacts(before, pact);
    lines.push(...describeChanges(pact, changes));
  }
  return lines;
}
