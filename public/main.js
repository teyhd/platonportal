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

  function openLoginModal() {
    const modal = document.getElementById('modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.getElementById('pass')?.focus();
  }

  function closeLoginModal() {
    document.getElementById('modal')?.classList.add('hidden');
  }

  async function login(event) {
    event?.preventDefault();
    const input = document.getElementById('pass');
    const pin = input?.value?.trim() || '';

    if (!pin) {
      showToast('Введите PIN', 'error');
      input?.focus();
      return;
    }

    try {
      const result = (await fetchText(`/sso/auth?pin=${encodeURIComponent(pin)}`)).trim();
      if (result === 'ok') {
        showToast('Авторизация успешна', 'success');
        reloadSoon();
        return;
      }

      if (input) input.value = '';
      showToast('Неверный PIN', 'error');
      input?.focus();
    } catch (error) {
      console.error(error);
      showToast('Не удалось выполнить вход', 'error');
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
        openLoginModal();
      });
    });

    document.getElementById('closeLoginModal')?.addEventListener('click', closeLoginModal);
    document.getElementById('modal')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) closeLoginModal();
    });

    const pass = document.getElementById('pass');
    pass?.closest('form')?.addEventListener('submit', login);
    document.getElementById('btnlogin')?.addEventListener('click', login);
    document.getElementById('logoutBtn')?.addEventListener('click', logout);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeLoginModal();
    });
  });
})();
