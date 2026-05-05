# Deploy Proxy

В этом каталоге оставлены только файлы, которые нужны для нашего кейса:

```text
deploy/caddy/Caddyfile
  Основной production-конфиг. Caddy слушает 80/443, выпускает сертификаты для
  кастомных доменов и проксирует /_svc_api в backend.

deploy/nginx/catalog-rollback-public.conf
  Запасной публичный Nginx-конфиг на случай, если Caddy нужно временно выключить.
```

Основная схема:

```text
Internet
  -> Caddy :80/:443
      -> /_svc_api/* -> backend 127.0.0.1:4000
      -> остальное -> public frontend 127.0.0.1:3000
      -> shtab.<platform-domain> -> admin frontend 127.0.0.1:3001
```

Nginx в production вперед не ставим. Он нужен только как rollback.

## Caddy

Скопировать Caddyfile:

```bash
sudo cp deploy/caddy/Caddyfile /etc/caddy/Caddyfile
```

Создать директорию для access-log. Без этого Caddy может упасть на старте с
ошибкой `opening log writer`:

```bash
sudo install -d -o caddy -g caddy -m 0755 /var/log/caddy
sudo touch /var/log/caddy/catalog-access.log
sudo chown caddy:caddy /var/log/caddy/catalog-access.log
sudo chmod 0644 /var/log/caddy/catalog-access.log
```

Создать env для Caddy. Для тестового домена:

```bash
sudo install -d -m 0755 /etc/caddy
sudo install -d -o root -g caddy -m 0750 /etc/caddy/certs
sudo cp /etc/ssl/certs/myctlg-update.ru.crt /etc/caddy/certs/myctlg-update.ru.crt
sudo cp /etc/ssl/private/myctlg-update.ru.key /etc/caddy/certs/myctlg-update.ru.key
sudo chown root:caddy /etc/caddy/certs/myctlg-update.ru.crt /etc/caddy/certs/myctlg-update.ru.key
sudo chmod 0644 /etc/caddy/certs/myctlg-update.ru.crt
sudo chmod 0640 /etc/caddy/certs/myctlg-update.ru.key
sudo cp deploy/caddy/catalog.env.example /etc/caddy/catalog.env
sudo nano /etc/caddy/catalog.env
sudo chmod 0644 /etc/caddy/catalog.env
```

Минимальное содержимое `/etc/caddy/catalog.env`:

```env
CATALOG_PLATFORM_DOMAIN=myctlg-update.ru
CADDY_ACME_EMAIL=admin@myctlg-update.ru
CADDY_PLATFORM_CERT_FULLCHAIN=/etc/caddy/certs/myctlg-update.ru.crt
CADDY_PLATFORM_CERT_KEY=/etc/caddy/certs/myctlg-update.ru.key
```

Подключить env к systemd-сервису Caddy. Надежнее создать override-файл
напрямую, без интерактивного `systemctl edit`:

```bash
sudo mkdir -p /etc/systemd/system/caddy.service.d
sudo tee /etc/systemd/system/caddy.service.d/override.conf > /dev/null <<'EOF'
[Service]
EnvironmentFile=/etc/caddy/catalog.env
EOF
```

Применить:

```bash
sudo systemctl daemon-reload
sudo systemctl cat caddy
sudo systemctl show caddy -p EnvironmentFiles
```

Сертификат платформы должен покрывать оба имени: `myctlg-update.ru` и
`*.myctlg-update.ru`. Если твой `.crt` не содержит chain, собери fullchain и
скопируй именно его в `/etc/caddy/certs/myctlg-update.ru.crt`:

```bash
sudo sh -c 'cat /etc/ssl/certs/myctlg-update.ru.crt /etc/ssl/certs/myctlg-update.ru.chain.pem > /etc/ssl/certs/myctlg-update.ru.fullchain.pem'
sudo chmod 0644 /etc/ssl/certs/myctlg-update.ru.fullchain.pem
sudo cp /etc/ssl/certs/myctlg-update.ru.fullchain.pem /etc/caddy/certs/myctlg-update.ru.crt
sudo chown root:caddy /etc/caddy/certs/myctlg-update.ru.crt
```

Включить Caddy как публичный вход:

```bash
sudo systemctl stop nginx
sudo systemctl disable nginx

sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable caddy
sudo systemctl restart caddy
```

Проверить:

```bash
sudo systemctl status caddy
sudo ss -ltnp | grep -E ':80|:443|:4000|:3000|:3001'
```

Ожидаемо:

```text
:80   -> caddy
:443  -> caddy
:4000 -> backend
:3000 -> public frontend
:3001 -> admin frontend
```

## DNS Для Клиентского Домена

Для apex-домена:

```text
kingsname.ru      A      SERVER_IP
www.kingsname.ru  CNAME  kingsname.ru
```

Если DNS-провайдер поддерживает `ALIAS`, `ANAME` или CNAME flattening:

```text
kingsname.ru      ALIAS  customers.myctlg-update.ru
www.kingsname.ru  CNAME  customers.myctlg-update.ru
```

