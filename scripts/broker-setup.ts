// Makes a fresh broker ready for the pipeline: exactly the environments staging and production, and none of the
// example applications the image seeds. Safe to run repeatedly.
import { brokerRequest, brokerUrl, getJson } from "./lib/broker";

const wanted = [
  { name: "staging", displayName: "Staging", production: false },
  { name: "production", displayName: "Production", production: true },
];

type Environment = { uuid: string; name: string; production: boolean };
type Environments = { _embedded: { environments: Environment[] } };

async function existing() {
  const body = await getJson<Environments>(`${brokerUrl}/environments`);
  return body?._embedded.environments ?? [];
}

for (const environment of await existing()) {
  if (wanted.some((w) => w.name === environment.name)) continue;
  const response = await brokerRequest(`${brokerUrl}/environments/${environment.uuid}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`could not delete environment ${environment.name}: ${response.status} ${await response.text()}`);
  console.log(`removed environment ${environment.name}`);
}

const present = new Set((await existing()).map((e) => e.name));
for (const environment of wanted) {
  if (present.has(environment.name)) continue;
  const response = await brokerRequest(`${brokerUrl}/environments`, { method: "POST", body: JSON.stringify(environment) });
  if (!response.ok) throw new Error(`could not create environment ${environment.name}: ${response.status} ${await response.text()}`);
  console.log(`created environment ${environment.name}`);
}

console.log(`environments: ${(await existing()).map((e) => e.name).join(", ")}`);

// The image seeds a fresh database with two example applications deployed to production, which would be compared
// against in can-i-deploy for nothing.
for (const name of ["Example App", "Example API"]) {
  const response = await brokerRequest(`${brokerUrl}/pacticipants/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (response.ok) console.log(`removed example application ${name}`);
  else if (response.status !== 404) throw new Error(`could not delete ${name}: ${response.status} ${await response.text()}`);
}
