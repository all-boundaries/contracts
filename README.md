# contracts

The Pact Broker the services publish consumer pacts to and ask `can-i-deploy` of, and the scripts and the reusable
GitHub workflow that every team service (`subscriptions`, `payments`, `inventory`, `accounts`) releases with.

```sh
mise run up     # http://localhost:9292, with the staging and production environments
mise run down   # keeps the data
mise run reset  # also deletes the data and the simulated deployments
```

The broker is a local development one (image pinned in `compose.yaml`); a shared deployment is still to be decided.

## Why tags and not commit SHAs

A SHA says nothing about order, size or intent: which of two versions is newer, how far a production version is
behind main, or what changed between them. So every push to `main` is released as a semantic-version git tag
`vX.Y.Z` in the service's own repository, and the tag is the source of truth. Nothing is committed back to `main`
(no `package.json` churn, no commit loops): the version is derived from the tags.

## How a version is derived

`scripts/lib/version.ts` is the only place that computes it; `bun scripts/version.ts` prints it. The workflows, the
local tasks and the provider verification tests (`PACT_VERSION`) all use it.

| Build | Pact Broker version | Tagged |
| --- | --- | --- |
| Push to `main` | `X.Y.Z+<sha>`, for example `0.1.4+e335a14` | yes, `vX.Y.Z` |
| Any other branch or pull request | `<last tag>-<branch>.<commits since the tag>+<sha>`, for example `0.1.3-feature-x.2+e335a14` | never |

The broker also gets the branch (`--branch`, `providerVersionBranch`). The bump is a patch by default. A git trailer
in the message of any commit since the previous tag raises it, and the highest one wins:

```
Bump: minor    # 0.1.3 -> 0.2.0
Bump: major    # 0.1.3 -> 1.0.0
```

The services do not use conventional-commit prefixes, so the trailer is the signal. Every service starts from the
baseline tag `v0.1.0`.

## What the tag message says

The annotated tag message is the changelog of the release:

- `Changes since vX.Y.Z (patch bump)`: the subject of every commit since the previous tag.
- `Contract changes`: the interactions added, removed or changed between the pacts the previous release published
  (read back from the broker) and the pacts this release publishes. Interactions are compared by description, provider
  state, request and response. A provider with no pacts of its own reports that nothing changed.

```sh
git show v0.1.1    # in a service repository
```

## Environments and the pipeline

