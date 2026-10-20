---
name: write-tests
description: "Используй, когда нужно написать, доработать, проверить или отревьюить тесты в этом fullstack monorepo: web Vitest/RTL unit-component-integration tests, API node:test tests, api-contract tests или Playwright e2e tests."
---

# Write Tests

Пиши минимальный критичный regression guard для проектного кода. Цель skill - не coverage, а небольшой test-focused diff с низкой стоимостью поддержки.

## Источники Правил

Перед изменениями всегда прочитай:

- `docs/testing/guide.md`;
- `docs/testing/classification.md`.

По ситуации читай:

- соседние тесты рядом с target code;
- `AGENTS.md`, если меняются или добавляются frontend tests;
- `apps/web/src/shared/test/harness.tsx` и `apps/web/src/shared/test/setup.ts`, если нужны frontend providers, session, mocked API или browser globals;
- `apps/web/vitest.config.ts` или `apps/web/playwright.config.ts`, если нужно подтвердить frontend команду или e2e setup;
- `apps/api/package.json` и соседние API tests, если меняются backend tests;
- `packages/api-contract/package.json` и `packages/api-contract/test/contract.test.mjs`, если меняются contract tests.

## Рабочий Порядок

1. Разбери запрос и выдели проверяемое поведение, regression scenario и target surface.
   Критерий завершения: понятно, какой пользовательский flow, публичный API или backend invariant должен защищать тест.
2. Если сценарий, важность проверки или target surface неясны, остановись и задай один конкретный вопрос пользователю.
   Критерий завершения: нет догадок о том, что важно покрыть.
3. Найди target code и nearby tests узким поиском по app/package/feature/module/path.
   Критерий завершения: проверено, нет ли уже теста на это поведение, и понятно, дорабатывать существующий тест или создавать sibling file.
4. Выбери самый низкий достаточный уровень: `web unit`, `web component`, `web integration`, `api`, `contract` или `web e2e`.
   Критерий завершения: более низкий уровень теряет смысл сценария, а более высокий не добавляет нужной защиты.
5. Сформируй минимальный test plan: requirement -> test case -> file -> targeted command.
   Критерий завершения: planned cases покрывают только критичный MVP scope, без тестов "на всякий случай".
6. Напиши test-focused diff.
   Критерий завершения: изменены только разрешенные test files, локальные fixtures/builders или testing docs, если задача прямо про правила.
