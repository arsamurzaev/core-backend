# Custom Domains, Caddy, Nginx, Ubuntu Runbook

Документ описывает продовую настройку сервера Ubuntu для платформы каталогов с кастомными доменами клиентов.

Актуальные файлы для нашего production-кейса лежат в `deploy/`:

```text
deploy/caddy/Caddyfile
deploy/nginx/catalog-rollback-public.conf
deploy/README.md
```

Основной рекомендуемый вариант для production: `deploy/caddy/Caddyfile`. Nginx в этой схеме не стоит перед Caddy; он остается только как публичный rollback, если Caddy нужно временно выключить.

Основная рекомендуемая схема:

```text
Internet
  |
  | :80 / :443
  v
Caddy
  |
  |-- shtab.myctlg.ru      -> admin frontend
  |-- api.myctlg.ru        -> backend для админки
  |-- myctlg.ru            -> public/platform frontend
  |-- *.myctlg.ru          -> public catalog frontend
  |-- kingsname.ru                -> public catalog frontend
  |-- kingsname.ru/_svc_api/*          -> backend, tenant берется из Host
```

Nginx в этой схеме не является публичным TLS-входом. Для нашего кейса его лучше:

- полностью выключить, если Caddy напрямую проксирует в backend/frontend;
- держать как rollback-вариант, если нужно быстро вернуться к старой схеме.

## 1. Переменные И Принятые Порты

Перед началом выбери реальные значения и дальше подставляй их в команды.

```bash
export SERVER_IP="203.0.113.10"
export PLATFORM_DOMAIN="myctlg-update.ru"
export BACKEND_PORT="4000"
export PUBLIC_FRONTEND_PORT="3000"
export ADMIN_FRONTEND_PORT="3001"
export APP_USER="catalog"
export APP_ROOT="/opt/catalog"
export BACKEND_DIR="/opt/catalog/backend"
```

В этом документе используются такие адреса:

```text
backend             127.0.0.1:4000
public frontend     127.0.0.1:3000
admin frontend      127.0.0.1:3001
Caddy public        0.0.0.0:80, 0.0.0.0:443
```

Если у тебя backend сейчас работает на другом `HTTP_PORT`, поменяй `BACKEND_PORT` и все места в Caddyfile.

## 1.1 Важный Момент: API URL Во Frontend

Для кастомных доменов нельзя оставлять публичный storefront на постоянном browser API URL вида:

```env
NEXT_PUBLIC_API_BASE_URL=https://api.myctlg.ru
```

Если пользователь открыл `https://kingsname.ru`, а browser-запрос ушел на `https://api.myctlg.ru`, backend увидит `Host: api.myctlg.ru`, а не `Host: kingsname.ru`. Это ломает tenant resolution по домену и усложняет cookies/CORS.

Правильная production-схема:

```env
# Browser-запросы frontend: same-origin через Caddy
NEXT_PUBLIC_API_BASE_URL=/_svc_api

# Server-side запросы Next.js: напрямую в backend внутри сервера
API_BASE_URL=http://127.0.0.1:4000
```

Тогда:

```text
https://kingsname.ru/_svc_api/catalog/current     -> Caddy -> backend /catalog/current
https://shtab.myctlg.ru/_svc_api/...       -> Caddy -> backend /...
https://api.myctlg.ru/...             -> прямой платформенный API для внешних интеграций/Swagger/legacy
```

`api.myctlg.ru` или `api.myctlg.ru` можно оставить, но не как основной browser API URL для публичного storefront на кастомных доменах.

Если админка собирается отдельным build/deploy и ты принципиально хочешь оставить для нее абсолютный API URL, можно использовать:

```env
NEXT_PUBLIC_API_BASE_URL=https://api.myctlg.ru
```

Но для public storefront build всё равно нужен:

```env
NEXT_PUBLIC_API_BASE_URL=/_svc_api
```

## 2. DNS

### 2.1 DNS Платформы

В DNS-зоне `myctlg.ru`:

```text
@                         A      SERVER_IP
api                       A      SERVER_IP
shtab                     A      SERVER_IP
customers                 A      SERVER_IP
*                         A      SERVER_IP
```

