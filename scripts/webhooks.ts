// On GitHub the broker, not a person, starts a provider's verification when a consumer publishes a changed pact:
// a webhook sends a repository_dispatch event to the provider's repository (see .github/workflows/service-pipeline.yml).
// Run once against the shared broker; it needs api.github.com in the broker's PACT_BROKER_WEBHOOK_HOST_WHITELIST.
// Not for the local broker: nothing there listens, and the local simulation verifies providers itself.
import { createHash } from "node:crypto";
import { pactBroker } from "./lib/broker";
import { githubOrganisation, teamProviders } from "./lib/team-services";

const token = process.env.GITHUB_DISPATCH_TOKEN;
if (!token) throw new Error("GITHUB_DISPATCH_TOKEN (a token that may create repository_dispatch events) is required");

// A fixed id per provider makes create-or-update replace the webhook instead of adding another.
function webhookId(provider: string): string {
  const hex = createHash("sha1").update(`verify-${provider}`).digest("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-");
}

const payload = {
  event_type: "contract_content_changed",
  client_payload: {
    consumer: "${pactbroker.consumerName}",
    consumer_branch: "${pactbroker.consumerVersionBranch}",
    pact_url: "${pactbroker.pactUrl}",
  },
};

for (const provider of teamProviders) {
  await pactBroker([
    "create-or-update-webhook",
    `https://api.github.com/repos/${githubOrganisation}/${provider}/dispatches`,
    "--uuid",
    webhookId(provider),
    "--request",
    "POST",
    "--header",
    "Content-Type: application/json",
    "Accept: application/vnd.github+json",
    `Authorization: Bearer ${token}`,
    "--data",
    JSON.stringify(payload),
    "--provider",
    provider,
    "--contract-content-changed",
    "--description",
    `Verify ${provider} when a consumer's pact changes`,
  ]);
}
