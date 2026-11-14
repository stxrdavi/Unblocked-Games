(() => {
  'use strict';
  const admin = get('admin-dialog');
  const form = get('admin-form');
  const open = get('admin-open');
  const publicProfile = get('public-profile');
  let ownerName;
  let checkedSession;
  let checkPending;

  async function rpc(name, data = {}, session = null) {
    const headers = {apikey:authKey,'Content-Type':'application/json'};
    if (session) headers.Authorization = 'Bearer '+await accessToken(session);
    const response = await fetch(authBase+'/rest/v1/rpc/'+name, {
      method:'POST', headers, body:JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Operazione non disponibile.');
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

  open.onclick = () => { get('profile-dialog').close(); admin.showModal(); };
  get('admin-close').onclick = () => admin.close();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (form.dataset.pending || !profileSession) return;
    const session = profileSession;
    const name = form.elements.username.value.trim().toLowerCase();
    const action = event.submitter?.value || 'status';
    const status = get('admin-status');
    if (!/^[a-z0-9_.-]{3,24}$/.test(name)) {
      status.textContent = 'Inserisci uno username valido.';
      return;
    }
    if (action === 'ban' && !window.confirm('Bannare '+name+'?')) return;
    form.dataset.pending = 'true';
    status.textContent = 'Attendi…';
    try {
      const banned = await rpc('arcade_moderate', {profile_name:name, action}, session);
      if (session === profileSession) status.textContent = name + (banned ? ' è bannato.' : ' può accedere.');
    } catch (error) {
      if (session === profileSession) status.textContent = error.message;
    } finally {
      delete form.dataset.pending;
    }
  });
  window.addEventListener('arcade-session-change', checkAccount);
  window.addEventListener('arcade-profile-open', checkAccount);
  setInterval(checkAccount, 15000);
  checkAccount();
})();
