const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../custom_components/dart_assistant/frontend/dart-score-card.js'),'utf8');
const controls=new Map([['#daAudioPack',{}],['#daAudioFile',{}]]);
class Root {querySelector(s){return controls.get(s)||null}querySelectorAll(){return []}}
class Element {attachShadow(){return this.shadowRoot=new Root()}}
const context={HTMLElement:Element,window:{},customElements:{get:()=>false,define(){}},console,setTimeout,clearTimeout,
 localStorage:{getItem:()=>null,setItem(){}},crypto:{randomUUID:()=> 'test-upload-id'},
 FileReader:class {readAsDataURL(){this.result='data:application/zip;base64,UEsDBA==';this.onload()}}};
vm.createContext(context);vm.runInContext(source+'\nthis.Card=DartScoreCard;',context);
(async()=>{
 const card=new context.Card();card._render=()=>{};card._warmAudio=()=>{};
 card._db={settings:{},profiles:[],matches:[]};card._bindNext();
 assert.equal(typeof controls.get('#daAudioPack').onchange,'function');
 assert(card._audioSettingsHtml().includes('id="daAudioPack"'));
 assert(card._homeHtml().includes('/dart_assistant_static/default-logo.png'));
 const messages=[];card._hass={callWS:async message=>{messages.push(message);return {imported:2,skipped:0,library:{sounds:[],callers:[]}}}};
 await card._uploadAudioFile({name:'sounds.zip',size:4},'import');
 assert.equal(messages[0].type,'dart_assistant/audio_upload');
 assert.equal(messages[0].folder,'import');assert.equal(messages[0].final,true);
 assert(card._noticeText.includes('2 MP3-Dateien importiert'));
 messages.length=0;await card._uploadAudioFile({name:'bad.exe',size:4},'import');assert.equal(messages.length,0);
 console.log('PASS: settings bindings, bundled logo, ZIP upload routing, feedback and invalid extension');
})().catch(error=>{console.error(error);process.exitCode=1});
