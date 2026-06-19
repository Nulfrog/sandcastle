# Sandcastle project customizations

Tracks deviations from the upstream `@nulfrog/sandcastle` template so they can be
re-applied after an upgrade. The upgrade process overwrites `.sandcastle/` with
the vanilla template, so every upgrade must re-check this list.

This config runs every phase with `noSandbox()` (agents execute directly on the
host — no Docker, no bind-mounts).

## How to use on upgrade

1. Bump `@nulfrog/sandcastle` and pull the new template files.
2. For each entry below, confirm the customization survived; re-apply if the
   template reverted it.
3. Update this file with anything new.

Last reconciled against: `@nulfrog/sandcastle@^0.7.0`

## Active customizations

### Planner filters on `ready-for-agent` label

- Files: [plan-prompt.md](plan-prompt.md)
- Why: Issues reach the backlog via the authoring flow
  `/grill-with-docs -> /to-prd -> /to-issues`, which stamps AFK-ready issues with
  the `ready-for-agent` triage label (see `docs/agents/triage-labels.md`). The
  template's planner instead filters on a `Sandcastle` label that nothing in the
  flow ever applies, so the planner always sees an empty list. Filter on the
  label the skills actually produce.
- Change: in `plan-prompt.md`, the `gh issue list` filter is
  `--label ready-for-agent` (template default: no label filter).

### Merger pushes merged work to the remote

- Files: [merge-prompt.md](merge-prompt.md)
- Why: The vanilla flow merges branches into the local branch and closes the
  issues but never pushes, so the work stays on the host. We want a completed run
  to land on the remote.
- Change: a `# PUSH` step that runs `gh auth setup-git` (so the `git push` can
  authenticate via `GH_TOKEN`) then `git push origin HEAD`. Deliberately scoped
  to the current branch — **not** `git push --all`, which would also push the
  local `sandcastle/issue-*` working branches. On failure the merger reports it
  rather than force-pushing.

### Merger rolls up and closes completed parent PRDs

- Files: [merge-prompt.md](merge-prompt.md)
- Why: Work enters the backlog as `prd` tracking issues that `/to-issues` splits
  into `ready-for-agent` vertical slices. The slices link back via a `## Parent`
  body section (plain text `#<N>`, not a native GitHub sub-issue). The planner
  filters on `ready-for-agent`, so the `prd` parent is never worked, and the
  merger's `# CLOSE ISSUES` step only closes the slice IDs in `{{ISSUES}}`.
  Nothing read the `## Parent` back-reference, so a PRD whose every slice was
  merged + closed stayed OPEN forever. The vanilla template has no parent concept.
- Change: a `# CLOSE COMPLETED PARENT PRDs` step after `# CLOSE ISSUES`. For each
  just-closed slice it reads the `## Parent` PRD number, then for each distinct
  parent confirms it is an open `prd`, finds every slice referencing it
  (`gh issue list --state all --search "#<P> in:body"`, verifying each body's
  `## Parent` actually names `#<P>`), and closes the parent only when ALL its
  slices are closed. Conservative: leaves the parent open on any doubt.

### `pnpm install` hook on per-branch sandboxes only (no `node_modules` copy)

- Files: [main.mts](main.mts)
- Why: even under `noSandbox()`, `createSandbox()` (implementer/reviewer) always
  checks out a **fresh git worktree**. `node_modules` is gitignored, so that
  worktree starts with no dependencies and the agent's `typecheck`/`test` would
  fail without an install. The planner/merger are different: they `run()` with no
  branch, so they use the default `head` strategy and execute in the **repo root**
  (live working dir), where `node_modules` already exists. The vanilla template
  shares one `hooks` const across all phases and runs `npm install` — wrong here
  two ways: (1) this is a **pnpm workspace**, so `npm install` ignores
  `pnpm-workspace.yaml` + `catalog:` and writes a foreign flat tree; (2) applied
  to the planner/merger it would mutate the live repo-root workspace.
- Change: in `main.mts`,
  - the hook is `pnpm install`, in a const named `installHooks`, passed **only**
    to `createSandbox()` (implementer/reviewer).
  - the planner and merger `run()` calls pass **no** `hooks`.
  - `copyToWorktree` is `[]` (template default: `["node_modules"]`). pnpm's
    `node_modules` is a symlink farm into the shared `.pnpm` store; copying it to
    a sibling worktree path yields dangling/foreign symlinks, so the fresh
    `pnpm install` is the reliable path.

### Merge gates on "branch ahead of HEAD", not current-iteration commits

- Files: [main.mts](main.mts)
- Why: the template decides which branches reach the merge phase by counting
  commits an agent produced **in the current iteration** (`implement.commits`).
  But `createSandbox({ branch })` reuses an existing branch, so when a branch's
  work was already committed by an earlier (possibly interrupted) run, the
  implementer correctly makes **no new commit** — current-iteration count is 0,
  the branch is filtered out, never merged, and its issue stays open +
  `ready-for-agent`. The planner then re-picks the same issue every iteration: an
  infinite no-op loop (observed with #107/#108, both 1 commit ahead of `main`
  from a prior run, never merged).
- Change: a `branchHasUnmergedCommits(branch)` host helper
  (`git rev-list --count HEAD..<branch>`) replaces the
  `value.commits.length > 0` filter. A fulfilled pipeline whose branch is ahead
  of the merge target flows to merge regardless of which run produced the
  commits; a branch with nothing ahead of HEAD (no work, or already merged) is
  still skipped. Uses `node:child_process` (the runner stays on the merge target
  during plan/execute, so plain git sees the real local branches).

## Already satisfied by the template (no action needed)

### Runner deps (`tsx`, `zod`, `@types/node`) at the repo root

- Files: `package.json` (repo root, outside `.sandcastle/`)
- Why: `main.mts` is run via `tsx` from the repo root and imports `zod` plus
  (now) `node:child_process`. In this pnpm workspace these aren't hoisted to the
  root automatically.
- Status: `tsx` and `zod: catalog:` were already present. `@types/node: catalog:`
  was **added** so the `node:child_process` import in the merge-gating helper
  type-checks from the repo root (catalog pins `^22.10.0`). Re-verify after an
  upgrade in case the template's runner imports change.
