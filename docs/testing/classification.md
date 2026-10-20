# Классификация Тестов

Документ фиксирует уровни automated tests в этом fullstack monorepo. Практические правила, команды запуска и entry points смотри в `docs/testing/guide.md`.

Главное правило: выбирай самый низкий уровень, который защищает нужное поведение без потери смысла. Более высокий уровень нужен только когда нижний уровень не видит важный контракт.

В Sadhana добавляй тест только для критичного пользовательского пути или достоверности сохранённых данных. Уровни не задают квоты; при сомнении о ценности сценария согласуй его с человеком.

## Web Unit Tests

Web unit test проверяет изолированную frontend-логику в Vitest без React render, DOM-сценария и сети.

Что покрывать:

- чистые helpers и mappers;
- validation и filtering rules;
- route/path/model helpers;
- форматирование и преобразование API-типов в view model.

Размещай рядом с проверяемым кодом в `apps/web/src/**/*.test.ts` или `apps/web/src/**/*.test.tsx`.

## Web Component Tests

Web component test проверяет компонент или небольшую композицию через React Testing Library в `jsdom`.

Что покрывать:

- видимый текст, роли, labels и navigation state;
- пользовательские действия: ввод, клик, toggle, submit;
- локальные loading, success и error states;
- связку компонента с локальными providers через `apps/web/src/shared/test/harness.tsx`.

Используй, когда важно поведение UI, но не нужен реальный браузер и полный пользовательский flow.

## Web Integration Tests

Web integration test проверяет часть frontend-фичи вместе с providers, React Router, React Query, session state и mocked API.

Что покрывать:

- auth guards, перенаправление гостя и route composition;
- ошибки ввода в формах;
- page-level сценарии;
- API success/error flows через точный `mockApi` handler;
- взаимодействие нескольких компонентов внутри фичи.

Используй Vitest/RTL, если сценарий можно надежно проверить через DOM и mocked `fetch` без Playwright.

## API Unit And Integration Tests

API tests проверяют backend behavior через `node:test` и `node:assert/strict`.

Что покрывать:

- service behavior через fake repositories;
- repository SQL shape, transaction boundaries и retry logic через fake database/executor;
- API handlers через typed inputs и fake services;
- migration runner behavior через fake migration executor.

Не подключай реальный PostgreSQL в обычных тестах. Если нужен настоящий DB-backed тест, сначала согласуй scope, setup и cleanup.

## Contract Tests

Contract tests проверяют TypeSpec/OpenAPI-generated contract в `packages/api-contract`.

Что покрывать:

- наличие или отсутствие публичных API routes;
- request/response schemas и authorization parameters;
- регрессии generated OpenAPI surface после изменения `main.tsp` или generator scripts.

Contract test не заменяет backend service test и frontend behavior test. Он защищает общий API surface между пакетами.

## Web E2E Tests

E2E test проверяет критичный пользовательский путь через настоящий браузер, frontend, API и PostgreSQL без подмены собственного API и хранилища. Синтетические тестовые данные допустимы. Такие тесты используют Playwright и живут в `apps/web/e2e`.

Что покрывать:

- регистрация: создание аккаунта, открытие приложения и последующий вход с зарегистрированными данными;
- вход и выход;
- создание привычки и сохранение отметок дня;
- cross-page navigation, которую дешевле или надежнее проверить в браузере;
- browser storage/session behavior, видимое пользователю на нескольких маршрутах.

Ошибки форм и перенаправление гостя проверяй через Vitest/RTL как `web integration`. Успешный сценарий на нескольких уровнях дублируй только когда каждый тест защищает дополнительную полезную гарантию. Порядок запуска E2E установлен в [Testing Guide](guide.md#порядок-завершения-задачи).

## Naming And Placement

Существующая конвенция репозитория:

- web Vitest: `apps/web/src/**/*.test.ts` и `apps/web/src/**/*.test.tsx`;
- web Playwright: `apps/web/e2e/*.test.ts`;
- API node tests: `apps/api/test/**/*.ts`;
- contract tests: `packages/api-contract/test/*.test.mjs`.

Пиши тест рядом с проверяемым кодом. Не переименовывай существующие тесты только ради указания уровня в имени файла; уровень должен быть понятен из target surface, `describe` и test case.
