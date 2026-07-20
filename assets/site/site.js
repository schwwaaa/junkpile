(() => {
  const navToggle = document.querySelector('[data-nav-toggle]');
  const nav = document.querySelector('[data-site-nav]');
  if (navToggle && nav) {
    navToggle.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', String(open));
    });
    nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
      nav.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
    }));
  }

  const tocToggle = document.querySelector('[data-docs-toc-toggle]');
  const toc = document.querySelector('.docs-sidebar');
  if (tocToggle && toc) {
    const stateLabel = tocToggle.querySelector('[data-docs-toc-state]');
    tocToggle.addEventListener('click', () => {
      const open = toc.classList.toggle('is-open');
      tocToggle.setAttribute('aria-expanded', String(open));
      if (stateLabel) stateLabel.textContent = open ? 'Close' : 'Open';
    });
    toc.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
      if (window.matchMedia('(max-width: 820px)').matches) {
        toc.classList.remove('is-open');
        tocToggle.setAttribute('aria-expanded', 'false');
        if (stateLabel) stateLabel.textContent = 'Open';
      }
    }));
  }

  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const selector = button.getAttribute('data-copy');
      const target = selector ? document.querySelector(selector) : null;
      if (!target) return;
      try {
        await navigator.clipboard.writeText(target.textContent.trim());
        const previous = button.textContent;
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = previous; }, 1300);
      } catch (error) {
        button.textContent = 'Select text';
        target.focus?.();
      }
    });
  });

  const filterRoots = document.querySelectorAll('[data-example-filter]');
  filterRoots.forEach((root) => {
    const cards = [...root.querySelectorAll('[data-example-card]')];
    const count = root.querySelector('[data-filter-count]');
    const search = root.querySelector('[data-example-search]');
    const state = { version: 'all', family: 'all', topology: 'all', query: '' };

    const apply = () => {
      let visible = 0;
      cards.forEach((card) => {
        const text = card.textContent.toLowerCase();
        const matches =
          (state.version === 'all' || card.dataset.version === state.version) &&
          (state.family === 'all' || card.dataset.family === state.family) &&
          (state.topology === 'all' || card.dataset.topology === state.topology) &&
          (!state.query || text.includes(state.query));
        card.hidden = !matches;
        if (matches) visible += 1;
      });
      if (count) count.textContent = `${visible} of ${cards.length} examples`;
      const noResults = root.querySelector('[data-example-no-results]');
      noResults?.classList.toggle('is-visible', visible === 0);
    };

    root.querySelectorAll('[data-filter-key]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.filterKey;
        const value = button.dataset.filterValue;
        state[key] = value;
        root.querySelectorAll(`[data-filter-key="${key}"]`).forEach((peer) => {
          peer.classList.toggle('is-active', peer === button);
          peer.setAttribute('aria-pressed', String(peer === button));
        });
        apply();
      });
    });
    search?.addEventListener('input', () => {
      state.query = search.value.trim().toLowerCase();
      apply();
    });
    apply();
  });

  document.querySelectorAll('[data-layer-tabs]').forEach((root) => {
    const tabs = [...root.querySelectorAll('[data-layer-tab]')];
    const panels = [...root.querySelectorAll('[data-layer-panel]')];
    tabs.forEach((tab) => tab.addEventListener('click', () => {
      const id = tab.dataset.layerTab;
      tabs.forEach((peer) => {
        const active = peer === tab;
        peer.classList.toggle('is-active', active);
        peer.setAttribute('aria-selected', String(active));
      });
      panels.forEach((panel) => panel.classList.toggle('is-active', panel.dataset.layerPanel === id));
    }));
  });

  const docSearch = document.querySelector('[data-doc-search]');
  if (docSearch) {
    const sections = [...document.querySelectorAll('[data-doc-section]')];
    const status = document.querySelector('[data-doc-search-status]');
    const noResults = document.querySelector('[data-doc-no-results]');
    docSearch.addEventListener('input', () => {
      const query = docSearch.value.trim().toLowerCase();
      let shown = 0;
      sections.forEach((section) => {
        const keep = !query || section.textContent.toLowerCase().includes(query);
        section.classList.toggle('is-search-hidden', !keep);
        if (keep) shown += 1;
      });
      if (status) status.textContent = query ? `${shown} documentation sections match “${docSearch.value.trim()}”` : 'Search setup, architecture, inputs, examples, and troubleshooting.';
      noResults?.classList.toggle('is-visible', shown === 0);
    });
  }

  const sidebarLinks = [...document.querySelectorAll('.docs-sidebar a[href^="#"]')];
  const observedSections = sidebarLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);
  if ('IntersectionObserver' in window && observedSections.length) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      sidebarLinks.forEach((link) => link.classList.toggle('is-current', link.getAttribute('href') === `#${visible.target.id}`));
    }, { rootMargin: '-20% 0px -68% 0px', threshold: [0, .1, .5] });
    observedSections.forEach((section) => observer.observe(section));
  }

  document.querySelectorAll('[data-open-all]').forEach((button) => {
    button.addEventListener('click', () => {
      const scope = document.querySelector(button.dataset.openAll) || document;
      const details = [...scope.querySelectorAll('details')];
      const shouldOpen = details.some((item) => !item.open);
      details.forEach((item) => { item.open = shouldOpen; });
      button.textContent = shouldOpen ? 'Collapse all' : 'Expand all';
    });
  });
})();
