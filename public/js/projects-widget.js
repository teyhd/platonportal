const section = document.querySelector('[data-projects-widget]');

if (section) {
  const list = section.querySelector('[data-projects-list]');
  const status = section.querySelector('[data-projects-status]');
  const tabs = Array.from(section.querySelectorAll('[data-projects-sort]'));
  const supportsPopover = 'showPopover' in HTMLElement.prototype;
  const openStatusMenu = '.projects-teaser-status-options:popover-open';
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'projects-teaser-refresh';
  refresh.textContent = 'Обновить работы';
  refresh.hidden = true;
  status.after(refresh);
  status.tabIndex = -1;
  let data;
  let currentSort = 'latest';
  let message = '';
  let loading = false;
  let loadGeneration = 0;
  let loadController;
  const busy = new Set();

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function positionOpenStatusMenu() {
    const options = section.querySelector(openStatusMenu);
    if (!options) return;

    const trigger = options.previousElementSibling.getBoundingClientRect();
    const carousel = list.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? document.documentElement.clientWidth;
    const viewportBottom = viewportTop + (viewport?.height ?? document.documentElement.clientHeight);
    const viewportRight = viewportLeft + viewportWidth;
    const visibleLeft = Math.max(carousel.left, viewportLeft);
    const visibleRight = Math.min(carousel.right, viewportRight);
    if (trigger.right <= visibleLeft || trigger.left >= visibleRight ||
        trigger.bottom <= viewportTop || trigger.top >= viewportBottom) {
      options.hidePopover();
      return;
    }

    const gap = 8;
    const width = Math.min(Math.max(trigger.width, 256), 320, viewportWidth - 2 * gap);
    const left = Math.min(Math.max(trigger.left, visibleLeft, viewportLeft + gap), viewportRight - width - gap);
    options.style.width = `${width}px`;
    options.style.left = `${left}px`;

    const below = viewportBottom - trigger.bottom - 2 * gap;
    const above = trigger.top - viewportTop - 2 * gap;
    const fullHeight = options.scrollHeight + options.offsetHeight - options.clientHeight;
    const opensAbove = fullHeight > below && above > below;
    options.style.maxHeight = `${Math.max(opensAbove ? above : below, 0)}px`;
    options.style.top = `${opensAbove ? trigger.top - gap - options.offsetHeight : trigger.bottom + gap}px`;
    options.style.visibility = 'visible';
  }

  function quickControls(work) {
    const quick = work.quick;
    if (!data?.quickModeration?.csrfToken || !quick) return null;
    const controls = element('div', '', 'projects-teaser-moderation');
    const label = work.visibility === 'public' ? 'Внешняя витрина' : 'В ленте школы';
    controls.append(element('span', label, 'projects-teaser-work-status'));
    const menu = element('div', '', 'projects-teaser-status-menu');
    const moderationUrl = `https://proj.platoniks.ru/works/${work.id}#moderation`;
    const trigger = element(supportsPopover ? 'button' : 'a', 'Изменить статус', 'projects-teaser-status-trigger');
    trigger.setAttribute('aria-label', `Изменить статус работы «${work.title}»`);
    menu.append(trigger);
    controls.append(menu);
    if (!supportsPopover) {
      trigger.href = moderationUrl;
      return controls;
    }

    trigger.type = 'button';
    const options = element('div', '', 'projects-teaser-status-options');
    options.popover = 'auto';
    trigger.popoverTargetElement = options;
    options.addEventListener('beforetoggle', () => { options.style.visibility = ''; });
    options.addEventListener('toggle', positionOpenStatusMenu);
    menu.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !options.matches(':popover-open')) return;
      event.preventDefault();
      options.hidePopover();
      trigger.focus({preventScroll: true});
    });
    const unpublished = quick.latestVersionId !== work.versionId || (work.status === 'approved' && quick.status === 'pending');
    const unchanged = !unpublished && quick.status === 'approved' && work.visibility === 'school';
    const approve = element('button', unchanged ? 'Уже в ленте школы' : 'В ленту школы');
    approve.type = 'button';
    approve.disabled = busy.has(work.id) || unchanged || unpublished || !quick.canApproveSchool;
    approve.addEventListener('click', () => changeStatus(work, 'approve_school'));
    options.append(approve);
    if (unpublished || !quick.canApproveSchool) {
      options.append(element('p', quick.approveReason || 'Откройте и проверьте актуальную версию перед утверждением.'));
      const open = element('a', 'Проверить актуальную версию');
      open.href = moderationUrl;
      options.append(open);
    }
    for (const [action, title, description] of [
      ['review','На проверку','Снять с ленты, оставить автору и семье'],
      ['hide','Скрыть','Доступно только модератору'],
    ]) {
      const button = element('button');
      button.type = 'button';
      button.disabled = busy.has(work.id);
      button.append(element('strong', title),element('small', description));
      button.addEventListener('click', () => changeStatus(work, action));
      options.append(button);
    }
    if (busy.has(work.id)) options.append(element('p','Сохраняем статус…'));
    menu.append(options);
    return controls;
  }

  function show(sort = currentSort) {
    currentSort = sort;
    const scrollLeft = list.scrollLeft;
    tabs.forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.projectsSort === sort)));
    list.replaceChildren();
    const works = data?.[sort] || [];
    status.textContent = message || (works.length ? '' : 'Первые работы появятся здесь после проверки. Откройте проекты, чтобы посмотреть своё портфолио.');
    works.forEach(work => {
      const article = element('article', '', 'projects-teaser-card');
      article.dataset.workId = work.id;
      const link = element('a');
      link.href = `https://proj.platoniks.ru/works/${work.id}`;
      const media = element('div', '', 'projects-teaser-image');
      if (work.coverUrl) {
        const path = /^\/media\/(\d+)\/(\d+)\/(\d+)(?:\?published=1)?$/.exec(work.coverUrl);
        if (path) {
          const image = element('img');
          image.src = `/api/projects-media/${path[1]}/${path[2]}/${path[3]}`;
          image.alt = work.title;
          image.loading = 'lazy';
          image.decoding = 'async';
          media.append(image);
        }
      }
      if (!media.children.length) media.append(element('span', work.kind || 'Проект'));
      link.append(media,element('h3',work.title),element('p',[work.authorName,work.year].filter(Boolean).join(' · ')),element('span',`♡ ${work.likes || 0}`,'projects-teaser-likes'));
      article.append(link);
      const controls = quickControls(work);
      if (controls) article.append(controls);
      list.append(article);
    });
    list.scrollLeft = scrollLeft;
  }

  function invalidateLoad() {
    loadGeneration++;
    loadController?.abort();
    loadController = null;
    loading = false;
  }

  async function load(force = false) {
    if (loading && !force) return;
    invalidateLoad();
    const generation = loadGeneration;
    const controller = new AbortController();
    loadController = controller;
    loading = true;
    refresh.disabled = true;
    try {
      const response = await fetch('/api/projects-widget',{credentials:'same-origin',headers:{Accept:'application/json'},signal:controller.signal});
      if (!response.ok) throw new Error('unavailable');
      const result = await response.json();
      if (controller.signal.aborted || generation !== loadGeneration) return;
      data = result;
      refresh.hidden = true;
      show();
    } catch {
      if (controller.signal.aborted || generation !== loadGeneration) return;
      status.textContent = message || 'Работы временно недоступны. Попробуйте открыть сервис проектов.';
      refresh.hidden = false;
    } finally {
      if (generation === loadGeneration) {
        loading = false;
        loadController = null;
        refresh.disabled = busy.size > 0;
      }
    }
  }

  async function changeStatus(work, action) {
    if (busy.has(work.id) || !work.quick || !data?.quickModeration?.csrfToken) return;
    busy.add(work.id);
    invalidateLoad();
    refresh.disabled = true;
    const controls = list.querySelector(`[data-work-id="${work.id}"] .projects-teaser-status-options`);
    controls?.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      const response = await fetch('/api/projects-quick-status',{
        method:'POST',credentials:'same-origin',headers:{Accept:'application/json','Content-Type':'application/json'},
        body:JSON.stringify({csrfToken:data.quickModeration.csrfToken,workId:work.id,
          versionId:action === 'approve_school' ? work.versionId : work.quick.latestVersionId,
          expectedRevision:work.revision,action,requestId:crypto.randomUUID()}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? 'Работа уже обновлена. Проверьте её актуальную версию.' : /[а-яё]/i.test(result.error || '') ? result.error : 'Статус не подтверждён. Обновите работы перед повторным действием.');
      for (const sort of ['latest','top']) {
        data[sort] = (data[sort] || []).flatMap(item => item.id !== work.id ? [item] : result.publishedWork ? [result.publishedWork] : []);
      }
      message = action === 'hide' ? 'Работа скрыта.' : action === 'review' ? 'Работа снята с ленты и возвращена на проверку.' : 'Работа утверждена для школьной ленты.';
      show();
      await load(true);
    } catch (error) {
      message = /[а-яё]/i.test(error.message || '') ? error.message : 'Не удалось подтвердить статус. Обновите работы перед повторным действием.';
      refresh.hidden = false;
      // A fresh read resolves stale or ambiguous results; never repeat the POST automatically.
      await load(true);
    } finally {
      busy.delete(work.id);
      refresh.disabled = loading || busy.size > 0;
      show();
      status.focus({preventScroll:true});
    }
  }

  tabs.forEach(tab => tab.addEventListener('click', () => show(tab.dataset.projectsSort)));
  refresh.addEventListener('click', () => { message = ''; void load(); });
  function quietRefresh() {
    if (document.hidden || loading || busy.size || section.contains(document.activeElement) ||
        (supportsPopover && section.querySelector(openStatusMenu))) return;
    void load();
  }
  if (supportsPopover) {
    list.addEventListener('scroll', positionOpenStatusMenu);
    window.addEventListener('scroll', positionOpenStatusMenu);
    window.addEventListener('resize', positionOpenStatusMenu);
    window.visualViewport?.addEventListener('scroll', positionOpenStatusMenu);
    window.visualViewport?.addEventListener('resize', positionOpenStatusMenu);
  }
  window.setInterval(quietRefresh,60000);
  document.addEventListener('visibilitychange',quietRefresh);
  window.addEventListener('focus',quietRefresh);
  void load();
}
