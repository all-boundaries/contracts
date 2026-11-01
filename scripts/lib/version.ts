import { capture } from "./shell";

export type Bump = "major" | "minor" | "patch";
export type Semver = { major: number; minor: number; patch: number };

export const mainBranch = process.env.MAIN_BRANCH ?? "main";

const releaseTagPattern = "v[0-9]*.[0-9]*.[0-9]*";
const bumpRank: Record<Bump, number> = { patch: 0, minor: 1, major: 2 };

export function parseSemver(text: string): Semver {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (!match) throw new Error(`not a release version: ${text}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export const formatSemver = (v: Semver) => `${v.major}.${v.minor}.${v.patch}`;

export function bumpSemver(base: Semver, bump: Bump): Semver {
  if (bump === "major") return { major: base.major + 1, minor: 0, patch: 0 };
  if (bump === "minor") return { major: base.major, minor: base.minor + 1, patch: 0 };
  return { ...base, patch: base.patch + 1 };
}

function compareSemver(a: Semver, b: Semver) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

// The `Bump:` trailer values of the commits since the last release; the highest wins, and the default is patch.
export function highestBump(trailerValues: string[]): Bump {
  let highest: Bump = "patch";
  for (const raw of trailerValues) {
    const value = raw.trim().toLowerCase();
    if (!(value in bumpRank)) throw new Error(`Bump trailer must be major, minor or patch, got "${raw.trim()}"`);
    if (bumpRank[value as Bump] > bumpRank[highest]) highest = value as Bump;
  }
  return highest;
}

export function branchSlug(branch: string): string {
  return branch.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "detached";
}

export function currentBranch(repo: string): string {
  return (
    process.env.PACT_BRANCH ||
    process.env.GITHUB_HEAD_REF ||
    process.env.GITHUB_REF_NAME ||
    capture(["git", "branch", "--show-current"], { cwd: repo }) ||
    "detached"
  );
}

export type Release = { tag: string; semver: Semver; commit: string };

function releaseOf(repo: string, tag: string): Release {
  return { tag, semver: parseSemver(tag), commit: capture(["git", "rev-list", "-n1", tag], { cwd: repo }) };
}

export function releaseAtHead(repo: string): Release | undefined {
  const tags = capture(["git", "tag", "--points-at", "HEAD", "--list", releaseTagPattern], { cwd: repo })
    .split("\n")
    .filter(Boolean);
  const newest = tags.map((tag) => releaseOf(repo, tag)).sort((a, b) => compareSemver(b.semver, a.semver))[0];
  return newest;
}

export function lastRelease(repo: string): Release {
  try {
    const tag = capture(["git", "describe", "--tags", "--abbrev=0", "--match", releaseTagPattern, "HEAD"], { cwd: repo });
    return releaseOf(repo, tag);
  } catch {
    throw new Error(`${repo} has no release tag; create the baseline with: git tag -a v0.1.0 -m "Baseline"`);
  }
}

export function commitsSince(repo: string, release: Release) {
  const range = `${release.tag}..HEAD`;
  const subjects = capture(["git", "log", "--no-merges", "--format=%s", range], { cwd: repo }).split("\n").filter(Boolean);
  const bumps = capture(["git", "log", "--format=%(trailers:key=Bump,valueonly,unfold)", range], { cwd: repo })
    .split("\n")
    .filter((line) => line.trim() !== "");
  return { subjects, bump: highestBump(bumps) };
}

export function nextRelease(repo: string): { previous: Release; semver: Semver; bump: Bump; subjects: string[] } {
  const previous = lastRelease(repo);
  const { subjects, bump } = commitsSince(repo, previous);
  return { previous, semver: bumpSemver(previous.semver, bump), bump, subjects };
}

export function shortSha(repo: string, ref = "HEAD"): string {
  return capture(["git", "rev-parse", "--short", ref], { cwd: repo });
}

// The version the Pact Broker knows a build by: 0.1.4+e335a14 on main, 0.1.3-feature-x.2+e335a14 elsewhere.
export function pactVersion(repo: string, branch = currentBranch(repo)): string {
  const sha = shortSha(repo);
  if (branch === mainBranch) {
    const released = releaseAtHead(repo)?.semver ?? nextRelease(repo).semver;
    return `${formatSemver(released)}+${sha}`;
  }
  const base = lastRelease(repo);
  const ahead = capture(["git", "rev-list", "--count", `${base.tag}..HEAD`], { cwd: repo });
  return `${formatSemver(base.semver)}-${branchSlug(branch)}.${ahead}+${sha}`;
}

// The broker version of an earlier release, which was published as <tag>+<sha of the tagged commit>.
export function pactVersionOf(repo: string, release: Release): string {
  return `${formatSemver(release.semver)}+${shortSha(repo, release.commit)}`;
}
