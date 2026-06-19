// Parallel Planner with Review — four-phase orchestration loop
//
// This template drives a multi-phase workflow:
//   Phase 1 (Plan):             An opus agent analyzes open issues, builds a
//                               dependency graph, and outputs a <plan> JSON
//                               listing unblocked issues with branch names.
//   Phase 2 (Execute + Review): For each issue, a sandbox is created via
//                               createSandbox(). The implementer runs first
//                               (100 iterations). If it produces commits, a
//                               reviewer runs in the same sandbox on the same
//                               branch (1 iteration). All issue pipelines run
//                               concurrently via Promise.allSettled().
//   Phase 3 (Merge):            A single agent merges all completed branches
//                               into the current branch.
//
// The outer loop repeats up to MAX_ITERATIONS times so that newly unblocked
// issues are picked up after each round of merges.
//
// Usage:
//   npx tsx .sandcastle/main.mts
// Or add to package.json:
//   "scripts": { "sandcastle": "npx tsx .sandcastle/main.mts" }

import { execFileSync } from "node:child_process";
import * as sandcastle from "@nulfrog/sandcastle";
import { noSandbox } from "@nulfrog/sandcastle/sandboxes/no-sandbox";
import { z } from "zod";

// The planner emits its plan as JSON inside <plan> tags; Output.object extracts
// and validates it against this schema. We use Zod here, but any Standard
// Schema validator works just as well — Valibot, ArkType, etc. See
// https://standardschema.dev.
const planSchema = z.object({
  issues: z.array(
    z.object({ id: z.string(), title: z.string(), branch: z.string() }),
  ),
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Maximum number of plan→execute→merge cycles before stopping.
// Raise this if your backlog is large; lower it for a quick smoke-test run.
const MAX_ITERATIONS = 10;

// Install hook for the per-branch sandboxes only. createSandbox() always
// checks out a FRESH git worktree (node_modules is gitignored, so it's absent),
// so the implementer/reviewer must install deps before running. This is a pnpm
// workspace, so use `pnpm install` (npm would ignore pnpm-workspace.yaml +
// catalog: and write a foreign flat tree). Attached ONLY to createSandbox below
// — the planner/merger run() in the repo root (default `head` strategy) where
// node_modules already exists; running any install there would mutate the live
// workspace.
const installHooks = {
  sandbox: { onSandboxReady: [{ command: "pnpm install" }] },
};

// Do NOT copy node_modules into the worktree: pnpm's node_modules is a symlink
// farm into the shared .pnpm store, so copying it to a sibling worktree path
// yields dangling/foreign symlinks. Install fresh in the worktree instead (via
// installHooks above).
const copyToWorktree: string[] = [];

// Returns true if `branch` has commits not yet reachable from HEAD (the branch
// the merge phase merges into). We gate the merge on this rather than on commits
// produced in the CURRENT iteration: when createSandbox() reuses an existing
// branch whose work was already committed by an earlier (possibly interrupted)
// run, the implementer correctly makes no new commit, so a current-iteration
// count is 0 and the branch would never merge — the planner then re-picks the
// same open issue forever. Checking "ahead of HEAD" catches those resumed
// branches so they merge + close instead of looping. Runs on the host (the
// runner stays on the merge target during plan/execute; sandboxes use their own
// worktrees), so a plain git invocation sees the real local branches.
function branchHasUnmergedCommits(branch: string): boolean {
  try {
    const count = execFileSync(
      "git",
      ["rev-list", "--count", `HEAD..${branch}`],
      { encoding: "utf8" },
    ).trim();
    return Number(count) > 0;
  } catch {
    // Branch missing or git error — nothing we can safely merge.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  // -------------------------------------------------------------------------
  // Pre-plan: pull latest from remote so the planner reasons against an up-to-
  // date branch list and issue state. Non-fatal: a pull failure (e.g. offline)
  // prints a warning and continues with the local state.
  // -------------------------------------------------------------------------
  console.log("Pulling latest from remote…");
  try {
    execFileSync("git", ["pull", "--ff-only"], {
      encoding: "utf8",
      stdio: "pipe",
    });
    console.log("Pull complete.");
  } catch (err) {
    console.warn(
      `git pull failed (continuing with local state): ${(err as Error).message}`,
    );
  }

  // -------------------------------------------------------------------------
  // Phase 1: Plan
  //
  // The planning agent (opus, for deeper reasoning) reads the open issue list,
  // builds a dependency graph, and selects the issues that can be worked in
  // parallel right now (i.e., no blocking dependencies on other open issues).
  //
  // It outputs a <plan> JSON block — Output.object parses and validates it.
  // -------------------------------------------------------------------------
  const plan = await sandcastle.run({
    sandbox: noSandbox(),
    name: "planner",
    // One iteration is enough: the planner just needs to read and reason,
    // not write code. (Structured output requires maxIterations: 1.)
    maxIterations: 1,
    // Opus for planning: dependency analysis benefits from deeper reasoning.
    agent: sandcastle.claudeCode("claude-opus-4-8"),
    promptFile: "./.sandcastle/plan-prompt.md",
    // Extract and validate the <plan> JSON into a typed object. Throws
    // StructuredOutputError if the tag is missing, the JSON is malformed, or
    // validation fails — which aborts the loop.
    output: sandcastle.Output.object({ tag: "plan", schema: planSchema }),
  });

  const issues = plan.output.issues;

  if (issues.length === 0) {
    // No unblocked work — either everything is done or everything is blocked.
    console.log("No unblocked issues to work on. Exiting.");
    break;
  }

  console.log(
    `Planning complete. ${issues.length} issue(s) to work in parallel:`,
  );
  for (const issue of issues) {
    console.log(`  ${issue.id}: ${issue.title} → ${issue.branch}`);
  }

  // -------------------------------------------------------------------------
  // Phase 2: Execute + Review
  //
  // For each issue, create a sandbox via createSandbox() so the implementer
  // and reviewer share the same sandbox instance per branch. The implementer
  // runs first; if it produces commits, the reviewer runs in the same sandbox.
  //
  // Promise.allSettled means one failing pipeline doesn't cancel the others.
  // -------------------------------------------------------------------------

  const settled = await Promise.allSettled(
    issues.map(async (issue) => {
      const sandbox = await sandcastle.createSandbox({
        branch: issue.branch,
        sandbox: noSandbox(),
        hooks: installHooks,
        copyToWorktree,
      });

      try {
        // Run the implementer
        const implement = await sandbox.run({
          name: "implementer",
          maxIterations: 100,
          agent: sandcastle.claudeCode("claude-fable-5"),
          promptFile: "./.sandcastle/implement-prompt.md",
          promptArgs: {
            TASK_ID: issue.id,
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          },
        });

        // Only review if the implementer produced commits
        if (implement.commits.length > 0) {
          const review = await sandbox.run({
            name: "reviewer",
            maxIterations: 1,
            agent: sandcastle.claudeCode("claude-opus-4-8"),
            promptFile: "./.sandcastle/review-prompt.md",
            promptArgs: {
              BRANCH: issue.branch,
            },
          });

          // Merge commits from both runs so the merge phase sees all of them.
          // Each sandbox.run() only returns commits from its own run.
          return {
            ...review,
            commits: [...implement.commits, ...review.commits],
          };
        }

        return implement;
      } finally {
        await sandbox.close();
      }
    }),
  );

  // Log any agents that threw (network error, sandbox crash, etc.).
  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      console.error(
        `  ✗ ${issues[i]!.id} (${issues[i]!.branch}) failed: ${outcome.reason}`,
      );
    }
  }

  // Pass branches whose work isn't yet on the merge target to the merge phase.
  // We check "branch ahead of HEAD" (see branchHasUnmergedCommits) rather than
  // commits produced this iteration, so a branch finished by an earlier run —
  // where the implementer makes no new commit — still merges instead of being
  // re-planned forever. A fulfilled pipeline with nothing ahead of HEAD (truly
  // no work, or already merged) is correctly skipped.
  const completedIssues = settled
    .map((outcome, i) => ({ outcome, issue: issues[i]! }))
    .filter(
      (entry) =>
        entry.outcome.status === "fulfilled" &&
        branchHasUnmergedCommits(entry.issue.branch),
    )
    .map((entry) => entry.issue);

  const completedBranches = completedIssues.map((i) => i.branch);

  console.log(
    `\nExecution complete. ${completedBranches.length} branch(es) with commits:`,
  );
  for (const branch of completedBranches) {
    console.log(`  ${branch}`);
  }

  if (completedBranches.length === 0) {
    // All agents ran but none made commits — nothing to merge this cycle.
    console.log("No commits produced. Nothing to merge.");
    continue;
  }

  // -------------------------------------------------------------------------
  // Phase 3: Merge
  //
  // One agent merges all completed branches into the current branch,
  // resolving any conflicts and running tests to confirm everything works.
  //
  // The {{BRANCHES}} and {{ISSUES}} prompt arguments are lists that the agent
  // uses to know which branches to merge and which issues to close.
  // -------------------------------------------------------------------------
  await sandcastle.run({
    sandbox: noSandbox(),
    name: "merger",
    maxIterations: 1,
    agent: sandcastle.claudeCode("claude-opus-4-8"),
    promptFile: "./.sandcastle/merge-prompt.md",
    promptArgs: {
      // A markdown list of branch names, one per line.
      BRANCHES: completedBranches.map((b) => `- ${b}`).join("\n"),
      // A markdown list of issue IDs and titles, one per line.
      ISSUES: completedIssues.map((i) => `- ${i.id}: ${i.title}`).join("\n"),
    },
  });

  console.log("\nBranches merged.");
}

console.log("\nAll done.");
