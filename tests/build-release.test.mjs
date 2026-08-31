import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const releaseDir = join(root, "dist-release");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("release bundle packaging structure and exclusion rules", async () => {
  // If dist-release has not been built yet, we can check package.json files config
  const rootPkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.ok(Array.isArray(rootPkg.files), "package.json should have a files whitelist for npm/release distribution");
  assert.ok(rootPkg.files.includes("dist"));
  assert.ok(rootPkg.files.includes("server"));
  assert.ok(rootPkg.files.includes("README.md"));
  assert.ok(rootPkg.files.includes("LICENSE"));
  assert.equal(rootPkg.files.includes("tests"), false, "tests must be excluded from distribution files");
  assert.equal(rootPkg.files.includes("AGENTS.md"), false, "internal agent docs must be excluded from distribution files");
  assert.equal(rootPkg.files.includes("CONTRIBUTING.md"), false, "contributor guides must be excluded from distribution files");

  if (await exists(releaseDir)) {
    // Check included files in dist-release
    assert.equal(await exists(join(releaseDir, "dist")), true, "dist-release must contain dist");
    assert.equal(await exists(join(releaseDir, "server", "localAiController.mjs")), true, "dist-release must contain server");
    assert.equal(await exists(join(releaseDir, "README.md")), true, "dist-release must contain README.md");
    assert.equal(await exists(join(releaseDir, "LICENSE")), true, "dist-release must contain LICENSE");
    assert.equal(await exists(join(releaseDir, ".env.example")), true, "dist-release must contain .env.example");

    // Check excluded files in dist-release
    assert.equal(await exists(join(releaseDir, "tests")), false, "dist-release must not contain tests");
    assert.equal(await exists(join(releaseDir, "AGENTS.md")), false, "dist-release must not contain AGENTS.md");
    assert.equal(await exists(join(releaseDir, "CONTRIBUTING.md")), false, "dist-release must not contain CONTRIBUTING.md");
    assert.equal(await exists(join(releaseDir, "SECURITY.md")), false, "dist-release must not contain SECURITY.md");
    assert.equal(await exists(join(releaseDir, ".github")), false, "dist-release must not contain .github");

    // Check production package.json in releaseDir
    const releasePkg = JSON.parse(await readFile(join(releaseDir, "package.json"), "utf8"));
    assert.equal("devDependencies" in releasePkg, false, "release package.json must not have devDependencies");
  }
});
