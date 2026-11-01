import { dirname, join } from "node:path";

export const contractsRoot = join(import.meta.dir, "..", "..");
export const servicesRoot = process.env.SERVICES_DIR ?? dirname(contractsRoot);

const team: { services: string[]; providers: string[] } = await Bun.file(join(contractsRoot, "team-services.json")).json();

// In the order they are released: providers before the consumers that read from them.
export const teamServices = team.services;
export const teamProviders = team.providers;
export const githubOrganisation = "all-boundaries";
