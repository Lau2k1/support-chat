# SupportChat

Мультитенантная платформа онлайн-чата поддержки (SaaS): клиенты пишут через встраиваемый виджет
или Telegram-бота, операторы отвечают из панели, владелец управляет клиентами-тенантами.

## Стек

- **Backend** — Node.js 22, Express 5, TypeScript, WebSocket (`ws`), PostgreSQL 16 (`pg`).
- **Frontend** — React 19, TypeScript, Vite, MUI, Zustand (операторская панель + виджет).
- **Инфраструктура** — Docker Compose (dev: postgres; prod: app + postgres + Caddy/TLS).
- **Аутентификация** — JWT (`JWT_SECRET`), три роли: `superadmin` → `admin` (тенант) → `operator`.

## Возможности

- Мультитенантность через `tenant_id` (изоляция данных внутри одного Postgres).
- Встраиваемый виджет (`data-tenant="<slug>"`) и Telegram-бот (отдельный @bot на тенанта).
- Вход по email+паролю или через Telegram (Login Widget); забытый пароль
  восстанавливается через Telegram на `/recover` — одноразовая ссылка на 10 минут
  (почтовой рассылки на платформе нет).
- Операторы: quick replies (по категориям), теги, передача чата, распределение чатов,
  режим наблюдателя, архив, статистика.
- CRM владельца: тенанты, лимиты мест, инвайты, метрики платформы.
- AES-шифрование токенов Telegram-ботов; rate-limit, helmet; авто-закрытие чатов по таймауту.

## Быстрый старт (dev)

Требуется: **Node.js 22+** и **Docker**.

```bash
# 1) Переменные окружения
cp .env.example .env                 # креды Postgres для docker-compose
cp backend/.env.example backend/.env # DB/JWT/seed-переменные бэкенда

# 2) Postgres
docker compose up -d                 # поддержит контейнер support-chat-db (хост-порт 5433)

# 3) Backend
cd backend
npm install
npm run migrate                      # применяет src/db/schema/init.sql (идемпотентно)
npm run seed                         # создаёт суперадмина и демо-тенант
npm run dev                          # http://localhost:3000 (ts-node-dev, авто-рестарт)

# 4) Frontend (в отдельном терминале)
cd frontend-react
npm install
npm run dev                          # http://localhost:5173 (Vite, проксирует API/WS на :3000)
```

Откройте http://localhost:5173. Dev-доступы задаются переменными seed (по умолчанию
`ADMIN_EMAIL=admin@test.com` / `ADMIN_PASSWORD=admin123`). **Смените пароли перед прод-сидом.**

## Роли и панели

| Маршрут    | Панель             | Роль                     |
| ---------- | ------------------ | ------------------------ |
| `/login`   | Вход / регистрация | —                        |
| `/operator`| Панель оператора   | `operator` и выше        |
| `/admin`   | Админка тенанта    | `admin` (тенант)         |
| `/crm`     | CRM владельца      | `superadmin`             |
| `/widget`  | Виджет для встраивания | — (клиент)           |

Роль определяется из JWT (`tid`, `role`); жёсткое разделение «снизу вверх»: оператор → админ тенанта → владелец.

## Встраивание виджета

Виджет — отдельная страница `widget.html` (собирается вместе с панелями). Тенант задаётся
параметром `?tenant=<slug>` в URL или атрибутом `data-tenant` на теге скрипта.

**Вариант 1 — iframe (рекомендуется):**

```html
<iframe
  src="https://sct.chat/widget.html?tenant=acme"
  title="Чат поддержки"
  style="position:fixed;right:20px;bottom:20px;width:380px;height:620px;border:0;z-index:9999"
></iframe>
```

`acme` — это `slug` тенанта из CRM владельца.

> **Важно (SEC-19):** встраивание в iframe разрешено только с доменов, указанных в настройках
> тенанта `widget_origins` (панель админа → Настройки → «Домены для встраивания виджета»,
> по одному URL на строку). Панели защищены `frame-ancestors 'self'`; для `/widget.html`
> сервер подставляет список доменов тенанта в `frame-ancestors`. Пустой список = только `'self'`.
> `X-Frame-Options` больше не используется (его заменяет CSP `frame-ancestors` со списком доменов).

