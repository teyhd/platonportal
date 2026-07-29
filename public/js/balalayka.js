(() => {
  const primary = document.querySelector('[data-device-primary]');
  const secondary = document.querySelector('[data-device-secondary]');
  const androidLink = document.querySelector('[data-analytics-event="platform_android"]');
  const product = document.querySelector('[data-hero-product]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (primary && secondary && androidLink) {
    const webHref = primary.href;
    const iosHref = secondary.href;
    const androidHref = androidLink.href;
    const userAgent = navigator.userAgent || '';

    if (/iPhone|iPad|iPod/i.test(userAgent)) {
      primary.href = iosHref;
      primary.textContent = 'Установить на iPhone';
      primary.dataset.analyticsEvent = 'hero_ios_install';
      secondary.href = webHref;
      secondary.textContent = 'Открыть веб-версию';
      secondary.dataset.analyticsEvent = 'hero_web_open';
    } else if (/Android/i.test(userAgent)) {
      primary.href = androidHref;
      primary.textContent = 'Установить на Android';
      primary.dataset.analyticsEvent = 'hero_android_install';
      secondary.href = webHref;
      secondary.textContent = 'Открыть веб-версию';
      secondary.dataset.analyticsEvent = 'hero_web_open';
    }
  }

  if (!product || reducedMotion) return;

  let scheduled = false;
  const updateDepth = () => {
    scheduled = false;
    const rect = product.getBoundingClientRect();
    const viewportCenter = window.innerHeight / 2;
    const productCenter = rect.top + rect.height / 2;
    const shift = Math.max(-14, Math.min(14, (viewportCenter - productCenter) * 0.06));
    product.style.setProperty('--bl-product-shift', `${shift.toFixed(1)}px`);
  };

  const requestDepth = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(updateDepth);
  };

  updateDepth();
  window.addEventListener('scroll', requestDepth, { passive: true });
  window.addEventListener('resize', requestDepth, { passive: true });
})();
