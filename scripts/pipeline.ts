// The steps of a service pipeline. GitHub Actions calls them one by one; `mise run ci` and `mise run ci:main` call
// the `branch` and `main` sequences, so the same code runs in both places. Run from the root of the service.
//
//   bun pipeline.ts <step> [--role consumer|provider|both] [--to staging|production] [--promote] [--push]
import { rmSync } from "node:fs";
import { join } from "node:path";
import { deployService } from "./deploy";
import { brokerUrl, pactBroker } from "./lib/broker";
import { isUnverified } from "./lib/pact-queries";
import { contractChangeLines, formatTagMessage } from "./lib/changelog";
import { readLocalPacts, selectPublishable } from "./lib/pacts";
import { pipelineConfig } from "./lib/service-config";
import { capture, CommandFailed, run } from "./lib/shell";
import { servicesRoot, teamServices } from "./lib/team-services";
import { currentBranch, mainBranch, nextRelease, pactVersion, pactVersionOf, releaseAtHead, formatSemver } from "./lib/version";

type Role = "consumer" | "provider" | "both";
const environments = ["staging", "production"];

const argv = process.argv.slice(2);
const step = argv[0] ?? "";
const option = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const has = (name: string) => argv.includes(name);

const repo = process.cwd();
const service: string = (await Bun.file(join(repo, "package.json")).json()).name;
const { pacticipants, pactDirs } = await pipelineConfig(repo);
const role = (option("--role") ?? "both") as Role;
const actsAsConsumer = role === "consumer" || role === "both";
const actsAsProvider = role === "provider" || role === "both";

const heading = (text: string) => console.log(`\n==> ${service}: ${text}`);

function environmentOption(): string {
  const environment = option("--to");
  if (!environment || !environments.includes(environment)) throw new Error(`--to must be one of ${environments.join(", ")}`);
  return environment;
}

async function localPacts() {
  return selectPublishable(pacticipants, teamServices, await readLocalPacts(repo, pactDirs));
}

async function test() {
  heading("test");
  // The consumer tests merge into an existing pact file, so interactions of deleted tests would linger.
  for (const dir of pactDirs) {
    for (const match of new Bun.Glob(dir).scanSync({ cwd: repo, onlyFiles: false })) rmSync(join(repo, match), { recursive: true, force: true });
  }
  // The provider verification tests only run when the broker is named, and they belong to the verify step.
  await run(["mise", "run", "test"], { cwd: repo, env: { PACT_BROKER_BASE_URL: undefined } });
}

async function tag() {
  heading("tag the release");
  if (currentBranch(repo) !== mainBranch) throw new Error(`only ${mainBranch} is released`);
  const released = releaseAtHead(repo);
  if (released) return console.log(`HEAD is already released as ${released.tag}`);
  const next = nextRelease(repo);
  const { publishable } = await localPacts();
  const contractChanges = await contractChangeLines(publishable, pactVersionOf(repo, next.previous));
  const message = formatTagMessage({ ...next, contractChanges });
  const name = `v${formatSemver(next.semver)}`;
  capture(["git", "-c", "tag.gpgSign=false", "tag", "-a", name, "-m", message], { cwd: repo });
  console.log(message);
  if (has("--push")) capture(["git", "push", process.env.GIT_REMOTE ?? "origin", name], { cwd: repo });
}

const registerVersion = async () => {
  for (const pacticipant of pacticipants) {
    await pactBroker(["create-or-update-pacticipant", "--name", pacticipant, "--main-branch", mainBranch]);
    await pactBroker(["create-or-update-version", "--pacticipant", pacticipant, "--version", pactVersion(repo), "--branch", currentBranch(repo)]);
  }
};

async function publish() {
  if (!actsAsConsumer) return;
  heading("publish pacts");
  const { publishable, skipped } = await localPacts();
  for (const { file, reason } of skipped) console.log(`not publishing ${file}: ${reason}`);
  if (publishable.length === 0) {
    // can-i-deploy only knows versions the broker has seen, and a consumer with no pacts yet (the channel before its
    // adapters exist) would otherwise be unknown to it.
    console.log("no pacts to publish; registering the version");
    return registerVersion();
  }
  await pactBroker([
    "publish",
    ...publishable.map((p) => p.file),
    "--consumer-app-version",
    pactVersion(repo),
    "--branch",
    currentBranch(repo),
  ]);
}

