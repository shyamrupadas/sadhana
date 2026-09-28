---
name: project-commits
description: Commit staged changes in Sadhana when the user asks for a commit, using the repository's Conventional Commit format.
---

# Project Commits

Use this skill only for an explicit commit request. Change the git index only when the user explicitly asks to stage or unstage files. A commit request alone authorizes committing the existing staged diff, not staging other changes.

## Workflow

1. Inspect `git status --short`, `git diff --cached --stat`, `git diff --cached`, and `git diff --cached --check`.
2. If nothing is staged, report that there is nothing to commit and stop. If the staged diff includes changes outside the requested work or fails the whitespace check, report the issue and stop without changing the index.
3. Choose a message in the form `type(scope): subject`. Use an English, lowercase, imperative subject without a trailing period. Keep the scope concise and tied to the changed area.
4. Commit exactly the staged diff with `git commit -m "<message>"`. Do not rerun tests, lint, builds, type checks, or generators for a commit-only request; report validation already performed during the change task.
5. Report the commit hash, subject, and remaining worktree status in Russian.

## Types and scopes

Use `feat`, `fix`, `test`, `docs`, `refactor`, `chore`, `build`, `ci`, `perf`, or `revert` for the type. Common scopes are `agents` for `AGENTS.md` and project skills, `scratch` for local tickets, `docs` for documentation and ADRs, `contract` for the OpenAPI schema, `auth`, `habits`, or `sleep` for those features, `web` for other app changes, `pwa` for PWA assets and configuration, and `repo` for root tooling. Choose another short scope when it identifies the change more clearly.
