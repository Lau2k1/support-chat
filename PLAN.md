# План исправлений — support-chat

> Активный план работ. Отмечать `[x]` по мере выполнения, добавлять новые пункты по ходу.
> Последнее обновление: 08.10.2026 (по результатам анализа кодовой базы).

---

## 0. Гигиена Git (сделать первым — защита от потери работы) ✅

- [x] Закоммитить untracked: `frontend-react/` целиком, `backend/src/routes/admin.ts`, `docker-compose.yml`, `.gitignore` (4 коммита: chore / backend / frontend / docs)
- [x] Проверить `.gitignore`: `dist/`, `uploads/`, `.env`, `**/.env`, `node_modules/` игнорируются (подтверждено `git check-ignore`)
- [x] Корень: удалён рассинхронизированный `package-lock.json` + корневой `node_modules` (package.json остаётся `{}`); npm workspaces — опционально позже
- [ ] Решить судьбу легаси: `backend/create-db.js` (закоммичен как есть, дублирует compose — кандидат на удаление), `backend/dist/` (в .gitignore, но устарел — пересобрать)
- [ ] (опц.) Добавить `.gitattributes` (`* text=auto eol=lf`) — убрать CRLF-шум в предупреждениях git
- [ ] Запушить локальные коммиты в `origin/main` (сейчас 4 коммита впереди)

---

## 1. Безопасность (критично) ✅

### 1.1 WebSocket — привязать chatId к соединению ✅
- [x] `backend/src/ws/handler.ts`: при `join_chat`/`init_chat` сохранять `ws.chatId`
- [x] `message`, `close_chat`, `messageRead`, `typingStart/Stop` — клиенты используют только `ws.chatId`; операторы — payload id (валидируется), строки ~98–109, 200–209
- [x] Для повторного `join_chat` клиентом введён **client_token** (UUID, выдаётся при `chat_created`) — без него переподключение/чтение чужих чатов невозможны (колонка `chats.client_token` + уникальный индекс)
- [x] `removeConnection` чистит сокет из всех комнат (не только `ws.chatId`)
- [x] Sмоук-тест `backend/test/ws-smoke.cjs` (12/12): сценарии токенов, рассылки, файлов

### 1.2 REST — `/messages/:chatId` ✅
- [x] `backend/src/routes/chat.ts`: валидный JWT оператора **или** `client_token` (query/header `X-Client-Token`) — иначе 401
- [x] Заметки `note` видны только оператору (проверка по факту роли, а не «есть header»)

### 1.3 JWT ✅
- [x] `backend/src/middleware/auth.ts`: `expiresIn` (env `JWT_EXPIRES_IN`, по умолчанию 12h)
- [x] Убран fallback-секрет `'dev_fallback_secret'` — без `JWT_SECRET` сервер не стартует (явная ошибка)
- [x] `token_version` (колонка `operators.token_version`): смена роли/отключение в админке инвалидирует выданные токены; `resolveOperator` сверяет с БД при каждом запросе/WS-auth

### 1.4 Прочее ✅
- [x] `/upload/:chatId`, `/rate/:chatId` — операторский JWT или client_token (`routes/upload.ts` → `resolveCaller`)
- [x] Установлены и включены `helmet` + `express-rate-limit` (login/register/upload лимиты в `server.ts`)
- [x] Креды вынесены из `docker-compose.yml` в root `.env` (gitignored) + закоммичен `.env.example`
- [x] `seed.ts`: пароль админа из `ADMIN_PASSWORD`, предупреждение при дефолте
- [x] CORS: в production без `CORS_ORIGINS` — только same-origin + warning (иначе виджет не встроить) 
- [x] Заодно: SQL-интерполяция `CHAT_TIMEOUT_MINUTES` → параметр (`services/chat.ts:99`)

---

## 2. Баги интеграции фронт ↔ бэк ✅