Итог:

```text
myctlg.ru
api.myctlg.ru
shtab.myctlg.ru
customers.myctlg.ru
any-slug.myctlg.ru
```

`customers.myctlg.ru` нужен как удобная CNAME-цель для клиентских поддоменов.

### 2.2 DNS Клиентского Apex-Домена

Для домена клиента `kingsname.ru`:

```text
kingsname.ru        A      SERVER_IP
www.kingsname.ru    CNAME  kingsname.ru
```

Если DNS-провайдер клиента поддерживает `ALIAS`, `ANAME` или CNAME flattening:

```text
kingsname.ru        ALIAS  customers.myctlg.ru
www.kingsname.ru    CNAME  customers.myctlg.ru
```

Обычный `CNAME` на корне домена обычно нельзя использовать, потому что apex-домен уже содержит `NS` и `SOA`.

### 2.3 DNS Клиентского Поддомена

Если клиент хочет не `kingsname.ru`, а `shop.kingsname.ru`:

```text
shop.kingsname.ru   CNAME  customers.myctlg.ru
```

### 2.4 TXT-Верификация Владения

Если включено:

```env
CATALOG_DOMAIN_REQUIRE_TXT=true
```

то backend будет требовать TXT-запись:

```text
_myctlg-verify.kingsname.ru TXT "verificationToken-from-api"
```

Проверка с сервера:

```bash
dig +short TXT _myctlg-verify.kingsname.ru
dig +short A kingsname.ru
dig +short CNAME www.kingsname.ru
```

## 3. Подготовка Ubuntu

Команды рассчитаны на Ubuntu 22.04/24.04.

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y curl git unzip ca-certificates gnupg lsb-release ufw htop jq dnsutils
```

Проверить время. Для ACME/TLS важно, чтобы часы сервера были синхронизированы.

```bash
timedatectl status
sudo timedatectl set-ntp true
```

Создать пользователя приложения:

```bash
sudo adduser --system --group --home /opt/catalog catalog
sudo mkdir -p /opt/catalog
sudo chown -R catalog:catalog /opt/catalog
```

Настроить firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

Не открывай наружу:

```text
3000
3001
4000
5432/5433
6379
```

Проверить, кто слушает публичные порты:

```bash
sudo ss -ltnp | grep -E ':80|:443|:3000|:3001|:4000'
```

## 4. Установка Bun

В проекте используется `bun.lock`, поэтому на сервере удобно использовать Bun.

```bash
sudo apt install -y unzip
curl -fsSL https://bun.com/install | bash
```

Если устанавливал под пользователем `catalog`:

```bash
sudo -iu catalog
curl -fsSL https://bun.com/install | bash
~/.bun/bin/bun --version
exit
```

Путь к Bun для systemd:

```text
/opt/catalog/.bun/bin/bun
```

Если Bun установлен у обычного deploy-пользователя, используй его фактический путь:

```bash
which bun
```

## 5. Backend Env

Создать директорию для env:

```bash
sudo mkdir -p /etc/catalog
sudo touch /etc/catalog/backend.env
sudo chown root:catalog /etc/catalog/backend.env
sudo chmod 0640 /etc/catalog/backend.env
```

Файл:

```bash
sudo nano /etc/catalog/backend.env
```

Минимальный набор переменных, связанных с доменами:

```env
NODE_ENV=production

HTTP_PORT=4000
HTTP_HOST=https://api.myctlg-update.ru
HTTP_CORS=https://myctlg-update.ru,https://*.myctlg-update.ru,https://shtab.myctlg-update.ru,https://api.myctlg-update.ru

CATALOG_BASE_DOMAINS=myctlg-update.ru
CATALOG_RESERVED_SUBDOMAINS=www,api,admin,app,static,cdn,assets,shtab,customers

CATALOG_CUSTOM_DOMAIN_IPS=203.0.113.10
CATALOG_CUSTOM_DOMAIN_TARGETS=customers.myctlg-update.ru

