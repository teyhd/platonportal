export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .trim()
    .replace(/^@+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compareUserValues(left, right, direction = 'asc') {
  const numberLeft = Number(left);
  const numberRight = Number(right);
  let result;
  if (Number.isFinite(numberLeft) && Number.isFinite(numberRight) && String(left).trim() !== '' && String(right).trim() !== '') {
    result = numberLeft - numberRight;
  } else {
    result = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' }).compare(String(left ?? ''), String(right ?? ''));
  }
  return direction === 'desc' ? -result : result;
}

if (typeof document !== 'undefined') {
  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const api = (url, options = {}) => fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  const elements = {
    tbody: qs('#users-tbody'),
    table: qs('#users-table'),
    empty: qs('#users-empty'),
    noResults: qs('#users-no-results'),
    visible: qs('#users-visible'),
    total: qs('#users-total'),
    live: qs('#users-live'),
    search: qs('#user-search'),
    clearSearch: qs('#user-search-clear'),
    status: qs('#filter-status'),
    type: qs('#filter-type'),
    kaf: qs('#filter-kaf'),
    reset: qs('#users-reset'),
    mobileSort: qs('#mobile-sort'),
    userDrawer: qs('#user-drawer'),
    userMessage: qs('#user-drawer-message'),
    issuesDrawer: qs('#issues-drawer'),
    serviceDrawer: qs('#service-roles-drawer'),
    serviceMessage: qs('#service-roles-message'),
    userSave: qs('#btn-save-current'),
  };

  const state = {
    activeDrawer: null,
    lastFocused: null,
    sortKey: 'id',
    sortDirection: 'desc',
    originalRows: new WeakMap(),
    messageTimer: null,
  };

  const TYPE_LABELS = Object.fromEntries(qsa('#f-type option').map(option => [option.value, option.textContent.trim()]));
  const KAF_LABELS = Object.fromEntries(qsa('#f-kaf option').filter(option => option.value).map(option => [option.value, option.textContent.trim()]));

  function userRows() {
    return qsa('.user-row', elements.tbody);
  }

  function labelFor(map, value) {
    return map[String(value ?? '')] || '—';
  }

  function canonicalNick(user) {
    const raw = String(user.msgnickname_normalized || user.msgnickname || user.nickname || '').trim();
    if (!raw) return '';
    return raw.replace(/^@+/, '');
  }

  function userFromRow(row) {
    const d = row.dataset;
    return {
      id: d.userId,
      name: d.userName,
      kaf: d.userKaf,
      type: d.userType,
      status: d.userStatus,
      pin: d.userPin,
      nickname: d.userNickname,
      msgnickname: d.userMsgnickname,
      msgnickname_normalized: d.userMsgnicknameNormalized,
      tg_id: d.userTgId,
      avatar_url_custom: d.userAvatarUrlCustom,
      display_name_custom: d.userDisplayNameCustom,
      allow_discovery_outside_harmony: d.userAllowDiscoveryOutsideHarmony,
    };
  }

  function searchIndex(row) {
    const user = userFromRow(row);
    return normalizeSearchText([
      user.id,
      user.name,
      user.pin,
      user.nickname,
      user.msgnickname,
      user.msgnickname_normalized,
      user.tg_id,
      user.avatar_url_custom,
      user.display_name_custom,
      user.allow_discovery_outside_harmony ? 'разрешена видимость discovery' : 'скрыт запретена видимость discovery',
      labelFor(KAF_LABELS, user.kaf),
      labelFor(TYPE_LABELS, user.type),
      Number(user.status) ? 'активен активный' : 'заблокирован заблокированный',
    ].join(' '));
  }

  function sortValue(row, key) {
    const user = userFromRow(row);
    if (key === 'kaf') return labelFor(KAF_LABELS, user.kaf);
    if (key === 'type') return labelFor(TYPE_LABELS, user.type);
    if (key === 'status') return Number(user.status) ? 'Активен' : 'Заблокирован';
    if (key === 'nick') return canonicalNick(user);
    return user[key] ?? '';
  }

  function readUrlState() {
    const params = new URLSearchParams(window.location.search);
    const allowedKeys = new Set(['id', 'name', 'kaf', 'type', 'status', 'pin', 'nick']);
    const sort = params.get('sort');
    const direction = params.get('dir');
    if (allowedKeys.has(sort)) state.sortKey = sort;
    if (direction === 'asc' || direction === 'desc') state.sortDirection = direction;
    if (elements.search) elements.search.value = params.get('q') || '';
    if (elements.status) elements.status.value = params.get('status') || '';
    if (elements.type) elements.type.value = params.get('type') || '';
    if (elements.kaf) elements.kaf.value = params.get('kaf') || '';
  }

  function writeUrlState() {
    const params = new URLSearchParams(window.location.search);
    const values = {
      q: elements.search?.value.trim() || '',
      status: elements.status?.value || '',
      type: elements.type?.value || '',
      kaf: elements.kaf?.value || '',
      sort: state.sortKey,
      dir: state.sortDirection,
    };
    Object.entries(values).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }

  function updateSortControls() {
    qsa('.users-sort-button').forEach(button => {
      const active = button.dataset.sort === state.sortKey;
      button.dataset.direction = active ? state.sortDirection : '';
      button.closest('th')?.setAttribute('aria-sort', active ? (state.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none');
    });
    if (elements.mobileSort) elements.mobileSort.value = `${state.sortKey}:${state.sortDirection}`;
  }

  function updateCollectionVisibility() {
    const rows = userRows();
    const visibleRows = rows.filter(row => !row.hidden);
    const total = rows.length;
    elements.visible.textContent = String(visibleRows.length);
    elements.total.textContent = String(total);
    elements.empty.hidden = total !== 0;
    elements.table.hidden = total === 0;
    elements.noResults.hidden = total === 0 || visibleRows.length !== 0;
    const active = Boolean(
      elements.search?.value.trim() || elements.status?.value || elements.type?.value || elements.kaf?.value ||
      state.sortKey !== 'id' || state.sortDirection !== 'desc'
    );
    elements.reset.hidden = !active;
    elements.clearSearch.hidden = !elements.search?.value.trim();
    elements.live.textContent = total ? `Показано ${visibleRows.length} из ${total} пользователей` : 'Пользователей пока нет';
  }

  function sortRows() {
    const rows = userRows();
    rows.forEach((row, index) => {
      if (!state.originalRows.has(row)) state.originalRows.set(row, index);
    });
    rows.sort((left, right) => {
      const result = compareUserValues(sortValue(left, state.sortKey), sortValue(right, state.sortKey), state.sortDirection);
      return result || ((state.originalRows.get(left) || 0) - (state.originalRows.get(right) || 0));
    });
    rows.forEach(row => elements.tbody.insertBefore(row, elements.noResults));
  }

  function applyListState({ updateUrl = true } = {}) {
    const query = normalizeSearchText(elements.search?.value || '');
    const status = elements.status?.value || '';
    const type = elements.type?.value || '';
    const kaf = elements.kaf?.value || '';
    userRows().forEach(row => {
      const user = userFromRow(row);
      const matches = (!query || searchIndex(row).includes(query)) &&
        (!status || user.status === status) &&
        (!type || user.type === type) &&
        (!kaf || user.kaf === kaf);
      row.hidden = !matches;
    });
    sortRows();
    updateSortControls();
    updateCollectionVisibility();
    if (updateUrl) writeUrlState();
  }

  function closeActionMenus(except = null) {
    qsa('.users-action-menu').forEach(menu => {
      if (menu === except) return;
      menu.hidden = true;
      menu.previousElementSibling?.setAttribute('aria-expanded', 'false');
      menu.closest('.user-row')?.classList.remove('user-row--menu-open');
    });
  }

  function setMessage(element, message = '', kind = '') {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('is-error', kind === 'error');
    element.classList.toggle('is-success', kind === 'success');
  }

  function openDrawer(drawer, { focus = true } = {}) {
    if (!drawer) return;
    if (state.activeDrawer && state.activeDrawer !== drawer) closeDrawer(state.activeDrawer, { restoreFocus: false });
    state.lastFocused = document.activeElement;
    state.activeDrawer = drawer;
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('users-drawer-open');
    if (focus) window.setTimeout(() => qs('button[data-close-drawer]', drawer)?.focus(), 20);
  }

  function closeDrawer(drawer = state.activeDrawer, { restoreFocus = true } = {}) {
    if (!drawer) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    if (state.activeDrawer === drawer) state.activeDrawer = null;
    if (!state.activeDrawer) document.body.classList.remove('users-drawer-open');
    if (restoreFocus && state.lastFocused instanceof HTMLElement) state.lastFocused.focus();
  }

  function setTab(name) {
    const id = qs('#f-id')?.value;
    if (!id && name !== 'profile') {
      setMessage(elements.userMessage, 'Сначала сохраните профиль пользователя.', 'error');
      return;
    }
    qsa('.users-tab', elements.userDrawer).forEach(button => button.setAttribute('aria-selected', String(button.dataset.tab === name)));
    qsa('.users-tab-panel', elements.userDrawer).forEach(panel => { panel.hidden = panel.id !== `tab-${name}`; });
    setMessage(elements.userMessage);
  }

  function clearRoles() {
    qsa('.role-checkbox', elements.userDrawer).forEach(box => { box.checked = false; });
  }

  function clearLogins() {
    qsa('#logins-tbody .users-login-row', elements.userDrawer).forEach(row => {
      qs('.login-input', row).value = '';
      const pass = qs('.pass-input', row);
      pass.value = '';
      pass.type = 'password';
      const reveal = qs('.reveal-pass', row);
      reveal?.setAttribute('aria-pressed', 'false');
      reveal?.setAttribute('aria-label', 'Показать PIN/код доступа');
    });
  }

  function fillProfile(user = {}) {
    qs('#f-id').value = user.id ?? '';
    qs('#f-name').value = user.name ?? '';
    qs('#f-kaf').value = user.kaf ?? '';
    qs('#f-type').value = user.type ?? qsa('#f-type option')[0]?.value ?? '';
    qs('#f-status').checked = Number(user.status ?? 1) === 1;
    qs('#f-pin').value = user.pin ?? '';
    qs('#f-messenger-username').value = canonicalNick(user);
    qs('#f-tg-id').value = user.tg_id ?? '';
    qs('#f-allow-discovery').checked = Number(user.allow_discovery_outside_harmony ?? 0) === 1;
    qs('#f-avatar-url-custom').value = user.avatar_url_custom ?? '';
    qs('#f-display-name-custom').value = user.display_name_custom ?? '';
    qs('#user-drawer-title').textContent = user.id ? 'Редактирование пользователя' : 'Новый пользователь';
    qs('#user-drawer-subtitle').textContent = `ID: ${user.id ?? '—'}`;
  }

  function fillRoles(rights = []) {
    const selected = new Set(rights.map(item => `${item.srv_id}:${item.role_id}`));
    qsa('.role-checkbox', elements.userDrawer).forEach(box => { box.checked = selected.has(`${box.dataset.srvId}:${box.dataset.roleId}`); });
  }

  function fillLogins(logins = []) {
    const byService = new Map(logins.map(item => [String(item.srv_id), item]));
    qsa('#logins-tbody .users-login-row', elements.userDrawer).forEach(row => {
      const login = byService.get(row.dataset.srvId) || {};
      qs('.login-input', row).value = login.login || '';
      qs('.pass-input', row).value = login.pass || '';
    });
  }

  async function readApiError(response, fallback) {
    try {
      const body = await response.json();
      return body?.message || fallback;
    } catch (_) {
      return fallback;
    }
  }

  async function loadUser(id) {
    const response = await api(`/api/users/${id}`);
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить пользователя'));
    return response.json();
  }

  async function openUser(id, tab = 'profile') {
    openDrawer(elements.userDrawer);
    setMessage(elements.userMessage, 'Загрузка…');
    try {
      const data = await loadUser(id);
      fillProfile(data.user || {});
      clearRoles();
      fillRoles(data.rights || []);
      clearLogins();
      fillLogins(data.logins || []);
      setTab(tab);
    } catch (error) {
      setMessage(elements.userMessage, error.message, 'error');
    }
  }

  function openCreate() {
    clearRoles();
    clearLogins();
    fillProfile({ status: 1, allow_discovery_outside_harmony: 0 });
    setTab('profile');
    setMessage(elements.userMessage);
    openDrawer(elements.userDrawer);
    window.setTimeout(() => qs('#f-name')?.focus(), 30);
  }

  function assignDataset(row, user) {
    Object.assign(row.dataset, {
      userId: user.id ?? '', userName: user.name ?? '', userKaf: user.kaf ?? '', userType: user.type ?? '',
      userStatus: user.status ?? 0, userPin: user.pin ?? '', userNickname: user.nickname ?? '',
      userMsgnickname: user.msgnickname ?? '', userMsgnicknameNormalized: user.msgnickname_normalized ?? '',
      userTgId: user.tg_id ?? '', userAvatarUrlCustom: user.avatar_url_custom ?? '',
      userDisplayNameCustom: user.display_name_custom ?? '', userAllowDiscoveryOutsideHarmony: user.allow_discovery_outside_harmony ?? 0,
    });
  }

  function updateRow(user) {
    const row = qs(`.user-row[data-user-id="${CSS.escape(String(user.id))}"]`, elements.tbody);
    if (!row) {
      window.location.reload();
      return;
    }
    assignDataset(row, user);
    qs('.user-avatar', row).textContent = String(user.name || '?').trim().charAt(0) || '?';
    qs('.user-name', row).textContent = user.name || '';
    const details = canonicalNick(user) ? `@${canonicalNick(user)}` : 'Ник не указан';
    qs('.user-secondary', row).textContent = details;
    qs('td:nth-child(2) .user-cell-text', row).textContent = labelFor(KAF_LABELS, user.kaf);
    qs('td:nth-child(3) .user-role', row).textContent = labelFor(TYPE_LABELS, user.type);
    const status = qs('td:nth-child(4) .user-status', row);
    status.textContent = Number(user.status) ? 'Активен' : 'Заблокирован';
    status.className = `user-status ${Number(user.status) ? 'user-status--active' : 'user-status--blocked'}`;
    const pin = qs('td:nth-child(5) .user-pin', row);
    pin.textContent = '••••••';
    pin.setAttribute('aria-pressed', 'false');
    pin.setAttribute('aria-label', `Показать PIN пользователя ${user.name || ''}`.trim());
    pin.title = 'Показать PIN';
    qs('.action-menu-toggle', row).setAttribute('aria-label', `Действия пользователя ${user.name || ''}`);
    applyListState();
  }

  async function saveCurrent() {
    const activeTab = qs('.users-tab[aria-selected="true"]', elements.userDrawer)?.dataset.tab || 'profile';
    const currentId = qs('#f-id').value;
    elements.userSave.disabled = true;
    elements.userSave.setAttribute('aria-busy', 'true');
    try {
      if (activeTab === 'profile') {
        const payload = {
          name: qs('#f-name').value.trim(),
          kaf: qs('#f-kaf').value,
          type: Number(qs('#f-type').value || 0),
          status: qs('#f-status').checked ? 1 : 0,
          pin: qs('#f-pin').value.trim(),
          messenger_username: qs('#f-messenger-username').value.trim(),
          tg_id: qs('#f-tg-id').value.trim(),
          allow_discovery_outside_harmony: qs('#f-allow-discovery').checked ? 1 : 0,
          avatar_url_custom: qs('#f-avatar-url-custom').value.trim(),
          display_name_custom: qs('#f-display-name-custom').value.trim(),
        };
        if (!payload.name) {
          qs('#f-name').focus();
          throw new Error('Введите имя пользователя');
        }
        const response = await api(`/api/users${currentId ? `/${currentId}` : ''}`, { method: currentId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
        if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить профиль'));
        const result = await response.json();
        const id = currentId || result.id;
        if (!id) throw new Error('Сервер не вернул ID пользователя');
        const fresh = await loadUser(id);
        fillProfile(fresh.user || { id, ...payload });
        updateRow(fresh.user || { id, ...payload });
        setMessage(elements.userMessage, 'Профиль сохранён', 'success');
      }
      if (activeTab === 'roles') {
        if (!currentId) throw new Error('Сначала сохраните профиль пользователя');
        const pairs = qsa('.role-checkbox:checked', elements.userDrawer).map(box => ({ srv_id: Number(box.dataset.srvId), role_id: Number(box.dataset.roleId) }));
        const response = await api(`/api/users/${currentId}/rights`, { method: 'PUT', body: JSON.stringify({ pairs }) });
        if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить доступы'));
        setMessage(elements.userMessage, 'Доступы сохранены', 'success');
      }
      if (activeTab === 'logins') {
        if (!currentId) throw new Error('Сначала сохраните профиль пользователя');
        const rows = qsa('#logins-tbody .users-login-row', elements.userDrawer).map(row => ({
          srv_id: Number(row.dataset.srvId), login: qs('.login-input', row).value.trim(), new_password: qs('.pass-input', row).value,
        }));
        const response = await api(`/api/users/${currentId}/logins`, { method: 'PUT', body: JSON.stringify({ rows }) });
        if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить учётные записи'));
        setMessage(elements.userMessage, 'Учётные записи сохранены', 'success');
      }
    } catch (error) {
      setMessage(elements.userMessage, error.message, 'error');
    } finally {
      elements.userSave.disabled = false;
      elements.userSave.removeAttribute('aria-busy');
    }
  }

  async function deleteUser(row) {
    const user = userFromRow(row);
    if (!window.confirm(`Удалить пользователя «${user.name}» (ID: ${user.id})?`)) return;
    const response = await api(`/api/users/${user.id}`, { method: 'DELETE' });
    if (!response.ok) {
      window.alert(await readApiError(response, 'Не удалось удалить пользователя'));
      return;
    }
    row.remove();
    qs(`.users-issue-item[data-user-id="${CSS.escape(String(user.id))}"]`)?.remove();
    applyListState();
  }

  function initServiceRoles() {
    qsa('#service-roles-tbody tr').forEach(row => {
      const allowed = new Set((row.dataset.allowedRoles || '').split(',').filter(Boolean));
      qsa('.service-role-checkbox', row).forEach(box => { box.checked = allowed.has(box.dataset.roleId); });
    });
  }

  async function saveServiceRoles() {
    const button = qs('#btn-save-service-roles');
    const pairs = [];
    qsa('#service-roles-tbody tr').forEach(row => {
      qsa('.service-role-checkbox:checked', row).forEach(box => pairs.push({ srv_id: Number(row.dataset.srvId), role_id: Number(box.dataset.roleId) }));
    });
    button.disabled = true;
    try {
      const response = await api('/api/srvs-roles', { method: 'PUT', body: JSON.stringify({ pairs }) });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить роли сервисов'));
      qsa('#service-roles-tbody tr').forEach(row => { row.dataset.allowedRoles = qsa('.service-role-checkbox:checked', row).map(box => box.dataset.roleId).join(','); });
      setMessage(elements.serviceMessage, 'Настройки сохранены', 'success');
    } catch (error) {
      setMessage(elements.serviceMessage, error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function trapFocus(event) {
    if (event.key !== 'Tab' || !state.activeDrawer) return;
    const focusable = qsa('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href]', state.activeDrawer).filter(item => !item.hidden && item.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  qs('#btn-create-user')?.addEventListener('click', openCreate);
  qs('#btn-open-issues')?.addEventListener('click', () => openDrawer(elements.issuesDrawer));
  qs('#btn-srvs-roles')?.addEventListener('click', () => { initServiceRoles(); setMessage(elements.serviceMessage); openDrawer(elements.serviceDrawer); });
  qs('#btn-save-service-roles')?.addEventListener('click', saveServiceRoles);
  elements.userSave?.addEventListener('click', saveCurrent);
  elements.search?.addEventListener('input', () => applyListState());
  elements.status?.addEventListener('change', () => applyListState());
  elements.type?.addEventListener('change', () => applyListState());
  elements.kaf?.addEventListener('change', () => applyListState());
  elements.clearSearch?.addEventListener('click', () => { elements.search.value = ''; elements.search.focus(); applyListState(); });
  elements.reset?.addEventListener('click', () => {
    elements.search.value = ''; elements.status.value = ''; elements.type.value = ''; elements.kaf.value = '';
    state.sortKey = 'id'; state.sortDirection = 'desc'; applyListState();
  });
  elements.mobileSort?.addEventListener('change', () => {
    const [key, direction] = elements.mobileSort.value.split(':');
    state.sortKey = key; state.sortDirection = direction; applyListState();
  });
  qsa('.users-sort-button').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.sort;
    state.sortDirection = state.sortKey === key && state.sortDirection === 'asc' ? 'desc' : 'asc';
    state.sortKey = key;
    applyListState();
  }));
  elements.tbody?.addEventListener('click', event => {
    const toggle = event.target.closest('.action-menu-toggle');
    if (toggle) {
      const menu = toggle.nextElementSibling;
      const willOpen = menu.hidden;
      closeActionMenus(willOpen ? menu : null);
      menu.hidden = !willOpen;
      toggle.setAttribute('aria-expanded', String(willOpen));
      toggle.closest('.user-row')?.classList.toggle('user-row--menu-open', willOpen);
      return;
    }
    const action = event.target.closest('[data-open-tab], [data-action="delete"]');
    if (!action) return;
    const row = action.closest('.user-row');
    closeActionMenus();
    if (action.dataset.action === 'delete') deleteUser(row);
    else openUser(row.dataset.userId, action.dataset.openTab);
  });
  qsa('.users-tab', elements.userDrawer).forEach(button => button.addEventListener('click', () => setTab(button.dataset.tab)));
  qsa('.user-pin-reveal').forEach(button => button.addEventListener('click', () => {
    const row = button.closest('.user-row');
    const shown = button.getAttribute('aria-pressed') === 'true';
    button.textContent = shown ? '••••••' : (row?.dataset.userPin || '—');
    button.setAttribute('aria-pressed', String(!shown));
    button.setAttribute('aria-label', `${shown ? 'Показать' : 'Скрыть'} PIN пользователя ${row?.dataset.userName || ''}`.trim());
    button.title = shown ? 'Показать PIN' : 'Скрыть PIN';
  }));
  elements.userDrawer?.addEventListener('click', event => {
    const reveal = event.target.closest('.reveal-pass');
    if (!reveal) return;
    const input = qs('.pass-input', reveal.closest('.users-code-wrap'));
    const shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    reveal.setAttribute('aria-pressed', String(!shown));
    reveal.setAttribute('aria-label', shown ? 'Показать PIN/код доступа' : 'Скрыть PIN/код доступа');
  });
  qsa('[data-close-drawer]').forEach(button => button.addEventListener('click', () => closeDrawer(button.closest('.users-drawer'))));
  qs('#issues-search')?.addEventListener('input', event => {
    const query = normalizeSearchText(event.target.value);
    qsa('.users-issue-item').forEach(item => { item.hidden = Boolean(query) && !normalizeSearchText(item.dataset.search).includes(query); });
  });
  qs('#issues-list')?.addEventListener('click', event => {
    const item = event.target.closest('.users-issue-item');
    if (!item) return;
    closeDrawer(elements.issuesDrawer, { restoreFocus: false });
    openUser(item.dataset.userId, 'roles');
  });
  qs('#service-roles-search')?.addEventListener('input', event => {
    const query = normalizeSearchText(event.target.value);
    qsa('#service-roles-tbody tr').forEach(row => { row.hidden = Boolean(query) && !normalizeSearchText(row.dataset.srvName).includes(query); });
  });
  qs('#service-roles-tbody')?.addEventListener('click', event => {
    const button = event.target.closest('[data-service-action]');
    if (!button) return;
    qsa('.service-role-checkbox', button.closest('tr')).forEach(box => { box.checked = button.dataset.serviceAction === 'all'; });
  });
  document.addEventListener('click', event => { if (!event.target.closest('.user-actions')) closeActionMenus(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (state.activeDrawer) closeDrawer();
      else closeActionMenus();
    }
    trapFocus(event);
  });

  readUrlState();
  applyListState({ updateUrl: false });
}
