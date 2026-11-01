import { describe, expect, it } from "bun:test";
import { describeChanges, diffPacts, type Interaction, type Pact } from "../scripts/lib/contract-diff";
import { formatTagMessage } from "../scripts/lib/changelog";
import { selectPublishable } from "../scripts/lib/pacts";
import { parseSemver } from "../scripts/lib/version";

const pact = (consumer: string, provider: string, interactions: Interaction[]): Pact => ({
  consumer: { name: consumer },
  provider: { name: provider },
  interactions,
});
const charge = (body: object, key = "k1"): Interaction => ({
  key,
  description: "a charge request",
  providerStates: [{ name: "a subscription can be charged" }],
  request: { method: "POST", path: "/charges" },
  response: { status: 201, body },
});

describe("diffPacts", () => {
  it("sees nothing when only noise differs", () => {
    const before = pact("subscriptions", "payments", [{ ...charge({ chargeId: "ch-1" }), pending: false }]);
    const after = pact("subscriptions", "payments", [charge({ chargeId: "ch-1" }, "k2")]);
    expect(diffPacts(before, after)).toEqual([]);
  });

  it("sees an added interaction, and all of them when there was no earlier pact", () => {
    const after = pact("subscriptions", "payments", [charge({ chargeId: "ch-1" })]);
    expect(diffPacts(pact("subscriptions", "payments", []), after)).toEqual([
      { kind: "added", interaction: "a charge request (given a subscription can be charged)" },
    ]);
    expect(diffPacts(undefined, after)).toHaveLength(1);
  });

  it("sees a removed interaction", () => {
    const before = pact("subscriptions", "payments", [charge({ chargeId: "ch-1" })]);
    expect(diffPacts(before, pact("subscriptions", "payments", []))[0]?.kind).toBe("removed");
  });

  it("sees a changed response and names the part that changed", () => {
    const before = pact("subscriptions", "payments", [charge({ chargeId: "ch-1" })]);
    const after = pact("subscriptions", "payments", [charge({ chargeId: "ch-1", status: "pending" })]);
    expect(diffPacts(before, after)).toEqual([
      { kind: "changed", interaction: "a charge request (given a subscription can be charged)", detail: "response" },
    ]);
  });

  it("does not care about key order", () => {
    const before = pact("subscriptions", "payments", [charge({ a: 1, b: 2 })]);
    const after = pact("subscriptions", "payments", [charge({ b: 2, a: 1 })]);
    expect(diffPacts(before, after)).toEqual([]);
  });

  it("reads message pacts written as messages", () => {
    const message = { description: "an AccountClosed message", contents: { id: 1 } };
    const before: Pact = { consumer: { name: "subscriptions" }, provider: { name: "accounts" }, messages: [] };
    const after: Pact = { ...before, messages: [message] };
    expect(diffPacts(before, after)).toEqual([{ kind: "added", interaction: "an AccountClosed message" }]);
  });

  it("describes the changes per integration", () => {
    const after = pact("subscriptions", "payments", [charge({ chargeId: "ch-1" })]);
    expect(describeChanges(after, diffPacts(undefined, after))).toEqual([
      "subscriptions -> payments",
      "  + added: a charge request (given a subscription can be charged)",
    ]);
    expect(describeChanges(after, [])).toEqual([]);
  });
});

describe("selectPublishable", () => {
  const team = ["payments", "inventory", "subscriptions"];
  const local = (consumer: string, provider: string) => ({ file: `pacts/${consumer}-${provider}.json`, pact: pact(consumer, provider, []) });

  it("keeps pacts this service wrote about team services", () => {
    const { publishable, skipped } = selectPublishable("subscriptions", team, [local("subscriptions", "payments")]);
    expect(publishable).toHaveLength(1);
    expect(skipped).toEqual([]);
  });

  it("never publishes a pact about a third party", () => {
    const { publishable, skipped } = selectPublishable("payments", team, [local("payments", "processor")]);
    expect(publishable).toEqual([]);
    expect(skipped[0]?.reason).toContain("processor is not a team service");
  });

  it("does not publish another service's pact", () => {
    expect(selectPublishable("payments", team, [local("subscriptions", "payments")]).publishable).toEqual([]);
  });
});

describe("formatTagMessage", () => {
  const notes = {
    semver: parseSemver("0.2.0"),
    previous: { tag: "v0.1.0", semver: parseSemver("0.1.0"), commit: "abc" },
    bump: "minor" as const,
    subjects: ["Add a feature", "Fix a thing"],
    contractChanges: ["subscriptions -> payments", "  + added: a charge request"],
  };

  it("lists the commit subjects and the contract changes", () => {
    expect(formatTagMessage(notes)).toBe(
      [
        "Release 0.2.0",
        "",
        "Changes since v0.1.0 (minor bump)",
        "- Add a feature",
        "- Fix a thing",
        "",
        "Contract changes",
        "subscriptions -> payments",
        "  + added: a charge request",
        "",
      ].join("\n"),
    );
  });

  it("says so when no pact changed", () => {
    expect(formatTagMessage({ ...notes, contractChanges: [] })).toContain("No change to the pacts this service publishes.");
  });
});