CATALOG_DOMAIN_REQUIRE_TXT=true
CATALOG_DOMAIN_CHECK_ENABLED=true
CATALOG_DOMAIN_CHECK_CRON="*/5 * * * *"
CATALOG_DOMAIN_CHECK_LIMIT=25
CATALOG_DOMAIN_RECHECK_AFTER_SECONDS=300

CATALOG_TLS_ASK_ALLOWED_HOSTS=127.0.0.1,localhost,::1,[::1]
CATALOG_RESOLVE_CACHE_MS=30000

COOKIE_SAMESITE=lax
SESSION_COOKIE_NAME=sid
CSRF_COOKIE_NAME=csrf
ADMIN_SESSION_COOKIE_NAME=asid
ADMIN_CSRF_COOKIE_NAME=acrsf
```

Плюс добавь все уже существующие переменные проекта:

```text
DATABASE_*
REDIS_*
S3_*
INTEGRATION_CRYPTO_*
OBSERVABILITY_*
```

Важные нюансы:

- `CATALOG_CUSTOM_DOMAIN_IPS` должен содержать публичный IP, на который клиенты ставят `A` записи.
- `CATALOG_CUSTOM_DOMAIN_TARGETS` должен содержать CNAME-цели, которые backend считает валидными.
- `CATALOG_DOMAIN_RECHECK_AFTER_SECONDS` возвращается в API как рекомендуемая пауза перед повторной ручной проверкой DNS.
- `CATALOG_TLS_ASK_ALLOWED_HOSTS` должен совпадать с Host, который Caddy использует при запросе `ask`. Если Caddy вызывает `http://127.0.0.1:4000/internal/tls/ask`, оставь `127.0.0.1`.
- `HTTP_CORS` может не включать кастомные домены. Они разрешаются динамически через `catalog_domains`.

## 6. Деплой Backend На Сервер

Клонирование:

```bash
sudo -iu catalog
mkdir -p /opt/catalog
cd /opt/catalog
git clone <YOUR_BACKEND_REPO_URL> backend
cd backend
bun install --frozen-lockfile
bun run prisma:generate
bun run build
exit
```

Если репозиторий уже есть:

```bash
sudo -iu catalog
cd /opt/catalog/backend
git pull
bun install --frozen-lockfile
bun run prisma:generate
bun run build
exit
```

Применение Prisma-схемы:

```bash
sudo -iu catalog
cd /opt/catalog/backend
set -a
. /etc/catalog/backend.env
set +a
bun run prisma:migrate:deploy
exit
```

Если это уже существующая база, созданная до baseline-миграции, сначала смотри `docs/prisma-migrations.md`: baseline нужно пометить как applied, а не накатывать поверх живых таблиц.

```bash
bun run prisma:migrate:status
```

## 7. Systemd Для Backend

Создать unit:

```bash
sudo nano /etc/systemd/system/catalog-backend.service
```

Содержимое:

```ini
[Unit]
Description=Catalog Backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=catalog
Group=catalog
WorkingDirectory=/opt/catalog/backend
EnvironmentFile=/etc/catalog/backend.env
ExecStart=/opt/catalog/.bun/bin/bun run start:prod
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/opt/catalog/backend/runtime

[Install]
WantedBy=multi-user.target
```

Если `bun` находится в другом месте, поменяй `ExecStart`.

Подготовить runtime-директории:

```bash
sudo mkdir -p /opt/catalog/backend/runtime/logs
sudo chown -R catalog:catalog /opt/catalog/backend/runtime
```

Запуск:

```bash
sudo systemctl daemon-reload
sudo systemctl enable catalog-backend
sudo systemctl start catalog-backend
sudo systemctl status catalog-backend
```

Логи:

```bash
sudo journalctl -u catalog-backend -f
sudo journalctl -u catalog-backend --since "1 hour ago"
```

Проверка backend:

```bash
curl -i http://127.0.0.1:4000/observability/health
curl -i http://127.0.0.1:4000/internal/tls/ask?domain=example.com -H 'Host: 127.0.0.1'
```

Для неизвестного домена `ask` должен вернуть `404`.

