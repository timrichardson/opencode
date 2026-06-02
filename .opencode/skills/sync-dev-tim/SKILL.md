---
name: sync-dev-tim
description: Use when the user asks to fetch upstream dev, update local dev, sync dev-tim, or rebase dev-tim onto dev.
---

# Sync dev-tim

Use this skill to update the local `dev` branch from `upstream/dev`, then rebase `dev-tim` on top of the updated `dev`.

## Recommendation

- Prefer `rebase` for `dev-tim` because it is a topic/work branch and `dev` is the integration branch.
- Use `merge` only when preserving the branch's exact shared history is more important than a linear topic branch.
- If `dev-tim` has already been pushed and rewritten by rebase, pushing it will require a force-with-lease push. Ask before doing that.

## Safety Rules

- Start with `git status --short --branch` and inspect tracked changes before switching branches.
- Ignore unrelated untracked files unless they block checkout. Do not delete or modify untracked files without explicit user approval.
- If there are staged or unstaged tracked changes, stop and ask whether to commit, stash, or abort. Do not auto-stash unless the user asked for it.
- Before updating branches, inspect remotes with `git remote -v` if the expected remotes are uncertain.
- Do not push `dev`, `dev-tim`, or any rebased branch unless the user explicitly asks to push.
- If a rebase conflict occurs, report the conflicted files and resolve only if the user asked you to continue through conflicts.

## Workflow

1. Confirm branch/worktree state:

```sh
git status --short --branch
```

2. Fetch the latest upstream `dev`:

```sh
git fetch upstream dev
```

3. Update local `dev` exactly to `upstream/dev` history using fast-forward only:

```sh
git switch dev
git merge --ff-only upstream/dev
```

4. Rebase `dev-tim` on the updated local `dev`:

```sh
git switch dev-tim
git rebase dev
```

5. Verify the result:

```sh
git status --short --branch
git log --oneline --decorate -10
```

6. If the user asked to push after a successful rebase, use force-with-lease for the rebased topic branch:

```sh
git push --force-with-lease origin dev-tim
```

## Conflict Handling

- If `git rebase dev` stops with conflicts, inspect `git status --short` and the conflicted files.
- Resolve conflicts with the smallest correct changes.
- Continue with:

```sh
git rebase --continue
```

- If the user wants to abandon the rebase, run:

```sh
git rebase --abort
```
