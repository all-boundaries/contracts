// SIMULATED deployment: records what would be live where in .deployments/<environment>/<service>.json.
// The real deployment replaces deployService(); the gate before it and the recording after it stay as they are.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { contractsRoot } from "./lib/team-services";

const deploymentsDir = process.env.SIMULATED_DEPLOYMENTS_DIR ?? join(contractsRoot, ".deployments");

export async function deployService(service: string, version: string, environment: string): Promise<void> {
  const dir = join(deploymentsDir, environment);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${service}.json`), `${JSON.stringify({ service, version, environment, deployedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(`simulated deploy: ${service} ${version} is now live in ${environment}`);
}
