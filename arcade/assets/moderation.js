(() => {
  'use strict';
  const admin = get('admin-dialog');
  const form = get('admin-form');
  const nameField = form.elements.username;
  const matches = get('admin-matches');
  const account = get('admin-account');
  const accountName = get('admin-account-name');
  const access = get('admin-access');
  const avatar = get('admin-avatar');
  const ban = get('admin-ban');
  const unban = get('admin-unban');
  const confirmBan = get('admin-confirm');
  const statusText = get('admin-status');
  const open = get('admin-open');
  const publicProfile = get('public-profile');
  let ownerName;
  let checkedSession;
  let checkPending;
  let lookup;
  let selected;
  let saving = false;

  async function rpc(name, data = {}, session = null, signal) {
    const headers = {apikey:authKey,'Content-Type':'application/json'};
    if (session) headers.Authorization = 'Bearer '+await accessToken(session);
    const response = await fetch(authBase+'/rest/v1/rpc/'+name, {
      method:'POST', headers, body:JSON.stringify(data), signal
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.message || 'Operazione non disponibile.');
    return result;
  }

  function showPublicTag() {
    get('public-owner-tag').hidden = !ownerName || get('public-profile-name').textContent !== ownerName;
  }
  publicProfile.addEventListener('arcade-view-player', showPublicTag);
  rpc('arcade_public_owner').then(name => { ownerName = name; showPublicTag(); }).catch(() => {});

  async function checkAccount() {
    const session = profileSession;
    if (checkedSession !== session) {
      checkedSession = session;
      open.hidden = true;
      get('own-owner-tag').hidden = true;
      if (admin.open) admin.close();
    }
    if (!session || checkPending === session) return;
    checkPending = session;
    try {
      const [status] = await rpc('arcade_account_status', {}, session);
      if (session !== profileSession || !status) return;
      if (status.banned) {
        saveSession(null);
        setAccountMode(false);
        if (!accountDialog.open) accountDialog.showModal();
        accountFeedback('Questo account è stato bannato.');
        return;
      }
      open.hidden = get('own-owner-tag').hidden = !status.is_owner;
    } catch {
      if (session === profileSession) open.hidden = get('own-owner-tag').hidden = true;
    } finally {
      if (checkPending === session) checkPending = undefined;
    }
  }

  function resetSearch() {
    lookup?.abort();
    selected = null;
    statusText.textContent = '';
    matches.hidden = true;
    matches.replaceChildren();
    account.hidden = true;
    confirmBan.hidden = true;
  }

  function setAccess(state) {
    access.dataset.state = state;
    access.textContent = {
      pending:'Verifica…', unknown:'Stato non disponibile', owner:'Owner', banned:'Bannato', active:'Accesso attivo'
    }[state];
    ban.hidden = state !== 'active';
    unban.hidden = state !== 'banned';
  }

  function setPicture(initial, image, profile) {
    initial.textContent = profile.username[0].toUpperCase();
    image.hidden = !profile.avatar;
    if (profile.avatar) image.src = profile.avatar;
    else image.removeAttribute('src');
  }

  async function inspect(profile, request, session) {
    const name = profile.username;
    const playTime = get('admin-play-time');
    const topGame = get('admin-top-game');
    const bio = get('admin-bio');
    const args = {profile_name:name};
    selected = profile;
    matches.hidden = true;
    account.hidden = false;
    accountName.textContent = name;
    bio.textContent = profile.bio || '';
    bio.hidden = !bio.textContent;
    setPicture(get('admin-initial'), avatar, profile);
    setAccess('pending');
    playTime.textContent = topGame.textContent = '—';
    statusText.textContent = '';
    accountName.focus();
    const own = name === session.username || name === ownerName;
    const [state, stats] = await Promise.allSettled([
      own ? 'owner' : rpc('arcade_moderate', {...args, action:'status'}, session, request.signal),
      rpc('arcade_public_profile_stats', args, session, request.signal)
    ]);
    if (request.signal.aborted || session !== profileSession || !admin.open) return;
    const accessState = {true:'banned', false:'active', owner:'owner'}[state.value] || 'unknown';
    setAccess(accessState);
    if (accessState === 'unknown') {
      statusText.textContent = state.reason?.message || 'Impossibile verificare lo stato dell’account.';
    }
    const activity = stats.value?.[0];
    if (!activity) {
      playTime.textContent = topGame.textContent = 'Non disponibile';
      return;
    }
    const minutes = Math.floor(activity.total_seconds / 60);
    playTime.textContent = minutes >= 60 ? Math.floor(minutes / 60)+' h '+minutes % 60+' min'
      : activity.total_seconds > 0 && !minutes ? 'Meno di 1 min' : minutes+' min';
    topGame.textContent = byId.get(activity.favorite_game)?.title
      || (activity.favorite_game ? 'Gioco non più nel catalogo' : 'Nessuna partita');
  }

  function showMatches(profiles, request, session) {
    for (const profile of profiles) {
      const row = document.createElement('li');
      const button = document.createElement('button');
      const picture = document.createElement('span');
      const letter = document.createElement('span');
      const image = document.createElement('img');
      picture.className = 'admin-avatar';
      picture.setAttribute('aria-hidden','true');
      image.alt = '';
      image.addEventListener('error', () => { image.hidden = true; }, {once:true});
      setPicture(letter, image, profile);
      picture.append(letter, image);
      button.type = 'button';
      button.className = 'secondary';
      button.append(picture, profile.username, arcadeIcon('forward'));
      button.onclick = () => {
        nameField.value = profile.username;
        inspect(profile, request, session);
      };
      row.append(button);
      matches.append(row);
    }
    matches.hidden = false;
    matches.querySelector('button').focus();
  }

  open.onclick = () => {
    get('profile-dialog').close();
    admin.showModal();
    nameField.focus();
  };
  get('admin-close').onclick = () => admin.close();
  admin.addEventListener('close', () => {
    if (admin.open) return;
    resetSearch();
    form.reset();
  });
  avatar.addEventListener('error', () => { avatar.hidden = true; });
  nameField.addEventListener('input', resetSearch);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !profileSession) return;
    resetSearch();
    const session = profileSession;
    const name = nameField.value.trim().toLowerCase();
    if (!/^[a-z0-9_.-]{2,24}$/.test(name)) {
      statusText.textContent = 'Inserisci almeno 2 caratteri dello username.';
      return;
    }
    const request = lookup = new AbortController();
    statusText.textContent = 'Ricerca account…';
    let profiles;
    try {
      profiles = await rpc('arcade_search_profiles', {query:name}, session, request.signal);
    } catch (error) {
      if (request.signal.aborted || session !== profileSession || !admin.open) return;
      if (name.length >= 3) {
        inspect({username:name}, request, session);
        return;
      }
      statusText.textContent = error.message;
      return;
    }
    if (request.signal.aborted || session !== profileSession || !admin.open) return;
    const exact = profiles?.find(profile => profile.username === name);
    if (exact) inspect(exact, request, session);
    else if (profiles?.length) {
      statusText.textContent = '';
      showMatches(profiles, request, session);
    } else statusText.textContent = 'Nessun account trovato.';
  });

  ban.onclick = () => {
    if (!selected || access.dataset.state !== 'active') return;
    get('admin-confirm-text').textContent = 'Bannare '+selected.username+'? L’account verrà disconnesso.';
    confirmBan.hidden = false;
    ban.hidden = true;
    get('admin-cancel').focus();
  };
  get('admin-cancel').onclick = () => {
    confirmBan.hidden = true;
    setAccess('active');
    ban.focus();
  };

  async function moderate(action) {
    if (saving || !selected || !profileSession) return;
    const session = profileSession;
    const profile = selected;
    const buttons = [ban, unban, get('admin-cancel'), get('admin-confirm-ban'), form.querySelector('button')];
    saving = true;
    nameField.disabled = true;
    for (const button of buttons) button.disabled = true;
    statusText.textContent = 'Aggiornamento account…';
    try {
      const banned = await rpc('arcade_moderate', {profile_name:profile.username, action}, session);
      if (session !== profileSession || selected !== profile) return;
      if (typeof banned !== 'boolean') throw new Error('Stato non confermato. Cerca di nuovo l’account.');
      confirmBan.hidden = true;
      setAccess(banned ? 'banned' : 'active');
      statusText.textContent = banned ? 'Account bannato.' : 'Account sbloccato.';
      accountName.focus();
    } catch (error) {
      if (session === profileSession && selected === profile) statusText.textContent = error.message;
    } finally {
      saving = false;
      nameField.disabled = false;
      for (const button of buttons) button.disabled = false;
    }
  }
  get('admin-confirm-ban').onclick = () => { if (!confirmBan.hidden) moderate('ban'); };
  unban.onclick = () => { if (access.dataset.state === 'banned') moderate('unban'); };
  window.addEventListener('arcade-session-change', checkAccount);
  window.addEventListener('arcade-profile-open', checkAccount);
  setInterval(checkAccount, 15000);
  checkAccount();
})();