**Вариант 2 — модуль в своей разметке** (нужен свой контейнер; домен сайта — в `CORS_ORIGINS`
и в `widget_origins` тенанта):

```html
<div id="widget-root"></div>
<script type="module" src="https://sct.chat/assets/widget-<hash>.js" data-tenant="acme"></script>
```

Актуальное имя файла с хэшем смотрите в `frontend-react/dist/widget.html` после сборки.

> **Ограничение:** script-вариант рассчитан на размещение на том же домене (`window.location.host`
> используется для подключения WS). Для кросс-доменного встраивания используйте вариант 1 (iframe).

## Порты

| Порт | Где          | Назначение                          |
| ---- | ------------ | ----------------------------------- |
| 3000 | backend      | API + WebSocket + раздача статики   |
| 5173 | frontend dev | Vite dev-сервер (проксирует на 3000)|
| 5433 | host         | Postgres из `docker-compose.yml`    |
| 80/443 | prod (Caddy) | HTTPS + WS через reverse-proxy    |

## Структура

```
support-chat/
├── backend/                 # Express + TS + WS
│   ├── src/
│   │   ├── routes/          # REST: auth, chat, upload, admin, superadmin, canned, telegram
│   │   ├── ws/              # WebSocket-обработчик и типы событий
│   │   ├── services/        # chat (комнаты/статусы), telegram
│   │   ├── middleware/      # JWT-авторизация
│   │   ├── db/              # пул, seed, schema/init.sql
│   │   └── utils/           # validate, форматирование
│   ├── test/                # смоук-тесты (ws, crm, fixes, features)
│   └── .env.example
├── frontend-react/          # React + MUI + Vite (панели + виджет)
│   ├── src/{pages,components,stores,hooks,services,types,utils}
│   ├── index.html           # SPA-панели
│   └── widget.html          # виджет
├── landing/                 # маркетинговый лендинг (статика, отдаёт бэкенд)
├── deploy/                  # Caddyfile, .env.example, backup.sh, README.deploy.md
├── docker-compose.yml       # dev: postgres
├── docker-compose.prod.yml  # prod: app + postgres + caddy
└── PLAN.md                  # план работ и статус
```

## Тесты и качество

Юнит-тесты (Vitest) — чистые утилиты, без БД:

```bash
cd backend
npm test                        # vitest run (dateRange, validate)
```

Смоук-тесты (нужен запущенный backend на :3000 и сидированная БД):

```bash
cd backend
node test/ws-smoke.cjs                 # WS: токены, рассылки, назначение оператора
node test/fixes-smoke.cjs              # багрепорт №1: FK-удаление, теги, фильтр дат, валидация
node test/features-smoke.cjs           # пакет №2: webhook, назначение, public_code, теги
node test/crm-smoke.cjs                # CRM: роли, квоты, инвайты
node test/crm-tenant-detail-smoke.cjs  # CRM: скоуп по tenantId, изоляция
node test/e2e.cjs                      # все смоуки подряд
```

Линтер и форматирование (ESLint flat config + Prettier в каждом пакете), запуск из корня:

```bash
npm run lint                    # eslint в backend и frontend-react
npm run format                  # prettier --write
```

> `/login` и `/register` ограничены (по умолчанию 20 запросов / 15 мин на IP). Для полного
> `test/e2e.cjs` поднимите лимит: `AUTH_RATE_LIMIT_MAX=1000 npm run dev`.

## Деплой

Прод-развёртывание (VPS, Caddy + Let's Encrypt, бэкапы) — см. `deploy/README.deploy.md`.
Кратко: `git pull` → `docker compose --env-file deploy/.env -f docker-compose.prod.yml up -d --build`.
Схема БД применяется автоматически при старте контейнера (идемпотентно).

## Документация

- `PLAN.md` — текущий план работ и статус выполнения.
- `backend/.env.example` — все переменные окружения бэкенда.
- `deploy/README.deploy.md` — пошаговый деплой.
