(() => {
  'use strict';
  const section = get('friends');
  const strip = get('friend-strip');
  const requests = get('friend-requests');
  const status = get('friends-status');
  const dialog = get('public-profile');
  const controls = get('public-profile-friends');
  let people = [];
  let viewed = '';
  let ready = false;
  let revision = 0;
  let working = false;
  let lastGame;
  let presenceQueue = Promise.resolve();

  async function rpc(name, data, session = profileSession) {
    const token = await accessToken(session);
    const response = await fetch(authBase+'/rest/v1/rpc/arcade_'+name, {
      method:'POST', headers:{apikey:authKey, Authorization:'Bearer '+token, 'Content-Type':'application/json'},
      body:JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Servizio amici non disponibile.');
    if (name === 'friends_list') return response.json();
  }

  function button(text, click, className = 'secondary') {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.textContent = text;
    element.onclick = click;
    return element;
  }

  async function act(username, action) {
    if (working || !profileSession) return;
    working = true;
    const session = profileSession;
    try {
      await rpc('friend_action', {profile_name:username, action}, session);
      if (session === profileSession) await refresh();
    } catch {
      if (session === profileSession) {
        const message = 'Impossibile aggiornare l’amicizia. Riprova.';
        status.textContent = message;
        if (dialog.open) controls.append(document.createTextNode(message));
      }
    } finally {
      working = false;
    }
  }

  function renderActions() {
    controls.replaceChildren();
    controls.hidden = !profileSession || !ready || !viewed || viewed === profileSession.username;
    if (controls.hidden) return;
    const relation = people.find(person => person.username === viewed)?.relationship;
    const actions = {
      friend:[['Rimuovi amico','remove']],
      incoming:[['Accetta richiesta','accept'],['Rifiuta','decline']],
      outgoing:[['Annulla richiesta inviata','cancel']]
    };
    for (const [label, action] of actions[relation] || [['Aggiungi amico','request']]) {
      const name = viewed;
      controls.append(button(label, () => act(name, action)));
    }
  }

  function render() {
    section.hidden = !profileSession;
    if (section.hidden) {
      strip.replaceChildren();
      requests.replaceChildren();
      requests.hidden = true;
      status.textContent = '';
      renderActions();
      return;
    }
    const friends = people.filter(person => person.relationship === 'friend');
    const incoming = people.filter(person => person.relationship === 'incoming');
    get('friends-title').textContent = 'Amici ('+friends.length+')';
    const add = button('', () => search.focus(), 'friend-tile');
    const plus = document.createElement('span');
    plus.className = 'friend-avatar';
    plus.setAttribute('aria-hidden','true');
    plus.textContent = '+';
    add.append(plus, 'Aggiungi amici');
    strip.replaceChildren(add);
    for (const person of friends) {
      const tile = button('', () => dialog.dispatchEvent(new CustomEvent('arcade-open-player', {detail:person})), 'friend-tile');
      const photo = document.createElement('span');
      photo.className = 'friend-avatar';
      photo.setAttribute('aria-hidden','true');
      photo.textContent = person.username[0].toUpperCase();
      if (person.avatar) {
        const img = document.createElement('img');
        img.alt = '';
        img.addEventListener('error', () => img.remove(), {once:true});
        img.src = person.avatar;
        photo.append(img);
      }
      const name = document.createElement('strong');
      name.textContent = person.username;
      const game = document.createElement('small');
      const title = byId.get(person.game)?.title;
      game.textContent = title || 'Non in gioco';
      game.classList.toggle('friend-playing', Boolean(title));
      tile.append(photo, name, game);
      strip.append(tile);
    }
    requests.replaceChildren();
    requests.hidden = !incoming.length;
    if (incoming.length) {
      const heading = document.createElement('strong');
      heading.textContent = 'Richieste ricevute ('+incoming.length+')';
      requests.append(heading);
    }
    for (const person of incoming) {
      const row = document.createElement('div');
      row.className = 'friend-request';
      row.append(person.username, button('Accetta', () => act(person.username,'accept')),
        button('Rifiuta', () => act(person.username,'decline')));
      requests.append(row);
    }
    renderActions();
  }

  async function refresh() {
    const session = profileSession;
    const request = ++revision;
    if (!session) return;
    try {
      const result = await rpc('friends_list', {}, session);
      if (request !== revision || session !== profileSession) return;
      const changed = !ready || JSON.stringify(result) !== JSON.stringify(people);
      people = result;
      ready = true;
      status.textContent = '';
      if (changed) render();
    } catch {
      if (request !== revision || session !== profileSession) return;
      status.textContent = 'Lista amici al momento non disponibile.';
    }
  }

  function presence(heartbeat = false) {
    const session = profileSession;
    if (!session) return;
    const id = location.hash.startsWith('#gioco/') ? location.hash.slice(7) : '';
    const game = byId.has(id) && !document.hidden ? id : null;
    if (!(heartbeat && game) && game === lastGame) return;
    if (!game && !lastGame) return;
    lastGame = game;
    presenceQueue = presenceQueue.then(async () => {
      if (session === profileSession) await rpc('set_presence', {game_id:game}, session);
    }).catch(() => {});
  }

  dialog.addEventListener('arcade-view-player', event => {
    viewed = event.detail;
    renderActions();
    if (profileSession) refresh();
  });
  window.addEventListener('arcade-session-change', () => {
    people = [];
    ready = false;
    lastGame = undefined;
    render();
    refresh();
    presence();
  });
  window.addEventListener('hashchange', () => { presence(); });
  document.addEventListener('visibilitychange', () => {
    presence();
    if (!document.hidden) refresh();
  });
  setInterval(() => {
    if (document.hidden) return;
    presence(true);
    refresh();
  }, 15000);
  render();
  refresh();
  presence();
})();
