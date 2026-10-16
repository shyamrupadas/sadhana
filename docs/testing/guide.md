# Testing Guide

Практические правила для Vitest, React Testing Library, Playwright, `node:test` и contract tests. Краткие определения уровней зафиксированы в `docs/testing/classification.md`.

## Выбор Уровня

Выбирай самый низкий достаточный уровень:

- `web unit` - чистая frontend-логика без render, DOM и сети;
- `web component` - UI-компонент или небольшая композиция через RTL;
- `web integration` - page/feature behavior с providers, React Router, React Query, session state и mocked API;
- `api` - backend service, repository, handler, database utility или migration behavior через `node:test`;
- `contract` - TypeSpec/OpenAPI-generated API surface;
- `web e2e` - критичный browser-level flow, route redirects, navigation и storage/session behavior через Playwright.

E2E используй точечно. Если поведение можно надежно защитить Vitest/RTL или API test, не поднимай уровень до Playwright.

Добавляй тест только для критичного пользовательского пути или достоверности сохранённых данных. Если ценность сценария сомнительна, согласуй его с человеком. Категории не задают количество тестов.

## Запуск Тестов

Основные команды:

```bash
pnpm test
pnpm --filter @sadhana/web test:unit
pnpm --filter @sadhana/web test:e2e
pnpm --filter @sadhana/api test
pnpm --filter @sadhana/api-contract test
```

Targeted запуск:

```bash
pnpm --filter @sadhana/web test:unit -- src/features/main/main.page.test.tsx
pnpm --filter @sadhana/web test:e2e -- e2e/habit-mark.test.ts
pnpm --filter @sadhana/api exec node --test -r ts-node/register test/routes/habits.test.ts
pnpm --filter @sadhana/api-contract exec node --test test/contract.test.mjs
```

Если изменение затрагивает imports, package boundaries или generated contract, добавь релевантные проверки:

```bash
pnpm lint
pnpm typecheck
pnpm --filter @sadhana/api-contract generate
```

Не заявляй, что тест проверен, если команда не запускалась или упала из-за окружения. Укажи команду, краткий результат и причину.

## Ключевые Entry Points

- `apps/web/vitest.config.ts` - Vitest include, jsdom environment, aliases и setup files.
- `apps/web/src/shared/test/setup.ts` - jest-dom, cleanup, `localStorage`, global mocks cleanup.
- `apps/web/src/shared/test/harness.tsx` - `renderWithTestProviders` и `mockApi`.
- `apps/web/playwright.config.ts` - Playwright testDir, baseURL и dev webServer.
- `apps/api/package.json` - backend test command через `node:test` и `ts-node`.
- `packages/api-contract/package.json` - contract generation, build и `node:test`.

При изменениях в `apps/web` учитывай корневой `AGENTS.md`.

## Web Vitest And RTL

Проверяй пользовательское поведение и публичные contracts:

- используй roles, labels и visible text вместо generated CSS classes;
- используй `userEvent` для пользовательских действий;
- проверяй async UI через `findBy*` или `waitFor`, когда состояние действительно асинхронное;
- используй `renderWithTestProviders`, если нужен `QueryClientProvider`;
- держи `QueryClient` свежим на каждый тест через test harness;
- делай API fixtures typed через `satisfies ApiSchemas['...']`;
- mock API через `mockApi` с точными `method` и `path`.

Запрещено в обычных web tests:

- реальные network calls;
- broad API mocks, которые молча принимают любой request;
- snapshot-only tests;
- assertions на private implementation details, internal React state или generated CSS classes;
- тесты, зависящие от порядка запуска или общего mutable state.

Если новый browser API нужен одному тесту, добавь локальный mock. Расширяй `apps/web/src/shared/test/setup.ts` только когда API нужен многим тестам.

## API Tests

Используй `node:test` и `node:assert/strict`, как в существующих backend tests.

Правила:

