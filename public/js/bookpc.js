const root = document.querySelector('[data-bookpc]');
const select = key => root.querySelector(`[data-${key}]`);
const heading = root.querySelector('#bookpc-title');
const summary = select('summary');
const grid = select('grid');
const message = select('message');
const issueMessage = select('issue-message');
const retry = select('retry');
const card = select('card');
const cardTitle = select('card-title');
const cardState = select('card-state');
const caption = select('card-caption');
const details = select('card-details');
const issueBox = select('issue');
const issueLink = select('issue-link');
const action = select('action');
const dialog = select('dialog');
const form = select('form');
const room = select('room');
const comment = form.elements.comment;
const formMessage = select('form-message');
const submit = select('submit');
const cancel = select('cancel');
const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const states = { free: 'Свободно', occupied: 'Занято', own: 'У вас', unknown: 'Статус неизвестен' };
const rentalSlot = document.querySelector('[data-important-rentals]');
const tiles = new Map();
let shown;
let pinned = false;
let closeTimer;
let pending;
let submitting = false;
let restoringFocus = false;
let loading;
let fresh = false;

function roomLabel(value) {
  if (value === 0) return '13 ложе';
  if (value === 30) return 'Выездной';
  return value ?? '—';
}

for (const value of [0, ...Array.from({ length: 27 }, (_, index) => index + 1), 30]) {
  room.add(new Option(value === 0 || value === 30 ? roomLabel(value) : `№${value}`, String(value)));
}

async function request(path = '', options) {
  const response = await fetch(`/api/bookpc${path}`, { cache: 'no-store', ...options });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}

function placeCard() {
  if (!shown) return;
  const anchor = shown.button.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  const height = window.innerHeight;
  if (anchor.bottom <= 0 || anchor.top >= height) return closeCard();
  const gap = 5;
  const below = height - anchor.bottom - gap - 8;
  const above = anchor.top - gap - 8;
  card.style.maxHeight = '';
  const naturalHeight = card.offsetHeight;
  const openBelow = naturalHeight <= below || below >= above;
  card.style.maxHeight = `${Math.max(48, openBelow ? below : above)}px`;
  card.style.top = `${openBelow ? anchor.bottom + gap : anchor.top - gap - card.offsetHeight}px`;
  const left = anchor.left + (anchor.width - card.offsetWidth) / 2;
  card.style.left = `${Math.max(8, Math.min(left, width - card.offsetWidth - 8))}px`;
}

function addDetail(label, value, layout) {
  const row = document.createElement('div');
  row.className = `bookpc__detail bookpc__detail--${layout}`;
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;
  description.textContent = value || '—';
  row.append(term, description);
  details.append(row);
}

function paintCard() {
  const { id, state, own, rental, issue } = shown.device;
  const tone = own ? 'own' : state;
  cardTitle.textContent = `Ноутбук №${id}`;
  cardState.textContent = states[tone];
  cardState.dataset.state = tone;
  caption.textContent = state === 'free' ? (rental ? 'Последняя аренда' : 'Истории аренды пока нет') : '';
  caption.hidden = !caption.textContent;
  details.replaceChildren();
  if (rental) {
    addDetail('Кабинет №', roomLabel(rental.room), 'compact');
    addDetail('Начало', rental.startedAt ? dateFormat.format(new Date(rental.startedAt)).replace(',', '') : '—', 'compact');
    addDetail('Пользователь', rental.renter, 'wide');
    addDetail('Комментарий', rental.comment, 'wide');
    if (rental.pin) addDetail('Ваш PIN', rental.pin, 'pin');
  }
  issueBox.hidden = !issue;
  if (issue) {
    select('issue-label').textContent = issue.count === 1 ? 'Активная жалоба' : `Активные жалобы (${issue.count})`;
    select('issue-title').textContent = issue.title;
    issueLink.hidden = !issue.incidentId;
    if (issue.incidentId) issueLink.href = `https://tech.platoniks.ru/?view=reports&incident=${encodeURIComponent(issue.incidentId)}`;
  }
  action.hidden = !fresh || (state !== 'free' && !own);
  action.textContent = own ? 'Сдать' : 'Взять';
  placeCard();
}

function closeCard({ restoreFocus = false } = {}) {
  clearTimeout(closeTimer);
  if (!shown) return;
  const { button } = shown;
  shown = undefined;
  pinned = false;
  card.hidePopover();
  button.setAttribute('aria-expanded', 'false');
  if (restoreFocus) {
    restoringFocus = true;
    button.focus({ preventScroll: true });
    restoringFocus = false;
  }
}

