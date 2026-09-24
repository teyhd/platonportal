(() => {
  const telegram = window.Telegram?.WebApp;
  const elements = {
    loading: document.querySelector('[data-tma-loading]'),
    error: document.querySelector('[data-tma-error]'),
    errorTitle: document.querySelector('[data-tma-error-title]'),
    errorMessage: document.querySelector('[data-tma-error-message]'),
    retry: document.querySelector('[data-tma-retry]'),
    content: document.querySelector('[data-tma-content]'),
    name: document.querySelector('[data-tma-name]'),
    subtitle: document.querySelector('[data-tma-subtitle]'),
    services: document.querySelector('[data-tma-services]'),
    empty: document.querySelector('[data-tma-empty]'),
    logout: document.querySelector('[data-tma-logout]'),
  };
  let csrfToken = '';

  function getInitData() {
    if (telegram?.initData) return telegram.initData;
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return query.get('tgWebAppData') || hash.get('tgWebAppData') || '';
  }

  function setVisible(element, visible) {
    if (element) element.hidden = !visible;
  }

  function showError(title, message, retry = false) {
    setVisible(elements.loading, false);
    setVisible(elements.content, false);
    setVisible(elements.error, true);
    if (elements.errorTitle) elements.errorTitle.textContent = title;
    if (elements.errorMessage) elements.errorMessage.textContent = message;
    setVisible(elements.retry, retry);
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const error = new Error(payload?.code || `http_${response.status}`);
      error.code = payload?.code || 'request_failed';
      throw error;
    }
    return payload;
  }

  function cardFallback(title) {
    const fallback = document.createElement('span');
    fallback.className = 'telegram-miniapp-card-fallback';
    fallback.textContent = String(title || 'С').trim().slice(0, 1).toUpperCase() || 'С';
    return fallback;
  }

  function renderServices(services) {
    if (!elements.services) return;
    elements.services.replaceChildren();
    for (const service of services) {
      const card = document.createElement('a');
      card.href = service.launchUrl;
      card.className = 'telegram-miniapp-card';
      card.setAttribute('aria-label', `Открыть: ${service.title}`);

      if (service.imageSrc) {
        const image = document.createElement('img');
        image.src = service.imageSrc;
        image.alt = '';
        image.loading = 'lazy';
        image.addEventListener('error', () => image.replaceWith(cardFallback(service.title)), { once: true });
        card.append(image);
      } else {
        card.append(cardFallback(service.title));
      }

      const label = document.createElement('span');
      label.textContent = service.title;
      card.append(label);
      card.addEventListener('click', event => {
        event.preventDefault();
        window.location.assign(service.launchUrl);
      });
      elements.services.append(card);
    }
    setVisible(elements.empty, services.length === 0);
  }

  async function openPortal() {
    setVisible(elements.error, false);
    setVisible(elements.content, false);
    setVisible(elements.loading, true);

    const initData = getInitData();
    if (!initData) {
      showError('Откройте приложение из Telegram', 'Для безопасного входа используйте кнопку «Открыть портал» в чате с ботом.', false);
      return;
    }

    try {
      telegram.ready?.();
      telegram.expand?.();
      const authenticated = await request('/tg/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ initData }),
      });
      csrfToken = authenticated.csrfToken;
      const payload = await request('/tg/api/portal', { headers: { accept: 'application/json' } });
      if (elements.name) elements.name.textContent = payload.portal.title;
      if (elements.subtitle) elements.subtitle.textContent = `Здравствуйте, ${payload.user.name}. ${payload.portal.subtitle}`;
      renderServices(payload.portal.services || []);
      setVisible(elements.loading, false);
      setVisible(elements.content, true);
    } catch (error) {
      if (error.code === 'link_unavailable') {
        showError('Нужно подтвердить связь аккаунта', 'Ваш Telegram пока не связан с активным аккаунтом Гармонии или связь требует проверки.', false);
        return;
      }
      if (error.code === 'invalid_telegram_auth') {
        showError('Не удалось подтвердить вход', 'Закройте Mini App и откройте его снова из бота.', true);
        return;
      }
      showError('Не удалось открыть портал', 'Проверьте подключение и повторите попытку.', true);
    }
  }

  elements.retry?.addEventListener('click', openPortal);
  elements.logout?.addEventListener('click', async () => {
    try {
      await request('/tg/api/logout', { method: 'POST', headers: { 'x-tma-csrf': csrfToken } });
    } catch (_) {}
    telegram?.close?.();
  });

  document.addEventListener('DOMContentLoaded', openPortal);
})();
