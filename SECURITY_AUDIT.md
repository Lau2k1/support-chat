# Аудит безопасности — support-chat

> Роль: senior / архитектор по безопасности.
> Дата: 11.10.2026. HEAD: `76d8768`.
> Охват: backend (Express 5 + WS), frontend (React 19), виджет, Telegram-интеграция,
> схема БД, Docker/Caddy, прод-конфигурация и зависимости.
> Методика: чтение кода, проверка конфигурации, `npm audit`, инспекция прода
> (порты, заголовки, гейты авторизации), без эксплуатационных атак на прод.

Итоговая оценка: **базовая безопасность на хорошем уровне** (параметризованный SQL,
tenant-изоляция, перепроверка пользователя по БД на каждом запросе, шифрование
токенов ботов, HSTS/nosniff, порты БД закрыты). Но есть **два серьёзных канала
(XSS → угон сессии оператора и disk-DoS через загрузку до аутентификации)**, плюс
набор средних/низких замечаний и устаревшие зависимости.

---

## 1. Критично / Высоко

### VULN-01 (Критично) Stored XSS через файлы из Telegram → угон JWT оператора
**Где:**
- `backend/src/services/telegram.ts:120-130` — `downloadTelegramFile()` сохраняет файл как
  `uuid + path.extname(originalName)`, где расширение берётся из
  `msg.document.file_name` / `msg.audio.file_name` / `msg.video.file_name` (строки `170-184`).
  Фильтра расширений нет.
- `backend/src/server.ts:64` — `/uploads` раздаётся `express.static` (тип определяется по расширению).
- `backend/src/server.ts:33-37` — helmet с `contentSecurityPolicy: false` (CSP отсутствует).
- `frontend-react/src/components/chat/MessageList.tsx:93,97` — файл открывается как
  `window.open(file_url)` и `<a href={file_url} target="_blank">`.

**Атака:** любой пользователь Telegram пишет боту тенанта документ с именем
`pwn.html` (или `x.svg`). Файл сохраняется как `/uploads/<uuid>.html` и отдаётся с
`Content-Type: text/html`. Оператор нажимает на вложение → сценарий исполняется в
origin `sct.chat` → читает `localStorage.getItem('token')` (JWT оператора) и
отправляет наружу → **полный захват аккаунта оператора** (и, при админе, тенанта).
CSP нет, `X-Content-Type-Options: nosniff` от этого не защищает.

Аналогичный путь по `/upload` закрыт (список разрешённых расширений), но путь
Telegram — нет.

**Рекомендации (приоритет 1):**
1. В `downloadTelegramFile` применить allowlist расширений (как в `upload.ts`), а лучше
   **не сохранять расширение клиента вовсе** — хранить как `.bin`.
2. Раздавать `/uploads` **только** с безопасным типом и принудительным скачиванием:
   для не-image — `Content-Type: application/octet-stream` + `Content-Disposition: attachment`
   (отдельный контроллер-роут вместо `express.static`). Изображения отдавать через
   отдельный эндпоинт с проверкой magic-bytes и заголовком `Content-Disposition: inline`.
3. Включить строгую CSP (`helmet.contentSecurityPolicy`) с `object-src 'none'`,
   `frame-ancestors` по доменам панели, `script-src 'self'`, `style-src 'self' 'unsafe-inline'` (MUI/emotion).
4. Перенести токен сессии из `localStorage` в `HttpOnly` cookie (или short-lived access + refresh) — тогда даже при XSS токен недоступен.

### VULN-02 (Высоко) Неконтролируемая запись файлов на диск до аутентификации (DoS)
**Где:** `backend/src/routes/upload.ts:49` — `router.post('/upload/:chatId', upload.single('file'), ...)`.
Multer сохраняет файл на диск **до** `resolveCaller()` и проверки чата (строки `58-69`).
Файл не удаляется и при 401/403/404; очистки «сирот» нет.

**Атака:** аноним шлёт файлы (до 10 МБ) — лимит `uploadLimiter` 30/мин на IP
(`server.ts:52`), т.е. ~300 МБ/мин с одного IP, и с ботнета — быстрее. Диск VPS
забивается → отказ сервиса и БД. Дополнительно у multer в зависимостях есть
DoS-уязвимости (см. §5).

**Рекомендации:**
1. Выполнять аутентификацию/проверку чата **до** multer (вынести в middleware перед `upload.single`).
2. Удалять файл при неуспешной авторизации; завести TTL-очистку файлов без сообщения.
3. Хранить загрузки вне образа и следить за квотой; обновить `multer`.

### VULN-03 (Высоко) WebSocket: нет проверки Origin, нет ограничения размера кадра, нет heartbeat
**Где:** `backend/src/server.ts:86` — `new WebSocketServer({ server })` (по умолчанию
`maxPayload` ~100 МБ, Origin не проверяется). `backend/src/ws/handler.ts:137-176` —
`init_chat` **без аутентификации** создаёт чат для любого тенанта (при наличии онлайн-оператора).

