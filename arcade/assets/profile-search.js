(() => {
  'use strict';
  const section = get('profile-results');
  const status = get('profile-search-status');
  const matches = get('profile-matches');
  const dialog = get('public-profile');
  const avatar = get('public-profile-avatar');
  const stats = get('public-profile-stats');
  const statsStatus = get('public-profile-status');
  let timer;
  let pending;
  let statsRequest;

  async function openProfile(profile) {
    statsRequest?.abort();
    const request = new AbortController();
    statsRequest = request;
    get('public-profile-name').textContent = profile.username;
    get('public-profile-initial').textContent = profile.username[0].toUpperCase();
    const bio = get('public-profile-bio');
    bio.textContent = profile.bio || '';
    bio.hidden = !bio.textContent;
    avatar.hidden = !profile.avatar;
    if (profile.avatar) avatar.src = profile.avatar;
    else avatar.removeAttribute('src');
    stats.hidden = true;
    statsStatus.textContent = 'Caricamento statistiche…';
    dialog.showModal();
    dialog.dispatchEvent(new CustomEvent('arcade-view-player', {detail:profile.username}));
    try {
      const response = await fetch(authBase+'/rest/v1/rpc/arcade_public_profile_stats', {
        method:'POST', headers:{apikey:authKey,'Content-Type':'application/json'},
        body:JSON.stringify({profile_name:profile.username}), signal:request.signal
      });
      if (!response.ok) throw new Error();
      const [result] = await response.json();
      if (request.signal.aborted) return;
      if (!result) throw new Error();
      const minutes = Math.floor(result.total_seconds / 60);
      get('public-profile-time').textContent = minutes >= 60
        ? Math.floor(minutes / 60)+' h '+minutes % 60+' min'
        : result.total_seconds > 0 && minutes === 0 ? 'Meno di 1 min' : minutes+' min';
      get('public-profile-game').textContent = byId.get(result.favorite_game)?.title
        || (result.favorite_game ? 'Gioco non più nel catalogo' : 'Nessuna partita');
      stats.hidden = false;
      statsStatus.textContent = '';
    } catch {
      if (!request.signal.aborted) statsStatus.textContent = 'Statistiche al momento non disponibili.';
    }
  }

  get('public-profile-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { if (!dialog.open) statsRequest?.abort(); });
  avatar.addEventListener('error', () => { avatar.hidden = true; });

  function update() {
    clearTimeout(timer);
    pending?.abort();
    const query = search.value.trim().toLowerCase();
    section.hidden = !/^[a-z0-9_.-]{2,24}$/.test(query);
    matches.replaceChildren();
    if (section.hidden) return;
    status.textContent = 'Ricerca profili…';
    const request = new AbortController();
    pending = request;
    timer = setTimeout(async () => {
      try {
        const response = await fetch(authBase+'/rest/v1/rpc/arcade_search_profiles', {
          method:'POST', headers:{apikey:authKey,'Content-Type':'application/json'},
          body:JSON.stringify({query}), signal:request.signal
        });
        if (!response.ok) throw new Error('Ricerca non disponibile');
        const profiles = await response.json();
        if (request.signal.aborted) return;
        status.textContent = profiles.length ? '' : 'Nessun profilo trovato.';
        for (const profile of profiles) {
          const button = document.createElement('button');
          button.className = 'secondary profile-result';
          button.type = 'button';
          const picture = document.createElement('span');
          picture.className = 'profile-result-avatar';
          picture.setAttribute('aria-hidden', 'true');
          picture.textContent = profile.username[0].toUpperCase();
          if (profile.avatar) {
            const image = document.createElement('img');
            image.alt = '';
            image.addEventListener('error', () => image.remove(), {once:true});
            image.src = profile.avatar;
            picture.append(image);
          }
          button.append(picture, profile.username);
          button.onclick = () => openProfile(profile);
          matches.append(button);
        }
      } catch {
        if (request.signal.aborted) return;
        status.textContent = 'Ricerca profili al momento non disponibile.';
      }
    }, 250);
  }

  search.addEventListener('input', update);
  dialog.addEventListener('arcade-open-player', event => openProfile(event.detail));
  document.querySelector('.brand').addEventListener('click', update);
  update();
})();
