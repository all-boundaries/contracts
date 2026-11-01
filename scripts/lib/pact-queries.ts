import { brokerUrl, getJson } from "./broker";
import type { Pact } from "./contract-diff";

export const fetchPact = (provider: string, consumer: string, version: string) =>
  getJson<Pact>(`${brokerUrl}/pacts/provider/${provider}/consumer/${consumer}/version/${encodeURIComponent(version)}`);

type PactResource = { _links?: Record<string, { href: string } | undefined> };

// A pact whose content no provider version has verified yet: what a contract_content_changed webhook reacts to.
export async function isUnverified(provider: string, consumer: string, version: string): Promise<boolean> {
  const pact = await getJson<PactResource>(
    `${brokerUrl}/pacts/provider/${provider}/consumer/${consumer}/version/${encodeURIComponent(version)}`,
  );
  const link = pact?._links?.["pb:latest-verification-results"]?.href;
  if (!link) return true;
  return (await getJson(link)) === undefined;
}
