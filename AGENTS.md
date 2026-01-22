# Repository Guidelines

## Project Structure & Module Organization
- `src/app/`: app bootstrap, routing, and global providers.
- `src/features/`: feature modules (e.g., `auth`, `main`); feature entry points should be `index.ts` or `*.page.tsx`.
- `src/shared/`: shared UI, utilities, API client, and models.
- `public/`: static assets and PWA files.
- `dist/`: production build output (generated).

Layering is enforced by `eslint-plugin-boundaries`: `shared` cannot import from `features` or `app`, and `features` cannot import from `app`. Use public APIs (barrels or page entry points) when importing features.

## Build, Test, and Development Commands
- `yarn start`: run Vite dev server.
- `yarn build`: type-check (`tsc -b`) and create a production build.
- `yarn preview`: serve the built app locally.
- `yarn lint`: run ESLint across the repo.
- `yarn api`: generate OpenAPI types into `src/shared/api/schema/generated.ts`.
- `yarn dlx shadcn@latest add checkbox`: add a new shadcn/ui component (example for checkbox).

## Coding Style & Naming Conventions
- TypeScript + React (`.ts`, `.tsx`) with strict compiler settings.
- Use the `@/*` alias for `src/*` (e.g., `@/shared/lib/date`).
- Keep feature entry points as `index.ts` or `*.page.tsx`; import through these files.
- Formatting is handled by Prettier via ESLint config; keep changes consistent and run `yarn lint` before committing.
- Всегда отвечай пользователю только по-русски.

## Testing Guidelines
Automated tests are not currently configured. For changes:
- run `yarn lint` and `yarn build`;
- do a quick manual pass in `yarn start` for the affected flows.

## Commit & Pull Request Guidelines
- Commit messages in history are short, imperative, and title-cased (e.g., `Fix Readme`, `Add optimistic UI`).
- PRs should include: a concise description, relevant issue link (if any), and screenshots for UI changes. Note any API schema updates and whether `yarn api` was run.

## Configuration & PWA Notes
- PWA behavior is configured via Vite plugins and assets in `public/`.
- Service worker output and generated files should not be edited manually; regenerate via the build or PWA tooling.