function showCard(tile, pin = false) {
  clearTimeout(closeTimer);
  if (shown === tile) {
    if (pin) pinned = true;
    return;
  }
  closeCard();
  shown = tile;
  pinned = pin;
  tile.button.after(card);
  tile.button.setAttribute('aria-expanded', 'true');
  card.showPopover();
  paintCard();
}

function scheduleClose() {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    if (!pinned && !shown?.button.matches(':focus-visible, :hover') && !card.matches(':hover, :focus-within')) closeCard();
  }, 190);
}

function paintDevices(devices) {
  const ids = new Set(devices.map(device => device.id));
  for (const [id, tile] of tiles) {
    if (ids.has(id)) continue;
    if (shown === tile) closeCard();
    tile.item.remove();
    tiles.delete(id);
  }
  for (const device of devices) {
    let tile = tiles.get(device.id);
    if (!tile) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bookpc__tile';
      button.textContent = String(device.id);
      button.setAttribute('aria-controls', card.id);
      button.setAttribute('aria-expanded', 'false');
      item.append(button);
      grid.append(item);
      tile = { item, button };
      tiles.set(device.id, tile);
      button.addEventListener('pointerenter', event => {
        if (event.pointerType === 'mouse' && !pinned && !dialog.open) showCard(tile);
      });
      button.addEventListener('pointerleave', scheduleClose);
      button.addEventListener('focus', () => {
        if (!restoringFocus && button.matches(':focus-visible') && !dialog.open) showCard(tile);
      });
      button.addEventListener('click', () => {
        if (shown === tile && pinned) closeCard();
        else showCard(tile, true);
      });
    }
    tile.device = device;
    const tone = device.own ? 'own' : device.state;
    tile.button.dataset.state = tone;
    tile.button.toggleAttribute('data-has-issue', Boolean(device.issue));
    tile.button.setAttribute('aria-label', `Ноутбук №${device.id}, ${states[tone]}${device.issue ? ', есть жалоба' : ''}`);
  }
  if (shown) paintCard();
  const freeCount = devices.filter(device => device.state === 'free').length;
  const ownCount = devices.filter(device => device.own).length;
  summary.textContent = devices.length ? `Свободно ${freeCount} из ${devices.length}${ownCount ? ` · У вас ${ownCount}` : ''}` : 'Нет ноутбуков';
}

function paintOwnRentals(devices) {
  if (!rentalSlot) return;
  const focusedDevice = rentalSlot.contains(document.activeElement) ? document.activeElement.dataset.returnDevice : null;
  const rows = [];
  for (const device of devices) {
    if (device.state !== 'occupied' || device.own !== true || !device.rental?.id) continue;
    const row = document.createElement('div');
    row.className = 'bookpc-rental';
    const title = document.createElement('strong');
    const room = device.rental.room;
    title.textContent = `У вас ноутбук №${device.id}${room == null || room === '' ? '' : ` · каб. ${roomLabel(room)}`}`;
    const pin = document.createElement('span');
    pin.textContent = device.rental.pin ? `PIN: ${device.rental.pin}` : 'PIN недоступен';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Сдать';
    button.dataset.returnDevice = String(device.id);
    button.setAttribute('aria-label', `Сдать ноутбук №${device.id}`);
    button.addEventListener('click', () => openOperation(device, button));
    row.append(title, pin, button);
    rows.push(row);
  }
  rentalSlot.replaceChildren(...rows);
  rentalSlot.hidden = !rows.length;
  if (focusedDevice) Array.from(rentalSlot.querySelectorAll('button')).find(button => button.dataset.returnDevice === focusedDevice)?.focus();
}

function refresh(feedback = '') {
  if (loading) return loading;
  retry.hidden = true;
  loading = (async () => {
    try {
      const { devices, issuesStatus } = await request();
      fresh = true;
      paintDevices(devices);
      paintOwnRentals(devices);
      issueMessage.textContent = issuesStatus === 'unavailable' ? 'Данные техподдержки временно недоступны.' : '';
      message.textContent = feedback || (devices.length ? '' : 'В BookPC пока нет зарегистрированных ноутбуков.');
      return true;
    } catch (error) {
      fresh = false;
      paintOwnRentals([]);
      if (error.status === 401 || error.status === 403) paintDevices([]);
      if (shown) paintCard();
      summary.textContent = tiles.size ? 'Данные не обновились' : 'Статус недоступен';
      const issue = error.status === 401 || error.status === 403 ? 'Войдите в аккаунт с доступом к BookPC.' : 'Не удалось обновить данные BookPC.';
      message.textContent = [feedback, issue].filter(Boolean).join(' ');
      retry.hidden = false;
      return false;
    } finally {
      loading = undefined;
    }
  })();
  return loading;
}

