# Sadhana API

SQL-миграции 001–006 и принятая production-история сохранены. Обычный запуск API не применяет миграции, не создаёт пользователей и не сбрасывает данные.

## Локальный dev

Локальный путь: `http://localhost:5173` → `http://localhost:8080` → отдельная dev-БД. Web использует настоящий API (`VITE_USE_MOCKS=false`) и показывает отметку DEV. Другой адрес, учётные данные в URL или включённый MSW останавливают dev-web до API-запросов. Контур тестов запускается отдельно в режиме Vite `test` с `/test-api`.

До создания ресурсов dev запуск API намеренно закрыт: `dev` в `config/database-targets.json` равен `null`. После создания dev без production-строк (тикет 07) заполните эту секцию по `config/database-targets.example.json`: точные direct/runtime хосты одной ветки, порт, имя dev-БД, отдельную dev-роль и другую служебную БД `maintenanceDatabase` для будущего восстановления. Это несекретные идентификаторы, которые сохраняются в Git и сверяются независимо от URL. Runtime может использовать разрешённый pooled-хост либо direct; мигратор — только direct. Служебная БД не используется для прикладного SQL.

Создайте **новый** файл секретов и внесите отдельные dev-подключения и JWT-секреты:

```sh
cp apps/api/.env.example apps/api/.env.dev.local
```

`.env.dev.local` игнорируется Git. Старый `.env.local` больше не читается: не переносите оттуда production-доступы. Путь к новому файлу и конфигурации цели определяется относительно пакета API, независимо от текущего каталога. Dev-файл обязателен: оба URL и оба JWT-секрета должны быть заданы в нём. Унаследованные секреты не используются как запасные значения. Для Neon задайте `sslmode=require` (также разрешены `verify-full` и `channel_binding=require`). Остальные query-параметры, включая `host`, `database`, `user`, `options`, отклоняются; отключение TLS через URL запрещено.

Из корня: `pnpm dev` запускает web и API, `pnpm dev:api` — API, `pnpm dev:web` — web. API по умолчанию слушает порт 8080. Локальные API-entrypoints `dev`, `start` и `migrate` фиксируют `DB_ENVIRONMENT=dev`: конфликтующее значение приводит к отказу. `NODE_ENV=production` не выбирает production-конфигурацию и не отключает защиту цели. При старте выводятся окружение, хост, БД и роль; URL и секреты в диагностику не попадают.

Обычные CORS, вход по email/паролю и refresh cookie локального пути сохраняются. Перезапуск не меняет записи. Полноценный вход в постоянный dev проверяется после его создания; этот тикет не меняет Neon/Railway или их секреты.

## Production и порядок включения защиты

Существующие точки запуска образа сохраняются: `node dist/server.js` и Railway Pre-Deploy `node dist/db/migrate.js`. Образ задаёт `DB_ENVIRONMENT=production` отдельно от `NODE_ENV`. До публикации кода с защитой необходимо подготовить в Railway следующие переменные, не меняя действующие URL, пароли, журнал и команду Pre-Deploy:

| Переменная | Значение |
| --- | --- |
| `DB_ENVIRONMENT` | `production` |
| `DB_EXPECTED_DIRECT_HOST` | Точный direct-хост production-ветки |
| `DB_EXPECTED_RUNTIME_HOST` | Разрешённый runtime-хост той же ветки |
| `DB_EXPECTED_PORT` | `5432` либо фактический согласованный порт |
| `DB_EXPECTED_NAME` | Имя production-БД |
| `DB_EXPECTED_ROLE` | Production-роль |
| `DATABASE_URL`, `MIGRATION_DATABASE_URL` | Существующие runtime/direct URL той же цели |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Существующие production-секреты |

Сначала сверить несекретные ожидаемые идентификаторы с выбранным ресурсом независимо от URL и внести настройки для runtime и Pre-Deploy, затем выпускать образ. Без этих настроек новый образ и Pre-Deploy откажут до подключения; старый код дополнительных переменных не требует. Для действий в аккаунтах предварительно согласовать с пользователем, кто их выполняет. Один `NODE_ENV=production` недостаточен. Локальные env в production не загружаются. Автоматического baseline или сброса при включении защиты нет.

## Миграции PostgreSQL

Команды для dev из корня:

```sh
pnpm db:status
pnpm db:migrate --to 004
pnpm db:migrate
```

Все команды имеют `--help` и фиксированный dev-контекст без production-переключателя. `db:status` читает согласованный снимок в read-only транзакции: показывает наличие журнала и идентификаторы применённых/ожидающих SQL. Пустая схема без журнала допустима; непустая схема без журнала, разрыв, неизвестная версия и изменённый checksum дают отказ без исправлений.

`db:migrate --to NNN` применяет непрерывный префикс до существующей трёхзначной версии; без `--to` — всю цепочку. Версия ниже применённой отклоняется. Для возврата к прежней версии требуется отдельное восстановление dev, которое добавляется тикетом 05. Алиас `pnpm --filter @sadhana/api migrate` сохраняется.

