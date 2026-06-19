// Publish this fork under a personal scope WITHOUT permanently renaming the
// package in-repo (which would conflict with every upstream merge).
//
// It temporarily rewrites the package name + the nulfrog-castle template's
// import specifier, builds (cross-platform — the repo's `postbuild` uses
// unix `rm`/`cp` which fail on Windows), publishes, then restores the files.
//
// Usage:
//   node scripts/publish-fork.mjs            # real publish (needs `npm login` + OTP)
//   DRY=1 node scripts/publish-fork.mjs      # validate the tarball, no registry calls
//
// Env:
//   SCOPE_NAME   published name      (default: @nulfrog/sandcastle)

import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISHED_NAME = process.env.SCOPE_NAME ?? "@nulfrog/sandcastle";
const UPSTREAM_NAME = "@ai-hero/sandcastle";
const DRY = process.env.DRY === "1";

const pkgPath = join(root, "package.json");
const mainMtsPath = join(
  root,
  "src",
  "templates",
  "nulfrog-castle",
  "main.mts",
);

// shell: true so Windows resolves npm/npx/.cmd shims (spawnSync ENOENT otherwise).
const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", shell: true });

// --- snapshot originals so we can always restore -------------------------
const originalPkg = readFileSync(pkgPath, "utf8");
const originalMain = readFileSync(mainMtsPath, "utf8");

try {
  // 1. Rewrite the package name.
  const pkg = JSON.parse(originalPkg);
  pkg.name = PUBLISHED_NAME;
  // Scoped packages default to restricted; make every publish public.
  pkg.publishConfig = { ...(pkg.publishConfig ?? {}), access: "public" };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  // 2. Rewrite the template's import so a consumer of the published package
  //    gets a scaffold that resolves against the package they installed.
  writeFileSync(
    mainMtsPath,
    originalMain.replaceAll(UPSTREAM_NAME, PUBLISHED_NAME),
  );

  // 3. Build (tsup) + copy templates into dist (cross-platform postbuild).
  run("npx", ["tsup"]);
  const srcTemplates = join(root, "src", "templates");
  const distTemplates = join(root, "dist", "templates");
  rmSync(distTemplates, { recursive: true, force: true });
  cpSync(srcTemplates, distTemplates, { recursive: true });
  run("node", ["scripts/check-public-types-effect-free.mjs"]);

  // 4. Publish (or dry-run).
  const publishArgs = ["publish", "--access", "public"];
  if (DRY) publishArgs.push("--dry-run");
  // Pass a 2FA one-time password non-interactively when provided.
  if (process.env.NPM_OTP) publishArgs.push(`--otp=${process.env.NPM_OTP}`);
  run("npm", publishArgs);

  console.log(
    `\n${DRY ? "[dry-run] " : ""}Done: ${PUBLISHED_NAME}@${pkg.version}`,
  );
} finally {
  // 5. Always restore the in-repo files so the fork stays upstream-mergeable.
  writeFileSync(pkgPath, originalPkg);
  writeFileSync(mainMtsPath, originalMain);
  console.log("Restored package.json and nulfrog-castle/main.mts.");
}
