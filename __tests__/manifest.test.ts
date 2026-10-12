import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

interface Manifest {
  name: string;
  version: string;
  type: string;
  sideEffects: boolean;
  license: string;
  exports: Record<string, string | Record<string, string>>;
  files: string[];
  engines: Record<string, string>;
  publishConfig: Record<string, unknown>;
  repository: Record<string, string>;
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  [key: string]: unknown;
}

const manifest: Manifest = JSON.parse(
  readFileSync(resolve(ROOT, "package.json"), "utf8"),
);

describe("package.json", () => {
  it("is the public ESM package @tilli.dev/nudge.js", () => {
    expect(manifest.name).toBe("@tilli.dev/nudge.js");
    expect(manifest.type).toBe("module");
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.license).toBe("MIT");
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exports one entry point, types before import", () => {
    expect(manifest.exports).toEqual({
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./package.json": "./package.json",
    });
    expect(Object.keys(manifest.exports["."])).toEqual(["types", "import"]);
  });

  it("publishes only dist, README.md, LICENSE and CHANGELOG.md", () => {
    expect(manifest.files).toEqual([
      "dist",
      "README.md",
      "LICENSE",
      "CHANGELOG.md",
    ]);
  });

  it("requires Node 22 or later and has no runtime dependency", () => {
    expect(manifest.engines).toEqual({ node: ">=22" });
    for (const key of [
      "dependencies",
      "peerDependencies",
      "optionalDependencies",
      "bundleDependencies",
    ]) {
      expect(manifest, key).not.toHaveProperty(key);
    }
  });

  it("publishes publicly with provenance from the repository", () => {
    expect(manifest.publishConfig).toEqual({
      access: "public",
      provenance: true,
    });
    expect(manifest.repository).toEqual({
      type: "git",
      url: "git+https://github.com/tilli-pro/nudge.js.git",
    });
  });

  it("declares exactly the scripts of the release flow", () => {
    expect(manifest.scripts).toEqual({
      build: "rm -rf dist && tsc -p tsconfig.build.json",
      typecheck: "tsc -p tsconfig.json",
      lint: "biome check .",
      "lint:fix": "biome check --write .",
      test: "vitest run",
      "test:live": "vitest run --config vitest.live.config.ts",
      "pack:smoke": "bash scripts/pack-smoke.sh",
      "record-fixtures": "tsx scripts/record-fixtures.ts",
      "version-packages": "changeset version",
      release: "pnpm build && changeset publish",
      prepare: "lefthook install",
    });
  });

  it("pins every devDependency exactly", () => {
    for (const [name, version] of Object.entries(manifest.devDependencies)) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(manifest.devDependencies["@biomejs/biome"]).toBe("2.5.6");
  });
});

describe("build output", () => {
  it("tracks no file under dist/", () => {
    const tracked = execFileSync("git", ["ls-files", "dist"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(tracked).toBe("");
  });

  it("ignores dist/", () => {
    expect(() =>
      execFileSync("git", ["check-ignore", "-q", "dist/index.js"], {
        cwd: ROOT,
      }),
    ).not.toThrow();
  });
});

describe("the 0.1.0 sources", () => {
  it("are gone", () => {
    expect(existsSync(resolve(ROOT, "src", "config.ts"))).toBe(false);
    expect(existsSync(resolve(ROOT, "src", "types.ts"))).toBe(false);
  });
});

describe("LICENSE", () => {
  it("is the MIT licence of 0.1.0", () => {
    const text = readFileSync(resolve(ROOT, "LICENSE"), "utf8");
    expect(text.startsWith("MIT License")).toBe(true);
    expect(text).toContain("Copyright (c) 2025 Tilli");
  });
});
