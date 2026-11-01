import { existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "./shell";
import { contractsRoot } from "./team-services";

export const brokerUrl = (process.env.PACT_BROKER_BASE_URL ?? "http://localhost:9292").replace(/\/$/, "");

function authHeaders(): Record<string, string> {
  if (process.env.PACT_BROKER_TOKEN) return { Authorization: `Bearer ${process.env.PACT_BROKER_TOKEN}` };
  const { PACT_BROKER_USERNAME: user, PACT_BROKER_PASSWORD: password } = process.env;
  if (user && password) return { Authorization: `Basic ${btoa(`${user}:${password}`)}` };
  return {};
}

// The Pact Broker client from @pact-foundation/pact-cli, installed in this repository by `bun install`.
export async function pactBroker(args: string[]): Promise<void> {
  const cli = join(contractsRoot, "node_modules", ".bin", "pact");
  if (!existsSync(cli)) throw new Error(`${cli} is missing; run bun install in ${contractsRoot}`);
  await run([cli, "broker", ...args], { env: { PACT_BROKER_BASE_URL: brokerUrl } });
}

export function brokerRequest(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = { Accept: "application/hal+json", "Content-Type": "application/json", ...authHeaders() };
  return fetch(url, { ...init, headers });
}

export async function getJson<T>(url: string): Promise<T | undefined> {
  const response = await brokerRequest(url);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`GET ${url} answered ${response.status}`);
  return (await response.json()) as T;
}
