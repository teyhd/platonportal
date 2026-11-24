import { createUserFamilyTools } from './user-family-tools.js?v=4';

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

export function formatBirthDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return '';
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  }).format(date);
}

export function normalizeUserDetailsPayload(data) {
  const user = data?.user;
  if (data?.ok !== true || !user || user.id == null || user.id === '' ||
      !Array.isArray(data.rights) || !Array.isArray(data.logins)) return null;

  return { user, rights: data.rights, logins: data.logins };
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
    workspace: qs('.users-workspace'),
    table: qs('#users-table'),
    empty: qs('#users-empty'),
    noResults: qs('#users-no-results'),
    visible: qs('#users-visible'),
    total: qs('#users-total'),
    live: qs('#users-live'),
    search: qs('#user-search'),
    status: qs('#filter-status'),
    type: qs('#filter-type'),
    kaf: qs('#filter-kaf'),
    reset: qs('#users-reset'),
    mobileSort: qs('#mobile-sort'),
    userDrawer: qs('#user-drawer'),
    userMessage: qs('#user-drawer-message'),
    userRetry: qs('#btn-retry-user'),
    issuesButton: qs('#btn-open-issues'),
    issuesList: qs('#issues-list'),
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
    currentUserId: null,
    userDetailsState: 'idle',
    userLoadSequence: 0,
    userSaving: false,
    userDrafts: new Set(),
    userLoadTarget: null,
    savedUserType: null,
  };

  const TYPE_LABELS = Object.fromEntries(qsa('#f-type option').map(option => [option.value, option.textContent.trim()]));
  const KAF_LABELS = Object.fromEntries(qsa('#f-kaf option').filter(option => option.value).map(option => [option.value, option.textContent.trim()]));
  const EXTERNAL_ROLE_ID = -1;

  function userRows() {
    return qsa('.user-row', elements.tbody);
  }

  const familyDrawer = qs('#user-family-tools');
  const familyTools = createUserFamilyTools({
    drawer: familyDrawer, openDrawer,
  });

  function labelFor(map, value) {
    return map[String(value ?? '')] || '—';
  }

  function canonicalNick(user) {
    const raw = String(user.msgnickname_normalized || user.msgnickname || '').trim();
    if (!raw) return '';
    return raw.replace(/^@+/, '');
  }

  function messengerNick(user) {
    const raw = String(user.msgnickname_normalized || user.msgnickname || '').trim();
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
      birth_date: d.userBirthDate,
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
      user.birth_date,
      formatBirthDate(user.birth_date),
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
    const allowedKeys = new Set(['id', 'name', 'kaf', 'type', 'status', 'pin', 'birth_date', 'nick']);
    const sort = params.get('sort');
    const direction = params.get('dir');
    if (allowedKeys.has(sort)) state.sortKey = sort;
    if (direction === 'asc' || direction === 'desc') state.sortDirection = direction;
    // Search is intentionally transient: it must not be restored from a shared URL
    // or from the browser's back-forward cache.
    if (elements.search) elements.search.value = '';
    if (elements.status) elements.status.value = params.get('status') || '';
    if (elements.type) elements.type.value = params.get('type') || '';
    if (elements.kaf) elements.kaf.value = params.get('kaf') || '';
  }

  function writeUrlState() {
    const params = new URLSearchParams(window.location.search);
    const values = {
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
    // Drop legacy search links as well, so a copied URL never reopens a search.
    params.delete('q');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }

  function clearTransientSearch() {
    if (!elements.search?.value) return;
    elements.search.value = '';
    applyListState();
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
    elements.live.textContent = total ? `Показано ${visibleRows.length} из ${total} пользователей` : 'Пользователей пока нет';
  }

  function sortRows() {
    const rows = userRows();
    rows.forEach((row, index) => {
      if (!state.originalRows.has(row)) state.originalRows.set(row, index);
    });
    rows.sort((left, right) => {
      const leftValue = sortValue(left, state.sortKey);
      const rightValue = sortValue(right, state.sortKey);
      if (state.sortKey === 'birth_date') {
        const leftMissing = !leftValue;
        const rightMissing = !rightValue;
        if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
      }
      const result = compareUserValues(leftValue, rightValue, state.sortDirection);
      return result || ((state.originalRows.get(left) || 0) - (state.originalRows.get(right) || 0));
    });
    rows.forEach(row => elements.tbody.insertBefore(row, elements.noResults));
  }

  function applyListState() {
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
    writeUrlState();
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

  function openDrawer(drawer, { focus = true, opener = document.activeElement } = {}) {
    if (!drawer) return false;
    if (state.activeDrawer && state.activeDrawer !== drawer && !closeDrawer(state.activeDrawer, { restoreFocus: false })) return false;
    state.lastFocused = opener;
    state.activeDrawer = drawer;
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    elements.workspace.inert = true;
    document.body.classList.add('users-drawer-open');
    if (focus) window.setTimeout(() => {
      if (state.activeDrawer === drawer && !drawer.contains(document.activeElement)) {
        qs('button[data-close-drawer]', drawer)?.focus();
      }
    }, 20);
  }

  function closeDrawer(drawer = state.activeDrawer, { restoreFocus = true, discardFamilyDraft = false, force = false } = {}) {
    if (!drawer) return;
    if (drawer === elements.userDrawer) {
      if (state.userSaving) return false;
      if (state.userDrafts.size && !window.confirm('Закрыть форму и потерять несохранённые изменения?')) return false;
      state.userLoadSequence += 1;
      state.currentUserId = null;
      state.userLoadTarget = null;
      state.userDetailsState = 'idle';
      state.userDrafts.clear();
    }
    if (drawer === familyDrawer) {
      if (!force && !familyTools?.canClose({ discard: discardFamilyDraft })) return false;
      familyTools?.clear();
    }
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    if (state.activeDrawer === drawer) state.activeDrawer = null;
    if (!state.activeDrawer) {
      elements.workspace.inert = false;
      document.body.classList.remove('users-drawer-open');
    }
    if (restoreFocus && state.lastFocused instanceof HTMLElement) {
      if (state.lastFocused.getClientRects().length) state.lastFocused.focus();
      else elements.search?.focus();
    }
    return true;
  }

  function currentTab() {
    return qs('.users-tab[aria-selected="true"]', elements.userDrawer)?.dataset.tab || 'profile';
  }

  function renderUserControls() {
    const { userDetailsState, userSaving } = state;
    const ready = userDetailsState === 'ready';
    const editable = (ready || userDetailsState === 'new') && !userSaving;
    const tab = currentTab();
    qsa('.users-tab-panel input, .users-tab-panel select, .users-tab-panel button', elements.userDrawer)
      .forEach(control => { control.disabled = !editable; });
    qsa('.users-tab', elements.userDrawer).forEach(button => {
      button.disabled = userSaving || (button.dataset.tab !== 'profile' &&
        (!ready || (button.dataset.tab === 'roles' && Number(state.savedUserType) === EXTERNAL_ROLE_ID)));
    });
    qsa('button[data-close-drawer]', elements.userDrawer).forEach(button => { button.disabled = userSaving; });
    qs('.users-drawer-body', elements.userDrawer).setAttribute('aria-busy', String(userDetailsState === 'loading' || userSaving));
    elements.userRetry.hidden = userDetailsState !== 'error';
    elements.userSave.disabled = !editable || (tab !== 'profile' && !ready);
    elements.userSave.textContent = {
      profile: 'Сохранить профиль', roles: 'Сохранить доступы', logins: 'Сохранить учётные записи',
    }[tab];
    updateMissingRoleAction();
  }

  function setTab(name) {
    const id = state.currentUserId || qs('#f-id')?.value;
    if (!id && name !== 'profile') {
      setMessage(elements.userMessage, 'Сначала сохраните профиль пользователя.', 'error');
      return;
    }
    if (name === 'roles' && Number(state.savedUserType) === EXTERNAL_ROLE_ID) {
      setMessage(elements.userMessage, 'Внешним пользователям роли сервисов не назначаются.', 'error');
      return;
    }
    qsa('.users-tab', elements.userDrawer).forEach(button => {
      const selected = button.dataset.tab === name;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    qsa('.users-tab-panel', elements.userDrawer).forEach(panel => { panel.hidden = panel.id !== `tab-${name}`; });
    setMessage(elements.userMessage);
    renderUserControls();
  }

  function clearRoles() {
    qsa('.role-checkbox', elements.userDrawer).forEach(box => { box.checked = false; });
  }

  function isExternalUser() {
    return Number(qs('#f-type')?.value) === EXTERNAL_ROLE_ID;
  }

  function syncExternalRoleState() {
    const isExternal = isExternalUser();
    const rolesTab = qs('#tab-roles-button');
    qs('#external-role-hint').hidden = !isExternal;

    if (Number(state.savedUserType) === EXTERNAL_ROLE_ID && rolesTab.getAttribute('aria-selected') === 'true') setTab('profile');
    renderUserControls();
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
    qs('#f-birth-date').value = user.birth_date ?? '';
    qs('#f-display-name-custom').value = user.nickname ?? '';
    qs('#f-messenger-username').value = messengerNick(user);
    qs('#f-tg-id').value = user.tg_id ?? '';
    qs('#f-allow-discovery').checked = Number(user.allow_discovery_outside_harmony ?? 0) === 1;
    qs('#f-avatar-url-custom').value = user.avatar_url_custom ?? '';
    syncExternalRoleState();
    qs('#user-drawer-title').textContent = user.id ? (user.name || 'Редактирование пользователя') : 'Новый пользователь';
    qs('#user-drawer-subtitle').textContent = `ID: ${user.id ?? '—'}`;
  }

  function fillRoles(rights = []) {
    if (Number(state.savedUserType) === EXTERNAL_ROLE_ID) {
      clearRoles();
      return;
    }
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
    let body = null;
    try {
      body = await response.json();
    } catch (_) {
      // Обрабатываем это ниже единым сообщением, чтобы форма не оставалась пустой.
    }
    if (!response.ok) throw new Error(body?.message || 'Не удалось загрузить пользователя');
    const details = normalizeUserDetailsPayload(body);
    if (!details || String(details.user.id) !== String(id)) throw new Error(body?.message || 'Сервер вернул неполные данные пользователя');
    return details;
  }

  function openUser(row, tab = 'profile', opener = qs('.action-menu-toggle', row)) {
    const fallbackUser = userFromRow(row);
    const id = String(fallbackUser.id || '').trim();
    if (!id) {
      setMessage(elements.userMessage, 'Не удалось определить пользователя для редактирования.', 'error');
      return;
    }

    state.userLoadTarget = { id, tab };
    state.userDrafts.clear();
    state.currentUserId = id;
    state.savedUserType = fallbackUser.type;
    state.userDetailsState = 'loading';
    fillProfile(fallbackUser);
    clearRoles();
    clearLogins();
    setTab('profile');
    openDrawer(elements.userDrawer, { opener });
    loadUserDrawer();
  }

  async function loadUserDrawer() {
    const { id, tab } = state.userLoadTarget;
    const request = ++state.userLoadSequence;
    state.userDetailsState = 'loading';
    renderUserControls();
    setMessage(elements.userMessage, 'Загрузка…');
    try {
      const data = await loadUser(id);
      if (request !== state.userLoadSequence) return;

      state.currentUserId = String(data.user.id);
      state.savedUserType = data.user.type;
      state.userDetailsState = 'ready';
      if (!state.userDrafts.has('profile')) fillProfile(data.user);
      if (!state.userDrafts.has('roles')) fillRoles(data.rights);
      if (!state.userDrafts.has('logins')) fillLogins(data.logins);
      updateAccessIssue(data);
      setTab(tab === 'roles' && Number(state.savedUserType) === EXTERNAL_ROLE_ID ? 'profile' : tab);
      if (document.activeElement === document.body) qs('.users-tab[aria-selected="true"]', elements.userDrawer)?.focus();
    } catch (error) {
      if (request !== state.userLoadSequence) return;

      state.userDetailsState = 'error';
      setTab('profile');
      setMessage(elements.userMessage, `${error.message}. Повторите загрузку, чтобы внести изменения.`, 'error');
    }
  }

  function openCreate() {
    state.userDrafts.clear();
    state.userLoadSequence += 1;
    state.currentUserId = null;
    state.savedUserType = null;
    state.userLoadTarget = null;
    state.userDetailsState = 'new';
    clearRoles();
    clearLogins();
    fillProfile({ status: 1, allow_discovery_outside_harmony: 0 });
    setTab('profile');
    setMessage(elements.userMessage);
    openDrawer(elements.userDrawer);
    window.setTimeout(() => {
      if (state.activeDrawer === elements.userDrawer && state.userDetailsState === 'new') qs('#f-name')?.focus();
    }, 30);
  }

  function assignDataset(row, user) {
    Object.assign(row.dataset, {
      userId: user.id ?? '', userName: user.name ?? '', userKaf: user.kaf ?? '', userType: user.type ?? '',
      userStatus: user.status ?? 0, userPin: user.pin ?? '', userNickname: user.nickname ?? '',
      userMsgnickname: user.msgnickname ?? '', userMsgnicknameNormalized: user.msgnickname_normalized ?? '',
      userBirthDate: user.birth_date ?? '',
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
    const details = [
      canonicalNick(user) ? `@${canonicalNick(user)}` : 'Ник не указан',
      formatBirthDate(user.birth_date),
    ].filter(Boolean).join(' · ');
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

  function missingPrimaryRoles(user, rights) {
    const type = String(user.type);
    if (Number(type) === EXTERNAL_ROLE_ID || user.lifecycle_state !== 'active') return [];
    // Match the required-service filter in get_err_roles_users.
    const existing = new Set(rights.map(item => `${item.srv_id}:${item.role_id}`));
    return qsa('#service-roles-tbody tr').filter(row => {
      const { srvId, allowedRoles } = row.dataset;
      return Number(srvId) < 10 && allowedRoles.split(',').includes(type) && !existing.has(`${srvId}:${type}`);
    });
  }

  function updateIssueVisibility() {
    const items = qsa('.users-issue-item', elements.issuesList);
    qs('#users-issues-count').textContent = items.length;
    elements.issuesButton.hidden = items.length === 0;
    qs('#users-no-issues').hidden = items.length > 0;
    const query = normalizeSearchText(qs('#issues-search').value);
    items.forEach(item => { item.hidden = Boolean(query) && !normalizeSearchText(item.dataset.search).includes(query); });
    qs('#issues-empty').textContent = items.length ? 'По вашему запросу ничего не найдено.' : 'Проблем доступа нет.';
    qs('#issues-empty').hidden = items.some(item => !item.hidden);
  }

  function updateAccessIssue({ user, rights }) {
    const matching = qs(`.users-issue-item[data-user-id="${CSS.escape(String(user.id))}"]`, elements.issuesList);
    const missing = missingPrimaryRoles(user, rights);
    if (!missing.length) matching?.remove();
    else {
      const item = matching || qs('#users-issue-template').content.firstElementChild.cloneNode(true);
      const names = missing.map(row => row.dataset.srvName).join(', ');
      item.dataset.userId = user.id;
      item.dataset.missingSrvIds = missing.map(row => row.dataset.srvId).join(',');
      item.dataset.search = `${user.name} ${user.id} ${names}`;
      qs('.users-issue-name', item).textContent = user.name;
      qs('.users-issue-meta', item).textContent = `ID: ${user.id}`;
      qs('.users-issue-missing', item).textContent = names;
      if (!matching) elements.issuesList.append(item);
    }
    updateIssueVisibility();
  }

  function missingRoleBoxes() {
    const issue = qs(`.users-issue-item[data-user-id="${CSS.escape(String(state.currentUserId))}"]`, elements.issuesList);
    const missing = new Set((issue?.dataset.missingSrvIds || '').split(','));
    const userType = String(state.savedUserType);
    return qsa('.role-checkbox', elements.userDrawer)
      .filter(box => missing.has(box.dataset.srvId) && box.dataset.roleId === userType && !box.checked);
  }

  function updateMissingRoleAction() {
    const action = qs('#btn-add-missing-roles');
    action.hidden = state.userDetailsState !== 'ready' || !missingRoleBoxes().length;
    action.disabled = state.userSaving;
  }

  async function saveCurrent() {
    const activeTab = currentTab();
    const currentId = state.currentUserId;
    const canCreate = state.userDetailsState === 'new' && activeTab === 'profile';
    if (state.userSaving || (!canCreate && state.userDetailsState !== 'ready')) return;
    state.userSaving = true;
    renderUserControls();
    try {
      if (activeTab === 'profile') {
        const payload = {
          name: qs('#f-name').value.trim(),
          kaf: qs('#f-kaf').value,
          type: Number(qs('#f-type').value || 0),
          status: qs('#f-status').checked ? 1 : 0,
          pin: qs('#f-pin').value.trim(),
          birth_date: qs('#f-birth-date').value,
          nickname: qs('#f-display-name-custom').value.trim(),
          messenger_username: qs('#f-messenger-username').value.trim(),
          tg_id: qs('#f-tg-id').value.trim(),
          allow_discovery_outside_harmony: qs('#f-allow-discovery').checked ? 1 : 0,
          avatar_url_custom: qs('#f-avatar-url-custom').value.trim(),
        };
        if (!payload.name) {
          throw new Error('Введите имя пользователя');
        }
        if (currentId && isExternalUser() && Number(state.savedUserType) !== EXTERNAL_ROLE_ID &&
            !window.confirm('При переводе во внешние пользователи роли сервисов будут сняты. Сохранить профиль?')) return;
        const response = await api(`/api/users${currentId ? `/${currentId}` : ''}`, { method: currentId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
        if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить профиль'));
        const result = await response.json();
        const id = currentId || result.id;
        if (!id) throw new Error('Сервер не вернул ID пользователя');
        state.currentUserId = String(id);
        state.savedUserType = payload.type;
        state.userLoadTarget = { id: String(id), tab: 'profile' };
        state.userDetailsState = 'ready';
        state.userDrafts.delete('profile');
        if (payload.type === EXTERNAL_ROLE_ID) {
          clearRoles();
          state.userDrafts.delete('roles');
        }
        const row = qs(`.user-row[data-user-id="${CSS.escape(String(id))}"]`, elements.tbody);
        const messengerUsername = normalizeSearchText(payload.messenger_username);
        const localUser = {
          ...(row ? userFromRow(row) : {}),
          id,
          ...payload,
          msgnickname: messengerUsername,
          msgnickname_normalized: messengerUsername,
        };
        fillProfile(localUser);
        updateRow(localUser);
        try {
          const fresh = await loadUser(id);
          state.savedUserType = fresh.user.type;
          fillProfile(fresh.user);
          if (!state.userDrafts.has('roles')) fillRoles(fresh.rights);
          if (!state.userDrafts.has('logins')) fillLogins(fresh.logins);
          if (isExternalUser()) state.userDrafts.delete('roles');
          updateRow(fresh.user);
          updateAccessIssue(fresh);
          setMessage(elements.userMessage, 'Профиль сохранён', 'success');
        } catch (_) {
          state.userDetailsState = 'error';
          setMessage(elements.userMessage, 'Профиль сохранён. Повторите загрузку, чтобы продолжить работу.', 'error');
        }
      }
      if (activeTab === 'roles') {
        if (!currentId) throw new Error('Сначала сохраните профиль пользователя');
        if (Number(state.savedUserType) === EXTERNAL_ROLE_ID) {
          clearRoles();
          setMessage(elements.userMessage, 'Внешним пользователям роли сервисов не назначаются.', 'success');
          return;
        }
        const pairs = qsa('.role-checkbox:checked', elements.userDrawer).map(box => ({ srv_id: Number(box.dataset.srvId), role_id: Number(box.dataset.roleId) }));
        const response = await api(`/api/users/${currentId}/rights`, { method: 'PUT', body: JSON.stringify({ pairs }) });
        if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить доступы'));
        state.userDrafts.delete('roles');
        try {
          const fresh = await loadUser(currentId);
          fillRoles(fresh.rights);
          updateAccessIssue(fresh);
          setMessage(elements.userMessage, 'Доступы сохранены', 'success');
        } catch (_) {
          state.userDetailsState = 'error';
          state.userLoadTarget = { id: currentId, tab: 'roles' };
          setTab('profile');
          setMessage(elements.userMessage, 'Доступы сохранены. Повторите загрузку, чтобы обновить список проблем доступа.', 'error');
        }
      }
      if (activeTab === 'logins') {
        if (!currentId) throw new Error('Сначала сохраните профиль пользователя');
        const rows = qsa('#logins-tbody .users-login-row', elements.userDrawer).map(row => ({
          srv_id: Number(row.dataset.srvId), login: qs('.login-input', row).value.trim(), new_password: qs('.pass-input', row).value,
        }));
        const response = await api(`/api/users/${currentId}/logins`, { method: 'PUT', body: JSON.stringify({ rows }) });
        if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить учётные записи'));
        state.userDrafts.delete('logins');
        setMessage(elements.userMessage, 'Учётные записи сохранены', 'success');
      }
    } catch (error) {
      setMessage(elements.userMessage, error.message, 'error');
    } finally {
      state.userSaving = false;
      renderUserControls();
      if (activeTab === 'profile' && !qs('#f-name').value.trim()) qs('#f-name').focus();
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
    updateIssueVisibility();
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
      setMessage(elements.serviceMessage, 'Настройки сохранены. Обновите страницу перед назначением ролей пользователям.', 'success');
    } catch (error) {
      setMessage(elements.serviceMessage, error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function trapFocus(event) {
    if (event.key !== 'Tab' || !state.activeDrawer) return;
    const focusable = qsa('button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [href]', state.activeDrawer)
      .filter(item => item.tabIndex >= 0 && item.getClientRects().length);
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!state.activeDrawer.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  qs('#btn-create-user')?.addEventListener('click', openCreate);
  qs('#btn-open-issues')?.addEventListener('click', () => openDrawer(elements.issuesDrawer));
  qs('#btn-srvs-roles')?.addEventListener('click', () => { initServiceRoles(); setMessage(elements.serviceMessage); openDrawer(elements.serviceDrawer); });
  qs('#btn-save-service-roles')?.addEventListener('click', saveServiceRoles);
  elements.userSave?.addEventListener('click', saveCurrent);
  elements.userRetry?.addEventListener('click', loadUserDrawer);
  qs('#form-profile')?.addEventListener('submit', event => {
    event.preventDefault();
    if (currentTab() === 'profile') saveCurrent();
  });
  elements.userDrawer?.addEventListener('input', event => {
    const panel = event.target.closest('.users-tab-panel');
    if (panel && !state.userSaving) state.userDrafts.add(panel.id.replace('tab-', ''));
    if (panel?.id === 'tab-roles') updateMissingRoleAction();
  });
  qs('#btn-add-missing-roles')?.addEventListener('click', () => {
    missingRoleBoxes().forEach(box => { box.checked = true; });
    state.userDrafts.add('roles');
    updateMissingRoleAction();
    setMessage(elements.userMessage, 'Недостающие роли отмечены. Сохраните доступы, чтобы применить изменения.');
    elements.userSave.focus();
  });
  elements.search?.addEventListener('input', () => applyListState());
  elements.status?.addEventListener('change', () => applyListState());
  elements.type?.addEventListener('change', () => applyListState());
  elements.kaf?.addEventListener('change', () => applyListState());
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
  function showActionMenu(toggle, { last = false } = {}) {
    const menu = toggle.nextElementSibling;
    closeActionMenus(menu);
    menu.style.maxHeight = '';
    menu.classList.remove('users-action-menu--up');
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    toggle.closest('.user-row')?.classList.add('user-row--menu-open');
    const { top, bottom } = toggle.getBoundingClientRect();
    const spaceBelow = window.innerHeight - bottom - 12;
    const spaceAbove = top - 12;
    const opensUp = spaceBelow < menu.offsetHeight && spaceAbove > spaceBelow;
    menu.classList.toggle('users-action-menu--up', opensUp);
    menu.style.maxHeight = Math.max(44, opensUp ? spaceAbove : spaceBelow) + 'px';
    const items = qsa('[role="menuitem"]', menu);
    (last ? items.at(-1) : items[0])?.focus({ preventScroll: true });
  }

  elements.tbody?.addEventListener('keydown', event => {
    const toggle = event.target.closest('.action-menu-toggle');
    if (toggle && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      showActionMenu(toggle, { last: event.key === 'ArrowUp' });
      return;
    }
    const menu = event.target.closest('.users-action-menu');
    if (!menu) return;
    if (event.key === 'Tab') {
      const opener = menu.previousElementSibling;
      closeActionMenus();
      opener.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = qsa('[role="menuitem"]', menu);
    const position = items.indexOf(event.target);
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
      (position + offset + items.length) % items.length;
    items[next]?.focus();
  });

  elements.tbody?.addEventListener('click', event => {
    const toggle = event.target.closest('.action-menu-toggle');
    if (toggle) {
      if (toggle.nextElementSibling.hidden) showActionMenu(toggle);
      else closeActionMenus();
      return;
    }
    const action = event.target.closest('[data-open-tab], [data-family-tool], [data-action="delete"]');
    if (!action) return;
    const row = action.closest('.user-row');
    closeActionMenus();
    if (action.dataset.action === 'delete') deleteUser(row);
    else if (action.dataset.familyTool) familyTools?.open(userFromRow(row), action.dataset.familyTool, qs('.action-menu-toggle', row));
    else openUser(row, action.dataset.openTab);
  });
  qsa('.users-tab', elements.userDrawer).forEach(button => button.addEventListener('click', () => setTab(button.dataset.tab)));
  qs('.users-tabs', elements.userDrawer).addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = qsa('.users-tab:not([disabled])', elements.userDrawer);
    const index = tabs.indexOf(event.target);
    if (index === -1) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    setTab(next.dataset.tab);
    next.focus();
  });
  qs('#f-type')?.addEventListener('change', syncExternalRoleState);
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
  qsa('[data-close-drawer]').forEach(button => button.addEventListener('click', () => {
    closeDrawer(button.closest('.users-drawer'), { discardFamilyDraft: button.hasAttribute('data-family-cancel') });
  }));
  qs('#issues-search')?.addEventListener('input', updateIssueVisibility);
  qs('#issues-list')?.addEventListener('click', event => {
    const item = event.target.closest('.users-issue-item');
    if (!item) return;
    closeDrawer(elements.issuesDrawer, { restoreFocus: false });
    const row = qs(`.user-row[data-user-id="${CSS.escape(String(item.dataset.userId))}"]`, elements.tbody);
    if (row) openUser(row, 'roles', elements.issuesButton);
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
      else {
        const opener = qs('.action-menu-toggle[aria-expanded="true"]', elements.tbody);
        closeActionMenus();
        opener?.focus();
      }
    }
    trapFocus(event);
  });
  window.addEventListener('pagehide', clearTransientSearch);
  window.addEventListener('pagehide', () => {
    if (familyDrawer && state.activeDrawer === familyDrawer) closeDrawer(familyDrawer, { restoreFocus: false, force: true });
  });
  window.addEventListener('pageshow', clearTransientSearch);

  readUrlState();
  applyListState();
  updateIssueVisibility();
  renderUserControls();
}
