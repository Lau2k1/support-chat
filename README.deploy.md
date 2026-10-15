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
- `APP_DOMAIN` — домен панелей (например `app.<домен>`); его A-запись тоже
  должна указывать на этот сервер. Если не задан, всё работает на `DOMAIN`;
- `JWT_SECRET`, `TELEGRAM_TOKEN_KEY` — сгенерированные;
- `POSTGRES_PASSWORD` — надёжный;
- `CORS_ORIGINS` — ваш домен, домен панелей (и домены клиентов, встраивающих виджет);
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — владелец платформы (суперадмин);
- `CRYPTOBOT_TOKEN` — токен Crypto Pay API (CryptoBot) для онлайн-оплаты тарифов.
  Если пусто, онлайн-оплата выключена, а владелец подтверждает платежи вручную в CRM;
- для **первого** запуска: `RUN_SEED=true`.

> Вебхук CryptoBot укажите в настройках приложения: `https://<DOMAIN>/api/cryptobot/webhook`.
> `CRYPTOBOT_CURRENCY_TYPE=fiat` (по умолчанию, `CRYPTOBOT_FIAT=USD`) или `crypto` с
> `CRYPTOBOT_ASSET=USDT`.

> `deploy/.env` в `.gitignore` — секреты не попадают в репозиторий.

### Двухдоменная схема (лендинг + панели)

- `DOMAIN` (`sct.chat`) — лендинг продаж, виджет (`/widget.html`, `/uploads`, `/ws`,
  `/api/tg/*`) и API;
- `APP_DOMAIN` (`app.sct.chat`) — панели оператора/админа/CRM (`/login`, `/register`,
  `/operator`, `/admin`, `/crm`);
- Обе A-записи указывают на сервер; Caddy выпускает два сертификата;
- Запросы к панельным путям на `DOMAIN` отвечают `302` в панель на `APP_DOMAIN`;
- Сессионная cookie host-only: вход выполняется на `APP_DOMAIN`, и сессия действует
  только там — это ожидаемо;
- `PUBLIC_BASE_URL` остаётся `https://<DOMAIN>` (вебхуки Telegram и ссылки на файлы
  не зависят от домена).

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

## 8b. Приём платежей (CryptoBot / Crypto Pay)

Оплата подписки проходит через `@CryptoBot` (Crypto Pay API). Счёт выставляется в панели раздела
«Оплата»: `POST /billing/checkout` создаёт инвойс в USD (fiat).

1. Создайте приложение в `@CryptoBot`: Crypto Pay → My Apps → Create App, скопируйте токен.
   Проверка токена: `POST https://pay.crypt.bot/api/getMe` с заголовком
   `Crypto-Pay-API-Token: <токен>` → должно вернуться `{"ok":true,...}`.
2. В `deploy/.env` задайте:
   - `CRYPTOBOT_TOKEN` — токен приложения (в git только `.env.example`, без значения);
   - `CRYPTOBOT_CURRENCY_TYPE=fiat`, `CRYPTOBOT_FIAT=USD` — фиатный счёт в долларах
     (альтернатива: `crypto` + `CRYPTOBOT_ASSET=USDT`).
3. Пересоздайте контейнер: `docker compose --env-file deploy/.env -f docker-compose.prod.yml up -d`.
4. **Webhook** (моментальная активация подписки): в `@CryptoBot` → Crypto Pay → My Apps → ваше
   приложение → **Webhooks** укажите `https://<DOMAIN>/api/cryptobot/webhook`. Методов управления
   webhook в API нет (`setWebhook` → 405 METHOD_NOT_FOUND), настраивается только в интерфейсе бота.
   Подпись запросов — заголовок `crypto-pay-api-signature` (HMAC-SHA256 с ключом `SHA256(token)`);
   без корректной подписи эндпоинт отвечает 401.
5. Пока webhook не настроен, оплата всё равно активируется: панель опрашивает
   `POST /billing/payments/:id/sync` (проверка инвойса через `getInvoices`). Без `CRYPTOBOT_TOKEN`
   биллинг мягко деградирует в ручной режим — «Заявка на оплату» с уведомлением владельцу в Telegram.

## 8c. Юридические документы

Статические страницы `landing/legal/*.html` отдаются как `/legal/offer`, `/legal/consumer`,
`/legal/privacy`, `/legal/consent`, `/legal/dpa`, `/legal/cookies` (белый список в `server.ts`,
работает на обоих доменах). На них ссылаются футер лендинга, форма регистрации и тексты согласий.
`consumer` — Приложение № 2 к оферте (условия для клиентов, приобретающих Сервис для личных нужд).
Реквизиты исполнителя в разделе 13 оферты нужно заполнить до начала продаж.

Перед выпуском новой редакции обновите версию в тексте страницы **и** в `backend/src/legal.ts`
(`LEGAL`) — записи в `legal_acceptances` ссылаются на редакцию, действовавшую на момент акцепта.

При регистрации отдельный выбор статуса (бизнес / личные нужды) не запрашивается: оферта адресована
лицам, приобретающим Сервис для профессионального использования, поэтому заявлением о цели является
сам факт акцепта. Запись в `legal_acceptances` фиксирует это заявление (`client_type`), редакции
документов, IP и User-Agent. Колонки `client_type` и `consumer_version` создаются идемпотентно в
`init.sql` (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`), отдельных действий при деплое не требуется.

## 8a. Вход через Telegram (Login Widget)

Отдельный бот для авторизации операторов/админов в панели (не путать с ботами клиентов из п. 8):

1. Создайте бота в BotFather и задайте ему **Login Domain** = домен панелей
   (`APP_DOMAIN`, например `app.sct.chat`): /mybots → Bot Settings → Login Domain.
   Без этого виджет покажет ошибку авторизации.
2. В `deploy/.env` задайте:
   - `TELEGRAM_LOGIN_BOT_TOKEN` — токен бота из BotFather;
   - `TELEGRAM_LOGIN_BOT_USERNAME` — username бота без `@`.
3. Пересоздайте контейнер: `docker compose --env-file deploy/.env -f docker-compose.prod.yml up -d`.
4. Проверка: `curl https://<APP_DOMAIN>/auth/telegram/config` → `{"enabled":true,"botUsername":"..."}`.

Пока переменные не заданы, фича деградирует мягко: кнопки Telegram на страницах входа/регистрации
скрыты, `/auth/telegram/login` отвечает 503. Ротация токена — заменить значения в `deploy/.env`
и пересоздать контейнер; сессии операторов не зависят от токена.

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
