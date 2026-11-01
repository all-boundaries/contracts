// A push to main in every service, in the order the services have to be released: providers before their consumers.
import { join } from "node:path";
import { run } from "./lib/shell";
import { servicesRoot, teamServices } from "./lib/team-services";

for (const service of teamServices) {
  console.log(`\n######## ${service}`);
  await run(["mise", "run", "ci:main", ...(process.argv.includes("--promote") ? ["--", "--promote"] : [])], { cwd: join(servicesRoot, service) });
}
