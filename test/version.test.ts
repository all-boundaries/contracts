import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capture } from "../scripts/lib/shell";
import {
  branchSlug,
  bumpSemver,
  highestBump,
  lastRelease,
  nextRelease,
  pactVersion,
  pactVersionOf,
  parseSemver,
  releaseAtHead,
} from "../scripts/lib/version";

let repo: string;
const git = (...args: string[]) => capture(["git", "-c", "commit.gpgsign=false", "-c", "tag.gpgSign=false", ...args], { cwd: repo });
const commit = (subject: string, trailer?: string) => git("commit", "--allow-empty", "-m", trailer ? `${subject}\n\nBody text.\n\n${trailer}` : subject);
const sha = () => git("rev-parse", "--short", "HEAD");

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "version-test-"));
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  commit("Start the service");
  git("tag", "-a", "v0.1.0", "-m", "Baseline");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("version arithmetic", () => {
  it("bumps patch, minor and major and resets the lower parts", () => {
    const base = parseSemver("v1.4.9");
    expect(bumpSemver(base, "patch")).toEqual({ major: 1, minor: 4, patch: 10 });
    expect(bumpSemver(base, "minor")).toEqual({ major: 1, minor: 5, patch: 0 });
    expect(bumpSemver(base, "major")).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  it("lets the highest trailer win and defaults to patch", () => {
    expect(highestBump([])).toBe("patch");
    expect(highestBump(["minor", "patch"])).toBe("minor");
    expect(highestBump(["Minor", "MAJOR", "patch"])).toBe("major");
  });

  it("rejects a trailer that is not a bump", () => {
    expect(() => highestBump(["huge"])).toThrow("major, minor or patch");
    expect(() => parseSemver("1.2")).toThrow("not a release version");
  });

  it("makes branch names safe for a version", () => {
    expect(branchSlug("feature/New_Thing")).toBe("feature-new-thing");
    expect(branchSlug("--odd--")).toBe("odd");
    expect(branchSlug("///")).toBe("detached");
  });
});

describe("the version of a main build", () => {
  it("is the tag itself when HEAD is released", () => {
    expect(pactVersion(repo, "main")).toBe(`0.1.0+${sha()}`);
    expect(releaseAtHead(repo)?.tag).toBe("v0.1.0");
  });

  it("is the next patch after unreleased commits", () => {
    commit("Fix a thing");
    commit("Fix another thing");
    expect(releaseAtHead(repo)).toBeUndefined();
    expect(pactVersion(repo, "main")).toBe(`0.1.1+${sha()}`);
    expect(nextRelease(repo).subjects).toEqual(["Fix another thing", "Fix a thing"]);
  });

  it("takes a minor bump from a trailer in any commit since the tag", () => {
    commit("Add a feature", "Bump: minor");
    commit("Tidy up");
    expect(pactVersion(repo, "main")).toBe(`0.2.0+${sha()}`);
  });

  it("takes the highest bump when several trailers exist", () => {
    commit("Add a feature", "Bump: minor");
    commit("Break the contract", "Bump: major");
    commit("Tidy up", "Bump: patch");
    expect(nextRelease(repo).bump).toBe("major");
    expect(pactVersion(repo, "main")).toBe(`1.0.0+${sha()}`);
  });

  it("ignores trailers from before the previous tag", () => {
    commit("Add a feature", "Bump: minor");
    git("tag", "-a", "v0.2.0", "-m", "Release");
    commit("Fix a thing");
    expect(pactVersion(repo, "main")).toBe(`0.2.1+${sha()}`);
  });

  it("stays on the tag once the tag is created for HEAD", () => {
    commit("Fix a thing");
    git("tag", "-a", "v0.1.1", "-m", "Release");
    expect(pactVersion(repo, "main")).toBe(`0.1.1+${sha()}`);
  });

  it("finds the broker version of the previous release", () => {
    const released = sha();
    commit("Fix a thing");
    expect(pactVersionOf(repo, lastRelease(repo))).toBe(`0.1.0+${released}`);
  });

  it("fails without a baseline tag", () => {
    git("tag", "-d", "v0.1.0");
    expect(() => pactVersion(repo, "main")).toThrow("no release tag");
  });
});

describe("the version of a branch build", () => {
  it("counts the commits since the last tag and is never tagged", () => {
    commit("Work in progress");
    commit("More work");
    expect(pactVersion(repo, "feature/New_Thing")).toBe(`0.1.0-feature-new-thing.2+${sha()}`);
  });

  it("starts at zero on the tagged commit", () => {
    expect(pactVersion(repo, "feature-x")).toBe(`0.1.0-feature-x.0+${sha()}`);
  });
});
