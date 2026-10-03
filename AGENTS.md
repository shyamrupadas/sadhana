# Repository Guidelines

## Build, Test, and Development Commands
- `pnpm dev:web`: run the Vite dev server from `apps/web`.
- `pnpm build:web`: type-check and build the web package through Turbo.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`: run workspace tasks through Turbo.
- `pnpm --filter @sadhana/web preview`: serve the built web app locally.
- `pnpm --filter @sadhana/web api`: generate OpenAPI types into `apps/web/src/shared/api/schema/generated.ts`.
- `pnpm --dir apps/web dlx shadcn@latest add checkbox`: add a shadcn/ui component (example for checkbox).

## Coding Style & Naming Conventions
- TypeScript + React (`.ts`, `.tsx`) with strict compiler settings.
- In web, use the `@/*` alias for `apps/web/src/*` (e.g., `@/shared/lib/date`).
- For spacing, sizing, and layout, always use Tailwind scale utilities (e.g., `w-12`, `px-3`) when possible; do not use arbitrary pixel values unless there is no suitable Tailwind scale alternative.
- Fractional Tailwind size utilities (e.g., `w-10.5`) are acceptable; use them when needed instead of arbitrary pixel values.
- Formatting is handled by Prettier via ESLint config; keep changes consistent.
- Всегда отвечай пользователю только по-русски.

## Testing Guidelines
Automated tests are not currently configured. For changes:
- run `pnpm lint` and `pnpm build`;
- do a quick manual pass in `pnpm dev:web` for affected web flows.

## Commit & Pull Request Guidelines
- Do not change the git index (`git add`, `git restore --staged`) or commit unless explicitly asked.
- PRs should include: a concise description, relevant issue link (if any), and screenshots for UI changes. Note any API schema updates and whether `pnpm --filter @sadhana/web api` was run.

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

Single-context layout: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
