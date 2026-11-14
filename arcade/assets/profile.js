(() => {
  'use strict';
  const base = 'https://usrvjyffaoucyahkpyjw.supabase.co';
  const key = 'sb_publishable_FqDB6ZDEJwlVS19EvQhFng_oSYmq6lf';
  const dialog = get('profile-dialog');
  const form = get('profile-form');
  const status = get('profile-status');
  let profile;
  let play = {id:'', started:0};
  let refresh;

  async function api(path, data, method = 'POST') {
    const session = profileSession;
    if (!session) throw new Error('Accedi per continuare.');
    if (session.expiresAt && Date.now() >= session.expiresAt - 45000) {
      refresh ??= fetch(base+'/auth/v1/token?grant_type=refresh_token',{
        method:'POST', headers:{apikey:key,'Content-Type':'application/json'},
        body:JSON.stringify({refresh_token:session.refresh_token})
      }).then(async response=>{
        if (!response.ok) throw new Error('Sessione scaduta. Accedi di nuovo.');
        const result = await response.json();
        Object.assign(session,result,{expiresAt:Date.now()+result.expires_in*1000});
      }).finally(()=>{refresh=null;});
      await refresh;
    }
    session.expiresAt ??= Date.now()+session.expires_in*1000;
    const response = await fetch(base+'/rest/v1/'+path,{
      method, headers:{apikey:key,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
      body:JSON.stringify(data)
    });
    if (!response.ok) {
      const reason = await response.json().catch(()=>({}));
      if (reason.code === '23505') throw new Error('Questo nome è già in uso.');
      if (reason.code === 'P0001') throw new Error(reason.message);
      throw new Error('Profilo non disponibile. Verifica la configurazione Supabase.');
    }
    return response.status === 204 ? null : response.json();
  }

  function display() {
    const name = profile?.username || profileSession.username;
    get('profile-name').textContent = name;
    accountButton.textContent = name;
    get('profile-bio').textContent = profile?.bio || '';
    const avatar = get('profile-avatar');
    avatar.hidden = !profile?.avatar;
    if (profile?.avatar) avatar.src = profile.avatar;
  }

  async function load() {
    const [profiles, stats] = await Promise.all([
      api('arcade_profiles?select=username,bio,avatar,renamed_at',undefined,'GET'),
      api('rpc/arcade_play_stats',{})
    ]);
    profile = profiles[0];
    display();
    const minutes = Math.floor(stats.reduce((sum,row)=>sum+Number(row.seconds),0)/60);
    get('profile-time').textContent = minutes >= 60 ? Math.floor(minutes/60)+' h '+minutes%60+' min' : minutes+' min';
    get('profile-favorite').textContent = byId.get(stats[0]?.game)?.title || 'Nessuna partita registrata';
  }

  window.addEventListener('arcade-profile-open', async () => {
    profile = null;
    form.hidden = true;
    get('profile-edit').disabled = true;
    get('profile-time').textContent = '—';
    get('profile-favorite').textContent = '—';
    status.textContent = 'Caricamento…';
    display();
    dialog.showModal();
    try { await load(); status.textContent=''; get('profile-edit').disabled=false; }
    catch(error) { status.textContent=error.message; }
  });
  get('profile-close').onclick = () => dialog.close();
  get('profile-logout').onclick = () => {
    profileSession=null;
    username=null;
    profile=null;
    accountView();
    dialog.close();
  };
  get('profile-cancel').onclick = () => { form.hidden=true; };
  get('profile-edit').onclick = () => {
    form.reset();
    const available = Date.parse(profile?.renamed_at) + 7*86400000;
    form.elements.name.value=profile?.username || profileSession.username;
    form.elements.name.disabled=available>Date.now();
    form.elements.bio.value=profile?.bio || '';
    get('profile-rename').textContent=available>Date.now()
      ? 'Prossima modifica dal '+new Date(available).toLocaleString('it-IT')
      : 'Puoi cambiare il nome ogni 7 giorni.';
    status.textContent='';
    form.hidden=false;
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
    return canvas.toDataURL('image/webp',.82);
  }
  form.addEventListener('submit', async event=>{
    event.preventDefault();
    const button=form.querySelector('[type=submit]');
    button.disabled=true;
    try {
      const session=profileSession;
      const avatar=form.elements.photo.files[0];
      const changes={bio:form.elements.bio.value.trim()};
      if (avatar) changes.avatar=await photo(avatar);
      else if (form.elements.removePhoto.checked) changes.avatar='';
      const name=form.elements.name.value.trim().toLowerCase();
      if (!form.elements.name.disabled && name !== (profile?.username || session.username)) changes.username=name;
      if (!profile) {
        const encoded=session.access_token.split('.')[1].replaceAll('-','+').replaceAll('_','/');
        const payload=JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length/4)*4,'=')));
        await api('arcade_profiles',{user_id:payload.sub});
      }
      await api('arcade_profiles?user_id=not.is.null',changes,'PATCH');
      await load();
      form.hidden=true;
      status.textContent='Profilo salvato.';
    } catch(error) { status.textContent=error.message; }
    finally { button.disabled=false; }
  });

  setInterval(()=>{
    const id=location.hash.startsWith('#gioco/') ? location.hash.slice(7) : '';
    const active=profileSession && !document.hidden && !dialog.open && byId.has(id);
    const now=performance.now();
    if (!active || play.id!==id) {
      play={id:active ? id : '',started:now};
    } else if (now-play.started>=30000) {
      play.started=now;
      api('rpc/arcade_record_play',{game_id:id}).catch(()=>{});
    }
  },1000);
})();
