(() => {
  'use strict';
  const section = get('profile-results');
  const status = get('profile-search-status');
  const matches = get('profile-matches');
  const dialog = get('public-profile');
  const avatar = get('public-profile-avatar');
  let timer;
  let pending;

  function openProfile(profile) {
    get('public-profile-name').textContent = profile.username;
    get('public-profile-initial').textContent = profile.username[0].toUpperCase();
    const bio = get('public-profile-bio');
    bio.textContent = profile.bio || '';
    bio.hidden = !bio.textContent;
    avatar.hidden = !profile.avatar;
    if (profile.avatar) avatar.src = profile.avatar;
    else avatar.removeAttribute('src');
    dialog.showModal();
  }

  get('public-profile-close').onclick = () => dialog.close();
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
          button.className = 'secondary';
          button.type = 'button';
          button.textContent = profile.username;
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
  document.querySelector('.brand').addEventListener('click', update);
  update();
})();
