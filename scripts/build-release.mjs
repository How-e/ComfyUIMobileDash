import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = process.cwd();
const releaseDir = join(root, "dist-release");

console.log("=== Building Comfy Deck Open Source Release Bundle ===");

// 1. Run Privacy Check
console.log("\n[1/5] Running privacy check...");
execFileSync("node", ["scripts/privacy-check.mjs"], { stdio: "inherit" });

// 2. Run Test Suite
console.log("\n[2/5] Running test suite...");
execFileSync("node", ["--test", "tests/*.test.mjs"], { stdio: "inherit" });

// 3. Build Frontend with Vite
console.log("\n[3/5] Building production frontend...");
const viteBin = join(root, "node_modules", "vite", "bin", "vite.js");
execFileSync(process.execPath, [viteBin, "build"], { stdio: "inherit" });

// 4. Clean and Create Release Output Directory
console.log("\n[4/5] Preparing clean release directory...");
await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

// 5. Copy Production Runtime Files Only
console.log("\n[5/5] Copying release distribution files...");

const filesToCopy = [
  ["dist", "dist"],
  ["server", "server"],
  ["public", "public"],
  ["scripts/configure-dashboard.ps1", "scripts/configure-dashboard.ps1"],
  ["start-dashboard.bat", "start-dashboard.bat"],
  ["configure-dashboard.bat", "configure-dashboard.bat"],
  ["vite.config.js", "vite.config.js"],
  ["README.md", "README.md"],
  ["LICENSE", "LICENSE"],
  [".env.example", ".env.example"],
];

for (const [src, dest] of filesToCopy) {
  const srcPath = join(root, src);
  const destPath = join(releaseDir, dest);
  try {
    const s = await stat(srcPath);
    if (s.isDirectory()) {
      await mkdir(destPath, { recursive: true });
      await cp(srcPath, destPath, { recursive: true });
    } else {
      await mkdir(join(destPath, ".."), { recursive: true });
      await cp(srcPath, destPath);
    }
  } catch (err) {
    if (src === "LICENSE") {
      console.warn("  (Notice: LICENSE file will be included once created)");
    } else {
      throw err;
    }
  }
}

// Generate Production package.json
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const releasePkg = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description || "A touch-first mobile dashboard for ComfyUI and LM Studio workflows",
  license: pkg.license || "MIT",
  author: pkg.author || "How-e",
  repository: pkg.repository,
  type: pkg.type,
  scripts: {
    dev: "vite --host 0.0.0.0",
    preview: "vite preview --host 0.0.0.0",
    start: "vite preview --host 0.0.0.0",
  },
  dependencies: pkg.dependencies || {},
};

await writeFile(join(releaseDir, "package.json"), JSON.stringify(releasePkg, null, 2) + "\n", "utf8");

console.log("\n✔ Release bundle created successfully in dist-release/");
console.log("  - Excluded from release: tests, test fixtures, agent docs, and internal CI files.");
console.log("  - Included in release: compiled frontend, server controller, startup scripts, README, and environment templates.");
