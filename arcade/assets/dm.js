(() => {
  'use strict';
  const dialog = get('dm-dialog');
  const form = get('dm-form');
  const input = get('dm-text');
  const submit = form.querySelector('button');
  const log = get('dm-messages');
  const status = get('dm-status');
  const launcher = get('dm-launcher');
  const contacts = get('dm-contacts');
  const back = get('dm-back');
  const title = get('dm-title');
  const clock = new Intl.DateTimeFormat('it', {hour:'2-digit', minute:'2-digit'});
  let chat;
  let listRequest;
  let friends = [];
  let nextFriend = 0;
  let polling = false;
  let noticeStart = Date.now();
  const lastIncoming = new Map();

  function chatIsOpen(name) {
    return dialog.open && chat?.name === name;
  }

  function checkMessages(name, messages) {
    const previous = lastIncoming.get(name);
    for (const message of messages) {
      if (message.mine) continue;
      // A conversation's first read should not announce its history.
      const isNew = previous === undefined ? Date.parse(message.sent_at) >= noticeStart : message.id > previous;
      if (!lastIncoming.has(name) || message.id > lastIncoming.get(name)) lastIncoming.set(name, message.id);
      if (isNew) arcadeNotices.push({
        title:'Messaggio privato', detail:name,
        suppressed:() => chatIsOpen(name),
        reply:() => openChat(name)
      });
    }
    if (!lastIncoming.has(name)) lastIncoming.set(name, 0);
  }

  async function pollIncoming() {
    const session = profileSession;
    if (!session || document.hidden || polling || !friends.length) return;
    polling = true;
    const count = Math.min(4, friends.length);
    const batch = Array.from({length:count}, (_, offset) => friends[(nextFriend + offset) % friends.length]);
    nextFriend = (nextFriend + count) % friends.length;
    try {
      const token = await accessToken(session);
      if (session !== profileSession) return;
      await Promise.allSettled(batch.filter(name => !chatIsOpen(name)).map(async name => {
        const response = await fetch(authBase+'/rest/v1/rpc/arcade_friend_chat?mine=eq.false&select=id,sent_at', {
          method:'POST', headers:{apikey:authKey, Authorization:'Bearer '+token, 'Content-Type':'application/json'},
          body:JSON.stringify({profile_name:name}), signal:AbortSignal.timeout(8000)
        });
        if (!response.ok) return;
        const messages = await response.json();
        if (session === profileSession && friends.includes(name)) checkMessages(name, messages);
      }));
    } catch {
      // Retry on the next poll if the session refresh failed.
    } finally {
      polling = false;
    }
  }

  window.addEventListener('arcade-friends-updated', event => {
    friends = event.detail.filter(person => person.relationship === 'friend').map(person => person.username);
    pollIncoming();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollIncoming(); });
  setInterval(pollIncoming, 5000);

  function showPanel() {
    if (!dialog.open) dialog.show();
    launcher.setAttribute('aria-expanded', 'true');
  }

  function render(messages) {
    const previous = log.lastElementChild?.dataset.id;
    if (messages.length && previous === String(messages.at(-1).id)) return;
    const atBottom = !previous || log.scrollHeight - log.clientHeight - log.scrollTop < 30;
    log.replaceChildren(...messages.map(message => {
      const bubble = document.createElement('div');
      bubble.className = message.mine ? 'dm-message mine' : 'dm-message';
      const row = document.createElement('div');
      row.className = message.mine ? 'chat-message-row mine' : 'chat-message-row';
      row.dataset.id = message.id;
      const username = message.mine ? chat.session.username : chat.name;
      const time = document.createElement('time');
      time.dateTime = message.sent_at;
      time.textContent = (message.mine ? 'Tu · ' : chat.name+' · ')+clock.format(new Date(message.sent_at));
      bubble.append(document.createTextNode(message.body), time);
      row.append(makeChatAvatar(username, message.avatar), bubble);
      return row;
    }));
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  async function sync(message = null) {
    const current = chat;
    if (!current || current.pending || !dialog.open) return;
    current.pending = true;
    submit.disabled = true;
    try {
      const token = await accessToken(current.session);
      if (chat !== current || profileSession !== current.session) return;
      const options = {
        method:'POST', headers:{apikey:authKey,Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify({profile_name:current.name,message}),
        signal:current.controller.signal
      };
      let response = await fetch(authBase+'/rest/v1/rpc/arcade_friend_chat_profiles', options);
      if (response.status === 404 && (await response.json().catch(() => ({}))).code === 'PGRST202') {
        response = await fetch(authBase+'/rest/v1/rpc/arcade_friend_chat', options);
      }
      if (chat !== current || profileSession !== current.session) return;
      if (!response.ok) {
        if (response.status === 403) log.replaceChildren();
        const error = await response.json().catch(() => ({}));
        throw new Error(error.code === '42501' ? 'La chat è disponibile tra amici.' : 'Chat al momento non disponibile.');
      }
      const messages = await response.json();
      if (chat !== current || profileSession !== current.session) return;
      render(messages);
      checkMessages(current.name, messages);
      if (message !== null && input.value.trim() === message) input.value = '';
      status.textContent = messages.length ? '' : 'Scrivi il primo messaggio.';
      current.ready = true;
    } catch (error) {
      if (chat === current) {
        current.ready = false;
        status.textContent = error instanceof TypeError ? 'Connessione interrotta. Riprovo tra poco.' : error.message;
      }
    } finally {
      current.pending = false;
      if (chat === current) submit.disabled = !current.ready;
    }
  }

  function resetChat() {
    listRequest?.abort();
    chat?.controller.abort();
    chat = undefined;
    input.value = '';
    log.replaceChildren();
    submit.disabled = true;
  }

  function openChat(name) {
    if (!profileSession || document.fullscreenElement) return;
    resetChat();
    chat = {name,session:profileSession,controller:new AbortController()};
    get('public-profile').close();
    window.dispatchEvent(new Event('arcade-close-global'));
    title.textContent = name;
    contacts.hidden = true;
    back.hidden = log.hidden = form.hidden = false;
    status.textContent = 'Caricamento messaggi…';
    showPanel();
    arcadeNotices.recheck();
    input.focus();
    sync();
  }

  async function openContacts() {
    if (document.fullscreenElement) return;
    resetChat();
    title.textContent = 'Messaggi';
    contacts.hidden = false;
    back.hidden = log.hidden = form.hidden = true;
    contacts.replaceChildren();
    showPanel();
    get('dm-close').focus();
    const session = profileSession;
    if (!session) {
      status.textContent = 'Accedi per scrivere ai tuoi amici.';
      const login = document.createElement('button');
      login.type = 'button';
      login.className = 'secondary';
      login.textContent = 'Accedi';
      login.onclick = () => { dialog.close(); accountButton.click(); };
      contacts.append(login);
      return;
    }

    const request = new AbortController();
    listRequest = request;
    status.textContent = 'Caricamento amici…';
    try {
      const people = await fetchArcadeFriends(session, request.signal);
      if (request.signal.aborted || session !== profileSession) return;
      const friends = people.filter(person => person.relationship === 'friend');
      for (const friend of friends) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary';
        button.textContent = friend.username;
        button.onclick = () => openChat(friend.username);
        contacts.append(button);
      }
      status.textContent = friends.length ? '' : 'Aggiungi un amico per iniziare una chat.';
    } catch {
      if (!request.signal.aborted && session === profileSession) status.textContent = 'Lista amici al momento non disponibile.';
    }
  }

  launcher.onclick = () => { if (dialog.open) dialog.close(); else openContacts(); };
  back.onclick = openContacts;
  document.addEventListener('fullscreenchange', () => {
    launcher.hidden = Boolean(document.fullscreenElement);
    if (launcher.hidden && dialog.open) dialog.close();
  });
  window.addEventListener('arcade-open-dm', event => openChat(event.detail));
  get('dm-close').onclick = () => { dialog.close(); launcher.focus(); };
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    dialog.close();
    launcher.focus();
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    launcher.setAttribute('aria-expanded', 'false');
    resetChat();
  });
  window.addEventListener('arcade-session-change', () => {
    resetChat();
    friends = [];
    nextFriend = 0;
    noticeStart = Date.now();
    lastIncoming.clear();
    if (dialog.open) dialog.close();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const message = input.value.trim();
    if (message && chat?.ready) sync(message);
  });
  setInterval(() => { if (!document.hidden && dialog.open) sync(); }, 4000);
})();