Exactly two environments, in this order: `staging`, then `production`. `mise run up` creates them (and removes the
broker's seed `test` environment) with `scripts/broker-setup.ts`, which is safe to run again. A version being
recorded as deployed in an environment is what `can-i-deploy --to-environment` and the providers' `deployedOrReleased`
selector compare against.

A push to `main` runs these steps, each a subcommand of `scripts/pipeline.ts`:

| Step | What happens | If it fails |
| --- | --- | --- |
| `test` | the service's own tests; consumer pacts are regenerated from scratch | nothing is tagged or published |
| `tag` | computes the next version and creates `vX.Y.Z` with the changelog message (pushed on GitHub) | the build stops |
| `publish` | a consumer publishes its pacts for the team services under the new version and branch | the build stops |
| `verify` | a provider verifies the pacts of the `mainBranch`, `matchingBranch` and `deployedOrReleased` consumer versions, and publishes the results | the build stops; the result is in the broker |
| `can-i-deploy --to staging` | asks the broker whether this version works with what is in staging | staging is not touched |
| `deploy` and `record-deployment` (staging) | simulated deploy, then the broker is told this version is in staging | |
| `can-i-deploy --to production` | the same question for production | production is not touched |
| `deploy` and `record-deployment` (production) | simulated deploy, then the broker is told | |

Branch and pull request builds run only `test`, `publish` and `verify`. They never tag, and never deploy.

On GitHub the production job is bound to a `production` environment with required reviewers: the approval is the human
step between staging and production. Locally it is the `--promote` flag.

The real deployment goes where `deployService()` is in `scripts/deploy.ts`. For now it writes
`.deployments/<environment>/<service>.json`. The gate before it and the recording after it stay as they are.

### Third-party pacts are never published

`payments` writes a pact about the card processor (`pacts/payments-processor.json`). The processor cannot verify it,
so `can-i-deploy` would wait for a verification that never comes. `publish` only sends pacts whose consumer is the
service itself and whose provider is listed in `team-services.json`, and prints what it skipped.

## Local and GitHub

The workflow is thin and the logic is in the scripts, so one set of code runs in both places.

| | GitHub | Locally |
| --- | --- | --- |
| Pipeline | `.github/workflows/service-pipeline.yml`, called by each service's `.github/workflows/ci.yml` | `mise run ci` (branch build) and `mise run ci:main` (push to main) in the service |
| Broker | shared, from the secrets `PACT_BROKER_BASE_URL` and `PACT_BROKER_TOKEN` | `http://localhost:9292` |
| A changed pact reaches its provider | broker webhook `contract_content_changed`, which sends a `repository_dispatch` to the provider repository; its workflow runs `verify` | `verify-providers` in the consumer's `branch` and `main` sequences runs the provider's `contracts:verify` |
| Production approval | required reviewers of the `production` environment | `-- --promote` |
| Deployment | simulated for now | simulated, marker files in `.deployments/` |

The webhooks are created once against the shared broker with `mise run webhooks:create` (needs
`GITHUB_DISPATCH_TOKEN`, a token that may create `repository_dispatch` events). The local broker has none: nothing
there listens.

## Reading a `can-i-deploy` failure

`subscriptions` expects a `message` field in the `payments` charge response that `payments` does not send. Its branch
build publishes that pact; asking for the branch version fails like this (verbatim, the table trimmed to its rows):

```
CONSUMER      | C.VERSION                           | PROVIDER  | P.VERSION     | SUCCESS? | RESULT
subscriptions | 0.1.0-demo-charge-message.5+0f49aa0 | accounts  | 0.1.0+1030e8b | true     | 1
subscriptions | 0.1.0-demo-charge-message.5+0f49aa0 | inventory | 0.1.1+bf23371 | true     | 1
subscriptions | 0.1.0-demo-charge-message.5+0f49aa0 | payments  | 0.1.1+c8c88a7 | false    | 1

The verification for the pact between version 0.1.0-demo-charge-message.5+0f49aa0 of subscriptions and the version
of payments currently in staging (0.1.1+c8c88a7) failed

Computer says no
No deployable version found
```

Each row is a consumer version, the provider version in the target environment, and whether the provider's verification
of that pair succeeded. The sentence under the table names the blocking pair. Two cases:

- `false`: `payments 0.1.1+c8c88a7`, the version live in staging, was verified against the pact and could not satisfy
  it. The provider's own log says why (`Actual map is missing the following keys: message`). Fix the consumer
  expectation, or release a provider version that sends the field and ask again.
- `unknown` with `There is no verified pact between ... and the version of payments currently in staging`: nobody has
  verified this pact against the provider version in the target environment yet. The provider verifies its newest
  `main` against new pacts, so a consumer change that the provider supports in code still waits until the provider is
  released. This is why a release goes provider first. On GitHub the pipeline waits up to five minutes for a pending
  verification (`CAN_I_DEPLOY_RETRY_WHILE_UNKNOWN`) before failing.

## Running the local simulation

```sh
mise run up                     # in contracts: broker plus environments
mise run simulate               # push to main in every service, providers first, through staging
mise run simulate -- --promote  # ... and through production
mise run simulate:fresh         # reset, start empty, release everything through both environments

cd ../subscriptions
mise run ci                     # a branch build of the checked-out branch
mise run ci:main -- --promote   # a push to main: test, tag, publish, verify, staging, production
```

`reset` stops the broker, deletes its volume and removes `.deployments/`. After it, `simulate:fresh` leaves every
service released at the tag it has and recorded as deployed in both environments. `simulate` on a repository whose
`HEAD` is already tagged reuses the tag instead of creating another one.

The scripts have their own tests: `mise run test` (version and bump logic against temporary git repositories, and the
contract diff).
