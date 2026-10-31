# nginx для проверки версии приложения

На VDS системную конфигурацию меняет `admin` через sudo. Пользователь `deploy` публикует статику в `/var/www/sadhana-app/html`, не имеет sudo и не может менять `/etc/nginx`. Схема доступа и исходные runbooks находятся в соседнем репозитории ShlokaHub, `docs/operations/`.

## Применённая конфигурация

В HTTPS server block `app.sadhana-tracker.com` файла `/etc/nginx/sites-available/sadhana-app` действуют правила:

```nginx
location = /release.json {
    add_header Cache-Control "no-store" always;
    try_files $uri =404;
}

location = /sw.js {
    add_header Cache-Control "no-cache" always;
    try_files $uri =404;
}

location = /index.html {
    add_header Cache-Control "no-cache" always;
    try_files /index.html =404;
}

location / {
    add_header Cache-Control "no-cache" always;
    try_files $uri $uri/ /index.html;
}
```

HTTP → HTTPS redirect, сертификаты, document root и конфигурации остальных сайтов сохранены. Файл `release.json` появляется при публикации frontend-сборки; до этого корректный ответ — 404 с `no-store`, без SPA fallback.

При дальнейших изменениях нужно учитывать наследование `add_header`. В момент применения в родительских HTTP/server blocks и подключённых SSL-настройках дополнительных заголовков не было.

## Проверки и восстановление

Перед изменением проверяется актуальный server block и сохраняется резервная копия вне `sites-enabled`. Затем кандидат и полная конфигурация проверяются через `nginx -t`. Только после успеха выполняется `sudo systemctl reload nginx`. Reload асинхронный: перед HTTP-проверками нужно дождаться нового заголовка, чтобы не принять ответ прежнего worker за ошибку настройки.

Проверки выполняются без отключения проверки TLS:

```bash
curl -sS -D - -o /dev/null https://app.sadhana-tracker.com/release.json
curl -sS -D - -o /dev/null https://app.sadhana-tracker.com/index.html
curl -sS -D - -o /dev/null https://app.sadhana-tracker.com/login
curl -sS -D - -o /dev/null https://app.sadhana-tracker.com/sw.js
```

У JSON ожидается `Cache-Control: no-store`, у HTML, SPA-маршрутов и worker — `no-cache`. Существующий JSON возвращается как `application/json`; отсутствующий — с кодом 404. Эти два случая проверены на изолированном nginx на VDS, слушавшем только loopback и использовавшем временные файлы. Production-статика при проверке не менялась.

2026-10-31 конфигурация применена и проверена напрямую на origin и по публичному HTTPS. Три соседних сайта отвечали 200, их конфигурации не менялись. Резервная копия перед успешным применением: `/var/backups/nginx/sadhana-app.oLMfwK` (доступна через sudo). Для отката после сверки этой копии:

```bash
sudo cp -a /var/backups/nginx/sadhana-app.oLMfwK /etc/nginx/sites-available/sadhana-app
sudo nginx -t && sudo systemctl reload nginx
```

Содержимое frontend и API этой операцией не публикуется. Доступ к SSH, IP и ключи в репозитории не сохраняются.