Для поддомена клиента:

```text
shop.kingsname.ru CNAME  customers.myctlg-update.ru
```

## Важные Env

Backend:

```env
CATALOG_BASE_DOMAINS=myctlg-update.ru
CATALOG_CUSTOM_DOMAIN_IPS=SERVER_IP
CATALOG_CUSTOM_DOMAIN_TARGETS=customers.myctlg-update.ru
CATALOG_DOMAIN_REQUIRE_TXT=true
CATALOG_DOMAIN_RECHECK_AFTER_SECONDS=300
CATALOG_TLS_ASK_ALLOWED_HOSTS=127.0.0.1,localhost,::1,[::1]
SESSION_COOKIE_NAME=sid
CSRF_COOKIE_NAME=csrf
ADMIN_SESSION_COOKIE_NAME=admin_sid
ADMIN_CSRF_COOKIE_NAME=admin_csrf
```

Frontend:

```env
NEXT_PUBLIC_API_BASE_URL=/_svc_api
API_BASE_URL=http://127.0.0.1:4000
```

Смысл: на кастомном домене browser ходит в
`https://kingsname.ru/_svc_api/*`, Caddy проксирует запрос в backend, а backend
видит `Host: kingsname.ru`.

`/api/*` теперь остается за Next.js. Например,
`POST /api/revalidate-storefront` обрабатывается frontend-ом и не конфликтует с
Nest backend.

В `Caddyfile` блок `svc_api_to_backend` импортируется в site-блоках раньше
frontend fallback. Поэтому `/_svc_api/*` должен отрабатывать в Caddy до того,
как запрос попадет в Next.js.

Во frontend также есть fallback rewrite в `next.config.ts`: если `/_svc_api/*`
по ошибке дошел до Next.js, он проксируется на `API_BASE_URL` без префикса.
Основной production-путь всё равно должен отрабатывать в Caddy.

## Cookies

Для production оставляем такую модель:

```text
global admin на myctlg-update.ru/shtab.myctlg-update.ru -> admin_sid/admin_csrf, Domain=.myctlg-update.ru
catalog owner на domain.myctlg-update.ru                -> sid/csrf, host-only без Domain
custom domains                                           -> sid/csrf, host-only без Domain
```

Так мы избегаем конфликта двух cookie с одинаковым именем на
`domain.myctlg-update.ru`. Глобальная админка может работать через
`.myctlg-update.ru`, а владелец каталога и кастомный домен остаются
изолированы текущим host.

## Проверки

Backend:

```bash
curl -i http://127.0.0.1:4000/observability/health
```

TLS ask endpoint:

```bash
curl -i 'http://127.0.0.1:4000/internal/tls/ask?domain=kingsname.ru' -H 'Host: 127.0.0.1'
```

После активации домена ожидается:

```text
HTTP/1.1 204 No Content
```

Публичный API:

```bash
curl -I https://myctlg-update.ru/_svc_api/catalog/current
curl -I https://shtab.myctlg-update.ru/_svc_api/catalog/current
```

Кастомный домен с принудительным DNS на IP сервера:

```bash
curl -vk --resolve kingsname.ru:443:SERVER_IP https://kingsname.ru/_svc_api/catalog/current
```

## Rollback На Nginx

Использовать только если Caddy нужно временно выключить:

```bash
sudo systemctl stop caddy

sudo cp deploy/nginx/catalog-rollback-public.conf /etc/nginx/sites-available/catalog-rollback-public.conf
sudo ln -s /etc/nginx/sites-available/catalog-rollback-public.conf /etc/nginx/sites-enabled/catalog-rollback-public.conf
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
```

В rollback-режиме автоматических кастомных доменов нет. Работает платформа:

```text
myctlg-update.ru
*.myctlg-update.ru
api.myctlg-update.ru
shtab.myctlg-update.ru
```

Для каждого кастомного домена в Nginx придется вручную выпускать сертификат и
добавлять отдельный `server` block. Поэтому основной путь для нас — Caddy.

## Переключение На Боевой Домен

Когда переходишь с `myctlg-update.ru` на `myctlg.ru`, меняются только env и DNS:

```env
CATALOG_PLATFORM_DOMAIN=myctlg.ru
CADDY_ACME_EMAIL=admin@myctlg.ru
CADDY_PLATFORM_CERT_FULLCHAIN=/etc/caddy/certs/myctlg.ru.crt
CADDY_PLATFORM_CERT_KEY=/etc/caddy/certs/myctlg.ru.key
```

В backend env:

```env
CATALOG_BASE_DOMAINS=myctlg.ru
CATALOG_CUSTOM_DOMAIN_TARGETS=customers.myctlg.ru
HTTP_CORS=https://myctlg.ru,https://*.myctlg.ru,https://shtab.myctlg.ru,https://api.myctlg.ru
```

После изменения:

```bash
sudo systemctl daemon-reload
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl restart caddy
sudo systemctl restart catalog-backend
```