7. Выполни validation в момент, установленный [порядком завершения задачи](../../../docs/testing/guide.md#порядок-завершения-задачи): обычные тесты проверяй по ходу разработки, E2E — на финальном этапе всей задачи.
   Критерий завершения: результаты выполненных проверок прочитаны и отражены в финальном ответе.

## Выбор Уровня

- `web unit` - чистая frontend-логика без React render, DOM и сети.
- `web component` - отдельный компонент или небольшая композиция через React Testing Library.
- `web integration` - frontend page/feature с providers, routing, React Query, session state или mocked API.
- `api` - backend service, repository, handler, database utility или migration behavior через `node:test`.
- `contract` - TypeSpec/OpenAPI-generated API surface между пакетами.
- `web e2e` - критичный пользовательский путь через настоящий браузер, frontend, API и PostgreSQL без подмены собственного API и хранилища. Синтетические тестовые данные допустимы.

Если пользователь просит уровень выше минимально достаточного, объясни, какой уровень дешевле и почему. Если пользователь явно настаивает на более дорогом уровне, уточни перед реализацией.

## Scope

Когда skill используется внутри feature или bugfix задачи, применяй эти правила к тестовой части работы. Production-правки разрешены только scope исходной задачи; тесты должны оставаться минимальным regression guard для этих production-правок.

Когда задача только про тесты, разрешено менять:

- `*.test.ts`;
- `*.test.tsx`;
- `*.test.mjs`;
- `apps/web/e2e/*.test.ts`;
- локальные fixtures/builders рядом с тестом;
- `docs/testing/*`, если задача прямо про правила тестирования.

В test-only задаче запрещено без отдельного явного запроса пользователя:

- менять production-код;
- менять shared test infra: `apps/web/src/shared/test/*`, общие harness/setup helpers, package test scripts или Playwright/Vitest config;
- добавлять dependencies;
- редактировать generated contract artifacts вручную;
- создавать snapshot-only tests;
- выполнять внешние workflow-действия: менять git index, создавать ветки, коммиты, push, PR/MR или комментарии в трекерах.

Если хороший тест требует production seam, остановись до правок. Объясни, что именно нужно изменить в production-коде, почему без этого тест будет хрупким или невозможным, и чем опасны такие правки. Продолжай только после явного разрешения пользователя.

Если хороший тест требует shared test infra, остановись до правок. Объясни, что именно нужно изменить в test infra, почему без этого тест будет хрупким или невозможным, и чем опасны такие правки. Продолжай только после явного разрешения пользователя.

Если пользователь заранее явно попросил production-правку вместе с тестом или production-правка уже является частью feature/bugfix задачи, держи production diff минимальным и объясни связь с тестом.

## Правила Написания

- Пиши тест рядом с проверяемым кодом.
- Сначала проверяй, не покрыто ли поведение уже существующим тестом.
- Если покрыто полностью, не добавляй новый тест; сообщи путь к существующей проверке.
- Если покрыто частично, предпочитай доработать ближайший существующий тест.
- Используй классификацию из `docs/testing/classification.md`.
- Используй команды и entry points из `docs/testing/guide.md`.
- Не делай реальные network calls в обычных tests.
- Для web Vitest tests используй `apps/web/src/shared/test/harness.tsx`, если он покрывает сценарий.
- Для web API mocks задавай конкретные `method` и `path`; unexpected request должен быть диагностичным.
- Для API tests предпочитай fake repositories/database executors реальному PostgreSQL.
- Для contract changes проверяй generated OpenAPI surface через contract tests и запускай generation только когда меняется contract source.
- Для Playwright E2E используй настоящий frontend, API и PostgreSQL. Ошибки форм, перенаправления гостя и другие frontend-сценарии с API-моками проверяй через Vitest/RTL на уровне `web integration`.
- Не проверяй generated CSS classes, private implementation details или internal state без публичного контракта.
- Fixtures/builders держи локальными для теста; не создавай shared fixtures без явной необходимости и разрешения scope.
- Пиши минимальное количество тестов для самого важного поведения. Если сомневаешься, важно ли пользователю покрыть конкретную ветку, уточни.

## Validation

Обычные тесты проверяй адресно по ходу разработки. E2E запускай по [порядку завершения задачи](../../../docs/testing/guide.md#порядок-завершения-задачи), после готовности всей задачи и успешных остальных необходимых проверок. Команды по выбранному уровню:

```bash
pnpm --filter @sadhana/web test <test-file>
pnpm test:e2e <e2e-test-file>
pnpm --filter @sadhana/api exec node -r ts-node/register --test <api-test-file>
pnpm --filter @sadhana/api-contract exec node --test <contract-test-file>
```

Если изменение затрагивает нетривиальные types/imports, package boundaries или generated contract, добавь релевантные проверки:

```bash
pnpm lint
pnpm typecheck
pnpm --filter @sadhana/api-contract generate
```

Если targeted command не запускается из-за окружения, не заявляй, что тест проверен. Зафиксируй команду, краткий output summary и причину, почему validation не получена.

## Финальный Ответ

Пиши по-русски и кратко. Укажи:

- какие test files или testing docs изменены;
- что именно защищает тест или правило;
- выбранный уровень и почему он минимально достаточный;
- targeted command и результат;
- что осознанно не покрыто, если это важно для понимания scope;
- для новых DB migrations явно напомни, что их нужно применить.
