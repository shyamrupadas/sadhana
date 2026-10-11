---
name: project-commits
description: Commit the requested work using this repository's Conventional Commit rules. Use when the user asks to commit.
---

# Project Commits

## Workflow

1. Перед коммитом удали созданные тобой временные файлы проверок.
2. Stage and commit the requested work as one commit, preserving unrelated staged changes.
3. Use `type(scope): subject`. Scope is mandatory. Write the subject in English, imperative mood, lowercase after the colon, with no trailing period.
4. Do not run tests, linters, builds, type checks, generators, or other validation as part of this skill unless the user explicitly requests it in the same request.
5. Report: hash, subject, and whether the worktree is clean after the commit.

## Types and scopes

Project scopes: `agents` — agent instructions and skills; `scratch` — local specs and tickets; `contract` — API contract; `repo` — root tooling.
