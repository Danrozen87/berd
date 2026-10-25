#!/usr/bin/env node
// Reuse Biome's function rules. Compare existing debt with Git; never rewrite files.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename } from "node:path";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rules = [
  "complexity/noExcessiveLinesPerFunction",
  "complexity/noExcessiveCognitiveComplexity",
  "complexity/useMaxParams",
];

function git(root, args, optional = false) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0 && !optional) {
    throw new Error(result.stderr || `git ${args[0]} failed`);
  }
  return result.status === 0 ? result.stdout : null;
}

function baseRevision(root, staged) {
  if (staged) return "HEAD";
  const base = git(root, ["merge-base", "upstream/main", "HEAD"], true)?.trim();
  if (!base)
    throw new Error("upstream/main is required for the personal quality gate.");
  return base;
}

function sourceFiles(root, base, staged) {
  const args = ["diff", "--name-only", "-z", "--diff-filter=ACMRT"];
  if (staged) args.push("--cached");
  args.push(base, "--");
  const paths = git(root, args).split("\0");
  if (!staged)
    paths.push(
      ...git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split(
        "\0",
      ),
    );
  return [...new Set(paths)].filter(
    (path) =>
      /\.(?:[cm]?[jt]sx?)$/.test(path) &&
      !/(?:^|\/)(?:sdk\/src\/generated|tests|node_modules)\//.test(path) &&
      !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path),
  );
}

function diagnostics(root, path, source) {
  if (source === null) return [];
  const temp = mkdtempSync(join(tmpdir(), "berd-quality-"));
  let result;
  try {
    const inputPath = join(temp, basename(path));
    writeFileSync(inputPath, source);
    result = spawnSync(
      join(toolsRoot, "node_modules/.bin/biome"),
      [
        "lint",
        "--reporter=json",
        "--max-diagnostics=none",
        "--vcs-enabled=false",
        "--config-path",
        join(toolsRoot, "personal/biome-quality.json"),
        ...rules.map((rule) => `--only=${rule}`),
        inputPath,
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  if (result.error) throw result.error;
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(result.stderr || `Biome produced no report for ${path}`);
  }
  const unexpected = report.diagnostics.filter(
    (d) => !rules.some((rule) => d.category === `lint/${rule}`),
  );
  if (unexpected.length)
    throw new Error(`${path}: ${unexpected.map((d) => d.message).join("; ")}`);
  if (![0, 1].includes(result.status))
    throw new Error(result.stderr || "Biome failed");
  return report.diagnostics;
}

function scores(items, category) {
  return items
    .filter((item) => item.category === category)
    .map((item) => {
      const match = item.message.match(/\d+/);
      if (!match)
        throw new Error(`Unrecognized Biome diagnostic: ${item.message}`);
      return { score: Number(match[0]), description: item.message };
    })
    .sort((a, b) => b.score - a.score);
}

function regressions(previous, current) {
  return rules.flatMap((rule) => {
    const category = `lint/${rule}`;
    const before = scores(previous, category);
    return scores(current, category).filter(
      (item, index) => !before[index] || item.score > before[index].score,
    );
  });
}

function checkFile(root, path, base, staged) {
  const previous = git(root, ["show", `${base}:${path}`], true);
  const current = staged
    ? git(root, ["show", `:${path}`])
    : readFileSync(join(root, path), "utf8");
  const after = diagnostics(root, path, current);
  if (!after.length) return { failures: [], debt: 0 };
  const before = diagnostics(root, path, previous);
  return { failures: regressions(before, after), debt: after.length };
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--staged"))
    throw new Error("Usage: check-quality.mjs [--staged]");
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const staged = args.includes("--staged");
  const base = baseRevision(root, staged);
  const files = sourceFiles(root, base, staged);
  let debt = 0;
  let failed = false;
  for (const path of files) {
    const result = checkFile(root, path, base, staged);
    debt += result.debt;
    for (const item of result.failures) {
      console.error(`${path}: ${item.description}`);
      failed = true;
    }
  }
  if (failed)
    throw new Error(
      "Function limits grew. Split the responsibility or reduce the existing debt; see personal/CONTRIBUTING.md.",
    );
  console.log(
    `Personal quality: ${files.length} changed source files checked; ${debt} existing limit violations did not grow.`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