**Риск:**
- Нет проверки `Origin` → сторонний сайт может открыть `wss://sct.chat` и вызвать
  `init_chat` для любого slug (спам-чаты, засорение панели, рост БД; также
  зондирование «онлайн ли операторы»). CORS WebSocket не защищает.
- Кадр до ~100 МБ без лимита → расход памяти.
- Нет ping/pong → «мёртвые» соединения накапливаются в памяти.

**Рекомендации:** задать `maxPayload` (например, 64 КБ для сигналинга),
`verifyClient`/проверку `Origin` по allowlist (CORS_ORIGINS), heartbeat (ping/pong),
лёгкий rate-limit на `init_chat` по IP.

---

## 2. Средне

### VULN-04 (Средне) Слабые пароли и дефолты сидирования
- `backend/src/utils/validate.ts:11` — минимум 6 символов, без требований к сложности.
- `backend/src/db/seed.ts:12,16,71` — дефолт `admin123`, если `ADMIN_PASSWORD`/`TENANT_ADMIN_PASSWORD` не заданы.
- На проде `ADMIN_PASSWORD` задан (len 20), `TENANT_ADMIN_*` пусты — хорошо, но защита держится на конфиге, а не на коде.
**Реком.:** минимум 8–12, проверка на топ-пароли, «сломать» сборку/сид без явного пароля в prod (`NODE_ENV=production`).

### VULN-05 (Средне) Токены ботов расшифровываются ключом-фолбэком `JWT_SECRET`
`backend/src/services/telegram.ts:27` — `TELEGRAM_TOKEN_KEY || JWT_SECRET`.
На проде отдельный ключ задан (len 64). Риск: ротация `JWT_SECRET` сделает
сохранённые токены нерасшифровываемыми; в dev ключи не изолированы.
**Реком.:** в production требовать `TELEGRAM_TOKEN_KEY` явно (иначе — ошибка старта), без фолбэка.

### VULN-06 (Средне) Контейнер работает под root, нет host-firewall
- `backend/Dockerfile:31-51` — нет `USER`; процесс root внутри контейнера.
- Прод: `ufw` inactive, `iptables -P INPUT ACCEPT`, правил нет. Сейчас спасает только
  Docker network isolation (3000/5432 наружу закрыты — проверено), но это отсутствие
  «defense in depth».
**Реком.:** добавить непривилегированного пользователя в образ; включить ufw (только 22/80/443)
или nftables.

### VULN-07 (Средне) Зависимости с известными уязвимостями
`npm audit`:
- backend: 5 (1 critical, 2 high, 1 moderate, 1 low) — `proxy-addr` (critical, IP spoofing),
  `multer` (high, несколько DoS), `ws` (high, uninitialized memory + memory-exhaustion DoS),
  `qs`, `body-parser`.
- frontend: 4 (3 high, 1 low) — `axios` (много advisories), `react-router`/`react-router-dom`
  (open redirect / CSRF / DoS), `form-data` (CRLF injection).
**Реком.:** поднять зависимости (`npm audit fix`, затем `npm ci` и сборка), проверить,
что `ws`/`multer` обновились; для фронта пересобрать и передеплоить.

### VULN-08 (Средне) Пробелы в rate-limit
Ограничены только `/login`, `/register` (20/15 мин) и `/upload` (30/мин).
Глобального лимита и лимитов на `/messages/:chatId`, `/chat-status/:id`, WS — нет.
`trust proxy = 1` выставлен корректно (реальный IP клиента = последний хоп Caddy),
поэтому подделка `X-Forwarded-For` через один прокси не проходит.
**Реком.:** общий лимит на API и на «горячие» эндпоинты; лимит на создание чатов.

### VULN-09 (Средне) Размер файлов из Telegram не ограничен
`backend/src/services/telegram.ts:120-129` — `arrayBuffer()` целиком в память + запись на
диск без лимита.
**Реком.:** ограничить размер (напр. 20 МБ) и стримить, а не буферизовать целиком.

### VULN-10 (Средне) Бэкапы лежат на том же сервере и не зашифрованы
`deploy/backup.sh:11,23-28` — дампы БД и архивы загрузок в `/root/support-chat-backups`
на том же VPS; в дампе — хэши паролей и (зашифрованные) токены ботов. В скрипте есть
комментарий «уносить с сервера», но автоматизации нет.
**Реком.:** выгрузка в объектное хранилище (rclone/S3), шифрование архивов, отдельные креды.

---

## 3. Низко

- **VULN-11. Enrollment/тайминг на логине.** `routes/auth.ts:19` — при отсутствии
  пользователя `bcrypt.compare` не вызывается → различимый тайминг для перебора email.
  Реком.: сравнивать с фиктивным хэшем.
- **VULN-12. `/chat-status/:id` без авторизации** (`routes/chat.ts:119-122`) — перечисление
  существования/статуса чатов. Реком.: ограничить или убрать.
