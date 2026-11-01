// The one place a build's version is computed. Prints the Pact Broker version of the repository in the current
// directory; --branch prints the branch the build counts as, --semver the release number without the commit.
import { currentBranch, formatSemver, mainBranch, nextRelease, pactVersion, releaseAtHead } from "./lib/version";

const repo = process.cwd();
const flag = process.argv[2];

if (flag === "--branch") console.log(currentBranch(repo));
else if (flag === "--semver") console.log(formatSemver(releaseAtHead(repo)?.semver ?? nextRelease(repo).semver));
else if (flag === undefined) console.log(pactVersion(repo));
else {
  console.error(`usage: version.ts [--branch | --semver]  (main branch is "${mainBranch}")`);
  process.exit(2);
}
