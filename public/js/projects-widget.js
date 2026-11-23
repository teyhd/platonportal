const section = document.querySelector('[data-projects-widget]');

if (section) {
  const list = section.querySelector('[data-projects-list]');
  const status = section.querySelector('[data-projects-status]');
  const tabs = Array.from(section.querySelectorAll('[data-projects-sort]'));
  let data;

  function show(sort) {
    tabs.forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.projectsSort === sort)));
    list.replaceChildren();
    const works = data?.[sort] || [];
    status.textContent = works.length ? '' : 'Первые работы появятся здесь после проверки. Откройте проекты, чтобы посмотреть своё портфолио.';
    works.forEach(work => {
      const article = document.createElement('article');
      article.className = 'projects-teaser-card';
      const link = document.createElement('a');
      link.href = `https://proj.platoniks.ru/works/${work.id}`;
      const media = document.createElement('div');
      media.className = 'projects-teaser-image';
      if (work.coverUrl) {
        const path = /^\/media\/(\d+)\/(\d+)\/(\d+)(?:\?published=1)?$/.exec(work.coverUrl);
        if (path) {
          const image = document.createElement('img');
          image.src = `/api/projects-media/${path[1]}/${path[2]}/${path[3]}`;
          image.alt = work.title;
          image.loading = 'lazy';
          image.decoding = 'async';
          media.append(image);
        }
      }
      if (!media.children.length) {
        const format = document.createElement('span');
        format.textContent = work.kind || 'Проект';
        media.append(format);
      }
      const title = document.createElement('h3');
      title.textContent = work.title;
      const caption = document.createElement('p');
      caption.textContent = [work.authorName, work.year].filter(Boolean).join(' · ');
      const likes = document.createElement('span');
      likes.className = 'projects-teaser-likes';
      likes.textContent = `♡ ${work.likes || 0}`;
      link.append(media,title,caption,likes);
      article.append(link);
      list.append(article);
    });
  }

  tabs.forEach(tab => tab.addEventListener('click', () => show(tab.dataset.projectsSort)));
  fetch('/api/projects-widget', {credentials:'same-origin', headers:{Accept:'application/json'}})
    .then(response => { if (!response.ok) throw new Error('unavailable'); return response.json(); })
    .then(result => { data = result; show('latest'); })
    .catch(() => { status.textContent = 'Работы временно недоступны. Попробуйте открыть сервис проектов.'; });
}
