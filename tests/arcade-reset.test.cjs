const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {runInNewContext} = require('node:vm');
const {resolve} = require('node:path');
const root = resolve(__dirname, '..');
const page = readFileSync(resolve(root, 'arcade/index.html'), 'utf8');

function resetUI({cloudError = false, pending = Promise.resolve()} = {}) {
  const elements = new Map();
  const node = id => {
    if (!elements.has(id)) elements.set(id, {hidden:false, disabled:false, listeners:{},
      addEventListener(type, fn) { this.listeners[type] = fn; },
      showModal() { this.open = true; }, close() { this.open = false; }
    });
    return elements.get(id);
  };
  const values = new Map([['other-game', 'saved'], ['gameState', 'old-2048-save']]);
  const actions = [];
  const game = {id:'2048', title:'2048'};
  const context = {
    get:node, byId:new Map([['2048',game]]), location:{hash:'#gioco/2048'}, profileSession:null,
    playerRequest:0, crypto:{randomUUID:()=>'new-revision'}, arcadeSaveKeys:{'2048':['gameState','bestScore']},
    localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},
    window:{addEventListener() {}},
    clearGameFrame() { actions.push('stop'); return pending; },
    setGameLoading() {},
    async resetCloudGameSave() { actions.push('cloud'); if(cloudError) throw Error('Offline'); },
    async showGame() { actions.push('reload'); }, reloadGame() {}
  };
  runInNewContext(page.slice(page.indexOf("const resetDialog = get('game-reset-dialog');"),page.indexOf('\nasync function accountApi')),context);
  return {node, values, actions, context};
}
test('cancel preserves saves; confirmation stops the game, waits for writes, and resets only the selected game', async()=>{
  let finishWrite;
  const pending = new Promise(resolve=>{finishWrite=resolve;});
  const ui=resetUI({pending});
  ui.node('game-reset').listeners.click();
  assert.equal(ui.node('game-reset-dialog').open,true);
  assert.equal(ui.node('game-reset-name').textContent,'2048');
  ui.node('game-reset-cancel').listeners.click();
  assert.equal(ui.node('game-reset-dialog').open,false);
  assert.equal(ui.values.get('gameState'),'old-2048-save');
  assert.deepEqual(ui.actions,[]);
  ui.node('game-reset').listeners.click();
  const done=ui.node('game-reset-confirm').listeners.click();
  assert.deepEqual(ui.actions,['stop']);
  assert.equal(ui.node('game-reset-confirm').disabled,true);
  finishWrite();await done;
  assert.deepEqual(ui.actions,['stop','cloud','reload']);
  assert.equal(ui.values.get('arcade-reset-v1:2048'),'new-revision');
  assert.equal(ui.values.has('gameState'),false);
  assert.equal(ui.values.get('other-game'),'saved');
});
test('a cloud failure keeps the confirmation open and leaves progress unchanged for retry',async()=>{
  const ui=resetUI({cloudError:true});
  ui.node('game-reset').listeners.click();await ui.node('game-reset-confirm').listeners.click();
  assert.equal(ui.node('game-reset-dialog').open,true);
  assert.equal(ui.node('game-reset-confirm').disabled,false);
  assert.equal(ui.values.has('arcade-reset-v1:2048'),false);
  assert.equal(ui.values.get('gameState'),'old-2048-save');
  assert.match(ui.node('game-reset-status').textContent,/Offline/);
});
test('cloud reset writes tombstones for every allowed save key and reports server failures',async()=>{
  let request;const session={access_token:'test'};
  const context={profileSession:session,accessToken:async()=> 'test',AbortSignal,
    authBase:'https://example.test',authKey:'test',fetch:async(url,options)=>{request=JSON.parse(options.body);return {ok:true}}};
  runInNewContext(readFileSync(resolve(root,'arcade/assets/save-bridge.js'),'utf8'),context);
  await context.resetCloudGameSave({id:'2048'},session);
  assert.deepEqual(request,{game_name:'2048',changes:{gameState:null,bestScore:null}});
  context.fetch=async()=>({ok:false});
  await assert.rejects(context.resetCloudGameSave({id:'2048'},session),/Reset cloud non riuscito/);
});

test('fresh storage supports game save APIs and isolates cookies and worlds without clearing other games',async()=>{
  const context={console};
  runInNewContext(`
    class Storage {
      constructor() { Object.defineProperty(this,'data',{value:new Map(),configurable:true}); }
      getItem(key) { return this.data.get(String(key)) ?? null; }
      setItem(key,value) { this.data.set(String(key),String(value)); }
      removeItem(key) { this.data.delete(String(key)); }
      key(index) { return [...this.data.keys()][index]??null; }
      clear() { this.data.clear(); }
      get length() { return this.data.size; }
    }
    class Document {}
    let cookies='legacy=900';
    Object.defineProperty(Document.prototype,'cookie',{configurable:true,get(){return cookies},set(value){cookies=value}});
    const document = new Document();
    const original = new Storage(); original.setItem('score','900'); original.setItem('other-game','keep');
    const databases=new Set(['worlds']);
    const window={localStorage:original,sessionStorage:new Storage(),indexedDB:{
      open(name){databases.add(name);return name},deleteDatabase(name){databases.delete(name)},
      async databases(){return [...databases].map(name=>({name}))}
    }};
  `+readFileSync(resolve(root,'arcade/assets/reset-storage.js'),'utf8')+`
    window.prepareArcadeResetStorage('2048','fresh');
    result = (async()=>{
      const storage=window.localStorage;
      if(storage.getItem('score')!==null || storage.score!==undefined || storage.length!==0) throw Error('Old save visible');
      storage.score='12';storage.setItem('level','3');
      if(Storage.prototype.getItem.call(storage,'score')!=='12'||Object.keys(storage).length!==2) throw Error('New saves broken');
      if(document.cookie!==''||(await window.indexedDB.databases()).length!==0) throw Error('Old cookies or worlds visible');
      window.indexedDB.open('worlds');
      if((await window.indexedDB.databases())[0].name!=='worlds') throw Error('New worlds broken');
      delete storage.score;storage.clear();
      if(storage.length!==0) throw Error('Clear broken');
      // Native backing map is checked only by the test, outside the game-facing API.
      if(original.data.get('other-game')!=='keep'||original.data.get('score')!=='900') throw Error('Other saves deleted');
      return true;
    })();
  `,context);
  assert.equal(await context.result,true);
});
