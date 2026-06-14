/**
 * Resolve a POSIX `sh` to run host commands with.
 *
 * The `noSandbox()` provider executes every command via `spawn("sh", ["-c", …])`.
 * On macOS/Linux `sh` is always on PATH, so this is a no-op there. On Windows
 * there is no `sh` unless something puts one on PATH — without it the runner
 * dies instantly with a cryptic `spawn sh ENOENT`. Git for Windows ships a
 * full `sh.exe` (the same shell Git Bash uses), so on Windows we locate that
 * and return its absolute path, letting noSandbox work out of the box wherever
 * Git is installed.
 *
 * Resolution order on Windows:
 *   1. `sh.exe` already on PATH (e.g. Git's bin dir is on PATH).
 *   2. Derived from `git.exe` on PATH (Git ships sh under `bin/` and `usr/bin/`).
 *   3. Common Git for Windows install locations.
 * Falls back to `"sh"` if none are found, preserving the prior behaviour (and
 * its ENOENT) rather than failing differently.
 */

import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

let cached: string | undefined;

/** Absolute path to (or bare name of) a POSIX shell to spawn. Memoized. */
export function resolvePosixShell(): string {
  if (cached !== undefined) return cached;
  cached = process.platform === "win32" ? (findWindowsSh() ?? "sh") : "sh";
  return cached;
}

/** Reset the memoized result. Test-only. */
export function resetResolvePosixShellCache(): void {
  cached = undefined;
}

/** Relative paths from a Git for Windows install root to its bundled `sh.exe`. */
const GIT_SH_RELATIVE: ReadonlyArray<readonly string[]> = [
  ["bin", "sh.exe"],
  ["usr", "bin", "sh.exe"],
];

function findWindowsSh(): string | null {
  // 1. sh.exe already discoverable on PATH.
  const onPath = searchPathForExe("sh.exe");
  if (onPath) return onPath;

  // 2. Derive from git.exe on PATH. Git for Windows lays out git.exe under
  //    <root>\cmd\git.exe (or <root>\bin\git.exe) and sh.exe under <root>\bin
  //    and <root>\usr\bin, so the install root is the grandparent of git.exe.
  const git = searchPathForExe("git.exe");
  if (git) {
    const gitRoot = dirname(dirname(git));
    for (const rel of GIT_SH_RELATIVE) {
      const candidate = join(gitRoot, ...rel);
      if (existsSync(candidate)) return candidate;
    }
  }

  // 3. Common install locations.
  const roots = [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Programs")
      : undefined,
    "C:\\Program Files",
    "C:\\Program Files (x86)",
  ].filter((r): r is string => typeof r === "string" && r.length > 0);
  for (const root of roots) {
    for (const rel of GIT_SH_RELATIVE) {
      const candidate = join(root, "Git", ...rel);
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

/** First directory on PATH that contains `exe`, joined to `exe`; null if none. */
function searchPathForExe(exe: string): string | null {
  const pathVar = process.env.PATH ?? process.env.Path ?? "";
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
