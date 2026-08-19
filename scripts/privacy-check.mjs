import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const ignored = new Set([".git", "node_modules", "dist", "coverage", "outputs", "work"]);
const textExtensions = new Set(["", ".bat", ".css", ".html", ".js", ".jsx", ".json", ".md", ".mjs", ".ps1", ".ts", ".tsx", ".yml", ".yaml"]);
const rules = [
  ["personal home path", /(?:[A-Za-z]:\\Users\\[^\\\s]+|\/(?:Users|home)\/[^/\s]+)/g],
  ["email address", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g],
  ["bearer token", /\bBearer\s+[A-Za-z0-9._~-]{16,}\b/gi],
  ["assigned credential", /\b(?:api[_-]?key|client[_-]?secret|password|passwd|access[_-]?token)\s*[:=]\s*["']?[^\s"'${}]{8,}/gi],
];

async function files(dir = root) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = relative(root, join(dir, entry.name)).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) found.push(...await files(join(dir, entry.name)));
    } else if (textExtensions.has(extname(entry.name))) found.push(join(dir, entry.name));
  }
  return found;
}

const findings = [];
let publishableFiles;
try {
  publishableFiles = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
    .split("\0").filter(Boolean).filter((file) => textExtensions.has(extname(file))).map((file) => join(root, file));
} catch {
  publishableFiles = await files();
}

for (const file of publishableFiles) {
  const content = await readFile(file, "utf8");
  for (const [name, pattern] of rules) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      findings.push(`${relative(root, file)}:${line} (${name})`);
    }
  }
}

try {
  const history = execFileSync("git", ["log", "--all", "--format=%H%x09%ae%x09%ce"], { encoding: "utf8" });
  for (const row of history.trim().split(/\r?\n/).filter(Boolean)) {
    const [commit, authorEmail, committerEmail] = row.split("\t");
    for (const email of new Set([authorEmail, committerEmail])) {
      if (email && !email.endsWith("@users.noreply.github.com")) findings.push(`${commit.slice(0, 8)} (public commit email)`);
    }
  }
} catch { /* A project can run this check before Git is initialized. */ }

if (findings.length) {
  console.error("Privacy check failed. Review these locations (values are intentionally hidden):");
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exitCode = 1;
} else {
  console.log("Privacy check passed: no personal paths, emails, private keys, or common credential patterns detected.");
}
