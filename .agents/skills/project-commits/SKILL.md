---
name: project-commits
description: Create one commit with all current repository changes using this repository's Conventional Commit rules. Use when the user asks to commit the current work.
---

# Project Commits

## Workflow

1. Перед коммитом удали созданные тобой временные файлы проверок.
2. If the staged diff is empty, report that there is nothing to commit and stop.
3. Use `type(scope): subject`. Scope is mandatory. Choose the type, scope, and subject from the current task. Write the subject in English, imperative mood, lowercase after the colon, with no trailing period.
4. Do not run tests, linters, builds, type checks, generators, or other validation as part of this skill unless the user explicitly requests it in the same request.
5. Commit all staged changes with `git commit -m "<subject>"`. Add a body only for necessary context.
6. Report in Russian: hash, subject, and whether the worktree is clean after the commit.

## Types and scopes

Use `feat`, `fix`, `test`, `docs`, `refactor`, `chore`, `build`, `ci`, `perf`, or `revert` for the type. Common scopes are `agents` for `AGENTS.md` and project skills, `scratch` for local tickets, `docs` for documentation and ADRs, `contract` for the OpenAPI schema, `auth`, `habits`, or `sleep` for those features, `web` for other app changes, `pwa` for PWA assets and configuration, and `repo` for root tooling. Choose another short scope when it identifies the change more clearly.
