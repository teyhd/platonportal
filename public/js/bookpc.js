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
const forceNote = select('force-note');
const submit = select('submit');
const cancel = select('cancel');
const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const states = { free: 'Свободно', occupied: 'Занято', own: 'У вас', unknown: 'Статус неизвестен',
  assigned: 'Закреплён', 'assigned-admin': 'Закреплён' };
const actionLabels = { rent: 'Взять', return: 'Сдать', 'force-return': 'Завершить аренду' };
const rentalSlot = document.querySelector('[data-important-rentals]');
const locationSlot = document.querySelector('[data-important-laptop-locations]');
const tiles = new Map();
const locationTiles = new Map();
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

function deviceOperation(device) {
  if (device.assignment) return null;
  if (device.own) return 'return';
  if (device.canForceReturn) return 'force-return';
  return device.state === 'free' && device.rentable ? 'rent' : null;
}

function deviceTone(device) {
  if (device.assignment) return device.assignment.label ? 'assigned-admin' : 'assigned';
  return device.own ? 'own' : device.state;
}

function paintCard() {
  const { id, state, rental, issue, assignment } = shown.device;
  const tone = deviceTone(shown.device);
  const operation = deviceOperation(shown.device);
  cardTitle.textContent = `Ноутбук №${id}`;
  cardState.textContent = states[tone];
  cardState.dataset.state = tone;
  caption.textContent = !assignment && state === 'free' ? (rental ? 'Последняя аренда' : 'Истории аренды пока нет') : '';
  caption.hidden = !caption.textContent;
  details.replaceChildren();
  if (assignment?.label) addDetail('Закреплён за', assignment.label, 'wide');
  if (assignment?.room) addDetail('Кабинет', assignment.room, 'compact');
  if (rental && !assignment) {
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
  action.hidden = !fresh || !operation;
  action.textContent = actionLabels[operation] ?? '';
  action.toggleAttribute('data-force', operation === 'force-return');
  placeCard();
}

function closeCard({ restoreFocus = false } = {}) {
  clearTimeout(closeTimer);
  if (!shown) return;
  const { button } = shown;
  shown = undefined;
  pinned = false;
  if (card.matches(':popover-open')) card.hidePopover();
  root.append(card);
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

function bindCardTrigger(tile) {
  const { button } = tile;
  button.setAttribute('aria-controls', card.id);
  button.setAttribute('aria-expanded', 'false');
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

function removeMissingTiles(collection, devices) {
  const ids = new Set(devices.map(device => device.id));
  for (const [id, tile] of collection) {
    if (ids.has(id) && tile.item.isConnected) continue;
    if (shown === tile) closeCard();
    tile.item.remove();
    collection.delete(id);
  }
}

function paintDevices(devices) {
  removeMissingTiles(tiles, devices);
  for (const device of devices) {
    let tile = tiles.get(device.id);
    if (!tile) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bookpc__tile';
      button.textContent = String(device.id);
      item.append(button);
      grid.append(item);
      tile = { item, button };
      tiles.set(device.id, tile);
      bindCardTrigger(tile);
    }
    tile.device = device;
    const tone = deviceTone(device);
    tile.button.dataset.state = tone;
    tile.button.toggleAttribute('data-has-issue', Boolean(device.issue));
    tile.button.setAttribute('aria-label', `Ноутбук №${device.id}, ${states[tone]}${device.issue ? ', есть жалоба' : ''}`);
  }
  const rentable = devices.filter(device => !device.assignment);
  const freeCount = rentable.filter(device => device.state === 'free').length;
  const ownCount = rentable.filter(device => device.own).length;
  const availability = rentable.length ? `Для аренды ${freeCount} из ${rentable.length}` : 'Нет ноутбуков для аренды';
  summary.textContent = `${availability}${ownCount ? ` · У вас ${ownCount}` : ''}`;
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

function paintLocations(devices) {
  if (!locationSlot) return;
  const locations = devices.filter(device => device.assignment?.showInImportant);
  removeMissingTiles(locationTiles, locations);
  for (const device of locations) {
    let tile = locationTiles.get(device.id);
    if (!tile) {
      const item = document.createElement('div');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bookpc-rental important-laptop-location';
      const title = document.createElement('strong');
      title.textContent = `Резервный ноутбук №${device.id}`;
      const location = document.createElement('span');
      button.append(title, location);
      item.append(button);
      locationSlot.append(item);
      tile = { item, button, location };
      locationTiles.set(device.id, tile);
      bindCardTrigger(tile);
    }
    tile.device = device;
    tile.location.textContent = `Кабинет ${device.assignment.room}`;
  }
  locationSlot.hidden = !locations.length;
}

function refresh(feedback = '') {
  if (loading) return loading;
  retry.hidden = true;
  loading = (async () => {
    try {
      const { devices, ownRentals = devices, issuesStatus } = await request();
      fresh = true;
      paintDevices(devices.filter(device => device.rentable || device.assignment));
      paintOwnRentals(ownRentals);
      paintLocations(devices);
      if (shown) paintCard();
      issueMessage.textContent = issuesStatus === 'unavailable' ? 'Данные техподдержки временно недоступны.' : '';
      message.textContent = feedback;
      return true;
    } catch (error) {
      fresh = false;
      paintOwnRentals([]);
      paintLocations([]);
      if (error.status === 401 || error.status === 403 || error.message === 'assignments_unavailable') paintDevices([]);
      if (shown) paintCard();
      summary.textContent = tiles.size ? 'Данные не обновились' : 'Статус недоступен';
      const issue = errorMessages[error.message] ||
        (error.status === 401 || error.status === 403 ? 'Войдите в аккаунт с доступом к BookPC.' : 'Не удалось обновить данные BookPC.');
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
  const operation = deviceOperation(device);
  if (!fresh || !operation) return;
  pending = { device, button, operation, payload: null };
  const rent = operation === 'rent';
  const forced = operation === 'force-return';
  form.reset();
  formMessage.textContent = '';
  select('dialog-title').textContent = `${actionLabels[operation]} ${forced ? 'ноутбука' : 'ноутбук'} №${device.id}`;
  select('room-field').hidden = !rent;
  select('comment-field').hidden = operation !== 'return';
  forceNote.hidden = !forced;
  if (forced) {
    forceNote.textContent = device.rental.renter ? `Арендатор — ${device.rental.renter}.` : 'Текущая аренда оформлена на другого пользователя.';
  }
  room.required = rent;
  room.disabled = !rent;
  comment.disabled = operation !== 'return';
  submit.textContent = actionLabels[operation];
  submit.toggleAttribute('data-force', forced);
  closeCard();
  dialog.showModal();
}

const errorMessages = {
  computer_assigned: 'Ноутбук закреплён за сотрудником. Выберите другой.',
  assignments_unavailable: 'Реестр ноутбуков недоступен. Попробуйте ещё раз.',
  computer_occupied: 'Ноутбук уже взяли. Статус обновлён.',
  active_rental_changed: 'Аренда изменилась. Статус обновлён.',
  no_active_rental: 'Эта аренда уже завершена. Статус обновлён.',
  rental_not_owned: 'Сдать ноутбук может тот, кто его взял.',
  computer_not_registered: 'Ноутбук больше не числится в BookPC.',
  computer_not_rentable: 'Этот ноутбук не выдаётся в аренду.',
  bookpc_access_denied: 'Доступ к BookPC изменился.',
  portal_admin_required: 'Чужую аренду может завершить администратор портала.',
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
    ...(rent ? { room: Number(room.value) } : { rental_id: device.rental.id }),
    ...(operation === 'return' && { comment: comment.value }),
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
    const updated = await refresh(rent ? `Ноутбук №${device.id} у вас.` : `Аренда ноутбука №${device.id} завершена.`);
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
window.addEventListener('pagehide', () => {
  paintOwnRentals([]);
  paintLocations([]);
});
window.addEventListener('pageshow', event => {
  if (event.persisted && !dialog.open) refresh();
});
