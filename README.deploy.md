# Деплой SupportChat на VPS (Ubuntu 22.04 / 24.04 / 26.04 LTS)

Стек в проде: **Caddy** (TLS, авто Let's Encrypt) → **app** (Node: API + WebSocket + собранный SPA/виджет) → **Postgres 16**.
Наружу открыты только **22/80/443**. Порт приложения (3000) и БД (5432) — только во внутренней сети Docker.

## 0. Требования

- VPS: **2 vCPU / 2–4 ГБ RAM / 20–30 ГБ SSD**.
- **Домен**, A-запись которого смотрит на IP сервера (нужен для HTTPS и вебхука Telegram).
- Открыты порты 22, 80, 443 (для Let's Encrypt Caddy сам поднимет проверку по 80).

## 1. Установка Docker на сервере

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # затем перелогиньтесь
docker --version && docker compose version
```

## 2. Код на сервере

Вариант A — `git clone` (рекомендуется, если есть доступ к репозиторию):

```bash
sudo mkdir -p /root/support-chat && cd /root/support-chat
git clone <REPO_URL> .
```

Вариант B — залить с локальной машины (без git):

```bash
# с локального компьютера:
rsync -av --exclude node_modules --exclude dist --exclude .env \
  ./ user@SERVER_IP:/root/support-chat/
```

## 3. Настройка окружения

```bash
cd /root/support-chat
cp deploy/.env.example deploy/.env
openssl rand -hex 48   # вставьте в JWT_SECRET
openssl rand -hex 32   # вставьте в TELEGRAM_TOKEN_KEY
nano deploy/.env
```

Обязательно задайте:
- `DOMAIN` и `PUBLIC_BASE_URL=https://<домен>` — **совпадать**;
- `JWT_SECRET`, `TELEGRAM_TOKEN_KEY` — сгенерированные;
- `POSTGRES_PASSWORD` — надёжный;
- `CORS_ORIGINS` — ваш домен (и домены клиентов, встраивающих виджет);
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — владелец платформы (суперадмин);
- для **первого** запуска: `RUN_SEED=true`.

> `deploy/.env` в `.gitignore` — секреты не попадают в репозиторий.

## 4. Запуск

```bash
cd /root/support-chat
docker compose --env-file deploy/.env -f docker-compose.prod.yml up -d --build
docker compose --env-file deploy/.env -f docker-compose.prod.yml ps
```

Первый запуск: Caddy получит сертификат Let's Encrypt (10–60 секунд), app применит схему БД и (при `RUN_SEED=true`) создаст суперадмина и тенант по умолчанию.

Проверка:

```bash
curl -s https://<домен>/health          # {"ok":true}
docker compose --env-file deploy/.env -f docker-compose.prod.yml logs -f app
```

Войдите владельцем: `https://<домен>/login` → `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

После успешного первого запуска **можно** поставить `RUN_SEED=false` в `deploy/.env` и перезапустить app
(не обязательно: seed идемпотентен; он лишь перезаписывает пароль тенант-админа, только если задан `TENANT_ADMIN_EMAIL`).

## 5. Firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Docker публикует 80/443 сам; 3000/5432 остаются внутри compose-сети.

## 6. Обновление версии

```bash
cd /root/support-chat
git pull                       # или rsync нового кода
docker compose --env-file deploy/.env -f docker-compose.prod.yml up -d --build
```

Миграции применяются автоматически при старте контейнера app.

## 7. Бэкапы

```bash
chmod +x deploy/backup.sh
./deploy/backup.sh             # разовый дамп БД + uploads в /root/support-chat-backups
crontab -e
# добавьте строку:
0 3 * * * /root/support-chat/deploy/backup.sh >> /var/log/support-chat-backup.log 2>&1
```

Храните копии **вне** сервера (rsync/rclone в объектное хранилище).

## 8. Telegram-бот

- В CRM/админке тенанта вставьте токен бота из BotFather — вебхук зарегистрируется автоматически на
  `PUBLIC_BASE_URL/api/tg/<botId>` (секрет `X-Telegram-Bot-Api-Secret-Token`).
- Требуются рабочие 443 и корректный `PUBLIC_BASE_URL`.

## 9. Полезные команды

```bash
D="docker compose --env-file deploy/.env -f docker-compose.prod.yml"
$D ps                       # статусы
$D logs -f app              # логи приложения
$D restart app              # перезапуск
$D exec app node dist/db/seed.js   # повторный seed вручную
$D down                     # остановить (volumes сохраняются)
$D down -v                  # ⚠️ остановить и УДАЛИТЬ данные БД/uploads
```

## Структура файлов деплоя

| Файл | Назначение |
| --- | --- |
| `backend/Dockerfile` | multi-stage сборка (фронт + бэкенд → slim-рантайм) |
| `backend/docker-entrypoint.sh` | ожидание БД → миграция → опц. seed → старт |
| `docker-compose.prod.yml` | app + postgres + caddy |
| `deploy/Caddyfile` | HTTPS + reverse proxy (WS из коробки) |
| `deploy/.env.example` | шаблон секретов |
| `deploy/backup.sh` | дамп БД + uploads, ретенция 7 дней |