async function verify(extraEnv: Record<string, string> = {}, dir = repo) {
  await run(["mise", "run", "contracts:verify"], {
    cwd: dir,
    env: { PACT_BROKER_BASE_URL: brokerUrl, PACT_VERSION: pactVersion(dir), PACT_BRANCH: currentBranch(dir), ...extraEnv },
  });
}

async function verifyOwnProvider() {
  if (!actsAsProvider) return;
  heading("verify the pacts consumers published");
  // A provider that publishes no pact is unknown to the broker until a version of it is registered.
  await registerVersion();
  await verify();
}

// Stands in for the Pact Broker webhook (contract_content_changed -> repository_dispatch to the provider's repository)
// that GitHub gets: each provider verifies the pact this build published, if no provider version verified it before.
async function verifyProviders() {
  if (!actsAsConsumer) return;
  const { publishable } = await localPacts();
  const version = pactVersion(repo);
  for (const { pact } of publishable) {
    const provider = pact.provider.name;
    if (!(await isUnverified(provider, pact.consumer.name, version))) continue;
    heading(`local webhook: ${provider} verifies the changed pact`);
    try {
      await verify({ PACT_TRIGGER_CONSUMER: pact.consumer.name, PACT_TRIGGER_BRANCH: currentBranch(repo) }, join(servicesRoot, provider));
    } catch (error) {
      if (!(error instanceof CommandFailed)) throw error;
      console.log(`${provider} could not verify the pact; the result is in the broker and can-i-deploy will report it`);
    }
  }
}

async function canIDeploy(environment: string) {
  heading(`can-i-deploy to ${environment}`);
  const retry = Number(process.env.CAN_I_DEPLOY_RETRY_WHILE_UNKNOWN ?? 0);
  for (const pacticipant of pacticipants) {
    await pactBroker([
      "can-i-deploy",
      "--pacticipant",
      pacticipant,
      "--version",
      pactVersion(repo),
      "--to-environment",
      environment,
      ...(retry > 0 ? ["--retry-while-unknown", String(retry), "--retry-interval", process.env.CAN_I_DEPLOY_RETRY_INTERVAL ?? "10"] : []),
    ]);
  }
}

async function deploy(environment: string) {
  heading(`deploy to ${environment}`);
  await deployService(service, pactVersion(repo), environment);
}

async function recordDeployment(environment: string) {
  heading(`record the ${environment} deployment`);
  for (const pacticipant of pacticipants) {
    await pactBroker(["record-deployment", "--pacticipant", pacticipant, "--version", pactVersion(repo), "--environment", environment]);
  }
}

async function release(environment: string) {
  await canIDeploy(environment);
  await deploy(environment);
  await recordDeployment(environment);
}

const steps: Record<string, () => Promise<void>> = {
  test,
  tag,
  publish,
  verify: verifyOwnProvider,
  "verify-providers": verifyProviders,
  "can-i-deploy": () => canIDeploy(environmentOption()),
  deploy: () => deploy(environmentOption()),
  "record-deployment": () => recordDeployment(environmentOption()),
  branch: async () => {
    await test();
    await publish();
    await verifyProviders();
    await verifyOwnProvider();
  },
  main: async () => {
    await test();
    await tag();
    await publish();
    await verifyProviders();
    await verifyOwnProvider();
    await release("staging");
    // On GitHub the production job waits for a reviewer of the production environment; here it is a flag.
    if (!has("--promote")) return console.log(`\n${service} ${pactVersion(repo)} waits in staging; add --promote to continue to production`);
    await release("production");
  },
};

const handler = steps[step];
if (!handler) {
  console.error(`usage: pipeline.ts <${Object.keys(steps).join("|")}> [--role ...] [--to ...] [--promote] [--push]`);
  process.exit(2);
}
try {
  await handler();
} catch (error) {
  if (error instanceof CommandFailed) process.exit(error.exitCode);
  throw error;
}
