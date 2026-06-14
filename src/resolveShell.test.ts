import { afterEach, describe, expect, it } from "vitest";
import {
  resolvePosixShell,
  resetResolvePosixShellCache,
} from "./resolveShell.js";

describe("resolvePosixShell", () => {
  afterEach(() => resetResolvePosixShellCache());

  it("returns a non-empty shell command", () => {
    expect(resolvePosixShell().length).toBeGreaterThan(0);
  });

  it("returns bare 'sh' on non-Windows platforms", () => {
    if (process.platform === "win32") return; // covered by the Windows case below
    expect(resolvePosixShell()).toBe("sh");
  });

  it("memoizes the resolved value", () => {
    expect(resolvePosixShell()).toBe(resolvePosixShell());
  });

  it("resolves to an sh.exe path or falls back to 'sh' on Windows", () => {
    if (process.platform !== "win32") return;
    const resolved = resolvePosixShell();
    // Either Git's bundled sh.exe was located (absolute .exe path) or we fell
    // back to the bare name — both are acceptable, but never empty.
    expect(resolved === "sh" || resolved.toLowerCase().endsWith("sh.exe")).toBe(
      true,
    );
  });
});
