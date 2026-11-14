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

  function render(messages) {
    const previous = log.lastElementChild?.dataset.id;
    if (messages.length && previous === String(messages.at(-1).id)) return;
    const atBottom = !previous || log.scrollHeight - log.clientHeight - log.scrollTop < 30;
    log.replaceChildren(...messages.map(message => {
      const bubble = document.createElement('div');
      bubble.className = message.mine ? 'dm-message mine' : 'dm-message';
      bubble.dataset.id = message.id;
      const time = document.createElement('time');
      time.dateTime = message.sent_at;
      time.textContent = (message.mine ? 'Tu · ' : chat.name+' · ')+clock.format(new Date(message.sent_at));
      bubble.append(document.createTextNode(message.body), time);
      return bubble;
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
      const response = await fetch(authBase+'/rest/v1/rpc/arcade_friend_chat', {
        method:'POST', headers:{apikey:authKey,Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify({profile_name:current.name,message}),
        signal:current.controller.signal
      });
      if (chat !== current || profileSession !== current.session) return;
      if (!response.ok) {
        if (response.status === 403) log.replaceChildren();
        const error = await response.json().catch(() => ({}));
        throw new Error(error.code === '42501' ? 'La chat è disponibile tra amici.' : 'Chat al momento non disponibile.');
      }
      const messages = await response.json();
      if (chat !== current || profileSession !== current.session) return;
      render(messages);
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
    title.textContent = name;
    contacts.hidden = true;
    back.hidden = log.hidden = form.hidden = false;
    status.textContent = 'Caricamento messaggi…';
    if (!dialog.open) dialog.showModal();
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
    if (!dialog.open) dialog.showModal();
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

  launcher.onclick = openContacts;
  back.onclick = openContacts;
  document.addEventListener('fullscreenchange', () => {
    launcher.hidden = Boolean(document.fullscreenElement);
    if (launcher.hidden && dialog.open) dialog.close();
  });
  window.addEventListener('arcade-open-dm', event => openChat(event.detail));
  get('dm-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    resetChat();
  });
  window.addEventListener('arcade-session-change', () => {
    resetChat();
    if (dialog.open) dialog.close();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const message = input.value.trim();
    if (message && chat?.ready) sync(message);
  });
  setInterval(() => { if (!document.hidden && dialog.open) sync(); }, 4000);
})();
