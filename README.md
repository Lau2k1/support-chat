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
├── deploy/                  # Caddyfile, .env.example, backup.sh, README.deploy.md
├── docker-compose.yml       # dev: postgres
├── docker-compose.prod.yml  # prod: app + postgres + caddy
└── PLAN.md                  # план работ и статус
```

## Тесты (смоук)

```bash
cd backend
node test/ws-smoke.cjs          # WS: токены, рассылки, назначение оператора
node test/fixes-smoke.cjs       # багрепорт №1: FK-удаление, теги, фильтр дат, валидация
node test/features-smoke.cjs    # пакет №2: webhook, назначение, public_code, теги
node test/crm-smoke.cjs         # CRM: роли, квоты, инвайты
```

## Деплой

Прод-развёртывание (VPS, Caddy + Let's Encrypt, бэкапы) — см. `deploy/README.deploy.md`.
Кратко: `git pull` → `docker compose --env-file deploy/.env -f docker-compose.prod.yml up -d --build`.
Схема БД применяется автоматически при старте контейнера (идемпотентно).

## Документация

- `PLAN.md` — текущий план работ и статус выполнения.
- `backend/.env.example` — все переменные окружения бэкенда.
- `deploy/README.deploy.md` — пошаговый деплой.
