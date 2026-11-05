// ANET inventory, 2026-11-03. These are inventory facts, not live health checks.
// This is a portal catalog, not an SSO registry or an Nginx configuration.
export const PORTAL_DOMAINS = [
  ['platoniks.ru', 'Горячая линия русского языка', 'Школьный портал: раздел горячей линии.', 'phone', '/russian-hotline'],
  ['magic.platoniks.ru', 'Magic — заглушка', 'Домен зарезервирован; приложение не настроено.', 'wand-sparkles'],
  ['rec.platoniks.ru', 'REC — инфраструктура', 'Инфраструктурный сервис; назначение и доступность требуют проверки.', 'circle-dot'],
  ['new.platoniks.ru', 'Новогодняя игра', 'Школьная новогодняя игра.', 'party-popper'],
  ['rasp.platoniks.ru', 'Расписание — BestSchedule', 'Школьное расписание.', 'calendar-clock'],
  ['rep.platoniks.ru', 'Прогресс-репорты', 'Прогресс учеников; вход через портал.', 'chart-no-axes-combined'],
  ['git.platoniks.ru', 'Git — инфраструктура', 'Инфраструктура Git; доступность требует проверки.', 'git-branch'],
  ['diary.platoniks.ru', 'Школьный дневник', 'Школьный электронный дневник.', 'notebook-pen'],
  ['llm.platoniks.ru', 'Ollama — API', 'API языковых моделей Ollama; отдельного пользовательского интерфейса нет.', 'brain-circuit'],
  ['plug.platoniks.ru', 'Видеоконференции — plugNmeet', 'Видеоконференции plugNmeet.', 'video'],
  ['game.platoniks.ru', 'Карта Minecraft', 'Карта Minecraft и связанный API.', 'blocks'],
  ['next2.platoniks.ru', 'Next2 — инфраструктура', 'Инфраструктурный сервис; назначение и доступность требуют проверки.', 'server-cog'],
  ['next.platoniks.ru', 'Next — инфраструктура', 'Инфраструктурный сервис; назначение и доступность требуют проверки.', 'server'],
  ['cloud.platoniks.ru', 'Облако — KodExplorer', 'Файловое облако KodExplorer.', 'cloud'],
  ['cloudk.platoniks.ru', 'CloudK — заглушка', 'Домен зарезервирован; приложение не настроено.', 'cloud-off'],
  ['own.platoniks.ru', 'Own — инфраструктура', 'Инфраструктурный сервис; назначение и доступность требуют проверки.', 'hard-drive'],
  ['pc.platoniks.ru', 'Компьютеры — бронирование', 'Учёт и бронирование компьютеров; вход через портал.', 'monitor'],
  ['alisa.platoniks.ru', 'Алиса — обработчик навыка', 'Служебный обработчик навыка Алисы; отдельного интерфейса нет.', 'mic'],
  ['vpn.platoniks.ru', 'VPN — WireGuard', 'Панель управления WireGuard.', 'shield-check'],
  ['vote.platoniks.ru', 'Голосования', 'Школьные голосования.', 'vote'],
  ['photo.platoniks.ru', 'Фотобаттлы', 'Школьные фотобаттлы.', 'camera'],
  ['tildapi.platoniks.ru', 'Tilda — API интеграции', 'Служебный обработчик интеграции Tilda; отдельного интерфейса нет.', 'webhook'],
  ['puzzle.platoniks.ru', 'Пазлы', 'Школьные пазлы.', 'puzzle'],
  ['port.platoniks.ru', 'Port — инфраструктура', 'Панель инфраструктуры; доступность требует проверки.', 'container'],
  ['aplug.platoniks.ru', 'Aplug — заглушка', 'Домен зарезервирован; приложение не настроено.', 'unplug'],
  ['pve.platoniks.ru', 'Серверы — Proxmox', 'Управление виртуализацией Proxmox.', 'server'],
  ['vision.platoniks.ru', 'Сайт школы Platonics', 'Сайт частной школы Platonics.', 'globe'],
  ['buy.platoniks.ru', 'Закупки', 'Управление закупками; вход через портал.', 'shopping-cart'],
  ['stud.platoniks.ru', 'Посещаемость', 'Учёт посещаемости; вход через портал.', 'user-check'],
  ['know.platoniks.ru', 'База знаний', 'База знаний, поиск и MCP.', 'book-open-text'],
  ['chess.platoniks.ru', 'Шахматы — Platoniks Chess', 'Школьные шахматы Platoniks Chess.', 'crown'],
  ['event.platoniks.ru', 'Школьные события', 'Календарь школьных событий; вход через портал.', 'calendar-days'],
  ['graph.platoniks.ru', 'Мониторинг — Grafana', 'Мониторинг инфраструктуры в Grafana.', 'chart-no-axes-combined'],
  ['info.platoniks.ru', 'Схема инфраструктуры', 'Интерактивная схема инфраструктуры Платоникса.', 'network'],
  ['main.platoniks.ru', 'Личный дашборд', 'Закрытый раздел личного дашборда; требуется авторизация сервиса.', 'layout-dashboard', '/private'],
  ['msg.platoniks.ru', 'Балалайка', 'Мессенджер, звонки и Олег.', 'messages-square'],
  ['russ.platoniks.ru', 'Горячая линия — Russ', 'Сервис горячей линии русского языка.', 'phone-call'],
  ['smart.platoniks.ru', 'OmniRoute — AI-шлюз', 'Шлюз и маршрутизация AI-моделей.', 'route'],
  ['tech.platoniks.ru', 'Техническая поддержка', 'Заявки в техподдержку.', 'wrench'],
  ['tg.platoniks.ru', 'Telegram — MCP', 'Служебный MCP для Telegram; на корневом адресе нет интерфейса.', 'send'],
  ['vlad.platoniks.ru', 'Codex — закрытый API', 'Ограниченный API Codex; требуется разрешение сервиса.', 'terminal', '/codex/v1/'],
  ['vs.platoniks.ru', 'Владислав Дьяконов — визитка', 'Личная визитка Владислава Дьяконова.', 'contact-round'],
  ['welcome.platoniks.ru', 'Знакомство с Платониксом', 'Вводная страница о Платониксе.', 'door-open'],
].map(([domain, title, summary, icon, pathname = '/']) => ({
  domain, title, summary, icon, cont: `https://${domain}${pathname}`,
  pic: `domain-${domain.split('.')[0]}.svg`,
}));

export function normalizePortalUrl(value) {
  const text = String(value ?? '').trim();
  if (!/^https?:\/\//i.test(text) && !/^\/(?!\/)/.test(text)) return null;
  try {
    const url = new URL(text, 'https://platoniks.ru/');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const domain = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    return { domain, pathname };
  } catch { return null; }
}

export function getRegisteredService(value) {
  const target = normalizePortalUrl(value);
  if (!target) return null;
  // Existing portal launch routes keep their SSO behavior and permissions.
  const aliases = { '/cloud': 'cloud.platoniks.ru', '/diary': 'diary.platoniks.ru' };
  const domain = target.domain === 'platoniks.ru' ? aliases[target.pathname] ?? target.domain : target.domain;
  if (domain === 'platoniks.ru' && !/^\/russian-hotline(?:\/|$)/.test(target.pathname)) return null;
  return PORTAL_DOMAINS.find(service => service.domain === domain) ?? null;
}

export function findDomainCard(service, cards) {
  return cards.find(card => Number(card.type) === 0 && getRegisteredService(card.cont)?.domain === service.domain);
}
