# План исправлений — support-chat

> Активный план работ. Отмечать `[x]` по мере выполнения, добавлять новые пункты по ходу.
> Последнее обновление: 08.10.2026 (по результатам анализа кодовой базы).

---

## 0. Гигиена Git (сделать первым — защита от потери работы)

- [ ] Закоммитить untracked: `frontend-react/` целиком, `backend/src/routes/admin.ts`, `docker-compose.yml`, `.gitignore`
- [ ] Проверить `.gitignore`: `backend/dist/`, `backend/uploads/`, `.env`, `node_modules/`, `frontend-react/dist/`
- [ ] Разобраться с корнем: `package.json` = `{}`, а `package-lock.json` рассинхронизирован → либо удалить корневой lock, либо сделать нормальные npm workspaces
- [ ] Решить судьбу легаси-файлов: `backend/create-db.js` (дублёр compose), `backend/dist/` (устарел)

---

## 1. Безопасность (критично)

### 1.1 WebSocket — привязать chatId к соединению
- [ ] `backend/src/ws/handler.ts`: при `join_chat`/`init_chat` сохранять `ws.chatId`
- [ ] `message`, `close_chat`, `messageRead`, `typingStart/Stop` — брать chatId из `ws.chatId`, а не из payload (строки ~98–109, 200–209)
- [ ] Для оператора проверять, что чат назначен/доступен ему

### 1.2 REST — `/messages/:chatId`
- [ ] `backend/src/routes/chat.ts:90-95`: для открытых чатов тоже требовать валидный JWT (сейчас достаточно любой строки `Authorization`)
- [ ] Скрыт внутренний тип `note` от клиентов без роли оператора

### 1.3 JWT
- [ ] `backend/src/middleware/auth.ts`: добавить `expiresIn` (напр. `12h`) при выдаче в `routes/auth.ts`
- [ ] Убрать fallback-секрет `'dev_fallback_secret'` — при отсутствии `JWT_SECRET` падать с понятной ошибкой
- [ ] При смене роли/отключении оператора — инвалидация (подписывать `role`+`is_enabled` версию или проверять в БД на каждый запрос; минимум — деодноразовый `tokenVersion`)

### 1.4 Прочее
- [ ] `/upload/:chatId`, `/rate/:chatId` — требовать хотя бы `chatId` из cookie/локального токена клиента (сейчас полностью без auth)
- [ ] Добавить `helmet` и `express-rate-limit` (на login/upload)
- [ ] Вынести креды из `docker-compose.yml` в переменные/`.env` (secrets)
- [ ] `seed.ts`: убрать дефолтный пароль админа в лог/код — генерировать или брать из env
- [ ] CORS: вместо `*` по умолчанию — явный список из `CORS_ORIGINS`

---

## 2. Баги интеграции фронт ↔ бэк

- [ ] **`file_message`**: виджет (`src/widget/useWidgetWs.ts:258`) шлёт событие, которого нет в `backend/src/ws/types.ts` → добавить обработку на сервере + broadcast (и в REST `routes/upload.ts` после сохранения файла)
- [ ] **Фильтр тегов архива**: фронт шлёт `tagId[]=1&tagId[]=2`, Express 5 (`query parser: 'simple'`) не парсит массивы → читать сырой query или передавать `tagId=1,2` (`routes/chat.ts:36`, `OperatorDashboard.tsx:220`)
- [ ] **`init_operator` после F5**: `operator_join` не триггерит список чатов (гонка `ws.operatorStatus === 'online'` vs переход `offline→online`, `handler.ts:55,159`) → при первом `operator_join` всегда слать `init_operator`
- [ ] **Вставка шаблона**: `OperatorDashboard.tsx:120-122` пишет через `document.querySelector` в контролируемый `TextField` → передавать контент в `ChatInput` через state/callback
- [ ] **Даты инвайтов «—»**: `utils/format.ts:7` — `new Date(Number(ts))` на ISO-строке → поддержать ISO-строки
- [ ] **Реконнект WS**: `services/ws.ts` — `intentionalClose` не сбрасывается в `connect()` → сбрасывать при новом подключении (login без F5)
- [ ] **`chat_timeout_minutes` из админки**: `services/chat.ts:93` читает только env → читать из таблицы `settings` (или убрать настройку из UI)

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

## 7. Мультитенантность (SaaS: 5 клиентов × ~3 оператора)

> Цель: один инстанс, 5 организаций-клиентов со своими операторами и чатами.
> Изоляция — через `tenant_id` в строках БД (не отдельные БД/контейнеры).

### 7.1 Схема БД
- [ ] Новая таблица `tenants` (id, name, status, created_at)
- [ ] `tenant_id` добавить в: `operators`, `chats`, `tags`, `settings`, `invite_codes` (+FK, индексы)
- [ ] `messages` — через `chats.tenant_id` (прямой FK не обязателен, но проверить все выборки)
- [ ] Обновить `init.sql` + написать SQL-скрипт миграции существующих данных (или решить, что данных нет)

### 7.2 Роли и доступ
- [ ] Три уровня: **superadmin** (ты, глобальный доступ) → **tenant-admin** (клиент: свои операторы/инвайты/настройки/статистика) → **оператор**
- [ ] `middleware/auth.ts`: `authMiddleware` + проверка принадлежности ресурса тенанту; `adminMiddleware` → раздельные `tenantAdminMiddleware` / `superAdminMiddleware`
- [ ] При регистрации/инвайте оператора — привязка к тенанту invite-кода

### 7.3 Бэкенд: скоупинг всех запросов
- [ ] REST: каждый маршрут фильтрует по `req.user.tenantId` (chats, messages, canned-responses, tags, stats, settings)
- [ ] `/admin/*` — переименовать/разделить: `/tenant/*` (ресурсы тенанта) и `/superadmin/*` (управление тенантами)
- [ ] `invite_codes`: создание tenant-admin'ом своего тенанта; superadmin — CRUD тенантов
- [ ] WS: `operator_join`, `init_operator`, `new_chat`, `operators_status`, `transfer_chat` — рассылка только внутри тенанта (Map keyed by tenantId)
- [ ] `services/chat.ts`: in-memory реестр скоупить по tenantId (Set операторов → Map<tenantId, Set>)
- [ ] `settings` (welcome_message, chat_timeout) — per-tenant

### 7.4 Фронтенд
- [ ] `authStore`: хранить tenantId/tenantRole из JWT
- [ ] `AdminPanel` — для tenant-admin видит только свои данные; отдельный супер-админ UI (тенанты, их статистика)
- [ ] Виджет: передавать tenantId (через snippet/поддомен/`data-tenant-id`) — определить способ идентификации клиента на странице его сайта
- [ ] Скоупить загрузку тегов/кан-ответов/операторов по тенанту

### 7.5 Идентификация тенанта в виджете (выбрать один вариант)
- [ ] Вариант 1: отдельный поддомен клиента (`chat.client-a.ru`) — Host-заголовок → тенант (рекомендуется при наличии поддоменов)
- [ ] Вариант 2: `<script data-tenant="...">` в сниппете встраивания
- [ ] Вариант 3: path (`/t/client-a/...`)

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
