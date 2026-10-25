# Repository Guidelines

## Build, Test, and Development Commands
- `pnpm dev:web`: run the Vite dev server from `apps/web`.
- `pnpm build:web`: type-check and build the web package through Turbo.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`: run workspace tasks through Turbo.
- `pnpm --filter @sadhana/web preview`: serve the built web app locally.
- `pnpm --filter @sadhana/api-contract generate`: regenerate the shared OpenAPI, client, and handler artifacts from TypeSpec.
- `pnpm --dir apps/web dlx shadcn@latest add checkbox`: add a shadcn/ui component (example for checkbox).

## Coding Style & Naming Conventions
- TypeScript + React (`.ts`, `.tsx`) with strict compiler settings.
- In web, use the `@/*` alias for `apps/web/src/*` (e.g., `@/shared/lib/date`).
- For spacing, sizing, and layout, always use Tailwind scale utilities (e.g., `w-12`, `px-3`) when possible; do not use arbitrary pixel values unless there is no suitable Tailwind scale alternative.
- Fractional Tailwind size utilities (e.g., `w-10.5`) are acceptable; use them when needed instead of arbitrary pixel values.
- Formatting is handled by Prettier via ESLint config; keep changes consistent.

## Testing Guidelines
- At the start of any implementation task, read [Task Completion Order](docs/testing/guide.md#порядок-завершения-задачи) and follow it throughout the task, even when no test files change.
- Change test expectations only when the intended behavior changes or the test is demonstrably incorrect.
- For API contract or generator changes, follow the Contract Tests section in `docs/testing/guide.md`.

## Commit & Pull Request Guidelines
- PRs should include: a concise description, relevant issue link (if any), and screenshots for UI changes. Note any API contract updates and whether `pnpm --filter @sadhana/api-contract generate` was run.

## Configuration & PWA Notes
- PWA behavior is configured via Vite plugins and assets in `apps/web/public/`.
- Service worker output and generated files should not be edited manually; regenerate via the build or PWA tooling.

## Agent skills

### Frontend architecture

For adding or moving frontend files, changing module responsibilities, dependencies, or public interfaces, or auditing the architecture, follow `.agents/skills/frontend-architecture/SKILL.md`. Current rules are in `docs/architecture/frontend.md`.

### Issue tracker

Specs and tickets use `to-spec → to-tickets` and live in `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical triage roles; completed implementation awaiting acceptance uses `awaiting-human-review`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### UI tests

For adding or reviewing tests, follow `.agents/skills/write-tests/SKILL.md`; level definitions and commands are in `docs/testing/`.
