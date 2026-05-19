# AGENTS.md

Этот файл - единый источник правды для coding agents в этом репозитории. Он заменяет отдельные `content.md`, `context.md` и `server.md`; не создавайте новые контекстные файлы без прямой просьбы пользователя.

## Цель Проекта

- PlatonPortal / MainPortal - единый портал сервисов "Гармонии": быстрые переходы, SSO, пользовательские роли, комнаты/V.CALL, страницы инструкций и лендинг Balalayka.
- Держите репозиторий компактным и понятным.
- Текущий стиль архитектуры: простой Node.js monolith с локальными helper-модулями.

## Приоритеты Продукта

- Быстрое выполнение пользовательских действий.
- Удобство в ежедневном использовании.
- Минимум шагов до результата.
- Один понятный workflow без лишних страниц и промежуточных порталов.

## UX Инварианты

- Не увеличивайте число страниц без явной необходимости.
- Основной пользовательский сценарий должен укладываться в минимальное практичное число действий.
- Для админских задач по пользователям основной экран - `/users`; улучшайте его как рабочее пространство, а не добавляйте отдельный слой навигации.
- Предпочитайте быстрые интерактивные правки в текущем интерфейсе.
- Для UI/user-flow задач проверяйте критичные сценарии браузером или Playwright, когда это применимо.

## Стек И Структура

- Runtime: Node.js, ESM (`"type": "module"`).
- Backend/app: Express в `platonportal.js`.
- Views: Handlebars в `views`, layout в `views/layouts/main.hbs`, partials в `views/partials`.
- Локальные helper-модули: `vendor/*.mjs` и `vendor/logs.js`.
- Static assets: `public`.
- CSS: Tailwind input/config в `tailwind.input.css` и `tailwind.config.js`; собранный CSS лежит в `public/css/tailwind.css`.
- Дополнительный Vue/Vite подпроект находится в `platon`; не трогайте его без явной связи с задачей.
- Runtime logs пишутся в `logs` и исторически встречаются в `vendor/logs`; новые runtime-логи не коммитить.
- Формат runtime log-файлов в текущем коде: `дд.мм log.txt`.

## Перед Каждой Задачей

- Прочитайте этот `AGENTS.md` перед планированием изменений.
- Проверьте `git status --short --branch` и работайте с существующими изменениями пользователя, не затирая их.
- Подтвердите минимальный безопасный scope.
- Для DB/auth/SSO задач сначала изучите `vendor/db.mjs`, `vendor/ssoRouter.mjs`, `vendor/platformsso.mjs` и соответствующие handlers в `platonportal.js`.
- Предпочитайте существующие patterns и локальные helper APIs новым абстракциям.
- Не добавляйте лишнюю сложность, новые папки, страницы или отчеты без явной необходимости.
- Код должен оставаться простым и читаемым.

## Основные Команды

- Установка зависимостей: `npm install`.
- Локальный dev server: `npm run dev`.
- Проверка синтаксиса основного приложения: `node --check platonportal.js`.
- Запуск без nodemon: `node platonportal.js`.
- Порт по умолчанию: `777`, можно переопределить через `PORT`.
- Vue/Vite dev: `cd platon && npm run dev`.
- Vue/Vite build: `cd platon && npm run build`.
- Vue/Vite preview: `cd platon && npm run preview`.

## Границы Данных И Auth

- SSO и платформенную авторизацию считайте общей инфраструктурой; не меняйте их схему и контракты без прямой задачи.
- Не выполняйте destructive DB operations без явной необходимости, backup-плана и подтверждения scope.
- Значения `.env` и production credentials не должны попадать в Git, markdown-документы, логи команд или примеры.
- Если нужно документировать переменные окружения, пишите только имена и назначение, без значений.

## Production Access

- Deploy в production выполняйте только когда задача реально требует этого.
- SSH: `ssh root@platon.teyhd.ru -p 9022`.
- SSH key доступен на этой рабочей станции.
- Актуальный production path проекта: `/var/www/html/platonportal`.
- PM2 process name: `platonportal`.
- Проверка процессов: `pm2 list` и `pm2 info platonportal`.
- Приложение слушает порт `777`, если `PORT` не переопределен.
- Быстрая локальная проверка на сервере: `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:777/`.
- Перед deploy проверяйте реальный Nginx route/config на сервере; не меняйте Nginx без необходимости.
- В non-interactive SSH sessions используйте:
  - `export PATH=/root/.nvm/versions/node/v22.15.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`

## Deploy Validation

- Перед deploy проверьте `git status --short --branch` локально и на сервере.
- Перед перезапуском production сделайте безопасный backup/stash незакоммиченных server-side изменений.
- Если менялся основной Node-код, выполните `node --check platonportal.js`.
- После deploy проверьте `pm2 list`, `pm2 info platonportal`, локальный `curl` на `127.0.0.1:777` и свежие PM2 logs.
- Не запускайте `pm2 update` или массовые restart-команды без отдельной причины: это влияет на другие процессы сервера.

## Git Discipline

- Держите изменения атомарными и сфокусированными.
- Используйте понятные commit messages.
- Push выполняйте в текущую ветку, когда рабочее дерево чистое и diff проверен.
- Не запускайте рискованные или destructive команды без явной необходимости.
- Не оставляйте local-only изменения без понятной причины.
- Не revert-ите несвязанные изменения пользователя.
- Не добавляйте `node_modules`, runtime logs, backup-файлы, `.env`, generated debug-output и временные Playwright artifacts.

## Security

- Не коммитьте новые secrets, пароли, токены, приватные ключи, cookies, дампы сессий или значения `.env`.
- Не копируйте secrets из user prompt, server files, logs или старого кода в `AGENTS.md`, README, docs, comments или commit messages.
- Не печатайте содержимое `.env`, если пользователь явно не попросил и задача без этого невозможна.
- Перед commit проверяйте staged diff на секреты: `git diff --cached`.
- Если находите уже существующий secret в tracked-файлах, не распространяйте его дальше; сообщите о риске без раскрытия значения.

## Reporting

- В финальном ответе кратко укажите: что изменено, что проверено, commit/hash, был ли deploy, и какие риски остались.
- Не создавайте дополнительные markdown-отчеты в репозитории без прямой просьбы пользователя.
- Внешние уведомления с ключами или webhook URLs используйте только если пользователь явно попросил в текущей задаче; не сохраняйте такие ключи в Git.
