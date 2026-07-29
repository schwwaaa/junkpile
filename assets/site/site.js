(() => {
  const navToggle = document.querySelector('[data-nav-toggle]');
  const nav = document.querySelector('[data-site-nav]');
  navToggle?.addEventListener('click', () => {
    const open = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', String(!open));
    nav?.classList.toggle('is-open', !open);
  });

  const tocToggle = document.querySelector('[data-docs-toc-toggle]');
  const sidebar = document.querySelector('.docs-sidebar');
  tocToggle?.addEventListener('click', () => {
    const open = tocToggle.getAttribute('aria-expanded') === 'true';
    tocToggle.setAttribute('aria-expanded', String(!open));
    sidebar?.classList.toggle('is-open', !open);
    const state = document.querySelector('[data-docs-toc-state]');
    if (state) state.textContent = open ? 'Open' : 'Close';
  });

  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = document.querySelector(button.dataset.copy);
      if (!target) return;
      try {
        await navigator.clipboard.writeText(target.innerText);
        const old = button.textContent;
        button.textContent = 'Copied';
        setTimeout(() => button.textContent = old, 1200);
      } catch (_) {}
    });
  });

  document.querySelectorAll('[data-open-all]').forEach((button) => {
    button.addEventListener('click', () => {
      const root = document.querySelector(button.dataset.openAll);
      root?.querySelectorAll('details').forEach((d) => d.open = true);
    });
  });

  const docSearch = document.querySelector('[data-doc-search]');
  const docSections = [...document.querySelectorAll('[data-doc-section]')];
  const docNoResults = document.querySelector('[data-doc-no-results]');
  docSearch?.addEventListener('input', () => {
    const q = docSearch.value.trim().toLowerCase();
    let visible = 0;
    docSections.forEach((section) => {
      const hit = !q || section.textContent.toLowerCase().includes(q);
      section.hidden = !hit;
      if (hit) visible++;
    });
    if (docNoResults) docNoResults.style.display = visible ? 'none' : 'block';
  });

  const search = document.querySelector('[data-example-search]');
  const cards = [...document.querySelectorAll('[data-example-card]')];
  const count = document.querySelector('[data-filter-count]');
  const empty = document.querySelector('[data-example-no-results]');
  let version = 'all';
  function applyFilters() {
    const q = (search?.value || '').trim().toLowerCase();
    let shown = 0;
    cards.forEach((card) => {
      const matchVersion = version === 'all' || card.dataset.version === version;
      const matchText = !q || card.textContent.toLowerCase().includes(q);
      const show = matchVersion && matchText;
      card.hidden = !show;
      if (show) shown++;
    });
    if (count) count.textContent = `${shown} of ${cards.length} examples`;
    if (empty) empty.style.display = shown ? 'none' : 'block';
  }
  document.querySelectorAll('[data-filter-key="version"]').forEach((button) => {
    button.addEventListener('click', () => {
      version = button.dataset.filterValue;
      document.querySelectorAll('[data-filter-key="version"]').forEach((b) => {
        const active = b === button;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      applyFilters();
    });
  });
  search?.addEventListener('input', applyFilters);
  applyFilters();
})();
