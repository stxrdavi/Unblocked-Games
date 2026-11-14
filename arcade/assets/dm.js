(() => {
  'use strict';
  const dialog = get('dm-dialog');
  const form = get('dm-form');
  const input = get('dm-text');
  const submit = form.querySelector('button');
  const log = get('dm-messages');
  const status = get('dm-status');
  const clock = new Intl.DateTimeFormat('it', {hour:'2-digit', minute:'2-digit'});
  let chat;

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

  window.addEventListener('arcade-open-dm', event => {
    if (!profileSession || dialog.open) return;
    chat = {name:event.detail,session:profileSession,controller:new AbortController()};
    get('public-profile').close();
    get('dm-title').textContent = chat.name;
    input.value = '';
    log.replaceChildren();
    status.textContent = 'Caricamento messaggi…';
    dialog.showModal();
    input.focus();
    sync();
  });
  get('dm-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    chat?.controller.abort();
    chat = undefined;
    log.replaceChildren();
    input.value = '';
  });
  window.addEventListener('arcade-session-change', () => {
    if (chat && chat.session !== profileSession) {
      chat.controller.abort();
      dialog.close();
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const message = input.value.trim();
    if (message && chat?.ready) sync(message);
  });
  setInterval(() => { if (!document.hidden && dialog.open) sync(); }, 4000);
})();