- **VULN-13. JWT: не зафиксирован алгоритм.** `middleware/auth.ts:64` — `jwt.verify(token, SECRET)`
  без `algorithms: ['HS256']`. На практике безопасно (v9 не принимает `none`), но лучше зафиксировать.
- **VULN-14. Демotion равного админа.** `routes/admin.ts:117-144` (`/operators/:id/role`) не
  запрещает тенант-админу понизить другого админа своего тенанта (в `toggle`/`delete` такой
  запрет есть). Реком.: согласовать правило.
- **VULN-15. Клиентский токен в query.** `routes/chat.ts:99`, `upload.ts:37` — `?token=` попадает
  в логи/историю. Реком.: только заголовок `X-Client-Token`; короче TTL.
- **VULN-16. Роль/статус — из JWT, но перепроверяются в БД** (это плюс), однако TTL 12 ч без
  refresh/revoke-листа (есть `token_version` — хорошо).
- **VULN-17. Инвайт-коды: 6 байт** (`routes/admin.ts:246`) ≈ 48 бит; brute-force сдерживается
  только rate-limit логина. Реком.: 8+ байт.
- **VULN-18. `TELEGRAM_API_BASE` из env** (`services/telegram.ts:19`) — при компрометации env
  можно увести Bot API на чужой хост. Низко.
- **VULN-19. Сообщения об ошибках Telegram с деталями** (внутренние пути) показываются
  операторам в note (`services/telegram.ts:313-331`). Низко.

---

## 4. Инфраструктура и прод (факты проверки)

- Наружу открыты только **22, 80, 443**. `3000` и `5432` недоступны извне (Docker network). ✅
- `docker ps`: `support-chat-app` (3000 только внутренний), `support-chat-db` (5432 внутренний),
  `support-chat-caddy` (80/443). ✅
- Заголовки: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN`, `Cross-Origin-Opener-Policy`. ✅
  **CSP отсутствует** (см. VULN-01).
- Гейты без токена возвращают 401: `/admin/operators`, `/superadmin/tenants`, `/chats`;
  `POST /api/tg/3` без секрета → 401. ✅
- `.env`/`deploy/.env` **не в git** (в индексе только `*.env.example`). ✅
- Секреты на проде заданы: `JWT_SECRET` (96), `TELEGRAM_TOKEN_KEY` (64),
  `POSTGRES_PASSWORD` (28), `ADMIN_PASSWORD` (20). ✅
- `X-Frame-Options: SAMEORIGIN` конфликтует с документацией встраивания виджета
  (README «Вариант 1 — iframe»), а скриптовый вариант не работает кросс-доменно, т.к.
  виджет использует `window.location.host` для WS. Т.е. кросс-сайтовое встраивание
  сейчас фактически не работает; «починка» потребует ослабить framing/CORS — делать
  аккуратно, через `frame-ancestors` только для домена клиента и отельного CORS-origin.

---

## 5. Что сделано хорошо (подтверждено)

- Все SQL-запросы параметризованы — **SQL-инъекций не найдено**.
- Мультитенантная изоляция: каждый REST-роут и `chatAccess` в WS проверяют `tenant_id`;
  суперадмин выделен в отдельный неймспейс `/superadmin`.
- `resolveOperator` перечитывает пользователя из БД (`is_enabled`, `token_version`) на
  каждый запрос — отзыв сессии мгновенный.
- Шифрование токенов ботов AES-256-GCM с `v1`-версией и IV/AuthTag. ✅
- Telegram webhook: сравнение секрета, 404 для неактивных ботов, всегда 200 (нет retry-storm). ✅
- `helmet`, CORS с allowlist, `trust proxy = 1` настроены осмысленно.
- Пароли — bcrypt (10). `canned-responses` скоупится по `operator_id` (нет IDOR). ✅
- Обобщённые 500 «DB Error» — детали наружу не утекают. ✅
- Валидация входных данных централизована (`utils/validate.ts`), лимиты сообщений/полей. ✅

---

## 6. План исправлений (приоритеты)

1. **VULN-01** — allowlist/`.bin` для Telegram-файлов + раздача `/uploads` как attachment +
   CSP + вынести токен из localStorage. *(критично)*
2. **VULN-02** — auth перед multer, очистка файлов, обновить `multer`. *(высоко)*
3. **VULN-03** — Origin-проверка, `maxPayload`, heartbeat, rate-limit `init_chat`. *(высоко)*
4. **VULN-07** — поднять зависимости backend/frontend и пере-собрать/задеплоить. *(высоко)*
5. **VULN-04…06, 08-10** — парольная политика, отдельный ключ Telegram, non-root контейнер,
   ufw, размер файлов TG, оффсерверные шифрованные бэкапы. *(средне)*
6. **VULN-11…19** — гигиена (низко), закрывать по мере касания соответствующих модулей.

> Примечание: мониторинг/алерты (раздел 12 `PLAN.md`) помогут быстрее замечать
> аномалии (всплеск загрузок, рост БД, ошибки вебхука), но не заменяют исправления выше.
