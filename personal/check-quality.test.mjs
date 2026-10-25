import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const gate = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "check-quality.mjs",
);
const short = "export function work() { return 1; }\n";

function longFunction(lines) {
  return `export function work() {\n  let value = 0;\n${"  value += 1;\n".repeat(lines)}  return value;\n}\n`;
}

function fixture(t, initial = short) {
  const root = mkdtempSync(join(tmpdir(), "berd-quality-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", ...args],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  };
  git("init", "-q");
  git("config", "user.name", "Quality fixture");
  git("config", "user.email", "quality@example.invalid");
  writeFileSync(join(root, "work.ts"), initial);
  git("add", "work.ts");
  git("commit", "-qm", "fixture");
  git("update-ref", "refs/remotes/upstream/main", "HEAD");
  return {
    write: (source) => writeFileSync(join(root, "work.ts"), source),
    stage: () => git("add", "work.ts"),
    run: (...args) =>
      spawnSync(process.execPath, [gate, ...args], {
        cwd: root,
        encoding: "utf8",
      }),
    add: (path, source) => writeFileSync(join(root, path), source),
  };
}

function expectStatus(result, status) {
  assert.equal(result.status, status, `${result.stdout}\n${result.stderr}`);
  if (status === 1) assert.match(result.stderr, /Function limits grew/);
}

test("new oversized production functions fail, including untracked files", (t) => {
  const f = fixture(t);
  f.add("added.ts", longFunction(100));
  expectStatus(f.run(), 1);
});

test("staged failures cannot be hidden by an unstaged fix", (t) => {
  const f = fixture(t);
  f.write(longFunction(100));
  f.stage();
  f.write(short);
  expectStatus(f.run("--staged"), 1);
  expectStatus(f.run(), 0);
});

test("unstaged failures do not change the checked index snapshot", (t) => {
  const f = fixture(t);
  f.write("export function work() { return 2; }\n");
  f.stage();
  f.write(longFunction(100));
  expectStatus(f.run("--staged"), 0);
  expectStatus(f.run(), 1);
});

test("legacy debt may stay level or shrink but cannot grow", (t) => {
  const f = fixture(t, longFunction(100));
  f.write(`${longFunction(100)}\n// A focused fix elsewhere.\n`);
  expectStatus(f.run(), 0);
  f.write(longFunction(90));
  expectStatus(f.run(), 0);
  f.write(longFunction(110));
  expectStatus(f.run(), 1);
});

test("adding a second oversized function cannot hide behind legacy debt", (t) => {
  const f = fixture(t, longFunction(100));
  f.write(
    longFunction(100) +
      longFunction(90).replace("function work", "function other"),
  );
  expectStatus(f.run(), 1);
});

test("parameter and cognitive limits are enforced through Biome", (t) => {
  const f = fixture(t);
  f.write("export function work(a,b,c,d,e,f) { return a+b+c+d+e+f; }\n");
  expectStatus(f.run(), 1);
  f.write(
    "export function work(a) { if(a) { if(a) { if(a) { if(a) { if(a) { if(a) { return 1; } } } } } } return 0; }\n",
  );
  expectStatus(f.run(), 1);
});