- [x] **`file_message`**: решено иначе и лучше — бродкаст делает сам сервер в `routes/upload.ts` после INSERT в БД (строка из БД, а не от клиента → `file_url` нельзя подделать). Виджет больше не шлёт `file_message` (`useWidgetWs.ts`). Заодно починен загрузка файлов оператором — теперь сообщение доходит до клиента (раньше не доходила вообще)
- [x] **Фильтр тегов архива**: `routes/chat.ts:34` — принимает `tagId`, `tagId[]` (формат axios с Express 5 'simple') и `tagId=1,2` (comma-список); проверено вживую 7/7 (все 3 формы + промах)
- [x] **`init_operator` после F5**: уже исправлен в 1.1 (`operator_join` всегда шлёт список). Доп. чистка: убран дубль-отправка списка из `operator_status` (`handler.ts`)
- [x] **Вставка шаблона**: `OperatorDashboard.tsx` больше не пишет в DOM — `ChatInput` получил imperative handle `apiRef.insertTemplate(content)` (append + focus); передаётся через `ChatsView`
- [x] **Даты инвайтов «—»**: `utils/format.ts` — общий парсер `toDate` (число-эпоха | ISO-строка | Date | null/undefined)
- [x] **Реконнект WS**: `services/ws.ts` — `intentionalClose` сбрасывается в начале `connect()` (повторный login без F5)
- [x] **`chat_timeout_minutes` из админки**: `services/chat.ts` — таймер читает `settings.chat_timeout_minutes` каждый цикл, env-переменная — fallback

---

## 3. Недоработки бэкенда

- [ ] `assigned_operator_id` никогда не пишется → писать при назначении и при `transfer_chat` (иначе `/admin/operator-stats`, фильтр `/admin/chats?operator_id` — всегда нули)
- [ ] `client_id = MAX+1` (`ws/handler.ts:70`) → `INSERT ... RETURNING id` (устранение гонки)
- [ ] Пустые `catch {}` → логирование (console/pino)
- [ ] Интерполяция `CHAT_TIMEOUT_MINUTES` в SQL (`services/chat.ts:99`) → параметр
- [ ] Мёртвые колонки: `chats.client_name/client_device/region`, `operators.status` — либо начать использовать, либо удалить из `init.sql`
- [ ] Убрать неиспользуемый `export { upload }` (`routes/upload.ts:109`)
- [ ] Мёртвый endpoint `GET /archive` — либо подключить фронту, либо удалить

---

## 4. Недоработки фронтенда

- [ ] Необработанные WS-события: `chat_created`, `messageRead`, `operators_offline` (оператор), пустой `break` у `chat_transferred` (`hooks/useWebSocket.ts`)
- [ ] Виджет не узнаёт об оффлайне операторов: `operators_status` рассылается только операторам → дублировать в комнату клиента
- [ ] `RightPanel.tsx`: карточки шаблонов с `cursor:pointer` без `onClick`
- [ ] Дубль импорта `MessageList` как `MessageListArchive` (`OperatorDashboard.tsx:25`)
- [ ] `authStore.checkAuth` нигде не вызывается; в JWT нет `exp` (см. 1.3) — после добавления `exp` включить проверку
- [ ] `userId`/`activeChatId` виджета — сейчас `localStorage`, ОК; для оператора после 1.3 проверить `atob`-парсинг

---

## 5. Мёртвый код и зависимости

- [ ] Удалить неиспользуемые пакеты: `@tanstack/react-query` (только провайдер в `main.tsx`), `react-hook-form`, `zod`, `@hookform/resolvers` — либо начать использовать
- [ ] Перенести `@types/*` из `dependencies` в `devDependencies` (`frontend-react/package.json`)
- [ ] Удалить неиспользуемые экспорты: `getChatStatus`, `removeTag`, `rateChat` (операторским UI) — или подключить
- [ ] Проверить `noUnusedLocals/noUnusedParameters` во фронтовом tsconfig — включить

---

## 6. Качество и процесс

- [ ] README в корне: назначение, стек, запуск (`docker compose up -d` → `migrate` → `seed` → `dev`), порты, структура
- [ ] Тесты: минимум — vitest/jest на критичные места (auth middleware, ws handler — 1.1, `routes/chat.ts` фильтры)
- [ ] ESLint + Prettier во фронт (сейчас нет вообще) и бэк (есть eslint? проверить)
- [ ] Скрипты-обёртки в корне (`dev`, `build`, `migrate`) или npm workspaces
- [ ] `.env.example` в `backend/` (имена переменных без значений)
- [ ] E2E-смоук: поднять стек, прогнать сценарий «клиент открыл чат → оператор ответил → файл → закрытие»

