# Подготовка Railway к выпуску API из монорепозитория

Тикет 11 готовит образ и конфигурацию; изменение действующего сервиса выполняется в тикете 14 после репетиции мигратора на ветке Neon (тикет 12) и выпуска web (тикет 13).

## Настройки действующего сервиса

- Сохранить прежние проект, environment, сервис, домены, регион, одну реплику, переменные и порт `8080`. Источник Git при переключении: монорепозиторий, ветка `master`, корневая директория `/`.
- Корневой `Dockerfile` запускает `node dist/server.js` от непривилегированного пользователя `node`. В действующем Railway-сервисе вручную заданы Docker builder с корневым `Dockerfile`, watch patterns для API и общих входов, healthcheck `/` и Pre-Deploy `node dist/db/migrate.js`. Команда Pre-Deploy запускается из того же образа. Сборка образа и запуск API не применяют SQL.
- В настройках GitHub-подключения включить **Wait for CI**. Railway хранит эту настройку в сервисе; обязательный workflow `CI` запускается на каждом push в `master` без path-фильтра.
- Перед включением Pre-Deploy убедиться, что отдельная переменная `MIGRATION_DATABASE_URL` указывает на **direct** Neon URL той же production-ветки, что и сохранённый pooled `DATABASE_URL`. Проверить репетицию и начальное заполнение журнала по тикету 12; иначе мигратор остановит выпуск.
- Для коммита, опубликованного до смены Git-источника, запустить **Deploy Latest Commit** и сверить SHA. Затем проверить лог Pre-Deploy, healthcheck и `GET /` по прежнему API-домену.

## Границы автоматических выпусков

Web workflow реагирует на `apps/web/**`, `packages/api-contract/**`, корневые `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json` и оба workflow. Watch patterns действующего Railway-сервиса заданы вручную для `apps/api/**`, `packages/api-contract/**`, тех же корневых входов, `Dockerfile`, `.dockerignore` и общего CI workflow. Изменение только документации не запускает выпуск. Обязательный CI всегда генерирует и проверяет контракт, выполняет lint, typecheck, сборку и тесты workspace. При изменении одного из входов API, перечисленных в CI workflow, он дополнительно собирает Docker-образ и проверяет его содержимое и запуск. PostgreSQL в CI не запускается; тесты используют фиктивный `DATABASE_URL` и не обращаются к production Neon. Web workflow ждёт успешный check `workspace-and-image` того же SHA перед копированием на VPS при push в `master` и ручном запуске; при неуспехе CI или ожидании дольше 15 минут публикация останавливается. В защите ветки `master` обязательным должен быть этот же check.

## Совместимость переходных версий

Автоматические тесты контракта проверяют запросы нового клиента и прежние HTTP-формы ответов API. HTTP-тесты Fastify проверяют маршруты, статусы, заголовки и JSON, на которые опирается старый web. Обе группы входят в обязательный `pnpm test` в CI. До переключения Railway нужно вручную проверить новый web со старым API; перед возможным откатом web — старый web с новым API. Браузерные проверки и фактические адреса относятся к тикетам 13–14.


## Включение независимой проверки цели БД

Перед выпуском защиты окружений заполнить `DB_ENVIRONMENT=production` и независимые `DB_EXPECTED_DIRECT_HOST`, `DB_EXPECTED_RUNTIME_HOST`, `DB_EXPECTED_PORT`, `DB_EXPECTED_NAME`, `DB_EXPECTED_ROLE` для runtime и Railway Pre-Deploy. Сверить их с выбранным production-ресурсом; не вычислять ожидания из проверяемых URL. Затем выпускать новый образ. Иначе API и Pre-Deploy остановятся до подключения. Действующие подключения/JWT, журнал и `node dist/db/migrate.js` сохраняются; baseline повторно не запускается. Подробный порядок и таблица настроек — в [руководстве API](../../apps/api/README.md#production-и-порядок-включения-защиты). Внешние настройки в тикете 01 не меняются.

### Подготовленные значения для действующего production

Проверено 2026-10-17 чтением метаданных Neon: проект `sadhana-tracker` (`old-hill-95915061`), default-ветка `production` (`br-autumn-cake-ag06rp2m`), read-write endpoint `ep-flat-darkness-ag44hig2`, БД `neondb`, владелец/существующая роль `neondb_owner`. Это независимые ожидаемые идентификаторы ресурса, без чтения предметных записей или production-паролей. Pooled-хост соответствует тому же endpoint и ранее зафиксированному production-подключению в [инвентаризации](../../.scratch/monorepo-migration/decisions/10-production-migration-inventory.md).

| Переменная Railway | Подготовленное значение |
| --- | --- |
| `DB_ENVIRONMENT` | `production` |
| `DB_EXPECTED_DIRECT_HOST` | `ep-flat-darkness-ag44hig2.c-2.eu-central-1.aws.neon.tech` |
| `DB_EXPECTED_RUNTIME_HOST` | `ep-flat-darkness-ag44hig2-pooler.c-2.eu-central-1.aws.neon.tech` |
| `DB_EXPECTED_PORT` | `5432` |
| `DB_EXPECTED_NAME` | `neondb` |
| `DB_EXPECTED_ROLE` | `neondb_owner` |

Значения подготовлены для действующего сервиса `sadhana-backend` проекта Railway `sadhana-tracker`, environment `production`. На этом шаге Railway не изменялся; наличие этих переменных в нём не подтверждалось. До выпуска кода с guard сверить текущие runtime/direct URL с ожидаемым ресурсом и внести подготовленные значения в согласованном внешнем шаге, чтобы они были доступны и API, и Pre-Deploy. Существующие `DATABASE_URL`, `MIGRATION_DATABASE_URL`, JWT-секреты и команду `node dist/db/migrate.js` сохранить. Production-подключения остаются в Railway; локальный `.env.dev.local` для этой настройки не используется. Изменение переменных и запуск выпуска не входят в подготовку этого набора.

CI запускает образ с `DB_ENVIRONMENT=test`, двумя URL фиктивной БД и отдельной версионируемой тестовой целью. Production-секреты для проверки запуска не требуются.
