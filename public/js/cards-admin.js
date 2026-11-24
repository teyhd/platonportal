(() => {
  const drawer = document.querySelector('[data-cards-admin]');
  if (!drawer) return;

  const find = selector => drawer.querySelector(selector);
  const list = find('[data-card-list]');
  const results = find('[data-card-results]');
  const listStatus = find('[data-card-list-status]');
  const search = find('[data-card-search]');
  const filters = [...drawer.querySelectorAll('[data-card-filter]')];
  const empty = find('[data-card-empty]');
  const reset = find('[data-card-reset]');
  const retry = find('[data-card-retry]');
  const create = find('[data-card-new]');
  const back = find('[data-card-back]');
  const close = find('[data-card-admin-close]');
  const form = find('[data-card-form]');
  const formBody = find('[data-card-fields]');
  const formPlaceholder = find('[data-card-placeholder]');
  const editorTitle = find('[data-card-editor-title]');
  const saveStatus = find('[data-card-save-status]');
  const saveRetry = find('[data-card-save-retry]');
  const imageStatus = find('[data-card-image-status]');
  const refresh = find('[data-card-refresh]');
  const catalogRefresh = document.querySelector('[data-catalog-refresh]');
  const preview = find('[data-card-preview]');
  const materialPreview = find('[data-card-html-preview]');
  const servicePreview = find('[data-card-service-preview]');
  const previewImages = [find('[data-card-image-preview]'), find('[data-card-service-image]')];
  const fields = {
    title: find('[data-card-title]'),
    type: find('[data-card-type]'),
    link: find('[data-card-link]'),
    html: find('[data-card-html]'),
    role: find('[data-card-role]'),
    order: find('[data-card-order]'),
    shows: find('[data-card-shows]'),
    pic: find('[data-card-pic]'),
    file: find('[data-card-image-file]'),
  };

  const fallbackIcon = '/img/platon.png';
  const supportedImageTypes = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
  const supportedImageName = /\.(png|jpe?g|webp)$/i;
  const saveDelay = 650;
  const state = {
    cards: [],
    roles: [],
    filter: 'all',
    selectedId: null,
    savedValues: null,
    saved: false,
    failure: null,
    loaded: false,
    catalogChanged: false,
    busy: '',
    opener: null,
  };
  let saveTimer;
  let saveRequest;
  let navigating = false;
  let composing = false;

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true) {
      throw Object.assign(new Error(data.message), { status: response.status });
    }
    return data;
  }

  function errorMessage(error, fallback) {
    if (error.status === 401 || error.status === 403) {
      return 'Доступ к карточкам недоступен. Проверьте, что вы вошли в портал.';
    }
    return ({
      'title required': 'Введите заголовок.',
      'title too long': 'Сократите заголовок до 50 символов.',
      'content too long': 'Сократите содержимое до 3000 символов.',
      'pic too long': 'Сократите имя файла до 50 символов.',
      'role is not allowed': 'Выберите доступную аудиторию.',
      'crdorder must be from 0 to 127': 'Введите число от 0 до 127.',
      'Not found': 'Карточка больше недоступна. Откройте панель заново после обновления страницы.',
      'ambiguous card creation': 'Найдено несколько похожих карточек. Проверьте список.',
    })[error.message] || fallback;
  }

  function payload() {
    return {
      type: Number(fields.type.value),
      title: fields.title.value.trim(),
      cont: (fields.type.value === '1' ? fields.html : fields.link).value.trim(),
      pic: fields.pic.value.trim(),
      role: fields.role.value === '' ? null : Number(fields.role.value),
      shows: fields.shows.checked ? 1 : 0,
      crdorder: fields.order.value === '' ? null : Number(fields.order.value),
    };
  }

  function isDirty() {
    return state.savedValues !== null && state.savedValues !== JSON.stringify(payload());
  }

  function validationMessage(values = payload()) {
    if (!values.title) return 'Введите заголовок для автосохранения.';
    if (values.role === null) return 'Выберите аудиторию.';
    if (!Number.isInteger(values.crdorder) || values.crdorder < 0 || values.crdorder > 127) {
      return 'Укажите порядок от 0 до 127.';
    }
    return '';
  }

  function warnBeforeLeaving(event) {
    event.preventDefault();
    event.returnValue = '';
  }

  function updateStatus() {
    const dirty = isDirty();
    const busyMessage = state.busy === 'uploading' ? 'Загружаем изображение…' : saveRequest ? 'Сохраняем…' : '';
    const error = state.failure?.message || (dirty ? validationMessage() : '');
    const saved = !busyMessage && !error && !dirty && state.saved;
    const idleMessage = state.selectedId === null
      ? 'Автосохранение включено. Новая карточка по умолчанию скрыта.'
      : 'Автосохранение включено.';
    const message = busyMessage || error || (dirty ? 'Ожидает автосохранения…' : saved ? 'Сохранено' : idleMessage);
    if (saveStatus.textContent !== message) saveStatus.textContent = message;
    saveStatus.dataset.status = !busyMessage && error ? 'error' : saved ? 'success' : '';
    saveRetry.hidden = Boolean(busyMessage) || !state.failure;
    refresh.hidden = Boolean(busyMessage) || dirty || Boolean(state.failure) || !state.catalogChanged;
    if (dirty || busyMessage || hasUnconfirmedSave()) window.addEventListener('beforeunload', warnBeforeLeaving);
    else window.removeEventListener('beforeunload', warnBeforeLeaving);
  }

  function setBusy(busy) {
    state.busy = busy;
    const uploading = busy === 'uploading';
    Object.values(fields).forEach(control => { control.disabled = Boolean(busy); });
    create.disabled = Boolean(busy) || !state.loaded;
    list.querySelectorAll('button').forEach(button => { button.disabled = Boolean(busy); });
    close.disabled = uploading;
    back.disabled = uploading;
    retry.disabled = Boolean(busy);
    updateStatus();
  }

  function roleName(id) {
    if (Number(id) === 0) return 'Все, включая гостей';
    if (Number(id) === 7) return 'Модераторы и администраторы';
    return state.roles.find(role => Number(role.id) === Number(id))?.name || `Уровень ${id}`;
  }

  function normalizeSearch(value) {
    return String(value ?? '').toLowerCase().replaceAll('ё', 'е');
  }

  function filteredCards() {
    const words = normalizeSearch(search.value).trim().split(/\s+/).filter(Boolean);
    return state.cards.filter(card => {
      if (state.filter === 'services' && Number(card.type) !== 0) return false;
      if (state.filter === 'materials' && Number(card.type) !== 1) return false;
      if (state.filter === 'hidden' && Number(card.shows) === 1) return false;
      const searchable = normalizeSearch(`#${card.id} ${card.title || ''} ${card.cont || ''} ${card.pic || ''} ${roleName(card.role)}`);
      return words.every(word => searchable.includes(word));
    });
  }

  function updateSelectedRow() {
    list.querySelectorAll('[data-card-select]').forEach(button => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.cardSelect) === state.selectedId));
    });
  }

  function renderList() {
    filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.cardFilter === state.filter)));
    if (!state.loaded) return;

    const cards = filteredCards();
    const filtering = state.filter !== 'all' || Boolean(search.value.trim());
    listStatus.textContent = filtering ? `Найдено: ${cards.length} из ${state.cards.length}` : `Всего: ${state.cards.length}`;
    empty.hidden = cards.length > 0;
    reset.hidden = !filtering;
    find('[data-card-empty-text]').textContent = filtering
      ? 'Карточки не найдены.'
      : 'Карточек пока нет. Нажмите «Создать», чтобы добавить первую.';

    const rows = cards.map(card => {
      const row = document.createElement('li');
      const button = document.createElement('button');
      const title = document.createElement('strong');
      const meta = document.createElement('span');
      const visibility = document.createElement('span');
      const isHidden = Number(card.shows) !== 1;
      button.type = 'button';
      button.className = 'cards-admin__row';
      button.dataset.cardSelect = card.id;
      button.disabled = Boolean(state.busy);
      title.textContent = card.title || 'Без названия';
      visibility.className = 'cards-admin__row-visibility';
      visibility.dataset.hidden = String(isHidden);
      visibility.textContent = isHidden ? 'Скрыта' : 'В каталоге';
      meta.className = 'cards-admin__row-meta';
      meta.textContent = `${Number(card.type) === 1 ? 'Материал' : 'Сервис'}  ·  ${roleName(card.role)}  ·  #${card.id}`;
      button.append(title, visibility, meta);
      row.append(button);
      return row;
    });
    const focusedRow = list.contains(document.activeElement) && document.activeElement.dataset.cardSelect;
    list.replaceChildren(...rows);
    updateSelectedRow();
    if (focusedRow) (list.querySelector(`[data-card-select="${focusedRow}"]`) || search).focus({ preventScroll: true });
  }

  function showImageStatus(message, type = '') {
    imageStatus.textContent = message;
    imageStatus.dataset.status = type;
  }

  function setView(view) {
    drawer.dataset.view = view;
  }

  function fillForm(card) {
    state.selectedId = card ? Number(card.id) : null;
    fields.title.value = card?.title ?? '';
    fields.type.value = String(card?.type ?? 0);
    fields.link.value = fields.type.value === '0' ? card?.cont ?? '' : '';
    fields.html.value = fields.type.value === '1' ? card?.cont ?? '' : '';
    fields.role.value = String(card?.role ?? 7);
    fields.order.value = String(card?.crdorder ?? 100);
    fields.shows.checked = Number(card?.shows ?? 0) === 1;
    fields.pic.value = card?.pic ?? '';
    fields.file.value = '';
    find('[data-card-editor-id]').textContent = card ? `#${card.id}` : '';
    state.savedValues = JSON.stringify(payload());
    state.saved = false;
    state.failure = null;
    showImageStatus('');
    updateImage();
    updateEditor();
    updateStatus();
    updateSelectedRow();
  }

  function editCard(card) {
    fillForm(card);
    formPlaceholder.hidden = true;
    form.hidden = false;
    preview.open = false;
    setView('editor');
    formBody.scrollTop = 0;
    editorTitle.focus({ preventScroll: true });
  }

  function selectedCard() {
    return state.cards.find(card => Number(card.id) === state.selectedId);
  }

  function discardDraft() {
    if (state.selectedId !== null) {
      fillForm(selectedCard());
    } else {
      form.hidden = true;
      formPlaceholder.hidden = false;
      state.savedValues = null;
      state.failure = null;
      updateStatus();
    }
  }

  async function navigate(action) {
    if (navigating || state.busy === 'uploading') return;
    navigating = true;
    try {
      // Wait for the current write, then flush any newer edits before leaving.
      while (saveRequest || canSave()) {
        await (saveRequest || saveChanges());
      }
      if (isDirty() || hasUnconfirmedSave()) {
        if (!window.confirm('Изменения не сохранены. Выйти из редактора?')) return;
        discardDraft();
      }
      action();
    } finally {
      navigating = false;
      scheduleSave();
    }
  }

  function goBack() {
    navigate(() => {
      setView('list');
      const row = list.querySelector(`[data-card-select="${state.selectedId}"]`);
      (row || search).focus();
    });
  }

  function openDrawer(event) {
    state.opener = event.currentTarget;
    setView('list');
    drawer.showModal();
    document.documentElement.classList.add('cards-admin-open');
    if (!state.loaded) loadCards();
  }

  function closeDrawer() {
    navigate(() => {
      drawer.close();
      document.documentElement.classList.remove('cards-admin-open');
      state.opener?.focus({ preventScroll: true });
      state.opener = null;
    });
  }

  function cardImageSrc(pic) {
    const value = pic.trim();
    if (!value) return fallbackIcon;
    if (/^data:image\//i.test(value)) return value;
    if (/^(https?:)?\/\//i.test(value)) {
      try {
        const url = new URL(value, window.location.href);
        return url.hostname === 'platoniks.ru' ? url.pathname + url.search : fallbackIcon;
      } catch {
        return fallbackIcon;
      }
    }
    if (value.startsWith('/')) return value;
    const clean = value.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^public\//, '');
    return clean.startsWith('img/') ? `/${clean}` : `/img/${clean}`;
  }

  function updateImage() {
    const src = cardImageSrc(fields.pic.value);
    previewImages.forEach(image => {
      if (image.getAttribute('src') !== src) image.src = src;
    });
  }

  function updateEditor() {
    const title = fields.title.value.trim() || (state.selectedId === null ? 'Новая карточка' : 'Без названия');
    const isMaterial = fields.type.value === '1';
    editorTitle.textContent = title;
    find('[data-card-service-field]').hidden = isMaterial;
    find('[data-card-material-field]').hidden = !isMaterial;
    const role = fields.role.value;
    const audienceHints = {
      '': 'Выберите, кому показывать карточку.',
      0: 'Карточку увидят все посетители, включая гостей.',
      7: 'Карточку увидят модераторы и администраторы.',
    };
    find('[data-card-audience]').textContent = audienceHints[role] || `Уровень доступа «${roleName(role)}» и выше.`;
    if (!preview.open) return;

    servicePreview.hidden = isMaterial;
    materialPreview.hidden = !isMaterial;
    if (isMaterial) {
      const safeTitle = document.createElement('h3');
      safeTitle.textContent = title;
      const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><style>
        html{overflow:hidden}body{font:14px/1.55 system-ui;margin:12px;color:#0f172a;overflow-wrap:anywhere}
        img{max-width:100%;height:auto}h3{margin-top:0}a{color:#1d4ed8}</style><body>${safeTitle.outerHTML}${fields.html.value}</body></html>`;
      if (materialPreview.srcdoc !== html) materialPreview.srcdoc = html;
    } else {
      find('[data-card-service-title]').textContent = title;
    }
  }

  async function loadCards() {
    if (state.busy || state.loaded) return;
    setBusy('loading');
    listStatus.textContent = 'Загружаем карточки…';
    retry.hidden = true;
    try {
      const data = await api('/api/cards');
      if (!Array.isArray(data.cards) || !Array.isArray(data.roles)) throw new Error();
      state.cards = data.cards;
      state.roles = data.roles;
      const placeholder = new Option('Выберите аудиторию', '');
      placeholder.disabled = true;
      fields.role.replaceChildren(placeholder, ...state.roles.map(role => new Option(roleName(role.id), role.id)));
      state.loaded = true;
      renderList();
    } catch (error) {
      listStatus.textContent = errorMessage(error, 'Не удалось загрузить карточки.');
      retry.hidden = false;
    } finally {
      setBusy('');
    }
  }

  function hasUnconfirmedSave() {
    return Boolean(state.failure?.unconfirmedCreation || state.failure?.uncertainUpdate);
  }

  function canSave() {
    return state.loaded && !state.busy && !state.failure && !composing && isDirty() && !validationMessage();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    if (!saveRequest && !navigating && canSave()) saveTimer = setTimeout(saveChanges, saveDelay);
    updateStatus();
  }

  function saveChanges(retryFailed = false) {
    clearTimeout(saveTimer);
    if (saveRequest) return saveRequest;
    const failure = retryFailed ? state.failure : null;
    if (state.busy || (!failure && !canSave())) return;
    state.failure = null;
    saveRequest = writeCard(payload(), failure).finally(() => {
      saveRequest = null;
      scheduleSave();
    });
    updateStatus();
    return saveRequest;
  }

  function acceptSavedCard(card, values) {
    if (!card?.id) throw new Error();
    state.selectedId = Number(card.id);
    state.savedValues = JSON.stringify(values);
    state.saved = true;
    state.cards = state.cards.filter(item => Number(item.id) !== state.selectedId);
    state.cards.push(card);
    state.cards.sort((a, b) => a.type - b.type || a.crdorder - b.crdorder || a.id - b.id);
    find('[data-card-editor-id]').textContent = `#${card.id}`;
    renderList();
    state.catalogChanged = true;
    catalogRefresh?.classList.remove('hidden');
  }

  async function checkCreation(values) {
    const { cards } = await api('/api/cards');
    const knownIds = new Set(state.cards.map(card => Number(card.id)));
    const matches = cards.filter(card => !knownIds.has(Number(card.id)) && Object.entries(values).every(([key, value]) =>
      typeof value === 'number' ? Number(card[key]) === value : String(card[key] ?? '').trim() === value,
    ));
    if (matches.length > 1) throw new Error('ambiguous card creation');
    return matches[0];
  }

  async function writeCard(values, failure) {
    const id = state.selectedId;
    let unconfirmedCreation = failure?.unconfirmedCreation;
    let uncertainUpdate = failure?.uncertainUpdate;
    try {
      if (unconfirmedCreation) {
        const existing = await checkCreation(unconfirmedCreation);
        if (existing) {
          acceptSavedCard(existing, unconfirmedCreation);
          return;
        }
        unconfirmedCreation = null;
      }
      if (validationMessage(values) || (!isDirty() && !uncertainUpdate)) return;
      const { card } = await api(id ? `/api/cards/${id}` : '/api/cards', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(values),
      });
      acceptSavedCard(card, values);
    } catch (error) {
      if (!(error.status >= 400 && error.status < 500)) {
        if (id === null) unconfirmedCreation ||= values;
        else uncertainUpdate = true;
      }
      state.failure = {
        message: errorMessage(error, 'Не удалось сохранить карточку. Повторите попытку.'),
        unconfirmedCreation,
        uncertainUpdate,
      };
    }
  }

  function isSupportedImageFile(file) {
    return supportedImageTypes.has(file.type.toLowerCase()) || supportedImageName.test(file.name);
  }

  async function imageDataUrl(file) {
    const source = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      for (const maxSide of [1024, 800, 640]) {
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL('image/webp', 0.88);
        // Base64 and the JSON envelope must fit through the portal proxy.
        if (data.startsWith('data:image/') && data.length < 980_000) return data;
      }
      throw new Error('image too large');
    } finally {
      URL.revokeObjectURL(source);
    }
  }

  async function uploadImage() {
    const file = fields.file.files?.[0];
    fields.file.value = '';
    if (!file || state.busy || navigating) return;
    if (!isSupportedImageFile(file)) {
      showImageStatus('Выберите изображение в формате PNG, JPG или WebP.', 'error');
      return;
    }

    showImageStatus('');
    setBusy('uploading');
    try {
      const contentBase64 = await imageDataUrl(file);
      const { pic } = await api('/api/cards/upload-image', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, contentBase64 }),
      });
      if (!pic || pic.length > fields.pic.maxLength) throw new Error();
      fields.pic.value = pic;
      updateImage();
      showImageStatus('Изображение загружено.', 'success');
    } catch (error) {
      const message = error.message === 'image too large'
        ? 'Не удалось уменьшить изображение. Выберите файл меньшего размера.'
        : 'Не удалось загрузить изображение. Проверьте файл и повторите попытку.';
      showImageStatus(errorMessage(error, message), 'error');
    } finally {
      setBusy('');
      scheduleSave();
      fields.file.focus({ preventScroll: true });
    }
  }

  function applyFilter(filter) {
    state.filter = filter;
    renderList();
    results.scrollTop = 0;
  }

  drawer.dataset.view = 'list';
  document.querySelectorAll('[data-card-admin-open]').forEach(button => button.addEventListener('click', openDrawer));
  close.addEventListener('click', closeDrawer);
  back.addEventListener('click', goBack);
  drawer.addEventListener('cancel', event => {
    event.preventDefault();
    closeDrawer();
  });
  drawer.addEventListener('click', event => {
    if (event.target === drawer) closeDrawer();
  });

  retry.addEventListener('click', async () => {
    await loadCards();
    if (drawer.open) (retry.hidden ? search : retry).focus();
  });
  saveRetry.addEventListener('click', () => saveChanges(true));
  filters.forEach(button => button.addEventListener('click', () => applyFilter(button.dataset.cardFilter)));
  search.addEventListener('input', () => applyFilter(state.filter));
  reset.addEventListener('click', () => {
    search.value = '';
    applyFilter('all');
    search.focus();
  });
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-card-select]');
    if (!button || state.busy) return;
    const id = Number(button.dataset.cardSelect);
    if (id === state.selectedId && !form.hidden) {
      setView('editor');
      editorTitle.focus({ preventScroll: true });
    } else {
      navigate(() => editCard(state.cards.find(card => Number(card.id) === id)));
    }
  });
  create.addEventListener('click', () => {
    if (state.busy || !state.loaded) return;
    if (state.selectedId === null && !form.hidden) {
      setView('editor');
      editorTitle.focus({ preventScroll: true });
    } else {
      navigate(() => editCard());
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    saveChanges();
  });
  form.addEventListener('input', event => {
    if (event.isComposing || event.target === fields.file) return;
    updateEditor();
    scheduleSave();
  });
  form.addEventListener('compositionstart', () => {
    composing = true;
    clearTimeout(saveTimer);
  });
  form.addEventListener('compositionend', () => {
    composing = false;
    updateEditor();
    scheduleSave();
  });
  fields.pic.addEventListener('change', updateImage);
  fields.file.addEventListener('change', uploadImage);
  preview.addEventListener('toggle', updateEditor);
  previewImages.forEach(image => image.addEventListener('error', () => {
    if (image.getAttribute('src') !== fallbackIcon) image.src = fallbackIcon;
  }));
})();