## 8. Установка Caddy

Официальный пакет Caddy для Ubuntu устанавливается через apt repository Cloudsmith.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Проверка:

```bash
caddy version
sudo systemctl status caddy
```

Caddy package автоматически создает systemd-сервис `caddy`.

Важные пути:

```text
/etc/caddy/Caddyfile
/var/lib/caddy
/var/log/caddy
```

Директория `/var/lib/caddy` должна сохраняться между деплоями и бэкапами, там хранятся ACME account и сертификаты.

```bash
sudo mkdir -p /var/log/caddy
sudo chown -R caddy:caddy /var/log/caddy
sudo ls -la /var/lib/caddy
```

## 9. Если Nginx Уже Занимает 80/443

Caddy и Nginx не могут одновременно слушать `80` и `443`.

Проверка:

```bash
sudo ss -ltnp | grep -E ':80|:443'
```

Если Caddy будет главным публичным ingress, останови Nginx:

```bash
sudo systemctl stop nginx
sudo systemctl disable nginx
```

Для нашего кейса не поднимаем internal Nginx за Caddy. Caddy проксирует напрямую в backend/frontend/admin.

## 10. Основной Caddyfile

Открыть:

```bash
sudo nano /etc/caddy/Caddyfile
```

Перед этим создать env для Caddy:

```bash
sudo nano /etc/caddy/catalog.env
```

```env
CATALOG_PLATFORM_DOMAIN=myctlg-update.ru
CADDY_ACME_EMAIL=admin@myctlg-update.ru
CADDY_PLATFORM_CERT_FULLCHAIN=/etc/ssl/certs/myctlg-update.ru.fullchain.pem
CADDY_PLATFORM_CERT_KEY=/etc/ssl/private/myctlg-update.ru.key
```

И подключить его к systemd:

```bash
sudo systemctl edit caddy
```

```ini
[Service]
EnvironmentFile=/etc/caddy/catalog.env
```

```bash
sudo systemctl daemon-reload
```

Пример:

```caddyfile
{
	email {$CADDY_ACME_EMAIL:admin@myctlg-update.ru}

	on_demand_tls {
		ask http://127.0.0.1:4000/internal/tls/ask
	}
}

(access_log) {
	log {
		output file /var/log/caddy/catalog-access.log {
			roll_size 100MiB
			roll_keep 10
			roll_keep_for 720h
		}
		format json
	}
}

(backend_headers) {
	header_up Host {host}
	header_up X-Forwarded-Host {host}
	header_up X-Forwarded-Proto {scheme}
	header_up X-Real-IP {remote_host}
}

(backend_proxy) {
	reverse_proxy 127.0.0.1:4000 {
		import backend_headers
		flush_interval -1
		transport http {
			dial_timeout 10s
			response_header_timeout 120s
		}
	}
}

(public_frontend_proxy) {
	reverse_proxy 127.0.0.1:3000 {
		import backend_headers
		transport http {
			dial_timeout 10s
			response_header_timeout 120s
		}
	}
}

(admin_frontend_proxy) {
	reverse_proxy 127.0.0.1:3001 {
		import backend_headers
		transport http {
			dial_timeout 10s
			response_header_timeout 120s
		}
	}
}

api.{$CATALOG_PLATFORM_DOMAIN:myctlg-update.ru} {
	encode gzip
	import access_log

	import backend_proxy
}

shtab.{$CATALOG_PLATFORM_DOMAIN:myctlg-update.ru} {
	encode gzip
	import access_log

	handle_path /_svc_api/* {
		import backend_proxy
	}

	handle {
		import admin_frontend_proxy
	}
}

{$CATALOG_PLATFORM_DOMAIN:myctlg-update.ru}, *.{$CATALOG_PLATFORM_DOMAIN:myctlg-update.ru} {
	encode gzip
	import access_log

	handle_path /_svc_api/* {
		import backend_proxy
	}

	handle {
		import public_frontend_proxy
	}
}

https:// {
	tls {
		on_demand
	}

	encode gzip
	import access_log

	handle_path /_svc_api/* {
		import backend_proxy
	}

	handle {
		import public_frontend_proxy
	}
}
```

