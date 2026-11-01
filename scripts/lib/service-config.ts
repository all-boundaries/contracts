import { join } from "node:path";

export type PipelineConfig = { pacticipants: string[]; pactDirs: string[] };

/**
 * What a repository releases. A service is one pacticipant with its pacts in `pacts/`. A monorepo that is one deploy
 * but has several consumers (the channel: one per feature) says so in its package.json:
 *   "pipeline": { "pacticipants": ["channel-payments", "channel-subscriptions"], "pactDirs": ["features/*\/pacts"] }
 * Every pacticipant is published, checked and recorded under the same version.
 */
export async function pipelineConfig(repo: string): Promise<PipelineConfig> {
  const manifest = await Bun.file(join(repo, "package.json")).json();
  return {
    pacticipants: manifest.pipeline?.pacticipants ?? [manifest.name],
    pactDirs: manifest.pipeline?.pactDirs ?? ["pacts"],
  };
}
