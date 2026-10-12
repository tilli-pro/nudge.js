import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const WORKFLOWS = resolve(ROOT, ".github", "workflows");

function workflow(file: string): string {
  return readFileSync(resolve(WORKFLOWS, file), "utf8");
}

function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS)
    .filter((name) => name.endsWith(".yml"))
    .sort();
}

const scripts: Record<string, string> = JSON.parse(
  readFileSync(resolve(ROOT, "package.json"), "utf8"),
).scripts;

describe("ci.yml", () => {
  it("runs on pull requests into main and pushes to main", () => {
    expect(workflow("ci.yml")).toMatch(
      /^on:\n {2}pull_request:\n {4}branches: \[main\]\n {2}push:\n {4}branches: \[main\]$/m,
    );
  });

  it("only reads the repository", () => {
    expect(workflow("ci.yml")).toMatch(/^permissions:\n {2}contents: read$/m);
  });

  it("runs on Node 22 and 24 under stable check names", () => {
    const text = workflow("ci.yml");
    expect(text).toMatch(/^ {8}node: \["22", "24"\]$/m);
    expect(text).toMatch(
      /^ {4}name: verify \(node \$\{\{ matrix\.node \}\}\)$/m,
    );
    expect(text).toContain("node-version: ${{ matrix.node }}");
  });

  it("runs the gate in order", () => {
    const runs = [...workflow("ci.yml").matchAll(/^\s*- run: (.+)$/gm)].map(
      (match) => match[1],
    );
    expect(runs).toEqual([
      "pnpm install --frozen-lockfile",
      "pnpm lint",
      "pnpm typecheck",
      "pnpm test",
      "pnpm build",
      "pnpm pack:smoke",
    ]);
  });

  it("reads no secret", () => {
    expect(workflow("ci.yml")).not.toMatch(/secrets\./);
  });
});

describe("every workflow", () => {
  it("never runs the live test", () => {
    for (const file of workflowFiles()) {
      expect(workflow(file), file).not.toContain("test:live");
    }
  });

  it("runs only scripts that exist", () => {
    for (const file of workflowFiles()) {
      for (const match of workflow(file).matchAll(/\bpnpm ([\w:-]+)/g)) {
        const word = match[1];
        if (word === "install" || word === "exec") {
          continue;
        }
        expect(Object.keys(scripts), `${file}: pnpm ${word}`).toContain(word);
      }
    }
  });
});

describe(".changeset/config.json", () => {
  it("publishes publicly from main", () => {
    const config = JSON.parse(
      readFileSync(resolve(ROOT, ".changeset", "config.json"), "utf8"),
    );
    expect(config.access).toBe("public");
    expect(config.baseBranch).toBe("main");
  });
});

describe("scripts/pack-smoke.sh", () => {
  const path = resolve(ROOT, "scripts", "pack-smoke.sh");

  it("imports the package and typechecks a NodeNext consumer", () => {
    const text = readFileSync(path, "utf8");
    expect(text).toContain("import('@tilli.dev/nudge.js')");
    expect(text).toContain('"moduleResolution": "NodeNext"');
    expect(text).toContain("pnpm pack --pack-destination");
    expect(statSync(path).mode & 0o100).not.toBe(0);
  });
});