Мигратор проверяет оба URL и разрешённую цель, создаёт `schema_migrations`, сверяет SHA-256 и применяет новые SQL. `--help` описывает вход; неизвестные аргументы отклоняются. При ошибке драйвера/SQL возвращается ненулевой код без содержимого SQL и пользовательских записей. Сохраняются транзакция каждого файла с журналом, advisory lock и ограничения времени. Обычная миграция не пересоздаёт БД и не заполняет данные.

Исторический baseline отделён от dev. Его проверки и явное подтверждение сохранены в `node dist/db/migrate.js --baseline-confirmed-001-006` (либо `migrate:baseline`) с `MIGRATION_BASELINE_CONFIRMATION=reviewed-current-schema-and-sleep-data-001-006` и независимо проверенной production-конфигурацией. Он только фиксирует подтверждённые 001–006, не исполняя SQL; `applied_at` остаётся пустым. Для новой dev-БД baseline не используется, в принятом production повторно не выполняется. Исторический контекст: [инвентаризация production Neon](../../.scratch/monorepo-migration/decisions/10-production-migration-inventory.md).

## Изолированные проверки

Обычные API-тесты и CI-образ используют явный `DB_ENVIRONMENT=test` и несекретную цель `test` из `config/database-targets.json`: `postgres://fixture:fixture@db.invalid/app` для обоих URL плюс фиктивные JWT-секреты. Это отдельная проверяемая конфигурация без production-доступов. Проверка `GET /` не открывает соединений к БД.

Обычные workspace tests не подключаются к PostgreSQL, даже если задан `MIGRATION_TEST_DATABASE_URL`. Для явного прогона из корня:

```sh
pnpm db:test --help
pnpm db:test --target dev
MIGRATION_TEST_DATABASE_URL=<direct-test-url> pnpm db:test --target test
```

`--target dev` использует общий dev-env и разрешённую dev-цель; постоянная БД не пересоздаётся. API и прочую работу с dev на время теста лучше остановить: тестовый мигратор использует ту же advisory lock, что и обычный. `--target test` требует отдельный URL и независимую несекретную секцию `test` файла `config/migration-test-target.json` (direct/runtime хосты, порт, БД, роль). Начальное `null`, отсутствие URL, конфликт `DB_ENVIRONMENT`, pooled URL и неправильная цель дают ненулевой код, а не пропуск. Альтернативный файл задаётся `MIGRATION_TEST_TARGETS_PATH`: относительный путь разрешается от корня репозитория, абсолютный также допустим. Не формируйте разрешённую цель из проверяемого URL.

Для временного локального PostgreSQL можно использовать Docker. Выберите свободный порт и уникальное имя контейнера; например:

```sh
docker run --detach --rm --name sadhana-migration-test \
  --publish 127.0.0.1:55432:5432 --tmpfs /var/lib/postgresql/data \
  --env POSTGRES_USER=fixture --env POSTGRES_PASSWORD=local-test-only \
  --env POSTGRES_DB=migration_test postgres:16
docker exec sadhana-migration-test pg_isready -U fixture -d migration_test
```

Дождитесь готовности. Запишите в отдельный несекретный файл, например `/tmp/sadhana-migration-target.json`:

```json
{
  "test": {
    "directHost": "127.0.0.1",
    "runtimeHost": "127.0.0.1",
    "port": 55432,
    "database": "migration_test",
    "role": "fixture"
  }
}
```

Запуск и обязательная очистка после успеха **или ошибки**:

```sh
MIGRATION_TEST_TARGETS_PATH=/tmp/sadhana-migration-target.json \
MIGRATION_TEST_DATABASE_URL=postgres://fixture:local-test-only@127.0.0.1:55432/migration_test \
  pnpm db:test --target test
docker stop sadhana-migration-test
```

Контейнер хранит данные в tmpfs и удаляется после остановки. Для внешней тестовой цели нужна отдельная БД/роль с правами создания/удаления схем и установки `uuid-ossp`; production-доступы не используются. TLS на Neon задаётся обычными разрешёнными параметрами URL.

Контур повторно проверяет цель перед соединением, затем добавляет собственный уникальный `search_path`; входной URL с `options` запрещён. Каждый сценарий создаёт отдельную схему, удаляет её в `finally` после успеха/ошибки и очищает временные SQL-файлы. Проверяются read-only статус, маленькая цепочка механики, транзакции и конкуренция; отдельно — настоящая цепочка, преобразование сохранённых данных сна и исторический baseline. Дочерний вывод драйвера/SQL не публикуется: команда сообщает безопасную цель, счётчики результатов и имена упавших сценариев; ошибка любого сценария даёт ненулевой код. Сборка не нужна; PostgreSQL не становится обязательным для CI.
