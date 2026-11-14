(() => {
  'use strict';
  const dialog = get('profile-dialog');
  const form = get('profile-form');
  const status = get('profile-status');
  const edit = get('profile-edit');
  const avatar = get('profile-avatar');
  let profile;
  let play = {id:'', started:0, session:null};
  async function api(path, data, method = 'POST', prefer, session = profileSession) {
    const token = await accessToken(session);
    const response = await fetch(authBase+'/rest/v1/'+path,{
      method, headers:{apikey:authKey,Authorization:'Bearer '+token,'Content-Type':'application/json', ...(prefer ? {Prefer:prefer} : {})},
      body:JSON.stringify(data)
    });
    if (session !== profileSession) throw new Error('Accedi per continuare.');
    if (!response.ok) {
      const reason = await response.json().catch(()=>({}));
      if (reason.code === '23505' && Object.hasOwn(data ?? {}, 'username')) throw new Error('Questo nome è già in uso.');
      if (reason.code === 'P0001') throw new Error(reason.message);
      throw new Error('Profilo non disponibile. Verifica la configurazione Supabase.');
    }
    return response.status === 204 ? null : response.json();
  }

  function display() {
    const name = profile?.username || profileSession.username;
    get('profile-name').textContent = name;
    accountButton.textContent = name;
    const bio = get('profile-bio');
    bio.textContent = profile?.bio || '';
    bio.hidden = !bio.textContent;
    get('profile-initial').textContent = name.charAt(0).toLocaleUpperCase('it');
    if (profile?.avatar) {
      avatar.hidden = false;
      avatar.src = profile.avatar;
    } else {
      avatar.hidden = true;
      avatar.removeAttribute('src');
    }
  }
  avatar.addEventListener('error', () => { avatar.hidden = true; });

  function setEditing(active, focus = false) {
    form.hidden = !active;
    edit.setAttribute('aria-expanded', String(active));
    if (focus) (active ? get('profile-edit-title') : edit).focus();
  }

  async function load() {
    const session = profileSession;
    const [profiles, stats] = await Promise.all([
      api('arcade_profiles?select=username,bio,avatar,renamed_at',undefined,'GET'),
      api('rpc/arcade_play_stats',{})
    ]);
    profile = profiles[0];
    if (profile?.username) await rememberProfileName(session, profile.username);
    if (session !== profileSession) return;
    display();
    const minutes = Math.floor(stats.reduce((sum,row)=>sum+Number(row.seconds),0)/60);
    get('profile-time').textContent = minutes >= 60 ? Math.floor(minutes/60)+' h '+minutes%60+' min' : minutes+' min';
    get('profile-favorite').textContent = byId.get(stats[0]?.game)?.title || 'Nessuna partita';
  }

  window.addEventListener('arcade-profile-open', async () => {
    const session = profileSession;
    profile = null;
    setEditing(false);
    edit.disabled = true;
    get('profile-time').textContent = '—';
    get('profile-favorite').textContent = '—';
    status.textContent = 'Caricamento…';
    display();
    dialog.showModal();
    try {
      await load();
      if (session !== profileSession) return;
      status.textContent='';
      edit.disabled=false;
    } catch(error) {
      if (session === profileSession) status.textContent=error.message;
    }
  });
  get('profile-close').onclick = () => dialog.close();
  get('profile-logout').onclick = () => {
    profile=null;
    saveSession(null);
  };
  get('profile-cancel').onclick = () => setEditing(false, true);
  edit.onclick = () => {
    if (!form.hidden) {
      setEditing(false);
      return;
    }
    form.reset();
    const available = Date.parse(profile?.renamed_at) + 7*86400000;
    form.elements.name.value=profile?.username || profileSession.username;
    form.elements.name.disabled=available>Date.now();
    form.elements.bio.value=profile?.bio || '';
    get('profile-rename').textContent=available>Date.now()
      ? 'Prossima modifica dal '+new Date(available).toLocaleString('it-IT')
      : 'Puoi cambiare il nome ogni 7 giorni.';
    status.textContent='';
    setEditing(true, true);
  };

  async function photo(file) {
    if (file.size>5*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(file.type)) {
      throw new Error('Scegli un JPEG, PNG o WebP fino a 5 MB.');
    }
    const image = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width=canvas.height=256;
    const size=Math.min(image.width,image.height);
    canvas.getContext('2d').drawImage(image,(image.width-size)/2,(image.height-size)/2,size,size,0,0,256,256);
    image.close();
    for (const quality of [.82,.65,.45]) {
      const encoded = canvas.toDataURL('image/webp',quality);
      if (encoded.startsWith('data:image/webp;base64,') && encoded.length <= 172000) return encoded;
    }
    throw new Error('Usa una foto più piccola o con meno dettagli.');
  }
  form.addEventListener('submit', async event=>{
    event.preventDefault();
    const button=form.querySelector('[type=submit]');
    const session=profileSession;
    button.disabled=true;
    try {
      const avatar=form.elements.photo.files[0];
      const changes={bio:form.elements.bio.value.trim()};
      if (avatar) changes.avatar=await photo(avatar);
      else if (form.elements.removePhoto.checked) changes.avatar='';
      if (session !== profileSession) return;
      const name=form.elements.name.value.trim().toLowerCase();
      if (!form.elements.name.disabled && name !== (profile?.username || session.username)) changes.username=name;
      const encoded=session.access_token.split('.')[1].replaceAll('-','+').replaceAll('_','/');
      const {sub:userId}=JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length/4)*4,'=')));
      const profilePath='arcade_profiles?'+new URLSearchParams({user_id:'eq.'+userId});
      await api('arcade_profiles?on_conflict=user_id',{user_id:userId},'POST','resolution=ignore-duplicates,return=minimal',session);
      await api(profilePath,changes,'PATCH','return=minimal',session);
      profile = {...profile,...changes};
      if (changes.username) await rememberProfileName(session, changes.username);
      if (session !== profileSession) return;
      display();
      setEditing(false, true);
      status.textContent='Profilo salvato.';
      try { await load(); } catch {
        status.textContent='Profilo salvato. Le statistiche verranno aggiornate alla prossima apertura.';
      }
    } catch(error) {
      if (session === profileSession) status.textContent=error.message;
    }
    finally { button.disabled=false; }
  });

  setInterval(()=>{
    const id=location.hash.startsWith('#gioco/') ? location.hash.slice(7) : '';
    const active=profileSession && !document.hidden && !dialog.open && byId.has(id);
    const now=performance.now();
    if (!active || play.id!==id || play.session!==profileSession) {
      play={id:active ? id : '',started:now,session:profileSession};
    } else if (now-play.started>=30000) {
      play.started=now;
      api('rpc/arcade_record_play',{game_id:id}).catch(()=>{});
    }
  },1000);
})();
