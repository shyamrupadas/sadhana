# Sadhana API

Код перенесён из отслеживаемых файлов коммита `6a00918b1699af6f0d4882b637a942846ce95ff6` локального репозитория `sadhana-backend`. SQL-миграции 001–006 сохранены без изменений.

Для локального запуска скопируйте шаблон и заполните `DATABASE_URL`, `JWT_SECRET` и `JWT_REFRESH_SECRET`:

```sh
cp apps/api/.env.example apps/api/.env.local
```

`apps/api/.env.local` не попадает в Git. Для подключения к Neon укажите URL с `sslmode=require`; при использовании production-базы локальные изменения данных сохраняются в ней. API слушает `0.0.0.0:8080` (или порт из `PORT`).

Из корня workspace: `pnpm dev` запускает web и API вместе, `pnpm dev:api` — только API, `pnpm dev:web` — только web. `pnpm build:api` собирает API. Команда `pnpm --filter @sadhana/api migrate` оставлена для прежнего локального сценария; она повторно исполняет все SQL и не предназначена для существующей production-базы. Безопасный мигратор запланирован отдельным тикетом 10.
