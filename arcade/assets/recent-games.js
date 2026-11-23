(() => {
  'use strict';
  const section = get('recent-games');
  const list = get('recent-list');
  const back = get('recent-back');
  const next = get('recent-next');
  const memory = new Map();
  function key() {
    if (!profileSession) return 'arcade-recent-v1:guest';
    let user = profileSession.username.toLowerCase();
    try {
      const encoded = profileSession.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const {sub} = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
      if (typeof sub === 'string' && sub) user = sub;
    } catch {}
    return 'arcade-recent-v1:' + user;
  }

  function read() {
    let ids;
    try { ids = JSON.parse(localStorage.getItem(key())); } catch {}
    if (!Array.isArray(ids)) ids = memory.get(key()) || [];
    return [...new Set(ids.filter(id => typeof id === 'string' && byId.has(id)))].slice(0, 24);
  }

  function updateControls() {
    back.disabled = list.scrollLeft <= 1;
    next.disabled = list.scrollLeft + list.clientWidth >= list.scrollWidth - 1;
  }

  function render() {
    const ids = read();
    section.hidden = ids.length === 0;
    list.replaceChildren(...ids.map(id => {
      const game = byId.get(id);
      const link = document.createElement('a');
      link.className = 'recent-game';
      link.href = '#gioco/' + id;
      const artwork = document.createElement('span');
      artwork.className = 'recent-art';
      artwork.style.setProperty('--hue', game.color);
      artwork.textContent = game.title.split(/\s+/).slice(0, 2).map(word => word[0]).join('');
      if (game.cover) {
        const image = document.createElement('img');
        image.src = game.cover;
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('error', () => image.remove(), {once:true});
        artwork.append(image);
      }
      artwork.setAttribute('aria-hidden', 'true');
      const title = document.createElement('strong');
      title.textContent = game.title;
      link.append(artwork, title);
      link.addEventListener('pointerenter', () => queueGameWarmup(game));
      link.addEventListener('pointerleave', () => clearTimeout(warmTimer));
      link.addEventListener('focus', () => queueGameWarmup(game));
      link.addEventListener('blur', () => clearTimeout(warmTimer));
      return link;
    }));
    list.scrollTo({left:0, behavior:'instant'});
    requestAnimationFrame(updateControls);
  }

  function visit() {
    const id = location.hash.startsWith('#gioco/') ? location.hash.slice(7) : '';
    if (byId.has(id) && !get('player').hidden) {
      const ids = [id, ...read().filter(previous => previous !== id)].slice(0, 24);
      memory.set(key(), ids);
      try { localStorage.setItem(key(), JSON.stringify(ids)); } catch {}
    }
    render();
  }

  function scroll(direction) {
    list.scrollBy({
      left: direction * list.clientWidth,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    });
  }
  back.addEventListener('click', () => scroll(-1));
  next.addEventListener('click', () => scroll(1));
  list.addEventListener('scroll', updateControls, {passive:true});
  new ResizeObserver(updateControls).observe(list);
  window.addEventListener('hashchange', visit);
  window.addEventListener('arcade-session-change', render);
  window.addEventListener('storage', event => { if (event.key === key() || event.key === null) render(); });
  window.addEventListener('pageshow', render);
  visit();
})();
