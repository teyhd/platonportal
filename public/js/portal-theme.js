(() => {
  const root = document.documentElement;
  const account = root.dataset.themeAccount;
  const storageKey = `portal-theme:${account || 'guest'}`;
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const meta = document.querySelector('meta[name="theme-color"]');
  const modes = ['system', 'light', 'dark'];
  let preference = readPreference();
  let picker;

  function readPreference() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (modes.includes(saved)) return saved;
      if (!account) {
        const previous = localStorage.getItem('theme');
        if (previous === 'light' || previous === 'dark') return previous;
      }
    } catch {
      // The picker still works for the page when storage is unavailable.
    }
    return 'system';
  }

  function applyTheme() {
    const dark = preference === 'dark' || (preference === 'system' && systemTheme.matches);
    root.classList.toggle('dark', dark);
    root.dataset.portalTheme = dark ? 'dark' : 'light';
    if (meta) meta.content = dark ? '#09111d' : '#f5f5f7';
    const choice = picker?.querySelector(`input[value="${preference}"]`);
    if (choice) choice.checked = true;
  }

  applyTheme();
  systemTheme.addEventListener('change', () => {
    if (preference === 'system') applyTheme();
  });
  window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) {
      preference = readPreference();
      applyTheme();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    picker = document.querySelector('[data-portal-preferences]');
    if (!picker) return;
    const trigger = picker.querySelector('summary');
    applyTheme();

    picker.addEventListener('change', event => {
      if (event.target.name !== 'portal-theme' || !modes.includes(event.target.value)) return;
      preference = event.target.value;
      applyTheme();
      try { localStorage.setItem(storageKey, preference); } catch {}
    });

    picker.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !picker.open) return;
      event.preventDefault();
      picker.open = false;
      trigger.focus();
    });

    document.addEventListener('click', event => {
      if (!picker.contains(event.target)) picker.open = false;
    });
    picker.addEventListener('focusout', event => {
      if (event.relatedTarget && !picker.contains(event.relatedTarget)) picker.open = false;
    });
  });
})();
