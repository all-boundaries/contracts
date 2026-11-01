export type Interaction = Record<string, unknown> & { description?: string; providerStates?: { name: string }[] };
export type Pact = {
  consumer: { name: string };
  provider: { name: string };
  interactions?: Interaction[];
  messages?: Interaction[];
};

export type ContractChange = { kind: "added" | "removed" | "changed"; interaction: string; detail?: string };

// Fields that differ between runs without the contract meaning anything different.
const ignored = new Set(["key", "pending", "comments"]);

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function identify(interaction: Interaction): string {
  const states = (interaction.providerStates ?? []).map((s) => s.name).sort();
  const given = states.length > 0 ? ` (given ${states.join(", ")})` : "";
  return `${interaction.description ?? "(no description)"}${given}`;
}

function byIdentity(pact: Pact | undefined): Map<string, Interaction> {
  const found = new Map<string, Interaction>();
  for (const interaction of pact?.interactions ?? pact?.messages ?? []) found.set(identify(interaction), interaction);
  return found;
}

function changedParts(before: Interaction, after: Interaction): string {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)].filter((k) => !ignored.has(k)));
  return [...keys].filter((k) => stable(before[k]) !== stable(after[k])).sort().join(", ");
}

// Interactions added, removed or changed between two versions of one consumer's pact with one provider.
export function diffPacts(previous: Pact | undefined, current: Pact): ContractChange[] {
  const before = byIdentity(previous);
  const after = byIdentity(current);
  const changes: ContractChange[] = [];
  for (const [name, interaction] of after) {
    const old = before.get(name);
    if (!old) changes.push({ kind: "added", interaction: name });
    else if (changedParts(old, interaction)) changes.push({ kind: "changed", interaction: name, detail: changedParts(old, interaction) });
  }
  for (const name of before.keys()) if (!after.has(name)) changes.push({ kind: "removed", interaction: name });
  return changes;
}

const marks = { added: "+", removed: "-", changed: "~" } as const;

export function describeChanges(pact: Pact, changes: ContractChange[]): string[] {
  if (changes.length === 0) return [];
  const lines = changes.map((c) => `  ${marks[c.kind]} ${c.kind}: ${c.interaction}${c.detail ? ` [${c.detail}]` : ""}`);
  return [`${pact.consumer.name} -> ${pact.provider.name}`, ...lines];
}
