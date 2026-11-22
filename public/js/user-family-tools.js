const serviceNames = {
  portal: 'Портал', bookpc: 'Бронирование компьютеров', zayavki: 'Заявки',
  msg: 'Балалайка', vote: 'Голосование', buy: 'Закупки', chess: 'Шахматы',
};
const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function childIdentity(child, { active = true } = {}) {
  return [child.className || 'Класс не указан', `ID ${child.id}`, active ? '' : 'Неактивен'].filter(Boolean).join(' · ');
}

function record(title, detail) {
  const content = node('div', 'users-family-record');
  content.append(node('strong', '', title));
  if (detail) content.append(node('small', '', detail));
  return content;
}

export function createUserFamilyTools({ drawer, openDrawer }) {
  if (!drawer) return null;
  const $ = selector => drawer.querySelector(selector);
  const editor = $('[data-family-editor]');
  const preview = $('[data-service-preview]');
  const status = $('[data-family-tools-status]');
  const retry = $('[data-family-tools-retry]');
  const search = $('[data-family-search]');
  const dropdown = $('[data-family-dropdown]');
  const candidatesList = $('[data-family-results]');
  const searchStatus = $('[data-family-search-status]');
  const childrenList = $('[data-family-linked]');
  const changes = $('[data-family-changes]');
  const save = $('[data-family-save]');
  const serviceSelect = $('[data-preview-service]');
  const childSelect = $('[data-preview-child]');
  const entries = $('[data-preview-entries]');
  const date = $('[data-preview-date]');
  let targetId, mode, revision, retryAction, requestController, searchController, searchTimer;
  let requestRun = 0, searchRun = 0, activeOption = -1, candidates = [], saving = false, loading = false, conflict = false;
  let original = new Map(), draft = new Map(), services = [], children = [];

  function showStatus(message = '', { kind = '', action, label = 'Повторить' } = {}) {
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('is-error', kind === 'error');
    status.classList.toggle('is-success', kind === 'success');
    retry.hidden = !action;
    retry.textContent = label;
    retryAction = action;
  }

  function closeSearch() {
    searchRun += 1;
    clearTimeout(searchTimer);
    searchController?.abort();
    dropdown.hidden = true;
    search.setAttribute('aria-expanded', 'false');
    search.removeAttribute('aria-activedescendant');
    searchStatus.textContent = '';
    candidatesList.replaceChildren();
    candidates = [];
    activeOption = -1;
  }

  function clear() {
    requestRun += 1;
    requestController?.abort();
    closeSearch();
    targetId = null;
    mode = null;
    revision = null;
    original.clear();
    draft.clear();
    services = [];
    children = [];
    saving = false;
    loading = conflict = false;
    showStatus();
    search.value = '';
    search.disabled = true;
    childrenList.replaceChildren();
    $('[data-family-linked-section]').hidden = true;
    changes.hidden = true;
    save.disabled = true;
    save.textContent = 'Сохранить';
    serviceSelect.replaceChildren();
    childSelect.replaceChildren();
    entries.replaceChildren();
    $('[data-preview-roles]').replaceChildren();
    $('[data-preview-controls]').hidden = true;
    $('[data-preview-details]').hidden = true;
    date.hidden = true;
    editor.removeAttribute('aria-busy');
    preview.removeAttribute('aria-busy');
    drawer.querySelectorAll('button[data-close-drawer]').forEach(button => { button.disabled = false; });
  }

  function startRequest() {
    requestController?.abort();
    requestController = new AbortController();
    return { current: ++requestRun, signal: requestController.signal };
  }

  async function request(endpoint, { method = 'GET', body, signal } = {}) {
    const response = await fetch(`/api/users/${encodeURIComponent(targetId)}/${endpoint}`, {
      cache: 'no-store', method, signal,
      ...(body ? {
        headers: { 'Content-Type': 'application/json', 'X-Portal-CSRF': drawer.dataset.familyCsrf },
        body: JSON.stringify(body),
      } : {}),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw Object.assign(new Error(error?.message || (response.status === 403 ? 'Действие недоступно.' : 'Не удалось загрузить данные.')), {
        code: error?.code,
      });
    }
    return response.json();
  }

  function pendingChanges() {
    return {
      added: [...draft.values()].filter(child => !original.has(String(child.id))),
      removed: [...original.values()].filter(child => !draft.has(String(child.id))),
    };
  }

  function renderFamily() {
    const combined = new Map([...original, ...draft]);
    const rows = [...combined.values()].map(child => {
      const id = String(child.id);
      const isRemoved = !draft.has(id);
      const isAdded = !original.has(id);
      const item = node('li');
      const detail = record(child.name, childIdentity(child, { active: child.active }));
      if (isAdded || isRemoved) {
        item.dataset.change = isAdded ? 'added' : 'removed';
        detail.append(node('small', isAdded ? 'users-family-marker' : 'users-family-marker users-family-marker--removed',
          isAdded ? 'Будет добавлен' : 'Будет отвязан'));
      }
      const button = node('button', 'users-secondary-button', isRemoved ? 'Вернуть' : isAdded ? 'Убрать' : 'Отвязать');
      button.type = 'button';
      button.disabled = saving || loading;
      button.dataset.childAction = id;
      button.setAttribute('aria-label', `${button.textContent} · ${child.name} · ID ${id}`);
      button.addEventListener('click', () => {
        if (isRemoved) draft.set(id, child);
        else draft.delete(id);
        if (!conflict) showStatus();
        renderFamily();
        const nextFocus = childrenList.querySelector(`[data-child-action="${id}"]`) ?? search;
        nextFocus.focus();
      });
      item.append(detail, button);
      return item;
    });
    childrenList.replaceChildren(...rows);
    $('[data-family-empty]').hidden = rows.length > 0;
    const { added, removed } = pendingChanges();
    changes.hidden = !added.length && !removed.length;
    changes.textContent = [
      added.length ? `Добавить: ${added.length}` : '',
      removed.length ? `Отвязать: ${removed.length}` : '',
    ].filter(Boolean).join(' · ');
    save.disabled = saving || loading || conflict || !revision || changes.hidden;
  }

  function setFamily(data, pending) {
    original = new Map(data.children.map(child => [String(child.id), child]));
    draft = new Map(original);
    if (pending) {
      for (const child of pending.removed) draft.delete(String(child.id));
      for (const child of pending.added) {
        if (!draft.has(String(child.id))) draft.set(String(child.id), child);
      }
    }
    revision = data.revision;
    $('[data-family-linked-section]').hidden = false;
    renderFamily();
  }

  async function loadFamily({ refresh = false } = {}) {
    const pending = refresh ? pendingChanges() : undefined;
    closeSearch();
    loading = true;
    search.disabled = true;
    renderFamily();
    const { current, signal } = startRequest();
    editor.setAttribute('aria-busy', 'true');
    showStatus('Загружаем список детей…');
    try {
      const data = await request('family', { signal });
      if (current !== requestRun) return;
      conflict = false;
      setFamily(data, pending);
      showStatus(refresh && !changes.hidden ? 'Список обновлён. Проверьте свои изменения и нажмите «Сохранить».' : '');
    } catch (error) {
      if (current === requestRun && error.name !== 'AbortError') {
        showStatus(error.message, { kind: 'error', action: () => loadFamily({ refresh }) });
      }
    } finally {
      if (current === requestRun) {
        loading = false;
        search.disabled = !revision;
        editor.removeAttribute('aria-busy');
        renderFamily();
      }
    }
  }

  async function saveFamily(event) {
    event?.preventDefault();
    if (saving || save.disabled) return;
    closeSearch();
    saving = true;
    const { current, signal } = startRequest();
    const closeButtons = drawer.querySelectorAll('button[data-close-drawer]');
    closeButtons.forEach(button => { button.disabled = true; });
    search.disabled = true;
    save.textContent = 'Сохраняем…';
    editor.setAttribute('aria-busy', 'true');
    renderFamily();
    showStatus('Сохраняем изменения…');
    try {
      const data = await request('family', { method: 'PUT', body: { childIds: [...draft.keys()].map(Number), revision }, signal });
      if (current !== requestRun) return;
      setFamily(data);
      showStatus('Изменения сохранены.', { kind: 'success' });
    } catch (error) {
      if (current !== requestRun || error.name === 'AbortError') return;
      conflict = error.code === 'family_conflict';
      showStatus(error.message, conflict
        ? { kind: 'error', action: () => loadFamily({ refresh: true }), label: 'Обновить список' }
        : { kind: 'error' });
    } finally {
      if (current === requestRun) {
        saving = false;
        search.disabled = false;
        closeButtons.forEach(button => { button.disabled = false; });
        save.textContent = 'Сохранить';
        editor.removeAttribute('aria-busy');
        renderFamily();
        if (document.activeElement === document.body) {
          if (!retry.hidden) retry.focus();
          else if (save.disabled) search.focus({ preventScroll: true });
          else save.focus();
        }
      }
    }
  }

  function setActiveOption(index) {
    if (!candidates[index] || draft.has(String(candidates[index].id))) return;
    if (activeOption >= 0) candidatesList.children[activeOption]?.setAttribute('aria-selected', 'false');
    activeOption = index;
    const option = candidatesList.children[index];
    option.setAttribute('aria-selected', 'true');
    search.setAttribute('aria-activedescendant', option.id);
    const listTop = candidatesList.getBoundingClientRect().top;
    const optionTop = option.getBoundingClientRect().top - listTop + candidatesList.scrollTop;
    if (optionTop < candidatesList.scrollTop) candidatesList.scrollTop = optionTop;
    else if (optionTop + option.offsetHeight > candidatesList.scrollTop + candidatesList.clientHeight) {
      candidatesList.scrollTop = optionTop + option.offsetHeight - candidatesList.clientHeight;
    }
  }

  function chooseCandidate(index) {
    const child = candidates[index];
    if (!child || draft.has(String(child.id))) return;
    const id = String(child.id);
    draft.set(id, original.get(id) ?? { ...child, active: true });
    search.value = '';
    closeSearch();
    renderFamily();
    if (!conflict) showStatus();
    search.focus({ preventScroll: true });
  }

  function showCandidates(matches) {
    candidates = matches;
    searchStatus.textContent = matches.length >= 20 ? 'Уточните ФИО или введите ID, чтобы сузить список.'
      : matches.length ? '' : 'Ничего не найдено. Попробуйте другую часть имени или ID.';
    candidatesList.replaceChildren(...matches.map((child, index) => {
      const option = node('li', 'users-family-option');
      const alreadyLinked = draft.has(String(child.id));
      option.id = `family-option-${index}`;
      option.dataset.candidateIndex = String(index);
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.append(record(child.name, childIdentity(child)));
      if (alreadyLinked) {
        option.setAttribute('aria-disabled', 'true');
        option.append(node('span', 'users-family-option-hint', 'В списке'));
      }
      return option;
    }));
  }

  function scheduleSearch() {
    closeSearch();
    const q = search.value.trim();
    if (!q || search.disabled) return;
    const current = searchRun;
    dropdown.hidden = false;
    search.setAttribute('aria-expanded', 'true');
    searchStatus.textContent = 'Ищем учеников…';
    searchTimer = setTimeout(async () => {
      searchController = new AbortController();
      try {
        const data = await request('family/candidates', { method: 'POST', body: { q }, signal: searchController.signal });
        if (current === searchRun) showCandidates(data.candidates);
      } catch (error) {
        if (current === searchRun && error.name !== 'AbortError') searchStatus.textContent = error.message;
      }
    }, 180);
  }

  search.addEventListener('input', scheduleSearch);
  search.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Tab') {
      closeSearch();
    } else if (event.key === 'Escape' && !dropdown.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeOption >= 0 && !dropdown.hidden) chooseCandidate(activeOption);
    } else if (['ArrowDown', 'ArrowUp'].includes(event.key) && search.value.trim()) {
      event.preventDefault();
      if (dropdown.hidden) return scheduleSearch();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      let index = activeOption < 0 && direction < 0 ? candidates.length - 1 : activeOption + direction;
      while (candidates[index] && draft.has(String(candidates[index].id))) index += direction;
      setActiveOption(index);
    }
  });
  candidatesList.addEventListener('mousedown', event => {
    if (event.target.closest('[data-candidate-index]')) event.preventDefault();
  });
  candidatesList.addEventListener('click', event => {
    const option = event.target.closest('[data-candidate-index]');
    if (option) chooseCandidate(Number(option.dataset.candidateIndex));
  });
  drawer.addEventListener('pointerdown', event => {
    if (!dropdown.hidden && !event.target.closest('[data-family-picker]')) closeSearch();
  });
  editor.addEventListener('submit', saveFamily);

  function optionList(select, values, getLabel) {
    select.replaceChildren(...values.map(item => new Option(getLabel(item), String(item.id))));
  }

  async function loadPreview() {
    const service = services.find(item => String(item.id) === serviceSelect.value);
    if (!service) return;
    const { current, signal } = startRequest();
    const child = service.family ? children.find(item => String(item.id) === childSelect.value) : null;
    $('[data-preview-child-field]').hidden = !service.family || !children.length;
    $('[data-preview-controls]').toggleAttribute('data-child-visible', Boolean(child));
    $('[data-preview-child-id]').textContent = child ? childIdentity(child) : '';
    $('[data-preview-roles]').replaceChildren(...service.roles.map(role => node('li', '', role)));
    entries.replaceChildren();
    date.hidden = true;
    preview.setAttribute('aria-busy', 'true');
    showStatus('Загружаем сводку…');
    try {
      const result = await request('service-preview', { method: 'POST', body: { serviceId: service.id, childId: child?.id ?? null }, signal });
      if (current !== requestRun) return;
      if (result.state === 'ready') {
        const snapshotDate = /^\d{4}-\d{2}-\d{2}$/.test(result.date ?? '') ? new Date(`${result.date}T00:00:00Z`) : null;
        if (snapshotDate && Number.isFinite(+snapshotDate)) {
          date.textContent = 'На ' + dateFormatter.format(snapshotDate);
          date.hidden = false;
        }
        entries.replaceChildren(...result.entries.map(item => {
          const row = node('li');
          row.append(record(item.title, item.detail));
          return row;
        }));
        showStatus(result.entries.length ? '' : 'В доступной сводке за этот период пока нет записей.');
      } else if (result.state === 'no_child') {
        showStatus('У пользователя пока нет активных связанных детей.');
      } else if (result.state === 'forbidden') {
        showStatus('Сервис не предоставил сводку для выбранного профиля.');
      } else if (result.state === 'unavailable') {
        showStatus('Сервис временно недоступен.', { kind: 'error', action: loadPreview });
      } else {
        showStatus('Здесь доступны назначенные роли. Сводка этого сервиса недоступна.');
      }
    } catch (error) {
      if (current === requestRun && error.name !== 'AbortError') {
        showStatus(error.message, { kind: 'error', action: loadPreview });
      }
    } finally {
      if (current === requestRun) preview.removeAttribute('aria-busy');
    }
  }

  async function loadServices() {
    const { current, signal } = startRequest();
    $('[data-preview-controls]').hidden = true;
    $('[data-preview-details]').hidden = true;
    preview.setAttribute('aria-busy', 'true');
    showStatus('Загружаем список сервисов…');
    try {
      const data = await request('service-preview', { method: 'POST', body: {}, signal });
      if (current !== requestRun) return;
      services = data.services;
      children = data.children;
      if (!data.active) return showStatus('Учётная запись неактивна.');
      if (!services.length) return showStatus('Пользователю пока не назначены сервисы.');
      const serviceLabel = service => Object.hasOwn(serviceNames, service.label) ? serviceNames[service.label] : service.label;
      const offersSummary = service => service.previewAvailable ?? service.integration;
      const withSummary = services.filter(offersSummary);
      const withRolesOnly = services.filter(service => !offersSummary(service));
      const groups = [[withSummary, 'Со сводкой'], [withRolesOnly, 'Только роли']];
      serviceSelect.replaceChildren(...groups.filter(([list]) => list.length).map(([list, label]) => {
        const group = node('optgroup');
        group.label = label;
        optionList(group, list, serviceLabel);
        return group;
      }));
      optionList(childSelect, children, child => `${child.name} · ${childIdentity(child)}`);
      serviceSelect.value = (withSummary[0] ?? services[0]).id;
      $('[data-preview-controls]').hidden = false;
      $('[data-preview-details]').hidden = false;
      await loadPreview();
    } catch (error) {
      if (current === requestRun && error.name !== 'AbortError') {
        showStatus(error.message, { kind: 'error', action: loadServices });
      }
    } finally {
      if (current === requestRun) preview.removeAttribute('aria-busy');
    }
  }

  serviceSelect.addEventListener('change', loadPreview);
  childSelect.addEventListener('change', loadPreview);
  retry.addEventListener('click', () => retryAction?.());

  return {
    open(user, nextMode, opener) {
      if (openDrawer(drawer, { opener }) === false) return;
      clear();
      targetId = user.id;
      mode = nextMode;
      const editing = mode === 'family';
      $('#user-family-tools-name').textContent = user.name;
      $('[data-family-user-id]').textContent = `ID ${user.id}`;
      $('#user-family-tools-title').textContent = editing ? 'Дети пользователя' : 'Просмотр сервисов';
      editor.hidden = !editing;
      preview.hidden = editing;
      $('[data-family-actions]').hidden = !editing;
      $('[data-preview-actions]').hidden = editing;
      if (editing) loadFamily();
      else loadServices();
    },
    canClose({ discard = false } = {}) {
      return !saving && (discard || mode !== 'family' || changes.hidden || window.confirm('Закрыть панель и отменить несохранённые изменения?'));
    },
    clear,
  };
}
