# `level-lab` preset

A reusable `.sandcastle/` configuration extracted from a real project, so it can
be dropped into other repos without re-deriving the customizations each time.

It runs a **parallel-planner-with-review** workflow entirely under
`noSandbox()` (agents execute directly on the host — no Docker, no bind-mounts),
tuned for a **pnpm workspace** and a GitHub-Issues backlog.

## What it does

A four-phase loop (`main.mts`), repeated up to `MAX_ITERATIONS` times:

1. **Plan** — an Opus agent reads open issues, builds a dependency graph, and
   emits a `<plan>` JSON of unblocked issues + branch names (validated with Zod).
2. **Execute + Review** — each issue gets its own `createSandbox()` branch; the
   implementer runs, and if it produced commits a reviewer runs in the same
   sandbox. Pipelines run concurrently via `Promise.allSettled`.
3. **Merge** — one agent merges every completed branch back into the current
   branch and closes the issues.

## Deviations from the upstream template

These are the deliberate customizations (see `CUSTOMIZATIONS.md` for the full
rationale on each):

- **`noSandbox()` everywhere** — runs on the host instead of Docker.
- **pnpm-aware** — `pnpm install` hook on the per-branch sandboxes only;
  `copyToWorktree: []` (never copy pnpm's symlink-farm `node_modules`).
- **Planner filters on `ready-for-agent`** label (the label the authoring flow
  actually applies), not the upstream `Sandcastle` label.
- **Merger pushes to the remote** and **rolls up / closes completed parent
  PRDs**.
- **Merge gate = "branch ahead of HEAD"** (via `git rev-list`) rather than
  current-iteration commit count, so resumed branches still merge instead of
  looping forever.

## How to use in another project

1. Copy the contents of this directory into your repo's `.sandcastle/`:

```bash
mkdir -p .sandcastle
cp -r presets/level-lab/. .sandcastle/
```

2. Create `.sandcastle/.env` from the example and fill in your tokens:

```bash
cp .sandcastle/.env.example .sandcastle/.env
```

3. Ensure runner deps are available at the repo root (the runner imports `zod`
   and runs via `tsx`):

```bash
pnpm add -D tsx zod @types/node
```

4. Adjust for your project: this preset assumes a **pnpm workspace** and a
   `ready-for-agent` triage label. If you use npm/yarn or different labels,
   edit `main.mts`, `plan-prompt.md`, and `merge-prompt.md` accordingly.
   `CODING_STANDARDS.md` and `CUSTOMIZATIONS.md` are project-specific starting
   points — tailor them.

5. Run the loop:

```bash
npx tsx .sandcastle/main.mts
```

## Files

| File                  | Purpose                                                  |
| --------------------- | -------------------------------------------------------- |
| `main.mts`            | The four-phase orchestration loop                        |
| `plan-prompt.md`      | Planner prompt — dependency analysis + `<plan>` output   |
| `implement-prompt.md` | Implementer prompt                                       |
| `review-prompt.md`    | Reviewer prompt                                          |
| `merge-prompt.md`     | Merger prompt — merge, push, close issues + parent PRDs  |
| `CODING_STANDARDS.md` | Standards the reviewer enforces                          |
| `CUSTOMIZATIONS.md`   | Why each deviation from the upstream template exists     |
| `Dockerfile`          | Sandbox image (unused under `noSandbox()`; kept for ref) |
| `.env.example`        | Token placeholders (`ANTHROPIC_API_KEY`, `GH_TOKEN`)     |
| `.gitignore`          | Ignores `.env`, `logs/`, `worktrees/`                    |