Что делает этот файл:

- `api.myctlg.ru` проксирует напрямую в backend.
- `shtab.myctlg.ru` проксирует в админку.
- `myctlg.ru` и `*.myctlg.ru` проксируют публичный frontend, а `/_svc_api/*` отправляют в backend без префикса `/_svc_api`.
- `https://` ловит кастомные домены клиентов.
- `tls on_demand` выпускает сертификат только после разрешения от backend endpoint `/internal/tls/ask`.
- `handle_path /_svc_api/*` автоматически убирает `/_svc_api`, поэтому запрос `https://kingsname.ru/_svc_api/catalog/current` попадет в backend как `/catalog/current`.

Проверить и применить:

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy
```

Логи:

```bash
sudo journalctl -u caddy -f
sudo tail -f /var/log/caddy/catalog-access.log
```

## 11. Проверка Caddy До Реального DNS

Можно проверить домен через `--resolve`, не меняя публичный DNS:

```bash
curl -vk --resolve kingsname.ru:443:203.0.113.10 https://kingsname.ru/
curl -vk --resolve kingsname.ru:443:203.0.113.10 https://kingsname.ru/_svc_api/catalog/current
```

Если домен еще не `ACTIVE` в БД, TLS handshake должен не пройти или Caddy должен отказать в выпуске сертификата.

Проверка platform API:

```bash
curl -i https://api.myctlg.ru/observability/health
```

Проверка slug-домена:

```bash
curl -i https://testslug.myctlg.ru/catalog/current
curl -i https://testslug.myctlg.ru/_svc_api/catalog/current
```

## 12. Как Добавляется Кастомный Домен

### 12.1 Пользователь Добавляет Домен

Через API:

```http
POST /catalog/current/domains
```

Body:

```json
{
	"hostname": "kingsname.ru",
	"includeWww": true,
	"isPrimary": true,
	"redirectToPrimary": true
}
```

Ответ содержит:

```json
{
	"id": "domain-id",
	"catalogId": "catalog-id",
	"hostname": "kingsname.ru",
	"status": "PENDING_DNS",
	"verificationToken": "...",
	"message": "Добавьте DNS-записи из инструкции и повторите проверку примерно через 5 мин.",
	"nextCheckAfterSeconds": 300,
	"verification": {
		"txtRecord": {
			"type": "TXT",
			"name": "_myctlg-verify.kingsname.ru",
			"value": "verification-token",
			"required": true
		},
		"routingRecords": [
			{
				"type": "A",
				"name": "kingsname.ru",
				"value": "SERVER_IP",
				"required": false
			},
			{
				"type": "ALIAS/ANAME/CNAME",
				"name": "kingsname.ru",
				"value": "customers.myctlg.ru",
				"required": false
			}
		],
		"wwwRecord": {
			"type": "CNAME",
			"name": "www.kingsname.ru",
			"value": "kingsname.ru",
			"required": true
		}
	}
}
```

Пользователю надо показать DNS-инструкции из `verification`. Для маршрутизации
обычно нужен один вариант: `A/AAAA` на IP сервера или `ALIAS/ANAME/CNAME` на
платформенную цель.

```text
kingsname.ru                      A      SERVER_IP
kingsname.ru                      ALIAS  customers.myctlg.ru
www.kingsname.ru                  CNAME  kingsname.ru
_myctlg-verify.kingsname.ru       TXT    verificationToken
```

### 12.2 Проверка DNS Вручную

```bash
dig +short A kingsname.ru
dig +short CNAME www.kingsname.ru
dig +short TXT _myctlg-verify.kingsname.ru
```

### 12.3 Проверка Через Backend

```http
POST /catalog/current/domains/:id/check
```

Если DNS корректный, статус станет:

```text
ACTIVE
```

### 12.4 Проверка Через Cron

Cron сам проверяет домены по расписанию:

```env
CATALOG_DOMAIN_CHECK_CRON="*/5 * * * *"
```

Логи:

```bash
sudo journalctl -u catalog-backend -f | grep catalog-domain
```

## 13. Проверка Internal TLS Ask Endpoint

После активации домена:

```bash
curl -i 'http://127.0.0.1:4000/internal/tls/ask?domain=kingsname.ru' -H 'Host: 127.0.0.1'
```

Ожидаемо:

```text
HTTP/1.1 204 No Content
```

Для неизвестного домена:

```bash
curl -i 'http://127.0.0.1:4000/internal/tls/ask?domain=unknown-example.ru' -H 'Host: 127.0.0.1'
```

Ожидаемо:

```text
HTTP/1.1 404 Not Found
```

Если ответ всегда `404`, проверь:

```bash
grep CATALOG_TLS_ASK_ALLOWED_HOSTS /etc/catalog/backend.env
grep CATALOG_CUSTOM_DOMAIN /etc/catalog/backend.env
sudo journalctl -u catalog-backend --since "10 minutes ago"
```

## 14. Работа С БД Для Диагностики

Подключиться к PostgreSQL:

```bash
psql "$DATABASE_URL"
```

Если нет `DATABASE_URL`, собери команду из `DATABASE_*`.

Посмотреть домены:

```sql
select id, catalog_id, hostname, status, include_www, last_checked_at, last_error
from catalog_domains
order by created_at desc
limit 50;
```

Найти домен:

```sql
select *
from catalog_domains
where hostname = 'kingsname.ru';
```

Временно отключить домен:

```sql
update catalog_domains
set status = 'DISABLED'
where hostname = 'kingsname.ru';
```

Вернуть на повторную проверку:

```sql
update catalog_domains
set status = 'PENDING_DNS', last_error = null
where hostname = 'kingsname.ru';
```

Вручную ставить `ACTIVE` можно только для аварийной диагностики. В нормальном сценарии это делает DNS-check.

## 15. Nginx В Нашем Кейсе

В основной production-схеме Nginx не используется:

```text
Internet -> Caddy -> backend/frontend/admin
```

Не держим отдельный internal Nginx за Caddy, потому что он не добавляет пользы для текущей архитектуры, но добавляет еще один слой диагностики.

Актуальные proxy-файлы:

```text
deploy/caddy/Caddyfile
deploy/nginx/catalog-rollback-public.conf
```

## 16. Rollback На Nginx

Используй только если Caddy нужно временно выключить.

Скопировать rollback-конфиг:

```bash
sudo cp deploy/nginx/catalog-rollback-public.conf /etc/nginx/sites-available/catalog-rollback-public.conf
sudo ln -s /etc/nginx/sites-available/catalog-rollback-public.conf /etc/nginx/sites-enabled/catalog-rollback-public.conf
sudo rm -f /etc/nginx/sites-enabled/default
```

Переключить публичные `80/443` с Caddy на Nginx:

```bash
sudo systemctl stop caddy
sudo systemctl disable caddy
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
sudo ss -ltnp | grep -E ':80|:443'
```

В rollback-режиме работает только платформа:

```text
myctlg.ru
*.myctlg.ru
api.myctlg.ru
shtab.myctlg.ru
```

Кастомные домены в Nginx не автоматизируем. Для каждого кастомного домена в rollback-режиме придется вручную выпускать сертификат и добавлять отдельный `server` block. Поэтому основной production-путь для нас — Caddy.

## 17. Обновление Backend В Проде

Обычный деплой:

```bash
sudo -iu catalog
cd /opt/catalog/backend
git fetch --all
git pull
bun install --frozen-lockfile
bun run prisma:generate
bun run build
set -a
. /etc/catalog/backend.env
set +a
bun run prisma:migrate:deploy
exit