- тестируй service behavior через fake repositories и typed records;
- тестируй repository SQL/transaction behavior через fake `DatabaseService` или executor, а не через реальный PostgreSQL;
- проверяй errors через `assert.rejects`;
- избегай sleeps и таймеров, если инвариант можно выразить через controlled fake/deferred promise;
- не проверяй private fields напрямую, кроме узких cache/concurrency invariants, где публичный API не дает наблюдаемого результата;
- fixtures/builders держи локальными рядом с тестом.

DB migrations в production-коде требуют отдельного упоминания в финальном отчете: их нужно применить.

## Явные PostgreSQL-проверки мигратора

`pnpm db:test --target dev` использует проверенный dev; `pnpm db:test --target test` — отдельные `MIGRATION_TEST_DATABASE_URL` и независимую разрешённую цель. Отсутствующая настройка в явном запуске — ошибка. Обычный `pnpm test` эти DB-сценарии пропускает и не открывает соединений, даже если URL унаследован. Каждый DB-сценарий изолируется собственной схемой с очисткой после успеха/ошибки. Подготовка временного Docker PostgreSQL, права и очистка описаны в [API README](../../apps/api/README.md#изолированные-проверки).

## Contract Tests

Меняя `packages/api-contract/main.tsp`, generator scripts или generated API surface:

- проверь, нужен ли новый contract test или обновление существующего `test/contract.test.mjs`;
- после изменения контракта запусти `pnpm --filter @sadhana/api-contract generate`;
- не редактируй generated files вручную, если их можно регенерировать;
- не считай contract test заменой backend/API behavior tests.

## Playwright E2E

E2E tests живут в `apps/web/e2e` и запускаются через preview-like Vite server из `apps/web/playwright.config.ts`.

Правила:

- мокай API через `page.route` конкретными path patterns;
- unexpected API request должен явно падать или возвращать диагностичный 404;
- используй accessible locators: `getByRole`, `getByLabel`, `getByText`;
- не используй arbitrary `waitForTimeout`;
- проверяй URL, visible UI и browser storage только когда это часть пользовательского контракта;
- не добавляй screenshots/visual regression без отдельного запроса;
- не подключай live backend/DB без явного согласования.

E2E нужен для критичных маршрутов и browser-level интеграции. Для локальной логики, отдельной страницы или API error state предпочитай более низкий уровень.

## Fixtures And Builders

Пиши fixtures рядом с тестом, если они нужны только этому сценарию. Предпочитай factory function с overrides.

Не создавай shared fixtures без явной повторяемой пользы. Общие mutable fixtures запрещены.

## Scope Rules

Когда тесты пишутся внутри feature или bugfix задачи, эти правила управляют тестовой частью работы. Production diff определяется исходной задачей, а тесты должны оставаться минимальным regression guard.

В test-only задаче разрешено менять:

- `*.test.ts`, `*.test.tsx`, `*.test.mjs`;
- `apps/web/e2e/*.test.ts`;
- локальные fixtures/builders рядом с тестом;
- testing docs, если задача прямо про правила тестирования.

В test-only задаче без отдельного явного запроса пользователя не меняй:

- production-код;
- shared test infra;
- package dependencies;
- generated contract artifacts вручную;
- git index, commits, branches, push или внешние trackers.

Если хороший тест требует production seam или shared test infra, остановись до правок. Объясни, что именно нужно изменить, почему без этого тест будет хрупким или невозможным, и продолжай только после явного разрешения.

Тикет, прямо требующий настройки тестового контура, уже даёт разрешение на необходимые config, dependencies и shared test infra.

## Review Rules

При ревью теста проверяй:

- тест защищает пользовательское поведение или публичный API;
- выбран самый низкий достаточный уровень;
- mocks точные и диагностичные;
- каждый тест независим от порядка запуска;
- async assertions осознанны;
- fixtures не протекают между тестами;
- targeted validation запущена и результат понятен.
