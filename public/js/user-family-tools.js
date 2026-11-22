export function createUserFamilyTools({ drawer, openDrawer, users, normalizeText }) {
  if (!drawer) return null;
  const $ = selector => drawer.querySelector(selector);
  const editor = $('[data-family-editor]');
  const preview = $('[data-service-preview]');
  const status = $('[data-family-tools-status]');
  const retry = $('[data-family-tools-retry]');
  const search = $('[data-family-search]');
  const serviceSelect = $('[data-preview-service]');
  const childSelect = $('[data-preview-child]');
  const entries = $('[data-preview-entries]');
  let targetId, mode, linked = [], services = [], controller, sequence = 0, saving = false;
  let retryAction;

  function showStatus(message = '', retryFn) {
    status.textContent = message;
    status.classList.toggle('is-error', Boolean(retryFn));
    retry.hidden = !retryFn;
    retryAction = retryFn;
  }

  function clear() {
    sequence += 1;
    controller?.abort();
    targetId = null;
    linked = [];
    services = [];
    saving = false;
    showStatus();
    search.value = '';
    $('[data-family-linked]').replaceChildren();
    $('[data-family-results]').replaceChildren();
    serviceSelect.replaceChildren();
    childSelect.replaceChildren();
    entries.replaceChildren();
    $('[data-preview-roles]').textContent = '';
    $('#user-family-tools-name').textContent = '';
  }

  async function request(endpoint, body) {
    controller?.abort();
    controller = new AbortController();
    const response = await fetch(`/api/users/${encodeURIComponent(targetId)}/${endpoint}`, {
      cache: 'no-store',
      signal: controller.signal,
      ...(body ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Portal-CSRF': drawer.dataset.familyCsrf },
        body: JSON.stringify(body),
      } : {}),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.message || (response.status === 403 ? 'Действие недоступно.' : 'Не удалось загрузить данные.'));
    }
    return response.json();
  }

  function row(title, detail, buttonLabel, action) {
    const item = document.createElement('li');
    const content = document.createElement('div');
    content.textContent = title;
    if (detail) {
      const secondary = document.createElement('small');
      secondary.textContent = detail;
      content.append(secondary);
    }
    item.append(content);
    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'users-secondary-button';
      button.textContent = buttonLabel;
      button.setAttribute('aria-label', `${buttonLabel} · ${title}`);
      button.addEventListener('click', action);
      item.append(button);
    }
    return item;
  }

  function renderSearch() {
    const query = normalizeText(search.value);
    const existing = new Set(linked.map(child => String(child.id)));
    const matches = query ? users().filter(user =>
      user.type === '1' && user.status === '1' && !existing.has(user.id) &&
      normalizeText(`${user.name} ${user.id}`).includes(query)
    ).slice(0, 8) : [];
    const results = $('[data-family-results]');
    results.replaceChildren(...matches.map(child =>
      row(child.name, `ID ${child.id}`, 'Добавить', () => updateChild(child.id, 'add'))
    ));
    if (query && !matches.length) results.append(row('Подходящих учеников нет'));
  }

  async function loadFamily() {
    const current = ++sequence;
    showStatus('Загружаем список детей…');
    search.disabled = true;
    try {
      const data = await request('family');
      if (current !== sequence) return;
      linked = data.children;
      const list = $('[data-family-linked]');
      list.replaceChildren(...linked.map(child =>
        row(child.name, [child.className, child.active ? '' : 'Учётная запись неактивна'].filter(Boolean).join(' · '),
          'Отвязать', () => updateChild(child.id, 'remove'))
      ));
      if (!linked.length) list.append(row('Связанных детей пока нет'));
      search.disabled = false;
      renderSearch();
      showStatus();
    } catch (error) {
      if (current === sequence && error.name !== 'AbortError') showStatus(error.message, loadFamily);
    }
  }

  async function updateChild(childId, action) {
    if (saving) return;
    saving = true;
    const current = ++sequence;
    const controls = [...editor.querySelectorAll('input,button')];
    controls.forEach(control => { control.disabled = true; });
    showStatus('Сохраняем связь…');
    try {
      await request('family', { childId, action });
      if (current !== sequence) return;
      if (action === 'add') search.value = '';
      saving = false;
      await loadFamily();
      if (targetId && mode === 'family' && !search.disabled) search.focus();
    } catch (error) {
      if (current !== sequence || error.name === 'AbortError') return;
      saving = false;
      controls.forEach(control => { control.disabled = false; });
      showStatus(error.message, () => updateChild(childId, action));
    }
  }

  function setOptions(select, values, label) {
    select.replaceChildren(...values.map(item => new Option(label(item), String(item.id))));
  }

  async function loadPreview() {
    const current = ++sequence;
    const service = services.find(item => item.id === serviceSelect.value);
    if (!service) return;
    $('[data-preview-roles]').textContent = service.roles.join(', ');
    entries.replaceChildren();
    showStatus('Загружаем данные сервиса…');
    const showChild = childSelect.options.length > 0 && service.family;
    $('[data-preview-child-field]').hidden = !showChild;
    try {
      const result = await request('service-preview', { serviceId: service.id, childId: showChild ? childSelect.value : null });
      if (current !== sequence) return;
      if (result.state === 'ready') {
        entries.replaceChildren(...result.entries.map(item => row(item.title, item.detail)));
        showStatus(result.entries.length ? '' : 'В доступной сводке сейчас нет записей.');
      } else if (result.state === 'no_child') {
        showStatus('У пользователя пока нет активных связанных детей.');
      } else if (result.state === 'forbidden') {
        showStatus('Сервис не предоставил данные для выбранного профиля.');
      } else if (result.state === 'unavailable') {
        showStatus('Сервис временно недоступен.', loadPreview);
      } else {
        showStatus('Для этого сервиса доступны назначенные роли.');
      }
    } catch (error) {
      if (current === sequence && error.name !== 'AbortError') showStatus(error.message, loadPreview);
    }
  }

  async function loadServices() {
    const current = ++sequence;
    $('[data-preview-controls]').hidden = true;
    $('[data-preview-details]').hidden = true;
    showStatus('Загружаем доступы пользователя…');
    try {
      const data = await request('service-preview', {});
      if (current !== sequence) return;
      services = data.services;
      if (!data.active) return showStatus('Учётная запись неактивна.');
      if (!services.length) return showStatus('Пользователю пока не назначены сервисы.');
      setOptions(serviceSelect, services, item => item.label);
      setOptions(childSelect, data.children, child => [child.name, child.className].filter(Boolean).join(' · '));
      serviceSelect.value = (services.find(service => service.integration) ?? services[0]).id;
      $('[data-preview-controls]').hidden = false;
      $('[data-preview-details]').hidden = false;
      await loadPreview();
    } catch (error) {
      if (current === sequence && error.name !== 'AbortError') showStatus(error.message, loadServices);
    }
  }

  search.addEventListener('input', renderSearch);
  serviceSelect.addEventListener('change', loadPreview);
  childSelect.addEventListener('change', loadPreview);
  retry.addEventListener('click', () => retryAction?.());

  return {
    open(user, nextMode, opener) {
      clear();
      targetId = user.id;
      mode = nextMode;
      $('#user-family-tools-name').textContent = user.name;
      $('#user-family-tools-title').textContent = mode === 'family' ? 'Связанные дети' : 'Просмотр как пользователь';
      editor.hidden = mode !== 'family';
      preview.hidden = mode !== 'preview';
      if (openDrawer(drawer, { opener }) === false) return;
      if (mode === 'family') loadFamily();
      else loadServices();
    },
    clear,
  };
}