sudo systemctl restart catalog-backend
sudo systemctl status catalog-backend
```

Проверки после деплоя:

```bash
curl -i http://127.0.0.1:4000/observability/health
curl -i https://api.myctlg.ru/observability/health
sudo journalctl -u catalog-backend --since "10 minutes ago"
sudo journalctl -u caddy --since "10 minutes ago"
```

Если менялся Caddyfile:

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 18. Логи И Наблюдаемость

Caddy:

```bash
sudo journalctl -u caddy -f
sudo tail -f /var/log/caddy/catalog-access.log
```

Backend:

```bash
sudo journalctl -u catalog-backend -f
tail -f /opt/catalog/backend/runtime/logs/backend.jsonl
```

Сеть:

```bash
sudo ss -ltnp
sudo ss -ltnp | grep -E ':80|:443|:4000|:3000|:3001'
```

DNS:

```bash
dig +trace kingsname.ru
dig +short A kingsname.ru
dig +short AAAA kingsname.ru
dig +short CNAME www.kingsname.ru
dig +short TXT _myctlg-verify.kingsname.ru
```

TLS:

```bash
openssl s_client -connect kingsname.ru:443 -servername kingsname.ru </dev/null 2>/dev/null | openssl x509 -noout -issuer -subject -dates
```

HTTP:

```bash
curl -I https://kingsname.ru
curl -I https://kingsname.ru/_svc_api/catalog/current
curl -vk --resolve kingsname.ru:443:203.0.113.10 https://kingsname.ru/_svc_api/catalog/current
```

## 19. Частые Проблемы

### Caddy Не Стартует

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo journalctl -u caddy --since "10 minutes ago"
```

