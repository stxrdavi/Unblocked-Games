(() => {
  'use strict';
  const wrap = get('search-wrap');
  const menu = get('search-menu');
  const matches = get('game-matches');
  const status = get('game-search-status');

  function update() {
    const query = normalize(search.value.trim());
    menu.hidden = !query;
    if (!query) return;
    const results = games.filter(game => normalize(game.title).includes(query))
      .sort((a, b) => titleOrder.compare(a.title, b.title));
    matches.replaceChildren(...results.map(game => {
      const link = document.createElement('a');
      link.className = 'search-game';
      link.href = '#gioco/' + game.id;
      if (game.cover) {
        const image = document.createElement('img');
        image.src = game.cover;
        image.alt = '';
        image.loading = 'lazy';
        link.append(image);
      }
      link.append(game.title);
      return link;
    }));
    status.hidden = results.length > 0;
    status.textContent = results.length ? '' : 'Nessun gioco trovato.';
  }

  const close = () => { menu.hidden = true; };
  search.addEventListener('input', update);
  search.addEventListener('focus', update);
  search.addEventListener('click', () => { if (menu.hidden) update(); });
  wrap.addEventListener('focusout', event => {
    if (!wrap.contains(event.relatedTarget)) close();
  });
  document.addEventListener('pointerdown', event => {
    if (!wrap.contains(event.target)) close();
  });
  menu.addEventListener('click', event => {
    if (event.target.closest('a, button')) close();
  });
  window.addEventListener('hashchange', close);
  wrap.addEventListener('keydown', event => {
    if (menu.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      search.focus();
      close();
      return;
    }
    const actions = [...menu.querySelectorAll('a, button')];
    if (event.key === 'Enter' && event.target === search && actions.length) {
      event.preventDefault();
      actions[0].click();
    } else if (['ArrowDown','ArrowUp'].includes(event.key) && actions.length) {
      event.preventDefault();
      const index = actions.indexOf(event.target);
      const next = event.key === 'ArrowDown' ? index + 1 : index < 0 ? actions.length - 1 : index - 1;
      (actions[next] || search).focus();
    }
  });
})();