retry.addEventListener('click', () => refresh());
select('close-card').addEventListener('click', () => closeCard({ restoreFocus: true }));
card.addEventListener('pointerenter', () => clearTimeout(closeTimer));
card.addEventListener('pointerleave', scheduleClose);
document.addEventListener('pointerdown', event => {
  if (shown && !shown.button.contains(event.target) && !card.contains(event.target)) closeCard();
});
document.addEventListener('focusin', event => {
  if (shown && !shown.button.contains(event.target) && !card.contains(event.target)) closeCard();
});
document.addEventListener('keydown', event => {
  if (shown && !dialog.open && event.key === 'Escape') {
    event.preventDefault();
    closeCard({ restoreFocus: card.contains(document.activeElement) });
  }
});
window.addEventListener('resize', placeCard);
window.addEventListener('scroll', placeCard, { passive: true });

action.addEventListener('click', () => openOperation(shown.device, shown.button));

function openOperation(device, button) {
  const operation = device.own ? 'return' : 'rent';
  pending = { device, button, operation, payload: null };
  const rent = operation === 'rent';
  form.reset();
  formMessage.textContent = '';
  select('dialog-title').textContent = `${rent ? 'Взять' : 'Сдать'} ноутбук №${device.id}`;
  select('room-field').hidden = !rent;
  select('comment-field').hidden = rent;
  room.required = rent;
  room.disabled = !rent;
  comment.disabled = rent;
  submit.textContent = rent ? 'Взять' : 'Сдать';
  closeCard();
  dialog.showModal();
}

const errorMessages = {
  computer_occupied: 'Ноутбук уже взяли. Статус обновлён.',
  active_rental_changed: 'Аренда изменилась. Статус обновлён.',
  no_active_rental: 'Эта аренда уже завершена. Статус обновлён.',
  rental_not_owned: 'Сдать ноутбук может тот, кто его взял.',
  computer_not_registered: 'Ноутбук больше не числится в BookPC.',
  bookpc_access_denied: 'Доступ к BookPC изменился.',
  authentication_required: 'Сессия истекла. Войдите в портал снова.',
};

cancel.addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => {
  if (submitting) event.preventDefault();
});
dialog.addEventListener('close', () => {
  const button = pending?.button;
  pending = undefined;
  (button?.isConnected ? button : heading).focus();
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting || !pending) return;
  const { device, operation } = pending;
  const rent = operation === 'rent';
  pending.payload ??= {
    requestId: crypto.randomUUID(), computer_id: device.id,
    ...(rent ? { room: Number(room.value) } : { rental_id: device.rental.id, comment: comment.value }),
  };
  submitting = true;
  room.disabled = comment.disabled = submit.disabled = cancel.disabled = true;
  formMessage.textContent = 'Отправляем в BookPC…';
  try {
    await request(`/${operation}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pending.payload),
    });
    if (loading) await loading;
    const updated = await refresh(rent ? `Ноутбук №${device.id} у вас.` : `Ноутбук №${device.id} сдан.`);
    dialog.close();
    if (updated && rent && tiles.get(device.id)?.device.own) showCard(tiles.get(device.id), true);
  } catch (error) {
    if (!error.status || error.status >= 500) {
      formMessage.textContent = 'BookPC не подтвердил результат. Повторная проверка использует тот же запрос.';
      submit.textContent = 'Проверить ещё раз';
    } else {
      dialog.close();
      if (loading) await loading;
      await refresh(errorMessages[error.message] || 'BookPC отклонил действие.');
    }
  } finally {
    submitting = false;
    submit.disabled = cancel.disabled = false;
    if (dialog.open) submit.focus();
  }
});

refresh();
setInterval(() => { if (!document.hidden && !dialog.open) refresh(); }, 45000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !dialog.open) refresh();
});
window.addEventListener('pagehide', () => paintOwnRentals([]));
window.addEventListener('pageshow', event => {
  if (event.persisted && !dialog.open) refresh();
});