---

## 7. Мультитенантность (SaaS: 5 клиентов × ~3 оператора) ✅

> Изоляция — через `tenant_id` в строках БД (не отдельные БД/контейнеры).
> Суперадмин не принадлежит тенанту (tenant_id NULL) и видит всё (может «запрыгивать» в любой чат).

### 7.1 Схема БД
- [x] Таблица `tenants` (id, slug UNIQUE, name, status 'active'|'suspended', created_at)
- [x] `tenant_id` добавлен в: `operators`, `chats`, `tags`, `settings`, `invite_codes`, `canned_responses` (+FK, индексы; `settings` — составной PK `(tenant_id, key)`)
- [x] `messages` — через `chats.tenant_id` (все выборки скоуплены через чат)
- [x] `init.sql` обновлён (idempotентно); бэкфилл старых строк + смена PK `settings` — в `seed.ts` (порядок: migrate → seed); уникальность тегов per-tenant (`(tenant_id, name)`)

### 7.2 Роли и доступ
- [x] Три уровня: **superadmin** (глобально) → **admin** (tenant-admin) → **operator**
- [x] `middleware/auth.ts`: JWT несёт `tid`; `resolveOperator` возвращает `tenantId`; `adminMiddleware` заменён на `tenantAdminMiddleware` / `superAdminMiddleware`
- [x] Регистрация оператора привязывается к тенанту invite-кода (`register` берёт `invite.tenant_id`)

### 7.3 Бэкенд: скоупинг всех запросов
- [x] REST: `/chats`, `/messages`, `/upload`, `/rate`, `/stats`, `/stats/daily`, `/canned-responses`, `/archive`, теги — фильтр по `req.user.tenantId` (superadmin — без фильтра); оператор не может читать чат чужого тенанта
- [x] `/admin/*` остались как есть (скоуплены), добавлены `/superadmin/tenants` (CRUD + вкл/выкл; suspend также отключает операторов тенанта). Решено не переименовывать `/admin` → `/tenant` — меньше правок фронта, цель разделения полномочий достигнута
- [x] `invite_codes`: tenant-admin создаёт только для своего тенанта; superadmin — для любого (`tenantId` в body)
- [x] WS: `operator_join`/`init_operator`/`new_chat`/`operators_status`/`transfer_chat` рассылаются только внутри тенанта; оператор не может зайти в чат чужого тенанта (`chatAccess`)
- [x] `services/chat.ts`: `Map<tenantId, Set<ClientWs>>`, superadmin в группе 0 и доступен всем тенантам
- [x] `settings` per-tenant; авто-закрытие чатов читает таймаут каждого тенанта из `settings` (env — fallback)

### 7.4 Фронтенд
- [x] `authStore`: `tenantId`, `isSuperadmin`, `isAdmin` (admin|superadmin) из JWT
- [x] `AdminPanel`+`AdminSideNav`: страница «Тенанты» (TenantsPage) только у superadmin; остальное скоуплено сервером
- [x] Виджет передаёт тенант: `init_chat { tenant: data-tenant }` (см. 7.5)
- [x] Теги/кан-ответы/операторы скоуплены по тенанту (серверная фильтрация; демо-тенант в сиде)

### 7.5 Идентификация тенанта в виджете
- [x] **Вариант 2 выбран**: `<script ... data-tenant="acme">` в сниппете встраивания. Виджет читает `document.querySelector('script[data-tenant]')` и шлёт slug в `init_chat`. Поддомены (вариант 1) можно добавить позже как альтернативу
- [ ] (отложено) README/документация сниппета встраивания для клиентов (раздел 6)

---

## 8. Деплой на VPS/VDS

**Целевая конфигурация (5 клиентов, 15 операторов, ~30 активных чатов):**
- VPS: **2 vCPU / 2–4 ГБ RAM / 20–30 ГБ SSD**, Ubuntu 24.04, ~5–10$/мес
- Стек: `docker compose` → `app` (backend+статика фронта) + `postgres:16` + `caddy` (TLS)
- Порты наружу: **80/443** (+22). 3000/5433 — только внутри compose-сети
- Нагрузка при этих цифрах: ~50–80 WS-соединений, <100 КБ/с трафика — запас колоссальный