Частые причины:

- Nginx уже слушает `80/443`.
- Ошибка синтаксиса Caddyfile.
- Нет прав на `/var/log/caddy`.
- Нет доступа к backend на `127.0.0.1:4000`.

### Сертификат Не Выпускается

Проверить:

```bash
curl -i 'http://127.0.0.1:4000/internal/tls/ask?domain=kingsname.ru' -H 'Host: 127.0.0.1'
dig +short A kingsname.ru
dig +short TXT _myctlg-verify.kingsname.ru
sudo journalctl -u caddy --since "30 minutes ago" | grep -i tls
```

Причины:

- домен не `ACTIVE`;
- TXT не совпадает;
- A/CNAME не указывает на сервер;
- `CATALOG_TLS_ASK_ALLOWED_HOSTS` не включает `127.0.0.1`;
- Caddy не может достучаться до backend;
- превышены ACME rate limits после большого числа неудачных попыток.

### Custom Domain Открывается, Но Каталог Не Найден

Проверить tenant resolution:

```sql
select hostname, status, catalog_id
from catalog_domains
where hostname in ('kingsname.ru', 'www.kingsname.ru');
```

Проверить headers:

```bash
curl -vk https://kingsname.ru/_svc_api/catalog/current
```

Caddy должен передавать:

```text
Host: kingsname.ru
X-Forwarded-Host: kingsname.ru
X-Forwarded-Proto: https
```

### API Возвращает CORS Ошибку

Для storefront лучше использовать same-origin:

```text
https://kingsname.ru/_svc_api/*
```

Если frontend ходит на `https://api.myctlg.ru`, то запрос становится cross-origin и зависит от CORS/cookies. Для публичных каталогов это менее удобно.

### Cookies Не Ставятся

Проверить:

```bash
curl -I https://kingsname.ru/_svc_api/catalog/current
```

Для кастомного домена лучше same-origin API через `/_svc_api`. Тогда cookies будут привязаны к `kingsname.ru`, а не к `api.myctlg.ru`.

### SSE Не Работает

Проверить, что Caddy proxy использует:

```caddyfile
flush_interval -1
```

И что запрос идет через `/_svc_api/.../sse`, чтобы Caddy отправил его в backend.

## 20. Backup

Что бэкапить:

```text
PostgreSQL database
/etc/catalog/backend.env
/etc/caddy/Caddyfile
/var/lib/caddy
/etc/systemd/system/catalog-backend.service
```

Пример:

```bash
sudo tar -czf /root/catalog-caddy-backup-$(date +%F).tar.gz \
  /etc/caddy \
  /var/lib/caddy \
  /etc/catalog \
  /etc/systemd/system/catalog-backend.service
```

PostgreSQL:

```bash
pg_dump "$DATABASE_URL" | gzip > /root/catalog-db-$(date +%F).sql.gz
```

