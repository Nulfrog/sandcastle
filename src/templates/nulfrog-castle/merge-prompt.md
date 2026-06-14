# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, run `npm run typecheck` and `npm run test` to verify everything works
4. If tests fail, fix the issues before proceeding to the next branch

After all branches are merged, make a single commit summarizing the merge.

# PUSH

Push the merged work to the remote:

1. Wire git's credentials to the `GH_TOKEN` so the push can authenticate:
   `gh auth setup-git`
2. Push the **current branch only** (do NOT use `--all`, which would push the
   local `sandcastle/issue-*` working branches):
   `git push origin HEAD`
3. If the push fails (auth, non-fast-forward, etc.), do NOT force-push. Report
   the failure in your final output and continue to closing the issues.

# CLOSE ISSUES

For each branch that was merged, close its issue using the following command:

`gh issue close <ID> --comment "Completed by Sandcastle"`

Here are all the issues:

{{ISSUES}}

# CLOSE COMPLETED PARENT PRDs

Each issue above may be a vertical slice of a parent PRD. Slices reference their
parent in a `## Parent` section of their body (e.g. `#73`). The parent is a
separate `prd`-labelled tracking issue that is NOT in the list above and is never
worked directly, so it must be rolled up and closed here once all its slices are
done. Do this AFTER closing the slices above:

1. For each issue you just closed, read its body with `gh issue view <ID> --json body`
   and extract the parent PRD number from its `## Parent` section. Skip the issue
   if it has no `## Parent` section.
2. Collect the distinct parent PRD numbers.
3. For each distinct parent PRD `<P>`:
   a. Confirm it is still open and carries the `prd` label:
   `gh issue view <P> --json state,labels`. Skip it if it is already closed or
   is not a `prd`.
   b. Find ALL of its slices — every open OR closed issue whose body references
   `#<P>` in a `## Parent` section. Search with
   `gh issue list --state all --search "#<P> in:body" --json number,body` and
   keep only those whose `## Parent` section actually names `#<P>` (the search
   is a coarse text match — verify each candidate's body to avoid unrelated
   mentions).
   c. If EVERY such slice is CLOSED, close the parent:
   `gh issue close <P> --comment "All vertical slices completed; closed by Sandcastle"`.
   If any slice is still OPEN, leave the parent open.

Be conservative: only close a parent when you have positively confirmed every one
of its slices is closed. When in doubt, leave the parent open and note it in your
final output.

Once you've merged everything you can, output <promise>COMPLETE</promise>.
