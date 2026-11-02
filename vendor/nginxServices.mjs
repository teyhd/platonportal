// Additional web interfaces verified against the active Nginx hosts on 2026-09-23.
// Keep API endpoints, error pages and unavailable upstreams out of this list.
const ADMIN_NGINX_SERVICES = [
  { title: 'VPN — WireGuard', cont: 'https://vpn.platoniks.ru/', pic: 'vpn.png' },
  { title: 'Мониторинг — Grafana', cont: 'https://graph.platoniks.ru/', pic: 'nginx-monitoring.svg' },
  { title: 'Серверы — Proxmox', cont: 'https://pve.platoniks.ru/', pic: 'nginx-servers.svg' },
  { title: 'Видеоконференции — plugNmeet', cont: 'https://plug.platoniks.ru/', pic: 'nginx-conference.svg' },
  { title: 'Карта Minecraft', cont: 'http://game.platoniks.ru/', pic: 'nginx-minecraft.svg' },
  { title: 'Пазлы', cont: 'https://puzzle.platoniks.ru/', pic: 'nginx-puzzles.svg' },
  { title: 'Новый год', cont: 'https://new.platoniks.ru/', pic: 'nginx-new-year.svg' },
  { title: 'Сайт Platonics', cont: 'https://vision.platoniks.ru/', pic: 'nginx-website.svg' },
];

export function getAdminNginxServices(menuCards = []) {
  const existingHosts = new Set();
  for (const card of menuCards) {
    try {
      existingHosts.add(new URL(card.cont, 'https://platoniks.ru/').hostname);
    } catch {
      // A legacy card may contain a non-URL value.
    }
  }

  return ADMIN_NGINX_SERVICES
    .filter(card => !existingHosts.has(new URL(card.cont).hostname))
    .map(card => ({ ...card, type: 0, role: 5, shows: 1 }));
}
