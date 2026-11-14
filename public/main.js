(() => {
  const TOAST_TYPES = {
    info: 'bg-slate-950 text-white',
    success: 'bg-emerald-600 text-white',
    error: 'bg-rose-600 text-white',
  };

  function ensureToastRegion() {
    let region = document.getElementById('portal-toast-region');
    if (region) return region;

    region = document.createElement('div');
    region.id = 'portal-toast-region';
    region.className = 'fixed bottom-4 left-1/2 z-[200] flex w-[min(92vw,28rem)] -translate-x-1/2 flex-col items-center gap-2 pointer-events-none';
    document.body.appendChild(region);
    return region;
  }

  function showToast(message, type = 'info') {
    const region = ensureToastRegion();
    const item = document.createElement('div');
    item.className = [
      'pointer-events-auto rounded-lg px-4 py-2 text-sm font-medium shadow-lg shadow-slate-950/20',
      'transition duration-200 ease-out',
      TOAST_TYPES[type] || TOAST_TYPES.info,
    ].join(' ');
    item.textContent = message;
    region.appendChild(item);

    window.setTimeout(() => {
      item.classList.add('opacity-0', 'translate-y-1');
    }, 1800);
    window.setTimeout(() => item.remove(), 2200);
  }

  async function fetchText(url) {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'text/plain' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  function reloadSoon() {
    window.setTimeout(() => window.location.reload(), 50);
  }

  let loginTrigger;

  function openLoginModal(trigger) {
    const modal = document.getElementById('modal');
    if (!modal) return;
    loginTrigger = trigger;
    modal.classList.remove('hidden');
    document.getElementById('modal-pin')?.focus();
  }

  function closeLoginModal() {
    const modal = document.getElementById('modal');
    if (!modal || modal.classList.contains('hidden')) return;
    if (modal.querySelector('form[aria-busy="true"]')) return;
    modal.classList.add('hidden');
    loginTrigger?.focus();
  }

  async function login(event) {
    event?.preventDefault();
    const form = event.currentTarget;
    if (form.getAttribute('aria-busy') === 'true') return;
    const input = form.elements.pin;
    const submit = form.querySelector('button[type="submit"]');
    const message = form.querySelector('[data-pin-error]');
    const pin = input?.value?.trim() || '';

    function showError(text, invalid = false) {
      message.textContent = text;
      message.hidden = false;
      if (invalid) input.setAttribute('aria-invalid', 'true');
      input.focus();
      input.select();
    }

    if (!pin) {
      showError('Введите PIN.', true);
      return;
    }

    form.setAttribute('aria-busy', 'true');
    submit.disabled = true;
    submit.textContent = 'Входим…';
    input.removeAttribute('aria-invalid');
    message.hidden = true;
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        body: new URLSearchParams({ pin }),
      });
      const result = await response.json();
      if (response.ok && result.ok) {
        window.location.assign(result.redirect);
        return;
      }
      showError(result.message || 'Вход не удался. Попробуйте ещё раз.', response.status === 401);
    } catch {
      showError('Не удалось связаться с порталом. Попробуйте ещё раз.');
    } finally {
      form.removeAttribute('aria-busy');
      submit.disabled = false;
      submit.textContent = 'Войти';
    }
  }

  async function logout(event) {
    event?.preventDefault();
    showToast('Выход из аккаунта', 'info');
    try {
      await fetchText('/logout');
    } catch (error) {
      console.error(error);
    } finally {
      reloadSoon();
    }
  }

  window.PortalToast = {
    show: showToast,
    success: (message) => showToast(message, 'success'),
    error: (message) => showToast(message, 'error'),
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('#openModal, [data-open-login]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        openLoginModal(button);
      });
    });

    document.getElementById('closeLoginModal')?.addEventListener('click', closeLoginModal);
    document.getElementById('modal')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) closeLoginModal();
    });

    document.querySelectorAll('[data-portal-login]').forEach(form => form.addEventListener('submit', login));
    document.getElementById('logoutBtn')?.addEventListener('click', logout);

    document.addEventListener('keydown', (event) => {
      const modal = document.getElementById('modal');
      if (!modal || modal.classList.contains('hidden')) return;
      if (event.key === 'Escape') closeLoginModal();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(modal.querySelectorAll('a[href], input, button:not(:disabled)'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    });
  });
})();