Если PostgreSQL в Docker:

```bash
docker exec postgres-core pg_dump -U "$DATABASE_USER" "$DATABASE_NAME" | gzip > /root/catalog-db-$(date +%F).sql.gz
```

## 21. Rollback План

### Rollback Только Backend

```bash
sudo -iu catalog
cd /opt/catalog/backend
git log --oneline -5
git checkout <PREVIOUS_COMMIT>
bun install --frozen-lockfile
bun run prisma:generate
bun run build
exit

sudo systemctl restart catalog-backend
```

Если были изменения БД, rollback делай осторожно. Prisma migrations не хранят down-миграции, поэтому destructive rollback делается через backup/restore или отдельную forward-migration.

### Rollback Caddyfile

Перед правкой всегда сохраняй:

```bash
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.$(date +%F-%H%M%S).bak
```

Вернуть:

```bash
sudo cp /etc/caddy/Caddyfile.2026-05-04-120000.bak /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### Полный Rollback На Nginx

```bash
sudo systemctl stop caddy
sudo systemctl start nginx
sudo systemctl status nginx
sudo ss -ltnp | grep -E ':80|:443'
```

## 22. Production Checklist

Перед запуском:

```text
[ ] DNS платформы указывает на SERVER_IP
[ ] customers.myctlg.ru указывает на SERVER_IP
[ ] UFW открыт только на OpenSSH, 80, 443
[ ] backend работает под systemd
[ ] backend env содержит CATALOG_CUSTOM_DOMAIN_IPS
[ ] backend env содержит CATALOG_CUSTOM_DOMAIN_TARGETS
[ ] backend env содержит CATALOG_DOMAIN_REQUIRE_TXT=true
[ ] backend env содержит CATALOG_TLS_ASK_ALLOWED_HOSTS
[ ] prisma schema применена
[ ] Caddy установлен из official apt repository
[ ] /var/lib/caddy сохраняется и бэкапится
[ ] /etc/caddy/Caddyfile проходит caddy validate
[ ] Nginx не занимает 80/443
[ ] /internal/tls/ask отвечает 204 только для ACTIVE доменов
[ ] тестовый кастомный домен открывается по HTTPS
[ ] /_svc_api на кастомном домене работает same-origin
[ ] Caddy и backend logs проверены
```

## 23. Полезные Команды Одним Блоком

```bash
# Status
sudo systemctl status caddy
sudo systemctl status catalog-backend
sudo ss -ltnp | grep -E ':80|:443|:4000|:3000|:3001'

# Logs
sudo journalctl -u caddy -f
sudo journalctl -u catalog-backend -f

# Caddy config
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy

# Backend deploy
sudo -iu catalog
cd /opt/catalog/backend
git pull
bun install --frozen-lockfile
bun run prisma:generate
bun run build
set -a
. /etc/catalog/backend.env
set +a
bun run prisma:migrate:deploy
exit
sudo systemctl restart catalog-backend

# DNS
dig +short A kingsname.ru
dig +short CNAME www.kingsname.ru
dig +short TXT _myctlg-verify.kingsname.ru

# TLS ask
curl -i 'http://127.0.0.1:4000/internal/tls/ask?domain=kingsname.ru' -H 'Host: 127.0.0.1'

# Test via forced DNS
curl -vk --resolve kingsname.ru:443:203.0.113.10 https://kingsname.ru/_svc_api/catalog/current
```

## 24. Источники

- Caddy install for Debian/Ubuntu: https://caddyserver.com/docs/install
- Caddy On-Demand TLS global option: https://caddyserver.com/docs/caddyfile/options#on-demand-tls
- Caddy `tls on_demand`: https://caddyserver.com/docs/caddyfile/directives/tls
- Caddy `reverse_proxy`: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- Ubuntu Nginx install docs: https://ubuntu.com/server/docs/how-to/web-services/install-nginx/
- Certbot Ubuntu/Nginx instructions: https://certbot.eff.org/instructions?os=ubuntufocal&ws=nginx
- Bun installation: https://bun.com/docs/installation
