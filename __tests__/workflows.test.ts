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

function atLeast(
  found: readonly number[],
  minimum: readonly number[],
): boolean {
  for (const [index, wanted] of minimum.entries()) {
    const have = found[index] ?? 0;
    if (have !== wanted) {
      return have > wanted;
    }
  }
  return true;
}

describe("release.yml", () => {
  it("runs on pushes to main only", () => {
    const text = workflow("release.yml");
    expect(text).toMatch(/^on:\n {2}push:\n {4}branches: \[main\]\n/m);
    expect(text).not.toMatch(/pull_request|workflow_dispatch|schedule:/);
  });

  it("runs only in tilli-pro/nudge.js", () => {
    expect(workflow("release.yml")).toMatch(
      /^ {4}if: github\.repository == 'tilli-pro\/nudge\.js'$/m,
    );
  });

  it("may mint an OIDC token for trusted publishing", () => {
    const text = workflow("release.yml");
    expect(text).toMatch(/^permissions:\n(?: {2}.+\n)* {2}id-token: write$/m);
    expect(text).toMatch(/^ {2}contents: write$/m);
    expect(text).toMatch(/^ {2}pull-requests: write$/m);
  });

  it("installs npm 11.5.1 or later on Node 22 with the npm registry", () => {
    const text = workflow("release.yml");
    expect(text).toMatch(/^ {10}node-version: "22"$/m);
    expect(text).toMatch(
      /^ {10}registry-url: "https:\/\/registry\.npmjs\.org"$/m,
    );
    const install = /^ {6}- run: npm install -g npm@(\d+)\.(\d+)\.(\d+)$/m.exec(
      text,
    );
    expect(install).not.toBeNull();
    const version = install === null ? [] : install.slice(1).map(Number);
    expect(atLeast(version, [11, 5, 1])).toBe(true);
    const action = text.indexOf("uses: changesets/action@v1");
    expect(text.indexOf("npm install -g")).toBeLessThan(action);
    expect(text.indexOf("pnpm install --frozen-lockfile")).toBeLessThan(action);
  });

  it("versions and publishes through changesets scripts that exist", () => {
    const text = workflow("release.yml");
    expect(text).toContain("uses: changesets/action@v1");
    const commands = [
      ...text.matchAll(/^ +(version|publish): pnpm (\S+)$/gm),
    ].map((match) => match[2] ?? "");
    expect(commands).toEqual(["version-packages", "release"]);
    for (const command of commands) {
      expect(Object.keys(scripts), command).toContain(command);
    }
  });

  it("uses no npm token and no cache", () => {
    const text = workflow("release.yml");
    expect(text).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
    expect(text).not.toMatch(/\bcache:/);
  });
});

describe("pending changesets", () => {
  it("each names this package with a semver bump and a summary", () => {
    const directory = resolve(ROOT, ".changeset");
    const files = readdirSync(directory).filter(
      (name) => name.endsWith(".md") && name !== "README.md",
    );
    for (const name of files) {
      const text = readFileSync(resolve(directory, name), "utf8");
      const front = /^---\n"([^"]+)": (\w+)\n---\n/.exec(text);
      expect(front, name).not.toBeNull();
      expect(front?.[1], name).toBe("@tilli.dev/nudge.js");
      expect(["patch", "minor", "major"], name).toContain(front?.[2]);
      expect(text.slice(front?.[0].length ?? 0).trim(), name).not.toBe("");
    }
  });
});
