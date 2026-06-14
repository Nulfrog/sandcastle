import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectPackageManager,
  addDependencyCommand,
  hostHasDependency,
  getTemplateDependencies,
  getHostDependencies,
  isPnpmWorkspaceRoot,
  RUNNER_DEPENDENCIES,
} from "./InitService.js";

const makeDir = () => mkdtemp(join(tmpdir(), "init-service-"));

describe("detectPackageManager", () => {
  const detect = (dir: string) =>
    Effect.runPromise(
      detectPackageManager(dir).pipe(Effect.provide(NodeFileSystem.layer)),
    );

  it("defaults to npm when no lockfile or packageManager field is present", async () => {
    const dir = await makeDir();
    expect(await detect(dir)).toBe("npm");
  });

  it.each([
    { file: "pnpm-lock.yaml", expected: "pnpm" },
    { file: "yarn.lock", expected: "yarn" },
    { file: "bun.lockb", expected: "bun" },
    { file: "bun.lock", expected: "bun" },
    { file: "package-lock.json", expected: "npm" },
  ])("detects $expected from $file", async ({ file, expected }) => {
    const dir = await makeDir();
    await writeFile(join(dir, file), "");
    expect(await detect(dir)).toBe(expected);
  });

  it("prefers the package.json packageManager field over a lockfile", async () => {
    const dir = await makeDir();
    // Lockfile says npm, but the explicit field says pnpm — field wins.
    await writeFile(join(dir, "package-lock.json"), "");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "test", packageManager: "pnpm@9.1.0" }),
    );
    expect(await detect(dir)).toBe("pnpm");
  });

  it("ignores an unrecognized packageManager field and falls back to lockfile", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "yarn.lock"), "");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "test", packageManager: "deno@1.0.0" }),
    );
    expect(await detect(dir)).toBe("yarn");
  });
});

describe("addDependencyCommand", () => {
  it.each([
    { pm: "npm" as const, expected: "npm install zod" },
    { pm: "pnpm" as const, expected: "pnpm add zod" },
    { pm: "yarn" as const, expected: "yarn add zod" },
    { pm: "bun" as const, expected: "bun add zod" },
  ])("$pm builds '$expected'", ({ pm, expected }) => {
    expect(addDependencyCommand(pm, "zod")).toBe(expected);
  });

  it.each([
    { pm: "npm" as const, expected: "npm install --save-dev tsx zod" },
    { pm: "pnpm" as const, expected: "pnpm add -D tsx zod" },
    { pm: "yarn" as const, expected: "yarn add -D tsx zod" },
    { pm: "bun" as const, expected: "bun add -d tsx zod" },
  ])("$pm installs multiple dev deps with '$expected'", ({ pm, expected }) => {
    expect(addDependencyCommand(pm, "tsx zod", { dev: true })).toBe(expected);
  });

  it("adds -w before -D for a pnpm workspace root", () => {
    expect(
      addDependencyCommand("pnpm", "tsx", { dev: true, workspaceRoot: true }),
    ).toBe("pnpm add -w -D tsx");
  });

  it("ignores workspaceRoot for non-pnpm managers", () => {
    expect(addDependencyCommand("npm", "tsx", { workspaceRoot: true })).toBe(
      "npm install tsx",
    );
  });
});

describe("getHostDependencies", () => {
  it("always includes the runner dependency (tsx)", () => {
    for (const tpl of ["blank", "simple-loop", "parallel-planner"]) {
      expect(getHostDependencies(tpl)).toContain("tsx");
    }
    expect(RUNNER_DEPENDENCIES).toContain("tsx");
  });

  it("adds the template's own deps after the runner deps, deduped", () => {
    expect(getHostDependencies("parallel-planner")).toEqual(["tsx", "zod"]);
    expect(getHostDependencies("parallel-planner-with-review")).toEqual([
      "tsx",
      "zod",
    ]);
  });

  it("is just the runner deps for templates with no extra deps", () => {
    expect(getHostDependencies("simple-loop")).toEqual(["tsx"]);
    expect(getHostDependencies("blank")).toEqual(["tsx"]);
  });
});

describe("isPnpmWorkspaceRoot", () => {
  const check = (dir: string) =>
    Effect.runPromise(
      isPnpmWorkspaceRoot(dir).pipe(Effect.provide(NodeFileSystem.layer)),
    );

  it("returns false without a pnpm-workspace.yaml", async () => {
    const dir = await makeDir();
    expect(await check(dir)).toBe(false);
  });

  it("returns true when pnpm-workspace.yaml is present", async () => {
    const dir = await makeDir();
    await writeFile(
      join(dir, "pnpm-workspace.yaml"),
      "packages:\n  - 'pkgs/*'\n",
    );
    expect(await check(dir)).toBe(true);
  });
});

describe("hostHasDependency", () => {
  const has = (dir: string, pkg: string) =>
    Effect.runPromise(
      hostHasDependency(dir, pkg).pipe(Effect.provide(NodeFileSystem.layer)),
    );

  it("returns false when there is no package.json", async () => {
    const dir = await makeDir();
    expect(await has(dir, "zod")).toBe(false);
  });

  it("returns false when the package is not declared", async () => {
    const dir = await makeDir();
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "test", dependencies: { effect: "^3" } }),
    );
    expect(await has(dir, "zod")).toBe(false);
  });

  it.each(["dependencies", "devDependencies"])(
    "returns true when the package is in %s",
    async (key) => {
      const dir = await makeDir();
      await writeFile(
        join(dir, "package.json"),
        JSON.stringify({ name: "test", [key]: { zod: "^3" } }),
      );
      expect(await has(dir, "zod")).toBe(true);
    },
  );
});

describe("getTemplateDependencies", () => {
  it("reports zod as a dependency of the planner templates", () => {
    expect(getTemplateDependencies("parallel-planner")).toContain("zod");
    expect(getTemplateDependencies("parallel-planner-with-review")).toContain(
      "zod",
    );
  });

  it("reports no dependencies for templates that don't need a schema validator", () => {
    expect(getTemplateDependencies("simple-loop")).not.toContain("zod");
    expect(getTemplateDependencies("blank")).not.toContain("zod");
  });
});