- [ ] `Dockerfile` для backend (multi-stage: build TS → node slim runtime)
- [ ] Сборка фронта (`npm run build`, два бандла index+widget) → копия в образ или CI-артефакт; раздача бэкендом (уже есть catch-all) **или** отдельный nginx
- [ ] `docker-compose.prod.yml`: app + postgres + caddy, restart policies, healthchecks, volumes для БД и `uploads/`
- [ ] Секреты через `.env` на сервере (не коммитить), `JWT_SECRET` — длинный случайный, пароли БД — сгенерированные
- [ ] TLS: Caddy с авто Let's Encrypt (WS работает через прокси из коробки)
- [ ] Файрвол: открыты 80/443/22; 5433/3000 наружу не пробрасывать
- [ ] Бэкапы: cron `pg_dump` + архив `uploads/` (хранить вне сервера), ретенция ≥ 7 дней
- [ ] Логирование (Docker json-file + rotation) и мониторинг (uptime-пинг, рестарт по healthcheck)
- [ ] Домены: основной + поддомены клиентов (если выбран вариант с поддоменами из 7.5)

---

## 9. Telegram-бот интеграция (клиенты клиента пишут в бота → ответы из панели)

> Зависит от раздела 7 (мультитенантность): бот принадлежит тенанту.
> Модель: **отдельный @bot на каждого тенанта** (white-label + однозначная привязка входящих сообщений).

### 9.1 Схема БД
- [ ] Таблица `telegram_bots`: id, tenant_id (FK), bot_token (шифрованный AES, ключ из env), bot_username, is_active, created_at
- [ ] `chats`: колонки `source ('widget'|'telegram')` и `external_id` (tg user/chat id) + индекс `(source, external_id)`
- [ ] (по желанию) `telegram_users`: tg_user_id, tenant_id, имя/username — для отображения клиента

### 9.2 Бэкенд — входящий поток
- [ ] Webhook-роут `POST /api/tg/:botId` (или `/api/telegram/webhook/:botId`) — валидация `X-Telegram-Bot-Api-Secret-Token`, 404 для неактивных ботов
- [ ] Адаптер входящих апдейтов: text, photo, document, sticker (базовый набор) → нормализация в наш `messages`
- [ ] Логика чата: найти/создать `chats` по `(tenant_id, external_id, source='telegram')`, статус open → транслировать `new_chat` операторам тенанта
- [ ] Затем — обычное WS-событие `message` с chatId (панель показывает без изменений)

### 9.3 Бэкенд — исходящий поток
- [ ] При WS-ответе оператора на чат `source='telegram'` → Bot API `sendMessage`/`sendPhoto`/`sendDocument`
- [ ] Файлы от оператора: загрузка в `uploads/` (уже есть) → отправка в TG multipart'ом
- [ ] Файлы из TG: `getFile` → скачивание → сохранение в `uploads/`, `file_url` как обычно
- [ ] Ошибки TG (бот заблокирован, таймаут) → статус чата/уведомление оператору, retry-политика простая

### 9.4 Фронтенд
- [ ] Админка тенанта: страница «Telegram-бот» — ввод токена (BotFather), отображение @username, инструкция «как добавить бота клиенту», вкл/выкл
- [ ] Бейдж источника «Telegram» в списке чатов и шапке переписки
- [ ] superadmin: обзор всех подключённых ботов

### 9.5 Выбор транспорта
- [x] **Webhook** (решено: нужен публичный HTTPS — он всё равно будет по разделу 8)
- Альтернатива (long polling) — только если деплой откладывается: не требует публичного URL, но масштабируется хуже

---

## Порядок работ (рекомендуемый)

1. **Git-гигиена** (раздел 0) — сразу, до любых правок
2. **Безопасность** 1.1–1.3 — критичные дыры
3. **Баги интеграции** 2 (по порядку: file_message → теги → init_operator → остальное)
4. **Мультитенантность** 7 — ядро SaaS-модели, делать до набора клиентов
5. **Telegram-бот** 9 — после мультитенантности (привязка к тенанту)
6. **Недоработки** 3–4, затем чистка 5
7. **Процесс** 6 (README, тесты, линтер)
8. **Деплой** 8 — когда пойдут стабильные фичи
