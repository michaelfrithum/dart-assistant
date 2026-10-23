/*
 * Dart Score Card v1.9.0-beta.1 · Audio V1.0
 * Home Assistant Lovelace custom card
 * 301/501/701/custom • 1-4 players • Legs/Sets • Single/Double-out
 * Unlimited undo/redo for the current match • Leg & Match averages
 *
 * Install via HACS as an integration; add Dart Assistant in Devices & services.
 * Frontend is loaded automatically. Card: type: custom:dart-score-card
 */

class DartScoreCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._storageKey = "ha-dart-score-card-v2";
    this._history = [];
    this._future = [];
    this._mult = 1;
    this._state = this._freshState();
    this._screen="home";this._db=null;this._dbError="";
  }

  setConfig(config) {
    this.config = config || {};
    this._storageKey = this.config.storage_key || "ha-dart-score-card-v2";
    this._restore();
    this._render();
  }

  set hass(hass) {
    const first=!this._hass;this._hass=hass;
    if(first){this._loadDatabase();this._render();}
  }
  _matchLabel() { const s=this._state;return `${s.matchMode==='first'?'FIRST TO':'BEST OF'} ${s.bestOf}`; }
  _toggleFullscreen() {
    if(this._fullscreen){this._fullscreen=false;this._restoreChrome();this._render();return;}
    this._fullscreen=true;this._hiddenChrome=[];
    const walk=root=>{for(const el of root.querySelectorAll('*')){
      if(el.matches('app-header,ha-sidebar')){this._hiddenChrome.push([el,el.style.cssText]);el.style.setProperty('display','none','important');}
      if(el.shadowRoot)walk(el.shadowRoot);
    }};
    walk(document);
    this.setAttribute('data-fullscreen','');
    // A top-level overlay stays outside dashboard sizing/overflow constraints.
    this._fullscreenLayer=document.createElement('div');this._fullscreenLayer.setAttribute('data-dart-fullscreen','');
    Object.assign(this._fullscreenLayer.style,{position:'fixed',inset:'0',zIndex:'10000',background:'#050a0f',overflow:'auto',fontFamily:'Inter,Segoe UI,system-ui,sans-serif',containerType:'inline-size'});
    this._fullscreenLayer.attachShadow({mode:'open'});document.body.append(this._fullscreenLayer);
    this._render();
    // Request native fullscreen synchronously from the user's button gesture.
    // Keep the overlay as a fallback on browsers without this API.
    if(document.documentElement.requestFullscreen && !document.fullscreenElement){
      this._nativeFullscreenListener=()=>{
        if(document.fullscreenElement===document.documentElement){this._nativeFullscreen=true;return;}
        if(this._nativeFullscreen){this._restoreChrome();this._render();}
      };
      document.addEventListener('fullscreenchange',this._nativeFullscreenListener);
      document.documentElement.requestFullscreen({navigationUI:'hide'}).catch(()=>{
        document.removeEventListener('fullscreenchange',this._nativeFullscreenListener);
        this._nativeFullscreenListener=null;
        if(this._fullscreen){this._noticeText='Browser-Vollbild nicht verfügbar. Die Karte bleibt bildschirmfüllend innerhalb der Seite.';this._render();}
      });
    }
  }
  _restoreChrome(){
    if(this._nativeFullscreenListener){document.removeEventListener('fullscreenchange',this._nativeFullscreenListener);this._nativeFullscreenListener=null;}
    const leaveNative=this._nativeFullscreen && document.fullscreenElement===document.documentElement;
    this._nativeFullscreen=false;
    if(leaveNative)document.exitFullscreen().catch(()=>{});
for(const [el,style] of this._hiddenChrome||[])el.style.cssText=style;this._hiddenChrome=[];this.removeAttribute('data-fullscreen');this._fullscreenLayer?.remove();this._fullscreenLayer=null;this._fullscreen=false;}

  getCardSize() { return 9; }

  _freshState() {
    return {
      phase: "setup",
      bestOf: 5, startScore:501, matchMode:"best", setsMode:false, legsPerSet:5, setNumber:1, checkoutTips:true,
      playerCount: 2,
      doubleOut: true,
      current: 0,
      legNumber: 1,
      visitStart: 501,
      currentVisit: [],
      players: [
        this._newPlayer(""),
        this._newPlayer(""),
        this._newPlayer(""),
        this._newPlayer("")
      ],
      winner: null
    };
  }

  _newPlayer(name) {
    return {
      name, score: 501, legs: 0, sets:0, setLegs:0, matchThrownDarts: 0, legThrownDarts: 0, legFirst9Points: 0, legFirst9Darts: 0,
      matchPoints: 0, matchDarts: 0,
      legPoints: 0, legDarts: 0,
      first9Points: 0, first9Darts: 0
    };
  }

  _snapshot() {
    return JSON.parse(JSON.stringify(this._state));
  }

  _record() {} 

  _persist() {
    try { localStorage.setItem(this._storageKey, JSON.stringify({version:2, setup:this._state.phase==='setup'?this._state:(this._setup || this._state), events:this._events || [], cursor:this._cursor || 0})); this._saveError=''; }
    catch(e) { this._saveError='Speichern fehlgeschlagen: Match bitte nicht neu laden.'; }
  }

  _restore() {
    this._restoreResumeMatch();
    this._events=[]; this._cursor=0; this._setup=null;
    try {
      const data=JSON.parse(localStorage.getItem(this._storageKey) || 'null');
      if (!data) return;
      if(data.version!==2 || !data.setup || ![1,2,3,4].includes(data.setup.playerCount) || !(Number.isInteger(data.setup.bestOf)&&data.setup.bestOf>=1&&data.setup.bestOf<=99) || !Array.isArray(data.setup.players) || !Array.isArray(data.events) || !Number.isInteger(data.cursor) || data.cursor<0 || data.cursor>data.events.length) throw Error('Invalid saved match');
      if(data.events.some(d=>!d || (d.outAttempt!==undefined&&typeof d.outAttempt!=='boolean') || !Number.isInteger(d.base) || d.base<0 || d.base>25 || ![1,2,3].includes(d.mult) || (d.base>20 && d.base!==25) || (d.base===25 && d.mult===3))) throw Error('Invalid dart');
      this._setup={...this._freshState(),...data.setup}; this._events=data.events; this._cursor=data.cursor; this._replay();
    } catch(e) { this._saveError='Gespeicherte Daten konnten nicht geladen werden.'; }
  }

  _restoreResumeMatch(){
    this._resumeMatch=null;
    try{
      const r=JSON.parse(localStorage.getItem(this._storageKey+'-resume')||'null');
      if(!r)return;
      const s=r.setup;
      if(!s||s.phase!=='game'||![1,2,3,4].includes(s.playerCount)||!Number.isInteger(s.bestOf)||s.bestOf<1||s.bestOf>99||!Array.isArray(s.players)||s.players.length<s.playerCount||!Array.isArray(r.events)||!Number.isInteger(r.cursor)||r.cursor<0||r.cursor>r.events.length)throw Error('Invalid resume');
      if(r.events.some(d=>!d||!Number.isInteger(d.base)||d.base<0||d.base>25||(d.base>20&&d.base!==25)||![1,2,3].includes(d.mult)||(d.base===25&&d.mult===3)||(d.outAttempt!==undefined&&typeof d.outAttempt!=='boolean')))throw Error('Invalid resume darts');
      this._resumeMatch=r;
    }catch{}
  }
  _hasResumableMatch(){return this._state.phase==='game'||!!this._resumeMatch;}
  _stashResumeMatch(){
    const saved=JSON.parse(JSON.stringify({setup:this._setup,events:this._events||[],cursor:this._cursor||0}));
    try{localStorage.setItem(this._storageKey+'-resume',JSON.stringify(saved));this._resumeMatch=saved;return true;}
    catch{this._noticeText='Das laufende Match konnte nicht gesichert werden. Bitte zuerst fortsetzen.';return false;}
  }
  _dropResumeMatch(){this._resumeMatch=null;try{localStorage.removeItem(this._storageKey+'-resume');}catch{}}
  _resumeSavedMatch(){
    this._stopAudio();
    if(this._state.phase==='setup'){
      const saved=this._resumeMatch;if(!saved)return;
      this._setup=JSON.parse(JSON.stringify(saved.setup));this._events=JSON.parse(JSON.stringify(saved.events));this._cursor=saved.cursor;this._replay();
      this._dropResumeMatch();this._persist();
    }
    this._screen='game';this._noticeText='';this._render();
  }
  _startMatch() {
    const names=this._state.players.slice(0,this._state.playerCount).map((p,i)=>String(p.name||'Spieler '+(i+1)).trim().toLocaleLowerCase());
    if(new Set(names).size!==names.length){this._noticeText='Bitte unterschiedliche Spielernamen wählen.';this._render();return;}
    this._screen='game';this._noticeText='';this._dropResumeMatch();
    this._unlockWinAudio();
    this._celebration=null; this._statsOpen=false; this._statsLeg="match";
    const old=this._state; const s=this._freshState(); s.bestOf=old.bestOf; s.playerCount=old.playerCount;
    s.players=old.players.slice(0,s.playerCount).map((p,i)=>this._newPlayer(String(p.name || 'Spieler '+(i+1)).trim() || 'Spieler '+(i+1)));
    for(const key of ['startScore','matchMode','setsMode','legsPerSet','doubleOut','checkoutTips'])s[key]=old[key]??s[key];
    s.visitStart=s.startScore;for(const p of s.players)p.score=s.startScore;
    if(this._db)this._mutate('profiles',{names:s.players.map(p=>p.name)}).catch(()=>{this._dbError='Spielerprofil noch nicht gespeichert.';this._render();});
    s.phase='game';s.matchId=this._newId(); this._setup=s; this._events=[]; this._cursor=0; this._replay(); this._persist(); this._render();this._enqueueAudio([this._audioItem(this._eventFile('introSound'))]);this._scheduleGameOn();
  }
  _replay() {
    this._state=JSON.parse(JSON.stringify(this._setup));
    this._state.legResults=[]; this._state.visitRecords=[];
    for(const p of this._state.players) Object.assign(p,{matchThrownDarts:0,legThrownDarts:0,legFirst9Points:0,legFirst9Darts:0,lastVisit:null,legOutAttempts:0,matchOutAttempts:0,legOutHits:0,matchOutHits:0,legOutUnknown:0,matchOutUnknown:0});
    for(let i=0;i<this._cursor;i++) this._apply(this._events[i]);
    this._history=Array(this._cursor); this._future=Array(this._events.length-this._cursor); this._mult=1;
  }
  _apply(d) {
    const s=this._state; if(s.phase!=='game') return;
    const p=s.players[s.current], value=d.base*d.mult;
    const label=d.base===0?'MISS':d.base===25?(d.mult===2?'BULL':'25'):(d.mult===3?'T':d.mult===2?'D':'')+d.base;
    const after=p.score-value, finish=after===0 && (!s.doubleOut || d.mult===2);
    const bust=after<0 || (s.doubleOut && after===1) || (after===0&&!finish);
    const attempt=s.doubleOut && (finish || (d.outAttempt===true&&this._canDoubleOut(p.score)));
    if(s.doubleOut&&this._canDoubleOut(p.score)&&!finish&&d.outAttempt===undefined){p.legOutUnknown++;p.matchOutUnknown++;}
    if(attempt){p.legOutAttempts++;p.matchOutAttempts++;}
    if(finish){p.legOutHits++;p.matchOutHits++;}
    const n=p.legDarts; p.legDarts++; p.matchDarts++; p.matchThrownDarts++; p.legThrownDarts++;
    const first=n<9;
    if(first) { p.first9Darts++; p.legFirst9Darts++; if(!bust) {p.first9Points+=value;p.legFirst9Points+=value;} }
    s.currentVisit.push({label,value,bust,first});
    if(bust) {
      for(const prev of s.currentVisit.slice(0,-1)) {
        p.matchPoints-=prev.value; p.legPoints-=prev.value;
        if(prev.first) {p.first9Points-=prev.value;p.legFirst9Points-=prev.value;}
      }
      // A busted visit counts as three darts in the conventional 3-dart average.
      const unused=3-s.currentVisit.length;
      const first9Unused=Math.min(unused,Math.max(0,9-p.legDarts));
      p.first9Darts+=first9Unused; p.legFirst9Darts+=first9Unused;
      p.matchDarts+=unused; p.legDarts+=unused; p.score=s.visitStart;
      this._completeVisit(true,false);
      this._nextPlayer(); return;
    }
    p.score=after; p.matchPoints+=value; p.legPoints+=value;
    if(finish || s.currentVisit.length===3) this._completeVisit(false,finish);
    if(finish) {
      p.legs++; p.setLegs=(p.setLegs||0)+1;
      s.legResults.push({number:s.legNumber,winner:s.current,checkout:s.currentVisit.map(x=>x.label).join(" · "),total:s.currentVisit.reduce((sum,x)=>sum+x.value,0),players:s.players.map(x=>({name:x.name,score:x.score,legs:x.legs,points:x.legPoints,darts:x.legDarts,thrown:x.legThrownDarts,first9Points:x.legFirst9Points,first9Darts:x.legFirst9Darts,matchPoints:x.matchPoints,matchDarts:x.matchDarts,matchThrown:x.matchThrownDarts,outAttempts:x.legOutAttempts,outHits:x.legOutHits,matchOutAttempts:x.matchOutAttempts,matchOutHits:x.matchOutHits,outUnknown:x.legOutUnknown,matchOutUnknown:x.matchOutUnknown}))});
      let matchWon=false;
      if(s.setsMode){if(p.setLegs>=Math.floor(s.legsPerSet/2)+1){p.sets=(p.sets||0)+1;matchWon=p.sets>=this._neededLegs();s.legResults.at(-1).setWon=true;s.legResults.at(-1).setNumber=s.setNumber;s.setNumber++;for(const x of s.players)x.setLegs=0;}}
      else matchWon=p.legs>=this._neededLegs();
      if(matchWon) { s.winner=s.current; s.phase='finished'; return; }
      s.legNumber++;
      for(const x of s.players) { x.score=s.startScore; x.legPoints=0; x.legDarts=0; x.legThrownDarts=0; x.legFirst9Points=0; x.legFirst9Darts=0; x.legOutAttempts=0; x.legOutHits=0; x.legOutUnknown=0; }
      s.current=(s.legNumber-1)%s.playerCount; s.visitStart=s.startScore; s.currentVisit=[];
    } else if(s.currentVisit.length===3) this._nextPlayer();
  }

  _completeVisit(bust,finish) {
    const s=this._state,p=s.players[s.current];
    const total=bust?0:s.currentVisit.reduce((sum,d)=>sum+d.value,0);
    s.lastVisit={name:p.name,darts:s.currentVisit.slice(),total,status:bust?'BUST':finish?'LEG GEWONNEN':''};
    p.lastVisit=s.lastVisit;
    s.visitRecords.push({player:s.current,leg:s.legNumber,darts:s.currentVisit.length,total,bust,finish,start:s.visitStart});
  }

  _neededLegs() { return this._state.matchMode==='first'?this._state.bestOf:Math.floor(this._state.bestOf / 2) + 1; }

  _activePlayers() { return this._state.players.slice(0, this._state.playerCount); }

  _nextPlayer() {
    const s = this._state;
    s.current = (s.current + 1) % s.playerCount;
    s.visitStart = s.players[s.current].score;
    s.currentVisit = [];
    this._mult = 1;
  }

  _prepareWinAudio(){this._warmAudio();}
  _unlockWinAudio(){this._stopAudio();this._warmAudio();}
  _stopWinAudio(){this._stopAudio();}
  _playWinAudio(){const s=this._state,r=s.legResults.at(-1);this._enqueueAudio([this._audioItem(this._eventFile(s.phase==='finished'?'matchSound':r?.setWon?'setSound':'legSound'))]);}

  async _refreshAudio(show=true){
    if(!this._hass||this._audioLoading)return;
    this._audioLoading=true;
    try{this._audioLibrary=await this._hass.callWS({type:'dart_assistant/audio_list'});this._audioError='';this._audioFailures=new Set();this._warmAudio();if(show)this._noticeText='Audio-Dateiliste aktualisiert.';}
    catch(e){this._audioError='Audio-Dateiliste nicht verfügbar. Bitte Backend-Verbindung prüfen.';}
    finally{this._audioLoading=false;this._render();}
  }
  _callerFile(key){const voice=this._audioLibrary?.callers.find(v=>v.name===this._preferences().callerVoice);return voice?.files[String(key).toLowerCase()]||null;}
  _eventFile(key){const url=this._preferences()[key];return url?this._audioLibrary?.sounds.find(f=>f.url===url)||null:null;}
  _audioItem(file,caller=false){return file?{...file,caller}:null;}
  _audioObject(item){
    this._audioCache ||= new Map();const src=item.url+(item.revision?'?v='+item.revision:'');
    if(!this._audioCache.has(src)){const audio=new Audio(src);audio.preload='auto';this._audioCache.set(src,audio);}
    return this._audioCache.get(src);
  }
  _warmAudio(){
    if(typeof Audio==='undefined')return;
    const voice=this._audioLibrary?.callers.find(v=>v.name===this._preferences().callerVoice);
    for(const file of [...Object.values(voice?.files||{}),...['legSound','setSound','matchSound','introSound'].map(k=>this._eventFile(k)).filter(Boolean)])this._audioObject(file);
  }
  _stopAudio(){
    this._endCelebrationFx();
    this._audioQueue=[];this._audioNow='';this._audioGeneration=(this._audioGeneration||0)+1;
    this._audioFinish?.();this._audioFinish=null;
    if(this._audioCurrent){this._audioCurrent.pause();try{this._audioCurrent.currentTime=0;}catch{}this._audioCurrent=null;}
  }
  _enqueueAudio(items){
    this._audioQueue ||= [];this._audioQueue.push(...items.filter(x=>x&&!(this._audioFailures?.has(x.url))));
    this._drainAudio();
  }
  _scheduleGameOn(){
    const file=this._callerFile('gameon');
    if(file)this._enqueueAudio([{waitMs:1000},this._audioItem(file,true)]);
  }
  _beginCelebrationFx(item){
    clearTimeout(this._celebrationFxTimer);clearTimeout(this._celebrationFadeTimer);
    const fx={active:true,complete:false};this._celebrationFx=fx;
    if(!item||!(this._preferences().soundVolume??.7)||this._audioFailures?.has(item.url))this._celebrationFxTimer=setTimeout(()=>this._endCelebrationFx(fx),4000);
    return item?{...item,celebrationFx:fx}:null;
  }
  _endCelebrationFx(fx=this._celebrationFx){
    if(!fx||fx!==this._celebrationFx||!fx.active)return;
    clearTimeout(this._celebrationFxTimer);fx.active=false;this._syncCelebrationFx();
    this._celebrationFadeTimer=setTimeout(()=>{if(fx===this._celebrationFx){fx.complete=true;this._syncCelebrationFx();}},800);
  }
  _syncCelebrationFx(){
    const rays=(this._renderRoot||this.shadowRoot)?.querySelector?.('.celebration-rays');
    if(!rays)return;const fx=this._celebrationFx;
    rays.hidden=!fx||fx.complete;rays.classList.toggle('is-running',!!fx?.active);
    rays.classList.toggle('is-fading',!!fx&&!fx.active&&!fx.complete);
  }
  async _drainAudio(){
    if(this._audioDraining)return;this._audioDraining=true;
    try{while(this._audioQueue?.length){
      const item=this._audioQueue.shift(),generation=this._audioGeneration||0;
      if(item.waitMs){
        await new Promise(resolve=>{
          let timer;const done=()=>{clearTimeout(timer);if(this._audioFinish===done)this._audioFinish=null;resolve();};
          this._audioFinish=done;timer=setTimeout(done,item.waitMs);
        });
        continue;
      }
      const audio=this._audioObject(item);audio.volume=Math.max(0,Math.min(1,item.caller?(this._preferences().callerVolume??.75):(this._preferences().soundVolume??.7)));
      if(!audio.volume)continue;this._audioCurrent=audio;this._audioNow=item.name;if(this._screen==='settings')this._render();
      await new Promise(resolve=>{
        let timer,settled=false;
        const done=()=>{if(settled)return;settled=true;clearTimeout(timer);audio.removeEventListener('ended',done);audio.removeEventListener('error',failed);if(this._audioFinish===done)this._audioFinish=null;if(item.celebrationFx)this._endCelebrationFx(item.celebrationFx);audio.pause();resolve();};
        const failed=()=>{this._audioFailures ||= new Set();this._audioFailures.add(item.url);done();if(this._screen==='settings')this._render();};
        this._audioFinish=done;audio.addEventListener('ended',done);audio.addEventListener('error',failed);
        try{audio.currentTime=0;const play=audio.play();play?.catch(e=>{if(generation!==(this._audioGeneration||0)){done();return;}if(e.name==='NotAllowedError'){this._audioQueue=[];this._noticeText='Audio vom Browser blockiert. Bitte Audio testen antippen.';done();this._render();}else if(e.name==='AbortError')done();else failed();});}
        catch{failed();}
        timer=setTimeout(failed,Math.max(15000,(Number.isFinite(audio.duration)?audio.duration*1000:300000)+10000));
      });
      if(this._audioCurrent===audio){this._audioCurrent=null;this._audioNow='';if(this._screen==='settings')this._render();}
    }}finally{this._audioDraining=false;if(this._audioQueue?.length)this._drainAudio();}
  }
  _previewAudio(key){
    this._stopAudio();const file=key==='callerVoice'?this._callerFile('180'):this._eventFile(key);
    if(!file){this._noticeText='Keine verfügbare Audiodatei ausgewählt.';this._render();return;}
    this._enqueueAudio([this._audioItem(file,key==='callerVoice')]);
  }
  async _uploadAudioFile(file,folder){
    if(!file||this._audioUploading)return;
    if(!folder){this._noticeText='Bitte zuerst einen Zielordner auswählen.';this._render();return;}
    if(!(folder==='import'?/\.zip$/i:/\.mp3$/i).test(file.name)||file.size>32*1024*1024){this._noticeText='Bitte eine passende MP3- oder ZIP-Datei mit maximal 32 MB auswählen.';this._render();return;}
    this._audioUploading=true;this._noticeText=folder==='import'?'Soundpaket wird importiert …':'MP3 wird hochgeladen …';this._render();
    try{
      const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(Error('Datei nicht lesbar.'));r.onload=()=>resolve(String(r.result).split(',')[1]);r.readAsDataURL(file);});
      const uploadId=this._newId(),blockSize=524288;let result;
      for(let offset=0,part=0;offset<data.length;offset+=blockSize,part++)result=await this._hass.callWS({type:'dart_assistant/audio_upload',folder,filename:file.name,uploadId,part,final:offset+blockSize>=data.length,data:data.slice(offset,offset+blockSize)});
      this._audioLibrary=result.library;this._audioFailures=new Set();this._audioError='';
      this._noticeText=result.imported!==undefined?result.imported+' MP3-Dateien importiert · '+result.skipped+' bereits vorhanden.':result.existing?'Diese MP3 ist bereits vorhanden.':result.renamed?'Gespeichert als '+result.name+'. Die vorhandene Datei wurde beibehalten.':'MP3 gespeichert: '+result.name;
      this._warmAudio();
    }catch(e){this._noticeText=e.message||'Audio-Upload fehlgeschlagen.';}
    finally{this._audioUploading=false;this._render();}
  }
  _audioSettingsHtml(){
    const p=this._preferences(),library=this._audioLibrary||{sounds:[],callers:[]};
    const choices=(key,files,voice=false)=>{
      const value=p[key]||'',exists=voice?files.some(f=>f.name===value):files.some(f=>f.url===value);
      const selected=voice?this._callerFile('180'):this._eventFile(key);
      return '<div class="da-audio-choice"><select data-audio-setting="'+key+'" aria-label="'+({callerVoice:'Caller-Stimme',matchSound:'Match Win',legSound:'Leg Win',setSound:'Set Win',introSound:'Einlaufmusik'}[key])+'"><option value="">Aus · keine Wiedergabe</option>'+
        (value&&!exists?'<option selected value="'+this._esc(value)+'">Fehlt: '+this._esc(value.split('/').pop())+'</option>':'')+
        files.map(f=>'<option value="'+this._esc(voice?f.name:f.url)+'" '+(value===(voice?f.name:f.url)?'selected':'')+'>'+this._esc(f.name)+'</option>').join('')+
        '</select><button class="da-secondary" data-audio-preview="'+key+'" aria-label="'+({callerVoice:'Caller',matchSound:'Match Win',legSound:'Leg Win',setSound:'Set Win',introSound:'Einlaufmusik'}[key])+' probehören" '+(!selected?'disabled':'')+'>▶</button></div>'+
        (value&&(!exists||this._audioFailures?.has(selected?.url))?'<p role="status">Datei fehlt oder ist nicht abspielbar; wird übersprungen.</p>':'');
    };
    const voice=library.callers.find(v=>v.name===p.callerVoice);
    const hits=new Set([0,25,50]);for(let n=1;n<=20;n++)for(let m=1;m<=3;m++)hits.add(n*m);
    let totals=new Set([0]);for(let d=0;d<3;d++){const next=new Set();for(const a of totals)for(const b of hits)next.add(a+b);totals=next;}
    const missing=voice?[...Array.from(totals).sort((a,b)=>a-b).map(String),'gameon','bullseye'].filter(k=>!voice.files[k]):[];
    return '<section class="da-box"><h2>Caller & Audio · V1.0</h2><p role="status" aria-live="polite">'+(this._audioNow?'Wiedergabe: '+this._esc(this._audioNow):'Audio bereit')+'</p><button id="daRefreshAudio" class="da-secondary" '+(this._audioLoading?'disabled':'')+'>Dateiliste aktualisieren</button><p>'+library.sounds.length+' Sounds · '+library.callers.length+' Caller-Stimmen</p>'+
      (this._audioError?'<p role="alert">'+this._esc(this._audioError)+'</p>':'')+
      '<label>Caller-Stimme</label>'+choices('callerVoice',library.callers,true)+
      '<p>Das komplette Sprecherpaket wechselt mit der Stimme. Probehören: 180.</p>'+
      (missing.length?'<p>Im Sprecherpaket fehlen: '+missing.map(x=>this._esc(x+'.mp3')).join(', ')+'. Fehlende Ansagen werden übersprungen.</p>':'')+
      '<label for="daCallerVolume">Caller-Lautstärke · '+Math.round((p.callerVolume??.75)*100)+' %</label><input id="daCallerVolume" type="range" min="0" max="100" value="'+Math.round((p.callerVolume??.75)*100)+'">'+
      [['matchSound','Match Win'],['legSound','Leg Win'],['setSound','Set Win'],['introSound','Einlaufmusik']].map(([k,t])=>'<label>'+t+'</label>'+choices(k,library.sounds)).join('')+
      '<label for="daVolume">Sound-Lautstärke · '+Math.round((p.soundVolume??.7)*100)+' %</label><input id="daVolume" type="range" min="0" max="100" value="'+Math.round((p.soundVolume??.7)*100)+'">'+
      '<button id="daStopAudio" class="da-secondary">Audio stoppen</button><p>Eine leere Auswahl bleibt stumm. Ansagen und Ereignis-Sounds werden nacheinander abgespielt.</p>'+
      '<h3>Eigenes Soundpaket</h3><label class="da-upload">Soundpaket als ZIP importieren<input id="daAudioPack" type="file" accept="application/zip,.zip" '+(this._audioUploading?'disabled':'')+'></label><p>Ordnerstruktur: sounds/*.mp3 und caller/Stimme/*.mp3. Auch Caller.zip und Sounds.zip werden unterstützt. Bestehende Dateien bleiben erhalten.</p><label for="daAudioFolder">Zielordner für MP3-Upload</label><select id="daAudioFolder" '+(this._audioUploading?'disabled':'')+'><option value="">Bitte Zielordner wählen</option><option value="sounds" '+(this._audioUploadFolder==='sounds'?'selected':'')+'>Sounds</option>'+library.callers.map(v=>'<option value="'+this._esc('caller/'+v.name)+'" '+(this._audioUploadFolder==='caller/'+v.name?'selected':'')+'>Caller · '+this._esc(v.name)+'</option>').join('')+'</select><label class="da-upload">MP3 auswählen und hochladen<input id="daAudioFile" type="file" accept="audio/mpeg,.mp3" '+(!this._audioUploadFolder||this._audioUploading?'disabled':'')+'></label><p>Vorhandene Dateien bleiben erhalten. Gleiche Dateinamen erhalten einen Zusatz. Neue MP3s erscheinen automatisch in der Dateiliste. Caller-Dateien passend benennen, z. B. 180.mp3, gameon.mp3 oder bullseye.mp3.</p></section>';
  }
  connectedCallback() { requestAnimationFrame(()=>{if(this.isConnected)this._render();}); }
  disconnectedCallback() { this._stopWinAudio(); this._restoreChrome(); }

  _canDoubleOut(score) { return score===50 || (score>=2&&score<=40&&score%2===0); }
  _scoreDart(base,forcedValue=null,label=null) {
    if(this._state.phase!=='game')return;
    const mult=base===0?1:base===25?(forcedValue===50?2:1):this._mult;
    const score=this._state.players[this._state.current].score;
    if(this._state.doubleOut && this._canDoubleOut(score) && !(base*mult===score&&mult===2)) {
      this._pendingDart={base,forcedValue,label,mult}; this._render(); return;
    }
    this._commitDart(base,forcedValue,label,null);
  }
  _commitDart(base,forcedValue=null,label=null,outAttempt=null) {
    if(this._state.phase!=='game') return;
    this._quitArmed=false;
    const completedBefore=this._state.legResults.length, visitsBefore=this._state.visitRecords.length;
    const mult=base===0?1:base===25?(forcedValue===50?2:1):this._mult;
    this._events=this._events.slice(0,this._cursor); this._events.push(typeof outAttempt==="boolean"?{base,mult,outAttempt}:{base,mult}); this._cursor++; this._replay(); this._persist();
    const won=this._state.legResults.length>completedBefore;
    if(won){
      const r=this._state.legResults.at(-1);this._celebration=r;
      this._stopAudio();
      this._enqueueAudio([this._beginCelebrationFx(this._audioItem(this._eventFile(this._state.phase==='finished'?'matchSound':r.setWon?'setSound':'legSound')))]);
    }else{
      const clips=[];
      if(base===0)clips.push(this._audioItem(this._callerFile('0'),true));
      else if(base===25&&mult===2)clips.push(this._audioItem(this._callerFile('bullseye'),true));
      if(this._state.visitRecords.length>visitsBefore){
        const visit=this._state.visitRecords.at(-1);
        if(visit.bust)clips.push(this._audioItem(this._callerFile('bust'),true));
        else if(visit.total>0)clips.push(this._audioItem(this._callerFile(visit.total),true));
      }
      this._enqueueAudio(clips);
    }
    this._queueRecord();this._render();
  }

  _undo() { if(!this._cursor)return; this._stopWinAudio(); this._celebration=null; this._pendingDart=null; this._cursor--; this._replay(); this._persist(); this._queueRecord();this._render(); }

  _redo() { if(this._cursor>=this._events.length)return;this._stopAudio(); const before=this._state.legResults.length; this._cursor++; this._replay(); this._persist();this._queueRecord(); if(this._state.legResults.length>before)this._celebration=this._state.legResults.at(-1); this._render(); }

  _avg(points, darts) { return darts ? (points / darts * 3).toFixed(1) : "0.0"; }

  _standardCheckout(score) {
    // Practical common checkout suggestions. Not exhaustive for every preference.
    const c = {
      170:"T20 · T20 · BULL",167:"T20 · T19 · BULL",164:"T20 · T18 · BULL",
      161:"T20 · T17 · BULL",160:"T20 · T20 · D20",158:"T20 · T20 · D19",
      157:"T20 · T19 · D20",156:"T20 · T20 · D18",155:"T20 · T19 · D19",
      154:"T20 · T18 · D20",153:"T20 · T19 · D18",152:"T20 · T20 · D16",
      151:"T20 · T17 · D20",150:"T20 · T18 · D18",149:"T20 · T19 · D16",
      148:"T20 · T16 · D20",147:"T20 · T17 · D18",146:"T20 · T18 · D16",
      145:"T20 · T15 · D20",144:"T20 · T20 · D12",143:"T20 · T17 · D16",
      142:"T20 · T14 · D20",141:"T20 · T19 · D12",140:"T20 · T20 · D10",
      138:"T20 · T18 · D12",137:"T20 · T19 · D10",136:"T20 · T20 · D8",
      135:"BULL · T15 · D20",134:"T20 · T14 · D16",133:"T20 · T19 · D8",
      132:"BULL · BULL · D16",131:"T20 · T13 · D16",130:"T20 · T20 · D5",
      129:"T19 · T16 · D12",128:"T18 · T18 · D10",127:"T20 · T17 · D8",
      126:"T19 · T19 · D6",125:"25 · T20 · D20",124:"T20 · T16 · D8",
      123:"T19 · T16 · D9",122:"T18 · T18 · D7",121:"T20 · T11 · D14",
      120:"T20 · 20 · D20",119:"T19 · T12 · D13",118:"T20 · 18 · D20",
      117:"T20 · 17 · D20",116:"T20 · 16 · D20",115:"T20 · 15 · D20",
      114:"T20 · 14 · D20",113:"T20 · 13 · D20",112:"T20 · 12 · D20",
      111:"T20 · 11 · D20",110:"T20 · 10 · D20",109:"T20 · 9 · D20",
      108:"T20 · 8 · D20",107:"T19 · 10 · D20",106:"T20 · 6 · D20",
      105:"T20 · 5 · D20",104:"T18 · 10 · D20",103:"T19 · 6 · D20",
      102:"T20 · 10 · D16",101:"T17 · 10 · D20",100:"T20 · D20",
      99:"T19 · 10 · D16",98:"T20 · D19",97:"T19 · D20",96:"T20 · D18",
      95:"T19 · D19",94:"T18 · D20",93:"T19 · D18",92:"T20 · D16",
      91:"T17 · D20",90:"T18 · D18",89:"T19 · D16",88:"T16 · D20",
      87:"T17 · D18",86:"T18 · D16",85:"T15 · D20",84:"T20 · D12",
      83:"T17 · D16",82:"BULL · D16",81:"T19 · D12",80:"T20 · D10",
      79:"T19 · D11",78:"T18 · D12",77:"T19 · D10",76:"T20 · D8",
      75:"T17 · D12",74:"T14 · D16",73:"T19 · D8",72:"T16 · D12",
      71:"T13 · D16",70:"T18 · D8",69:"T19 · D6",68:"T20 · D4",
      67:"T17 · D8",66:"T10 · D18",65:"25 · D20",64:"T16 · D8",
      63:"T13 · D12",62:"T10 · D16",61:"T15 · D8",60:"20 · D20",
      59:"19 · D20",58:"18 · D20",57:"17 · D20",56:"16 · D20",
      55:"15 · D20",54:"14 · D20",53:"13 · D20",52:"12 · D20",
      51:"11 · D20",50:"BULL",49:"9 · D20",48:"8 · D20",47:"15 · D16",
      46:"6 · D20",45:"5 · D20",44:"4 · D20",43:"3 · D20",42:"10 · D16",
      41:"9 · D16",40:"D20",38:"D19",36:"D18",34:"D17",32:"D16",
      30:"D15",28:"D14",26:"D13",24:"D12",22:"D11",20:"D10",
      18:"D9",16:"D8",14:"D7",12:"D6",10:"D5",8:"D4",6:"D3",4:"D2",2:"D1"
    };
    return c[score] || (score > 170 ? "—" : "Kein Standard-Checkout");
  }

  _checkout(score) {
    const darts=3-this._state.currentVisit.length;
    if(this._state.checkoutTips===false)return 'Tipps ausgeschaltet';
    if(!this._state.doubleOut){
      const hits=[];for(let n=20;n>=1;n--)hits.push({value:n*3,label:'T'+n});hits.push({value:50,label:'BULL'},{value:25,label:'25'});for(let n=20;n>=1;n--)hits.push({value:n,label:String(n)},{value:2*n,label:'D'+n});
      const search=(rest,count)=>{const hit=hits.find(h=>h.value===rest);if(hit)return [hit.label];if(count<=1)return null;for(const h of hits){if(h.value>=rest)continue;const tail=search(rest-h.value,count-1);if(tail)return [h.label,...tail];}return null;};
      if(score>darts*60)return 'Noch kein Checkout';const route=search(score,darts);return route?route.join(' · '):'Kein Checkout';
    }
    if(this._state.phase==='finished') return 'Match beendet';
    if(score>170) return 'Noch kein Checkout';
    if([169,168,166,165,163,162,159].includes(score)) return 'Bogey – kein 3-Dart-Checkout';
    const standard=this._standardCheckout(score);
    if(!standard.includes('Kein') && standard.split(' · ').length<=darts) return standard;
    const doubles=[20,16,18,12,10,8,4,2,1,19,17,15,14,13,11,9,7,6,5,3].map(n=>({value:2*n,label:'D'+n})).concat({value:50,label:'BULL'});
    const hits=[]; for(let n=20;n>=1;n--)hits.push({value:n*3,label:'T'+n});
    for(let n=20;n>=1;n--)hits.push({value:n,label:String(n)});
    hits.push({value:25,label:'25'},...doubles);
    const search=(rest,count)=>{
      const end=doubles.find(x=>x.value===rest); if(end)return [end.label];
      if(count<=1)return null;
      for(const x of hits) { if(rest-x.value<2)continue; const tail=search(rest-x.value,count-1); if(tail)return [x.label,...tail]; }
      return null;
    };
    for(let n=1;n<=darts;n++) { const route=search(score,n); if(route)return route.join(' · '); }
    return 'Kein Checkout mit '+darts+' Dart'+(darts===1?'':'s');
  }

  _render() {
    if (!this.shadowRoot) return;
    this.dataset.registeredClass=customElements.get("dart-score-card")?.name || "";
    this.dataset.version="1.9.0-beta.1";
    const home=this.getRootNode?.().querySelector?.('#home');
    if(home){home.style.transform='translateX(-110px)';home.style.display=this._entryScreen()||this._state.phase==='setup'||this._fullscreen?'none':'';}
    const s=this._state;
    
    const html=this._screen==='home'?this._homeHtml():this._screen==='settings'?this._settingsHtml():this._screen==='lifetime'?this._lifetimeHtml():s.phase==='setup'||this._screen==='setup'?this._setupHtml():this._gameHtml();
    const root=this._fullscreenLayer?.shadowRoot||this.shadowRoot;
    if(root!==this.shadowRoot)this.shadowRoot.innerHTML='';
    root.innerHTML=`<style>${this._css()}</style>${html}`;
    // Bind existing card logic against the same render target used by the overlay.
    this._renderRoot=root;this._bind();this._bindNext();this._syncCelebrationFx();
    if(this._pendingDart||this._celebration||this._statsOpen)root.querySelector('[role=dialog]')?.focus({preventScroll:true});
  }

  _setupHtml() {
    const s=this._state,prefs=this._preferences();
    const scripts=Object.entries(this._hass?.states||{}).filter(([id])=>id.startsWith('script.')).sort((a,b)=>(a[1].attributes.friendly_name||a[0]).localeCompare(b[1].attributes.friendly_name||b[0]));
    return `<ha-card><div class="setup"><div class="setup-title"><div><div class="eyebrow">DARTS</div><h1>Dein Match</h1></div><div><button id="daBack" class="da-icon" aria-label="Zur Startseite"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H4m7-7-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>${this._fullscreenButton()}<button id="daSettings" class="da-icon" aria-label="Globale Einstellungen">${this._icon('gear')}</button></div></div><div class="setup-grid"><section><label>Spieler</label><div class="seg">${[1,2,3,4].map(n=>`<button data-count="${n}" class="${s.playerCount===n?'on':''}">${n}</button>`).join('')}</div><div class="names">${s.players.slice(0,s.playerCount).map((p,i)=>`<div class="da-name-field"><input data-name="${i}" autocomplete="off" maxlength="40" placeholder="Spieler ${i+1}" value="${this._esc(p.name)}" aria-label="Name Spieler ${i+1}" role="combobox" aria-autocomplete="list" aria-controls="profiles-${i}"><div class="da-name-menu" id="profiles-${i}" hidden></div></div>`).join('')}</div><p class="hint">Gespeicherten Namen auswählen oder neuen Namen eingeben.</p><label>Startpunkte</label><div class="seg">${[301,501,701].map(n=>`<button data-score="${n}" class="${s.startScore===n?'on':''}">${n}</button>`).join('')}<button data-custom class="${![301,501,701].includes(s.startScore)?'on':''}">Eigene</button></div><label class="field">Eigene Startpunkte<input id="startScore" type="number" min="2" max="10001" value="${s.startScore}"></label></section><section><label>Matchmodus</label><div class="seg two">${[['best','Best of'],['first','First to']].map(([v,t])=>`<button data-mode="${v}" class="${s.matchMode===v?'on':''}">${t}</button>`).join('')}</div><label class="field">${s.matchMode==='first'?'Siege zum Matchgewinn':'Anzahl maximaler Spiele'}<input id="bestOf" type="number" min="1" max="99" step="${s.matchMode==='first'?1:2}" value="${s.bestOf}"></label><label class="toggle"><input id="setsMode" type="checkbox" ${s.setsMode?'checked':''}> Mit Sets spielen</label>${s.setsMode?`<label class="field">Legs pro Set · Best of<input id="legsPerSet" type="number" min="1" max="99" step="2" value="${s.legsPerSet}"></label><p class="hint">${Math.floor(s.legsPerSet/2)+1} Legs für einen Setgewinn</p>`:''}<label class="toggle"><input id="doubleOut" type="checkbox" ${s.doubleOut?'checked':''}> Double Out <span>${s.doubleOut?'':'Single Out'}</span></label><label class="toggle"><input id="checkoutTips" type="checkbox" ${s.checkoutTips?'checked':''}> Checkout-Tipps</label></section></div><button id="start" class="start">MATCH STARTEN</button>${this._hasResumableMatch()?'<button id="resume" class="da-secondary" style="width:100%;margin-top:12px">MATCH FORTSETZEN</button>':''}<div class="hint">${s.startScore} · ${s.doubleOut?'Double Out':'Single Out'} · ${this._neededLegs()} ${s.setsMode?'Sets':'Legs'} zum Sieg</div>${this._notice()}${this._saveError?`<p role="alert">${this._esc(this._saveError)}</p>`:''}</div></ha-card>`;
  }
  _fullscreenButton(){return `<button id="fullscreen" class="settings fullscreen-button" aria-label="${this._fullscreen?'Normalansicht':'Vollbild'}" title="${this._fullscreen?'Normalansicht':'Vollbild'}"><span aria-hidden="true">${this._fullscreen?'⤡':'⛶'}</span></button>`;}

  _icon(name) {
    const paths={target:'<circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="11"/><circle cx="24" cy="24" r="5"/><path d="M24 24 41 7m-8 0 1 7 7 1 5-5-7-1-1-7z"/>',cup:'<path d="M15 8h18v9c0 9-18 9-18 0zM15 11H8v5c0 7 7 9 10 7m15-12h7v5c0 7-7 9-10 7M24 25v11m-7 4h14m-10-4h6"/>',gear:'<path d="m20 6-1 5-5 2-4-2-4 7 4 3v6l-4 3 4 7 4-2 5 2 1 5h8l1-5 5-2 4 2 4-7-4-3v-6l4-3-4-7-4 2-5-2-1-5z"/><circle cx="24" cy="24" r="7"/>',dart:'<path d="m9 39 22-22m-9 3 7 7M31 17l2-9 10-3-3 10-9 2M9 39l2-10 8 8-10 2m2-10-6 4m14 4-4 6"/>',single:'<circle cx="24" cy="24" r="12" fill="currentColor"/>',double:'<circle cx="19" cy="24" r="12"/><circle cx="29" cy="24" r="12"/>',triple:'<circle cx="14" cy="24" r="11"/><circle cx="24" cy="24" r="11"/><circle cx="34" cy="24" r="11"/>',miss:'<path d="m12 12 24 24m0-24L12 36"/>',bull25:'<circle cx="24" cy="24" r="12"/>',undo:'<path d="m18 10-9 9 9 9M9 19h20c15 0 15 23 0 23h-6"/>',redo:'<path d="m30 10 9 9-9 9m9-9H19c-15 0-15 23 0 23h6"/>'};
    return '<svg viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">'+(paths[name]||paths.target)+'</svg>';
  }
  _scoreRing(player, small=false, color='#2cc5ff', end='#9decff') {
    const progress=Math.max(0,Math.min(1,((this._state.startScore||501)-player.score)/(this._state.startScore||501))), circumference=289.0265;
    return `<div class="score-ring ${small?'mini':''}" style="--accent:${color}"><svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="ring-${small?this._state.players.indexOf(player):'active'}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs><circle class="track" cx="50" cy="50" r="46"/><circle class="progress" cx="50" cy="50" r="46" transform="rotate(-90 50 50)" stroke="url(#ring-${small?this._state.players.indexOf(player):'active'})" stroke-dasharray="${circumference*progress} ${circumference}" ${progress===0?'style="opacity:0"':''}/></svg><div class="ring-text"><b>${player.score}</b><span>${this._esc(player.name)}</span></div></div>`;
  }
  _gameHtml() {
    const s=this._state,p=s.players[s.current],needed=this._neededLegs();
    const others=this._activePlayers().map((x,i)=>({x,i}));
    const winner=s.winner!==null?s.players[s.winner]:null;
    const current=s.currentVisit, last=p.lastVisit;
    const colors=[['#2cc5ff','#9decff'],['#fa278c','#ff9bc9'],['#27ee87','#a6ffe1'],['#9952ff','#e5a6ff']];
    return `<ha-card><div class="app">
      <aside class="pad panel">
        <div class="pad-header"><div class="brand">${this._icon('target')}<div><b>${s.startScore}</b><small>DARTS</small></div></div><div class="match-label">${this._icon('cup')}<div><b>${this._matchLabel()}</b><small>${needed} ${s.setsMode?'SETS':'LEGS'} ZUM SIEG</small></div></div>${this._fullscreenButton()}<button id="quit" class="settings ${this._quitArmed?'armed':''}" aria-label="${this._quitArmed?'Match wirklich verlassen? Erneut tippen':'Match verlassen'}">${this._quitArmed?'Match verlassen? Erneut tippen':'←'}</button></div>
        <div class="mults">${[[1,'SINGLE','single'],[2,'DOUBLE','double'],[3,'TRIPLE','triple']].map(([m,t,icon])=>`<button data-mult="${m}" aria-label="${t}" aria-pressed="${this._mult===m}" class="${this._mult===m?'on':''}">${this._icon(icon)}<span>${t}</span></button>`).join('')}</div>
        <div class="numbers">${Array.from({length:20},(_,i)=>i+1).map(n=>`<button data-num="${n}">${n}</button>`).join('')}</div>
        <div class="special"><button data-special="miss" class="miss" aria-label="MISS">${this._icon('miss')}<b>MISS</b><small>0</small></button><button data-special="25" class="bull25" aria-label="25">${this._icon('bull25')}<b>25</b><small>SINGLE BULL</small></button><button data-special="bull" class="bull50" aria-label="BULL 50">${this._icon('double')}<b>50</b><small>BULL</small></button><div class="history-stack"><button id="undo" aria-label="UNDO ${this._history.length}" ${!this._history.length?'disabled':''}>${this._icon('undo')}<span>UNDO <small>${this._history.length}</small></span></button><button id="redo" aria-label="REDO ${this._future.length}" ${!this._future.length?'disabled':''}>${this._icon('redo')}<span>REDO <small>${this._future.length}</small></span></button></div></div>
      </aside>
      <main class="board panel">
        <header><div class="leg-label">${this._icon('dart')}<b>${s.setsMode?'SET '+s.setNumber+' · ':''}LEG ${s.legNumber}</b></div><button id="stats" class="stats-button" aria-label="Average-Ansicht">Ø <span>AVERAGES</span></button><div class="match-label">${this._icon('cup')}<div><b>${this._matchLabel()}</b><small>${needed} ${s.setsMode?'SETS':'LEGS'} ZUM SIEG</small></div></div></header>
        ${winner?`<div class="winner" role="status">${this._icon('cup')}<b>${this._esc(winner.name)} gewinnt das Match!</b><button id="newMatch">NEUES MATCH</button></div>`:''}
        <section class="hero"><div class="won-legs"><b>${s.setsMode?(p.sets||0):p.legs}</b><small>GEWONNENE<br>${s.setsMode?'SETS':'LEGS'}</small></div>${this._scoreRing(p,false,...colors[s.current])}<div class="stats-column"><div class="average"><b><span>Ø</span> ${this._avg(p.matchPoints,p.matchDarts)}</b><small>MATCH · 3-DART AVERAGE</small><div class="secondary-stats"><span>LEG Ø ${this._avg(p.legPoints,p.legDarts)}</span><span>FIRST 9 Ø ${this._avg(p.first9Points,p.first9Darts)}</span><span class="dart-count">${p.legThrownDarts} DART${p.legThrownDarts===1?"":"S"} IM LEG</span></div></div><div class="last-visit"><b>${last?last.darts.map(d=>d.label).join(' · '):'—'}</b><small>LETZTE AUFNAHME${last?' · '+this._esc(last.name):''}</small>${last?.status?`<em>${last.status}</em>`:''}</div><div class="checkout"><small>CHECKOUT · ${Math.max(0,3-current.length)} DART${3-current.length===1?"":"S"}</small><b>${this._checkout(p.score)}</b></div></div></section>
        <section class="visit-strip" aria-label="Aktuelle Aufnahme"><div class="dart-chips">${[0,1,2].map(i=>`<div class="dart-chip ${current[i]?'filled':''}"><b>${current[i]?.label||'—'}</b><small>${current[i]?.value??'·'}</small></div>`).join('')}</div><div class="visit-total"><small>AUFNAHME</small><b>${current.reduce((a,d)=>a+d.value,0)}</b></div></section>
        <section class="players" data-count="${others.length}" style="--players:${others.length}">${others.map(({x,i},j)=>`<article class="player ${i===s.current?'current-player':''}" aria-current="${i===s.current?'true':'false'}" data-player-index="${i}" data-player="${x.name ? this._esc(x.name) : j}" style="--accent:${colors[j][0]};--tint:${colors[j][0]}18">${this._scoreRing(x,true,...colors[j])}<div class="player-bottom"><div class="leg-summary"><div class="leg-dots" aria-label="${s.setsMode?(x.sets||0):x.legs} von ${needed} ${s.setsMode?'Sets':'Legs'}">${Array.from({length:needed},(_,i)=>`<i class="${i<(s.setsMode?(x.sets||0):x.legs)?'won':''}"></i>`).join('')}</div><b>${s.setsMode?(x.sets||0):x.legs}</b><small>${s.setsMode?'SETS · '+(x.setLegs||0)+' LEGS':'LEGS'}</small></div><div class="player-average"><b>Ø ${this._avg(x.matchPoints,x.matchDarts)}</b><small>3-DART AVG</small></div></div><div class="mini-darts"><b>${x.legThrownDarts}</b> DART${x.legThrownDarts===1?"":"S"} IM LEG</div></article>`).join('')}</section>
        ${this._saveError?`<div class="save-error" role="alert">${this._saveError}</div>`:''}
      </main></div>${this._notice()}${this._overlayHtml()}</ha-card>`;
  }


  _statsRows(result=null) {
    const s=this._state;
    const players=result?result.players:this._activePlayers().map(p=>({name:p.name,score:p.score,legs:p.legs,points:p.legPoints,darts:p.legDarts,thrown:p.legThrownDarts,first9Points:p.first9Points,first9Darts:p.first9Darts,matchPoints:p.matchPoints,matchDarts:p.matchDarts,matchThrown:p.matchThrownDarts}));
    return players.map((p,i)=>`<tr class="${result && i===result.winner?'leg-winner':''}"><th scope="row">${this._esc(p.name)}${result && i===result.winner?' <span class="won-tag">SIEGER</span>':''}</th><td>${p.score}</td><td>${this._avg(p.points,p.darts)}</td><td>${this._avg(p.matchPoints,p.matchDarts)}</td><td>${this._avg(p.first9Points,p.first9Darts)}</td><td><b>${p.thrown}</b></td></tr>`).join('');
  }
  _statsTable(result=null) {
    return `<div class="stats-table-wrap"><table class="stats-table"><thead><tr><th>SPIELER</th><th>REST</th><th>LEG Ø</th><th>MATCH Ø</th><th>FIRST 9 Ø</th><th>LEG DARTS</th></tr></thead><tbody>${this._statsRows(result)}</tbody></table></div>`;
  }

  _scoringStats(player,leg=null) {
    const visits=(this._state.visitRecords||[]).filter(v=>v.player===player && (leg===null||v.leg===leg));
    const valid=visits.filter(v=>!v.bust),full=valid.filter(v=>v.darts===3);
    const finishes=valid.filter(v=>v.finish);
    const won=(this._state.legResults||[]).filter(r=>r.winner===player && (leg===null||r.number===leg));
    return {best3:full.length?Math.max(...full.map(v=>v.total)):null,hundreds:valid.filter(v=>v.total>=100&&v.total<140).length,tons40:valid.filter(v=>v.total>=140&&v.total<180).length,max180:valid.filter(v=>v.total===180).length,highestOut:finishes.length?Math.max(...finishes.map(v=>v.start)):null,bestLeg:won.length?Math.min(...won.map(r=>r.players[player].thrown)):null,busts:visits.filter(v=>v.bust).length,visits:visits.length};
  }
  _scoringTables(result=null) {
    const leg=result?result.number:null;
    const rows=this._activePlayers().map((p,i)=>({name:p.name,stats:this._scoringStats(i,leg)}));
    const display=n=>n===null?'—':n;
    const count=n=>n;
    return `<p class="result-caption">Scoring · ${leg===null?'Match':'Leg '+leg}</p><div class="stats-table-wrap"><table class="stats-table"><thead><tr><th>SPIELER</th><th>BESTER 3-DARTER</th><th>100–139</th><th>140–179</th><th>180</th></tr></thead><tbody>${rows.map(({name,stats:v})=>`<tr><th scope="row">${this._esc(name)}</th><td><b>${display(v.best3)}</b></td><td>${count(v.hundreds)}</td><td>${count(v.tons40)}</td><td>${count(v.max180)}</td></tr>`).join('')}</tbody></table></div><p class="result-caption">Checkout & Legs · ${leg===null?'Match':'Leg '+leg}</p><div class="stats-table-wrap"><table class="stats-table"><thead><tr><th>SPIELER</th><th>HÖCHSTES CHECKOUT</th><th>BESTES LEG</th><th>BUSTS</th><th>AUFNAHMEN</th></tr></thead><tbody>${rows.map(({name,stats:v})=>`<tr><th scope="row">${this._esc(name)}</th><td>${display(v.highestOut)}</td><td>${display(v.bestLeg)}</td><td>${count(v.busts)}</td><td>${count(v.visits)}</td></tr>`).join('')}</tbody></table></div><p class="stats-note">Bester 3-Darter: vollständige Aufnahme mit drei Darts, ohne Bust. Punkteklassen zählen gültige abgeschlossene Aufnahmen. Höchstes Checkout: Rest zu Beginn der erfolgreichen Aufnahme. Bestes Leg: wenigste tatsächlich geworfene Darts in einem gewonnenen Leg.</p>`;
  }


  _matchLegCount() { return Math.max(1,(this._state.legResults||[]).length + (this._state.phase==='game'&&this._activePlayers().some(p=>p.legThrownDarts>0)?1:0)); }
  _outStatsTable(result=null) {

    if(!this._state.doubleOut)return '';
    const rows=this._activePlayers().map((p,i)=>{
      const q=result?result.players[i]:p;
      const attempts=result?q.outAttempts:p.matchOutAttempts,hits=result?q.outHits:p.matchOutHits;
      const unknown=result?q.outUnknown:p.matchOutUnknown;
      const quota=unknown?'—*':attempts?(100*hits/attempts).toFixed(1)+' %':'—';
      return `<tr><th scope="row">${this._esc(p.name)}</th><td>${attempts}</td><td>${hits}</td><td>${quota}</td><td>${attempts}</td></tr>`;
    }).join('');
    return `<p class="result-caption">Double-Out · ${result?'Leg '+result.number:'Match – Gesamtanzahl'}</p><div class="stats-table-wrap"><table class="stats-table"><thead><tr><th>SPIELER</th><th>VERSUCHE</th><th>CHECKOUTS</th><th>CHECKOUT-QUOTE</th><th>VERSUCHE GESAMT</th></tr></thead><tbody>${rows}</tbody></table></div><p class="stats-note">Erfolgreiche Checkouts zählen automatisch als Versuch. Andere Versuche müssen bei der Eingabe bestätigt werden. * Bei historischen Würfen ohne Ziel-Kennzeichnung ist die Quote nicht zuverlässig berechenbar und wird daher nicht angezeigt. Match-Zähler zeigen die Gesamtanzahl über alle Legs; die Checkout-Quote ist erfolgreiche Checkouts / erfasste Versuche.</p>`;
  }

  _overlayHtml() {
    const s=this._state;
    if(this._pendingDart){
      const d=this._pendingDart,p=s.players[s.current];
      const label=d.label || (d.base===0?'MISS':(d.mult===3?'T':d.mult===2?'D':'')+d.base);
      return `<div class="overlay"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="attempt-title" tabindex="-1"><div class="modal-heading"><div><small>${this._esc(p.name)} · LEG ${s.legNumber} · REST ${p.score}</small><h2 id="attempt-title">Double-Out-Versuch?</h2></div></div><p class="result-caption">${this._esc(label)} · War dieser Dart auf das Finish-Double gezielt?</p><div class="modal-actions"><button id="confirmAttempt" class="modal-primary">JA, DOUBLE-OUT-VERSUCH</button><button id="normalDart">NEIN, NORMALER DART</button><button id="cancelDart">DART ABBRECHEN</button></div><p class="stats-note">Das Ergebnis wird anschließend unverändert gewertet. Die Kennzeichnung zählt nur den Versuch.</p></section></div>`;
    }
    if(this._statsOpen) {
      const result=(s.legResults||[]).find(r=>String(r.number)===String(this._statsLeg));
      return `<div class="overlay"><section class="modal averages-modal" role="dialog" aria-modal="true" aria-labelledby="averages-title" tabindex="-1"><div class="modal-heading"><div><small>${s.startScore} · MATCH-STATISTIK</small><h2 id="averages-title">Averages & Darts</h2></div><button id="closeStats" class="modal-close" aria-label="Average-Ansicht schließen">×</button></div><div class="average-tabs"><button data-stats-leg="match" class="${!result?'selected':''}">Match · aktuelles Leg</button>${(s.legResults||[]).map(r=>`<button data-stats-leg="${r.number}" class="${result?.number===r.number?'selected':''}">Leg ${r.number}</button>`).join('')}</div>${result?`<p class="result-caption">Leg ${result.number} · ${this._esc(result.players[result.winner].name)} gewinnt · ${result.checkout}</p>`:''}${this._statsTable(result)}${this._scoringTables(result)}${this._outStatsTable(result)}<p class="stats-note">DARTS zählt die tatsächlich geworfenen Darts. Bei Bust zählt für den 3-Dart-Average eine volle Aufnahme mit drei Darts.</p><button id="backToGame" class="modal-primary">ZURÜCK ZUM SPIEL</button></section></div>`;
    }
    const result=this._celebration;
    if(!result)return '';
    const winner=result.players[result.winner], match=s.phase==='finished';
    return `<div class="overlay celebration-overlay"><section class="modal celebration-modal" role="dialog" aria-modal="true" aria-labelledby="winner-title" tabindex="-1"><div class="celebration-rays" aria-hidden="true">${Array.from({length:12},(_,i)=>`<i style="--i:${i}"></i>`).join('')}</div><div class="winner-trophy">${this._icon('cup')}</div><small class="winner-kicker">${match?'MATCH GEWONNEN':'LEG '+result.number+' GEWONNEN'}</small><h2 id="winner-title">${this._esc(winner.name)}</h2><p class="winner-checkout">${result.checkout} <span>· ${result.total} Punkte</span></p><div class="winner-metrics"><div><small>LEG AVERAGE</small><b>${this._avg(winner.points,winner.darts)}</b></div><div><small>MATCH AVERAGE</small><b>${this._avg(winner.matchPoints,winner.matchDarts)}</b></div><div><small>GEWORFENE DARTS</small><b>${winner.thrown}<span> im Leg</span></b></div></div><div class="modal-actions"><button id="celebrationUndo">↶ SIEGDART ZURÜCK</button><button id="celebrationStats">Ø AVERAGES</button><button id="dismissCelebration" class="modal-primary">${match?'ERGEBNIS ANSEHEN':'WEITERSPIELEN'}</button></div></section></div>`;
  }

  _bind() {
    const q=(s)=>(this._renderRoot||this.shadowRoot).querySelector(s);
    if(q('#fullscreen'))q('#fullscreen').onclick=()=>this._toggleFullscreen();
    const update=(key,value)=>{this._state[key]=value;this._persist();this._render();};
    (this._renderRoot||this.shadowRoot).querySelectorAll('[data-score]').forEach(b=>b.onclick=()=>update('startScore',+b.dataset.score));
    if(q('[data-custom]'))q('[data-custom]').onclick=()=>{q('#startScore').focus();q('#startScore').select();};
    (this._renderRoot||this.shadowRoot).querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{this._state.matchMode=b.dataset.mode;if(b.dataset.mode==='best'&&this._state.bestOf%2===0)this._state.bestOf++;this._persist();this._render();});
    for(const [id,min,max,odd] of [['startScore',2,10001,false],['bestOf',1,99,this._state.matchMode!=='first'],['legsPerSet',1,99,true]])if(q('#'+id))q('#'+id).onchange=e=>{let v=Number(e.target.value);if(!Number.isInteger(v)||v<min||v>max){e.target.value=this._state[id];return;}if(odd&&v%2===0)v=Math.min(99,v+1);update(id,v);};
    for(const id of ['setsMode','checkoutTips'])if(q('#'+id))q('#'+id).onchange=e=>update(id,e.target.checked);
    const commitPending=attempt=>{const d=this._pendingDart;if(!d)return;this._pendingDart=null;this._mult=d.mult;this._commitDart(d.base,d.forcedValue,d.label,attempt);};
    if(q("#confirmAttempt"))q("#confirmAttempt").onclick=()=>commitPending(true);
    if(q("#normalDart"))q("#normalDart").onclick=()=>commitPending(false);
    if(q("#cancelDart"))q("#cancelDart").onclick=()=>{this._pendingDart=null;this._render();};
    if(q("#stats"))q("#stats").onclick=()=>{this._statsOpen=true;this._statsLeg="match";this._render();};
    const closeStats=()=>{this._statsOpen=false;this._render();};
    if(q("#closeStats"))q("#closeStats").onclick=closeStats;
    if(q("#backToGame"))q("#backToGame").onclick=closeStats;
    if(q("#dismissCelebration"))q("#dismissCelebration").onclick=()=>{if(this._state.phase!=="finished"){this._stopAudio();this._scheduleGameOn();}this._celebration=null;if(this._state.phase==="finished"){this._statsLeg="match";this._statsOpen=true;}this._render();};
    if(q("#celebrationUndo"))q("#celebrationUndo").onclick=()=>this._undo();
    if(q("#celebrationStats"))q("#celebrationStats").onclick=()=>{this._statsLeg=String(this._celebration.number);this._celebration=null;this._statsOpen=true;this._render();};
    (this._renderRoot||this.shadowRoot).querySelectorAll("[data-stats-leg]").forEach(b=>b.onclick=()=>{this._statsLeg=b.dataset.statsLeg;this._render();});
    (this._renderRoot||this.shadowRoot).onkeydown=e=>{if(!this._pendingDart&&!this._celebration&&!this._statsOpen)return;if(e.key==="Escape"){this._pendingDart=null;this._celebration=null;this._statsOpen=false;this._render();e.preventDefault();}if(e.key==="Tab"){const controls=[...q("[role=dialog]").querySelectorAll("button:not(:disabled)")];const first=controls[0],last=controls.at(-1);if(e.shiftKey&&((this._renderRoot||this.shadowRoot).activeElement===first||(this._renderRoot||this.shadowRoot).activeElement===q("[role=dialog]"))){last?.focus();e.preventDefault();}else if(!e.shiftKey&&(this._renderRoot||this.shadowRoot).activeElement===last){first?.focus();e.preventDefault();}}};
    (this._renderRoot||this.shadowRoot).querySelectorAll("[data-count]").forEach(b=>b.onclick=()=>{this._state.playerCount=+b.dataset.count;this._setup=null;this._persist();this._render();});
    (this._renderRoot||this.shadowRoot).querySelectorAll("[data-best]").forEach(b=>b.onclick=()=>{this._state.bestOf=+b.dataset.best;this._setup=null;this._persist();this._render();});
    (this._renderRoot||this.shadowRoot).querySelectorAll("[data-name]").forEach(i=>i.oninput=()=>{this._state.players[+i.dataset.name].name=i.value;this._persist();});
    if(q("#doubleOut")) q("#doubleOut").onchange=e=>{this._state.doubleOut=e.target.checked;this._persist();this._render();};
    if(q("#start")) q("#start").onclick=()=>this._startMatch();
    if(q("#resume"))q("#resume").onclick=()=>this._resumeSavedMatch();

    (this._renderRoot||this.shadowRoot).querySelectorAll("[data-mult]").forEach(b=>b.onclick=()=>{this._mult=+b.dataset.mult;this._render();});
    (this._renderRoot||this.shadowRoot).querySelectorAll("[data-num]").forEach(b=>b.onclick=()=>this._scoreDart(+b.dataset.num));
    (this._renderRoot||this.shadowRoot).querySelectorAll("[data-special]").forEach(b=>b.onclick=()=>{
      const v=b.dataset.special;
      if(v==="miss") this._scoreDart(0,0,"MISS");
      if(v==="25") this._scoreDart(25,25,"25");
      if(v==="bull") { const old=this._mult; this._mult=2; this._scoreDart(25,50,"BULL"); this._mult=1; }
    });
    if(q("#undo")) q("#undo").onclick=()=>this._undo();
    if(q("#redo")) q("#redo").onclick=()=>this._redo();
    if(q("#newMatch")) q("#newMatch").onclick=()=>{this._stopAudio();this._celebration=null;this._statsOpen=false;this._screen="home";this._state=this._freshState();this._setup=null;this._events=[];this._cursor=0;this._history=[];this._future=[];this._persist();this._render();};
    if(q("#quit")) q("#quit").onclick=()=>{
      if(this._quitArmed) {this._stopAudio();
        this._celebration=null;this._statsOpen=false;this._screen="home";this._state=this._freshState(); this._setup=null; this._events=[]; this._cursor=0; this._history=[]; this._future=[]; this._quitArmed=false; this._persist(); this._render();
      } else { this._quitArmed=true; this._render(); }
    };
  }

  _newId(){return typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
  async _loadDatabase(){
    if(!this._hass||this._dbLoading)return;this._dbLoading=true;
    try{
      this._db=await this._hass.callWS({type:'dart_assistant/get'});this._dbError='';
      const old=this._legacyPreferences(),names=this._db.legacy_imported?[]:(old.profiles||[]).filter(n=>n&&!/^Spieler [1-4]$/.test(n));
      for(let i=0;i<names.length;i+=4)this._db=await this._hass.callWS({type:'dart_assistant/mutate',action:'profiles',payload:{names:names.slice(i,i+4)}});
      if(this._db.settings.startScript===undefined&&old.startScript)this._db=await this._hass.callWS({type:'dart_assistant/mutate',action:'settings',payload:{patch:{startScript:old.startScript}}});
      if(!this._db.legacy_imported)this._db=await this._hass.callWS({type:'dart_assistant/mutate',action:'finish_import',payload:{}});
      localStorage.setItem(this._storageKey+'-preferences','{}');
      if(this._state.phase==='finished')this._queueRecord();
      this._flushOutbox();this._refreshAudio(false);
    }catch(e){this._dbError='Verbindung zur Datenspeicherung fehlt. Einstellungen und abgeschlossene Matches werden erst nach erfolgreicher Verbindung gespeichert.';}
    finally{this._dbLoading=false;this._render();}
  }
  _legacyPreferences(){try{return JSON.parse(localStorage.getItem(this._storageKey+'-preferences')||'{}');}catch{return {};}}
  _preferences(){const s=this._db?.settings||{};return {...s,profiles:(this._db?.profiles||[]).map(p=>p.name)};}
  async _mutate(action,payload){
    if(!this._db)throw Error('Die dauerhafte Datenspeicherung ist noch nicht verbunden.');
    this._db=await this._hass.callWS({type:'dart_assistant/mutate',action,payload});return this._db;
  }
  async _savePreferences(patch){
    delete patch.profiles;
    try{await this._mutate('settings',{patch});this._dbError='';}
    catch(e){this._dbError=e.message||'Einstellung konnte nicht gespeichert werden.';}
    this._render();
  }
  _entryScreen(){return this._screen==='home'||this._screen==='settings'||this._screen==='lifetime';}
  _toolbar(back=true){return `<div class="da-toolbar">${back?'<button id="daBack" class="da-icon" aria-label="Zur Startseite"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H4m7-7-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>':'<span></span>'}<div>${this._fullscreenButton()}<button id="daSettings" class="da-icon" aria-label="Globale Einstellungen">${this._icon('gear')}</button></div></div>`;}
  _homeHtml(){return `<ha-card><section class="da-home">${this._toolbar(false)}<div class="da-home-content"><div class="da-brand"><img class="da-logo" src="${this._esc(this._preferences().logo||'/dart_assistant_static/default-logo.png')}" alt="Dart Assistant"><div class="da-home-actions"><button id="daStart" class="da-primary">START</button><button id="daStats" class="da-secondary">STATISTIKEN</button>${this._state.phase!=='setup'||this._hasResumableMatch()?'<button id="daResume" class="da-tertiary">MATCH FORTSETZEN</button>':''}</div></div></div>${this._notice()}</section></ha-card>`;}
  _notice(){return this._dbError||this._noticeText?`<p class="da-notice" role="status">${this._esc(this._dbError||this._noticeText)}${this._dbError?'<button id="daReconnect">Erneut verbinden</button>':''}</p>`:'';}
  _settingsHtml(){
    const p=this._preferences(),scripts=Object.entries(this._hass?.states||{}).filter(([id])=>id.startsWith('script.')).sort((a,b)=>(a[1].attributes.friendly_name||a[0]).localeCompare(b[1].attributes.friendly_name||b[0]));
    return `<ha-card><section class="da-page">${this._toolbar()}<h1>Einstellungen</h1><div class="da-settings-grid"><section class="da-box"><h2>Darstellung</h2><img class="da-preview" src="${this._esc(p.logo||'/dart_assistant_static/default-logo.png')}" alt="Logo-Vorschau"><label class="da-upload">PNG-Logo auswählen<input id="daLogo" type="file" accept="image/png"></label><button id="daResetLogo" class="da-secondary">Standardlogo verwenden</button><p>Das PNG ersetzt das gesamte Logo. Es wird proportional und ohne Beschnitt angezeigt.</p></section>${this._audioSettingsHtml()}<section class="da-box"><h2>Home Assistant</h2><label for="daScript">Startaktion</label><select id="daScript"><option value="">Keine Startaktion</option>${scripts.map(([id,x])=>`<option value="${this._esc(id)}" ${p.startScript===id?'selected':''}>${this._esc(x.attributes.friendly_name||id)}</option>`).join('')}</select><p>Wird ausschließlich beim Tippen auf START einmal ausgelöst.</p></section><section class="da-box"><h2>Daten</h2><p>${this._db?'Dauerhaft in Home Assistant gespeichert.':'Datenspeicherung noch nicht verbunden.'}</p><p>${this._db?.profiles.length||0} Spieler · ${this._db?.matches.length||0} abgeschlossene Matches</p><button id="daManageStats" class="da-secondary">Spieler & Statistiken verwalten</button><p>Spieler- und Duell-Resets findest du im jeweiligen Statistikprofil.</p></section></div>${this._notice()}${this._confirmHtml()}</section></ha-card>`;
  }
  async _upload(file,kind){
    if(!file)return;this._noticeText='Datei wird gespeichert …';this._render();
    try{
      if(file.size>2*1024*1024)throw Error('Maximal 2 MB je Datei.');
      if(kind==='logo'&&!/\.png$/i.test(file.name))throw Error('Bitte PNG auswählen.');
      if(kind!=='logo'&&!/\.mp3$/i.test(file.name))throw Error('Bitte MP3 auswählen.');
      const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(Error('Datei konnte nicht gelesen werden.'));r.onload=()=>resolve(String(r.result).split(',')[1]);r.readAsDataURL(file);});
      if(!this._db)throw Error('Datenspeicherung noch nicht verbunden.');
      this._db=await this._hass.callWS({type:'dart_assistant/upload',kind,data});this._winAudio=null;this._noticeText='Gespeichert.';
    }catch(e){this._noticeText=e.message||'Datei konnte nicht gespeichert werden.';}
    this._render();
  }
  _showHome(){this._stopAudio();this._screen='home';this._confirm=null;this._noticeText='';this._render();}
  _startFromHome(){
    if(this._starting||this._screen!=='home')return;this._starting=true;
    if(this._state.phase==='game'&&!this._stashResumeMatch()){this._starting=false;this._render();return;}
    if(this._state.phase!=='setup'){this._state=this._freshState();this._setup=null;this._events=[];this._cursor=0;}
    for(const p of this._state.players)if(/^Spieler [1-4]$/.test(p.name))p.name='';
    // Switch screens synchronously: double-taps cannot call the script again.
    this._screen='setup';this._noticeText='';this._stopAudio();this._render();
    const id=this._preferences().startScript;
    if(id&&id.startsWith('script.')&&this._hass?.states[id])this._hass.callService('script','turn_on',{entity_id:id}).catch(()=>{this._noticeText='Startaktion konnte nicht ausgeführt werden.';this._render();});
    this._starting=false;
  }
  _outbox(){try{return JSON.parse(localStorage.getItem(this._storageKey+'-outbox')||'[]');}catch{return [];}}
  _queueRecord(){
    const s=this._state;if(!s.matchId)return;
    const out=this._outbox().filter(x=>x.id!==s.matchId);
    const seen=this._db?.matches.some(m=>m.id===s.matchId)||this._outbox().some(m=>m.id===s.matchId);
    if(s.phase!=='finished'&&!seen)return;
    let record={id:s.matchId,phase:s.phase};
    if(s.phase==='finished')record={...record,winner:s.winner,needed:this._neededLegs(),startScore:s.startScore,setsMode:s.setsMode,players:s.players.map((p,i)=>{
      const wins=s.legResults.filter(r=>r.winner===i),visits=s.visitRecords.filter(v=>v.player===i&&!v.bust);
      return {name:p.name,points:p.matchPoints,darts:p.matchDarts,legs:p.legs,sets:p.sets||0,
        hundreds:visits.filter(v=>v.total>=100&&v.total<140).length,oneforties:visits.filter(v=>v.total>=140&&v.total<180).length,oneeighties:visits.filter(v=>v.total===180).length,
        highestCheckout:Math.max(0,...wins.map(r=>r.total)),bestLeg:wins.length?Math.min(...wins.map(r=>r.players[i].thrown)):0};})};
    out.push(record);
    try{localStorage.setItem(this._storageKey+'-outbox',JSON.stringify(out));}catch{this._dbError='Das Match konnte nicht zwischengespeichert werden. Bitte nicht schließen.';}
    this._flushOutbox();
  }
  async _flushOutbox(){
    if(this._flushing||!this._db)return;this._flushing=true;
    try{
      while(this._outbox().length){
        const record=this._outbox()[0];await this._mutate('match_state',record);
        const latest=this._outbox();if(JSON.stringify(latest[0])===JSON.stringify(record))latest.shift();
        localStorage.setItem(this._storageKey+'-outbox',JSON.stringify(latest));
      }
      this._dbError='';
    }catch(e){this._dbError='Match noch nicht in Home Assistant gespeichert. Es bleibt auf diesem Gerät vorgemerkt. Bitte erneut verbinden.';}
    finally{this._flushing=false;this._render();}
  }
  _allStats(pid,matches){
    const rows=matches.filter(m=>m.players.some(p=>p.id===pid));const ps=rows.map(m=>m.players.find(p=>p.id===pid));
    const sum=k=>ps.reduce((a,p)=>a+(p[k]||0),0);const wins=rows.filter(m=>m.winner===pid).length;
    return {matches:rows.length,wins,losses:rows.length-wins,rate:rows.length?(100*wins/rows.length).toFixed(1):'0.0',avg:this._avg(sum('points'),sum('darts')),legs:sum('legs'),sets:sum('sets'),hundreds:sum('hundreds'),oneforties:sum('oneforties'),oneeighties:sum('oneeighties'),checkout:Math.max(0,...ps.map(p=>p.highestCheckout||0)),best:Math.min(...ps.filter(p=>p.bestLeg>0).map(p=>p.bestLeg),Infinity),rows};
  }
  _duelMatches(a,b){const key=[a,b].sort().join('|'),reset=this._db?.pair_resets[key]||'';return (this._db?.matches||[]).filter(m=>m.date>reset&&m.players.length===2&&m.players.some(p=>p.id===a)&&m.players.some(p=>p.id===b));}
  _statTiles(s){return `<div class="da-tiles">${[['Matches',s.matches],['Siege',s.wins],['Siegquote',s.rate+' %'],['3-Dart-Average',s.avg],['100–139',s.hundreds],['140–179',s.oneforties],['180er',s.oneeighties],['Höchstes Checkout',s.checkout||'—'],['Bestes Leg',s.best===Infinity?'—':s.best+' Darts'],['Gewonnene Legs',s.legs],['Gewonnene Sets',s.sets]].map(([k,v])=>`<div><small>${k}</small><b>${v}</b></div>`).join('')}</div>`;}
  _isPlaceholderName(name){return /^spieler\s*[1-4]$/i.test(String(name||'').trim());}
  _lifetimeHtml(){
    const profiles=(this._db?.profiles||[]).filter(p=>!this._isPlaceholderName(p.name));let p=profiles.find(p=>p.id===this._selectedProfile)||profiles[0];
    if(!p)return `<ha-card><section class="da-page">${this._toolbar()}<h1>Statistiken</h1><div class="da-empty">Noch keine Spieler gespeichert.<p>Starte dein erstes Match – nur vollständig abgeschlossene Matches zählen.</p></div>${this._notice()}</section></ha-card>`;
    this._selectedProfile=p.id;const all=this._allStats(p.id,this._db.matches),opponents=profiles.filter(x=>x.id!==p.id).map(o=>({...o,count:this._duelMatches(p.id,o.id).length})).sort((a,b)=>b.count-a.count),frequent=opponents[0];
    const opponent=opponents.find(o=>o.id===this._selectedOpponent)||frequent;this._selectedOpponent=opponent?.id;
    const duel=opponent?this._duelMatches(p.id,opponent.id):[],a=this._allStats(p.id,duel),b=opponent?this._allStats(opponent.id,duel):null;
    return `<ha-card><section class="da-page">${this._toolbar()}<h1>Statistiken</h1><div class="da-profile-tabs">${profiles.map(x=>`<button class="${p.id===x.id?'selected':''}" data-profile="${x.id}">${this._esc(x.name)}</button>`).join('')}</div><h2>${this._esc(p.name)} · All-Time</h2>${this._statTiles(all)}<section class="da-box da-frequent"><h2>Häufigster Gegner</h2>${frequent?.count?`<button data-opponent="${frequent.id}" class="da-secondary">${this._esc(frequent.name)} · ${frequent.count} gemeinsame Matches</button><p>${this._allStats(p.id,this._duelMatches(p.id,frequent.id)).wins} Siege · ${this._allStats(frequent.id,this._duelMatches(p.id,frequent.id)).wins} Niederlagen</p>`:'Noch keine direkten Duelle.'}</section><section class="da-box"><h2>Head-to-Head</h2>${opponents.length?`<select id="daOpponent" aria-label="Gegner auswählen">${opponents.map(o=>`<option value="${o.id}" ${o.id===opponent?.id?'selected':''}>${this._esc(o.name)}</option>`).join('')}</select><div class="da-duel"><div><h3>${this._esc(p.name)}</h3><b>${a.wins}</b><p>${a.legs} Legs · ${a.sets} Sets · Ø ${a.avg}</p><p>Checkout ${a.checkout||'—'} · Bestes Leg ${a.best===Infinity?'—':a.best}</p></div><span>:</span><div><h3>${this._esc(opponent.name)}</h3><b>${b.wins}</b><p>${b.legs} Legs · ${b.sets} Sets · Ø ${b.avg}</p><p>Checkout ${b.checkout||'—'} · Bestes Leg ${b.best===Infinity?'—':b.best}</p></div></div><h3>Letzte Begegnungen</h3>${this._historyHtml(duel)}<button id="daResetPair" class="da-danger">Dieses Duell zurücksetzen</button>`:'Noch kein weiterer Spieler vorhanden.'}</section><section class="da-box"><h2>Letzte Matches</h2>${this._historyHtml(all.rows)}</section><div class="da-danger-actions"><button id="daResetPlayer" class="da-danger">Nur Spielerstatistiken zurücksetzen</button><button id="daDeletePlayer" class="da-danger">Spieler vollständig löschen</button></div>${this._notice()}${this._confirmHtml()}</section></ha-card>`;
  }
  _historyHtml(rows){rows=rows.filter(m=>m.players.every(p=>!this._isPlaceholderName(p.name)));return rows.length?`<div class="da-history">${rows.slice().reverse().slice(0,10).map(m=>`<div><time>${new Date(m.date).toLocaleDateString('de-AT')}</time><span>${m.players.map(p=>this._esc(p.name)).join(' · ')}</span><b>${m.players.map(p=>m.setsMode?p.sets:p.legs).join(' : ')}</b><small>Sieger: ${this._esc(m.players.find(p=>p.id===m.winner)?.name||'—')}</small></div>`).join('')}</div>`:'<p>Noch keine abgeschlossenen Matches.</p>';}
  _confirmHtml(){const c=this._confirm;return c?`<div class="da-confirm" role="dialog" aria-modal="true" aria-label="Sicherheitsbestätigung"><section class="da-box"><h2>${this._esc(c.title)}</h2><p>${this._esc(c.text)}</p><div class="da-confirm-actions"><button id="daCancelConfirm" class="da-secondary">Abbrechen</button><button id="daConfirm" class="da-danger">${this._busy?'Wird gespeichert …':'Bestätigen'}</button></div></section></div>`:'';}
  _askReset(action){if(this._outbox().length){this._noticeText='Bitte zuerst die vorgemerkten Matches speichern und danach zurücksetzen.';this._render();return;}const p=this._db.profiles.find(p=>p.id===this._selectedProfile);this._confirm={action,title:action==='delete_player'?'Spieler vollständig löschen?':action==='reset_pair'?'Direktes Duell zurücksetzen?':'Spielerstatistiken zurücksetzen?',text:action==='reset_pair'?'Nur die direkte Bilanz und Begegnungsliste dieser Paarung werden zurückgesetzt. All-Time-Statistiken bleiben erhalten.':`Alle abgeschlossenen Matches mit ${p.name} werden aus den Statistiken entfernt. Die Werte der beteiligten Gegner werden entsprechend neu berechnet. ${action==='delete_player'?'Auch das Spielerprofil wird entfernt.':'Das Spielerprofil bleibt erhalten.'}`,payload:{player:p.id,opponent:this._selectedOpponent,confirm:action}};this._render();}
  _bindNext(){
    const q=s=>(this._renderRoot||this.shadowRoot).querySelector(s);
    if(q('#daStart'))q('#daStart').onclick=()=>this._startFromHome();
    if(q('#daStats'))q('#daStats').onclick=()=>{this._screen='lifetime';this._loadDatabase();this._render();};
    if(q('#daSettings'))q('#daSettings').onclick=()=>{this._screen='settings';this._loadDatabase();this._render();};
    if(q('#daBack'))q('#daBack').onclick=()=>this._showHome();
    if(q('#daResume'))q('#daResume').onclick=()=>this._resumeSavedMatch();
    if(q('#daManageStats'))q('#daManageStats').onclick=()=>{this._screen='lifetime';this._render();};
    if(q('#daReconnect'))q('#daReconnect').onclick=()=>this._loadDatabase();
    if(q('#daLogo'))q('#daLogo').onchange=e=>this._upload(e.target.files[0],'logo');
    if(q('#daResetLogo'))q('#daResetLogo').onclick=()=>this._savePreferences({logo:''});
    if(q('#daScript'))q('#daScript').onchange=e=>this._savePreferences({startScript:e.target.value});
    if(q('#daVolume'))q('#daVolume').onchange=e=>this._savePreferences({soundVolume:+e.target.value/100});
    if(q('#daCallerVolume'))q('#daCallerVolume').onchange=e=>this._savePreferences({callerVolume:+e.target.value/100});
    if(q('#daRefreshAudio'))q('#daRefreshAudio').onclick=()=>this._refreshAudio();
    if(q('#daStopAudio'))q('#daStopAudio').onclick=()=>{this._stopAudio();this._render();};
    (this._renderRoot||this.shadowRoot).querySelectorAll('[data-audio-setting]').forEach(e=>e.onchange=async()=>{this._stopAudio();await this._savePreferences({[e.dataset.audioSetting]:e.value});this._warmAudio();});
    (this._renderRoot||this.shadowRoot).querySelectorAll('[data-audio-preview]').forEach(e=>e.onclick=()=>this._previewAudio(e.dataset.audioPreview));
    if(q('#daAudioFolder'))q('#daAudioFolder').onchange=e=>{this._audioUploadFolder=e.target.value;this._render();};
    const audioPack=q('#daAudioPack');if(audioPack)audioPack.onchange=e=>this._uploadAudioFile(e.target.files[0],'import');
    if(q('#daAudioFile'))q('#daAudioFile').onchange=e=>this._uploadAudioFile(e.target.files[0],this._audioUploadFolder);
    (this._renderRoot||this.shadowRoot).querySelectorAll('[data-upload]').forEach(e=>e.onchange=()=>this._upload(e.files[0],e.dataset.upload));
    (this._renderRoot||this.shadowRoot).querySelectorAll('[data-reset-sound]').forEach(e=>e.onclick=()=>{this._winAudio=null;this._savePreferences({[e.dataset.resetSound]:''});});
    (this._renderRoot||this.shadowRoot).querySelectorAll('[data-profile]').forEach(e=>e.onclick=()=>{this._selectedProfile=e.dataset.profile;this._selectedOpponent=null;this._render();});
    (this._renderRoot||this.shadowRoot).querySelectorAll('[data-opponent]').forEach(e=>e.onclick=()=>{this._selectedOpponent=e.dataset.opponent;this._render();});
    if(q('#daOpponent'))q('#daOpponent').onchange=e=>{this._selectedOpponent=e.target.value;this._render();};
    for(const [id,a] of [['daResetPlayer','reset_player'],['daDeletePlayer','delete_player'],['daResetPair','reset_pair']])if(q('#'+id))q('#'+id).onclick=()=>this._askReset(a);
    if(q('#daCancelConfirm'))q('#daCancelConfirm').onclick=()=>{this._confirm=null;this._render();};
    if(q('#daConfirm'))q('#daConfirm').onclick=async()=>{if(this._busy)return;const c=this._confirm;this._busy=true;this._render();try{await this._mutate(c.action,c.payload);this._confirm=null;this._noticeText='Gespeichert.';}catch(e){this._noticeText=e.message||'Aktion fehlgeschlagen.';}finally{this._busy=false;this._render();}};
    const inputs=(this._renderRoot||this.shadowRoot).querySelectorAll('[data-name]');
    inputs.forEach(input=>{
      const show=()=>{const i=+input.dataset.name,menu=q('#profiles-'+i);if(!menu)return;const names=this._preferences().profiles.filter(n=>n.toLocaleLowerCase().includes(input.value.trim().toLocaleLowerCase()));menu.innerHTML=names.map(n=>`<button type="button" data-name-choice="${this._esc(n)}">${this._esc(n)}</button>`).join('');menu.hidden=!names.length;menu.querySelectorAll('button').forEach(b=>{b.onpointerdown=e=>e.preventDefault();b.onclick=()=>{input.value=b.dataset.nameChoice;this._state.players[i].name=input.value;menu.hidden=true;this._persist();};});};
      input.onfocus=show;input.oninput=()=>{this._state.players[+input.dataset.name].name=input.value;this._persist();show();};input.onblur=()=>{const menu=q('#profiles-'+input.dataset.name);if(menu)setTimeout(()=>{if(menu.isConnected)menu.hidden=true;},150);};
    });
  }

  _esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  }

  _css() {
    return `
    :host{display:block;container-type:inline-size;font-family:Inter,"Segoe UI",system-ui,sans-serif;line-height:1.18;color:#f7f8fb}*{box-sizing:border-box}ha-card{background:#050a0f;border:0;box-shadow:none;border-radius:0;color:inherit}button,input{font:inherit}button{color:inherit;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}button:focus-visible,input:focus-visible{outline:3px solid #69d9ff;outline-offset:3px}button:disabled{opacity:.3;cursor:default}button:active:not(:disabled){transform:scale(.97)}svg{display:block;width:36px;height:36px;flex-shrink:0}.app{display:grid;grid-template-columns:46% minmax(0,1fr);gap:14px;padding:12px;min-height:650px;background:radial-gradient(ellipse at 70% 0,#0c1821 0,transparent 65%),#050a0f}.panel{border:1px solid #2a3743;border-radius:24px;background:radial-gradient(ellipse at 50% 0,#111c27 0,transparent 65%),linear-gradient(145deg,#0b1118,#080e14);box-shadow:inset 0 1px 0 #ffffff04,0 12px 35px #0005;min-width:0}.pad{padding:18px;display:grid;grid-template-rows:58px 88px 1fr 98px;gap:14px}.pad-header{display:flex;align-items:center;gap:18px;min-width:0}.brand{display:flex;align-items:center;gap:12px;padding-right:18px;border-right:1px solid #415160}.brand svg{color:#9ac5f0;width:38px;height:38px}.brand b{font-size:30px;display:block;line-height:1}.brand small,.match-label small{display:block;color:#b3c3d5;font-size:11px;letter-spacing:.035em;margin-top:5px}.match-label{display:flex;align-items:center;gap:12px;min-width:0}.match-label svg{color:#99c5f0;width:30px;height:30px}.match-label b{font-size:16px;white-space:nowrap;font-weight:650}.settings{margin-left:auto;border:0;background:transparent;padding:8px;color:#afc3dc}.settings svg{width:28px;height:28px}.settings.armed{font-size:11px;max-width:100px;color:#ffb7ca;border:1px solid #ff397a;border-radius:10px}.mults{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.mults button{border:1px solid #3b4a5b;background:linear-gradient(145deg,#1d2a37,#151e29);border-radius:19px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;font-size:15px;font-weight:650;box-shadow:inset 0 1px 0 #ffffff04}.mults svg{color:#b7cde9;width:30px;height:30px}.mults button.on{border-color:#2ac8ff;background:linear-gradient(155deg,#213e76,#132440);box-shadow:inset 0 0 18px #1dcaff45,0 0 20px #129bff12}.mults button.on svg{color:white;filter:drop-shadow(0 0 3px #19b9ff)}.numbers{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));grid-template-rows:repeat(4,1fr);gap:10px}.numbers button{min-height:66px;border:1px solid #3b4753;border-radius:15px;background:linear-gradient(145deg,#151e27,#0d141c);box-shadow:inset 0 1px 0 #ffffff03;font-size:clamp(27px,3cqw,42px);font-weight:400}.special{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.special>button{border-radius:16px;border:1px solid #55616e;background:linear-gradient(145deg,#273340,#18222e);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}.special b{font-size:19px;font-weight:650}.special small{font-size:10px;letter-spacing:.03em;color:#b9c4d2}.special svg{width:29px;height:29px;margin-bottom:4px}.special .miss{border-color:#e74559;background:linear-gradient(145deg,#3c1a24,#24131b);box-shadow:inset 0 0 20px #fd234215}.miss svg{color:#ff4968}.special .bull25{border-color:#ba8b28;background:linear-gradient(145deg,#3b301c,#251e14)}.bull25 svg{color:#ffcc54}.special .bull50{border-color:#e92877;background:linear-gradient(145deg,#40172a,#28121e)}.bull50 svg{color:#fa337e}.history-stack{display:grid;grid-template-rows:1fr 1fr;gap:6px}.history-stack button{display:flex;align-items:center;justify-content:center;gap:6px;background:linear-gradient(145deg,#2b3440,#1b242e);border:1px solid #5b6879;border-radius:12px;font-size:12px;font-weight:650}.history-stack svg{color:#afbed0;width:22px;height:22px}.history-stack small{font-size:10px;color:#a5b4c6}.board{padding:18px;display:flex;flex-direction:column;gap:12px}.board header{display:flex;justify-content:space-between;align-items:center;min-height:54px}.leg-label{display:flex;align-items:center;gap:12px}.leg-label svg{color:#36baf7}.leg-label b{font-size:18px;font-weight:650}.board header .match-label svg{color:#f9ce4c}.hero{display:grid;grid-template-columns:42px minmax(0,1.35fr) minmax(0,1fr);gap:12px;align-items:center;flex:1;min-height:240px}.won-legs{text-align:center;align-self:center}.won-legs>b{font-size:38px;color:#35bdfd;display:block;line-height:1}.won-legs small{display:block;font-size:9px;color:#b8c7d9;margin-top:8px}.score-ring{position:relative;width:100%;max-width:230px;aspect-ratio:1;margin:auto}.score-ring>svg{width:100%;height:100%;overflow:visible}.score-ring circle{fill:none;stroke-width:5.2}.score-ring .track{stroke:#36424f}.score-ring .progress{stroke-linecap:round}.ring-text{position:absolute;inset:15%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;min-width:0}.ring-text b{font-size:clamp(52px,6.8cqw,104px);font-weight:650;line-height:1;letter-spacing:-.055em;text-shadow:0 3px 8px #0008}.ring-text span{display:block;max-width:100%;font-size:clamp(20px,2.25cqw,34px);font-weight:350;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#d5dfeb}.stats-column{display:flex;flex-direction:column;justify-content:center;gap:18px;min-width:0}.stats-column>div{padding-left:15px;border-left:1px solid #40505f}.stats-column small{display:block;color:#afc0d4;font-size:10px;letter-spacing:.025em;margin-top:6px}.average>b{font-size:26px;font-weight:650;white-space:nowrap}.average>b>span{color:#aebdd1;font-weight:350}.secondary-stats{display:flex;flex-wrap:wrap;gap:5px 12px;font-size:10px;color:#91a6bd;margin-top:8px}.last-visit>b{font-size:16px;line-height:1.4;font-weight:450;overflow-wrap:anywhere}.last-visit em{display:block;color:#ffc55a;font-size:10px;font-style:normal;margin-top:5px}.checkout>b{display:block;font-size:14px;line-height:1.4;margin-top:6px;overflow-wrap:anywhere}.visit-strip{display:grid;grid-template-columns:minmax(0,1fr) 88px;align-items:center;gap:16px;padding:10px 14px;border:1px solid #145788;border-radius:22px;background:radial-gradient(ellipse at 30% 0,#10294288,transparent 75%),linear-gradient(135deg,#0b1722,#081017);box-shadow:inset 0 0 20px #12b5ff09;min-height:86px}.dart-chips{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}.dart-chip{border:1px solid #334557;border-radius:19px;background:linear-gradient(150deg,#14212d,#0a141c);text-align:center;padding:10px 5px;min-width:0}.dart-chip>b{display:block;font-size:21px;font-weight:450}.dart-chip small{display:block;color:#a9bdd3;font-size:13px;margin-top:6px}.dart-chip.filled{box-shadow:inset 0 0 17px #30beef0a}.visit-total{border-left:1px solid #536171;text-align:center;padding-left:12px}.visit-total small{font-size:10px;color:#b5c5d7;display:block}.visit-total b{font-size:29px;line-height:1.15;display:block;margin-top:4px}.players{display:grid;grid-template-columns:repeat(var(--players),minmax(0,1fr));gap:10px;min-width:0}.players:empty{display:none}.player{border:1px solid color-mix(in srgb,var(--accent) 24%,#162332);border-radius:21px;padding:9px 10px;background:radial-gradient(ellipse at 50% 0,var(--tint),transparent 80%),#080f16;min-width:0;max-width:260px}.score-ring.mini{max-width:110px}.mini .ring-text{gap:4px;inset:14%}.mini .ring-text b{font-size:clamp(27px,3cqw,43px);font-weight:450;letter-spacing:-.05em}.mini .ring-text span{font-size:clamp(12px,1.3cqw,20px);font-weight:400;color:#fff}.mini circle{stroke-width:5.5}.player-bottom{display:flex;align-items:flex-end;justify-content:space-between;gap:8px;margin-top:7px}.leg-summary{text-align:center;min-width:0}.leg-dots{display:flex;gap:3px;margin-bottom:7px}.leg-dots i{width:9px;height:9px;background:#35404e;border-radius:50%}.leg-dots i.won{background:var(--accent);box-shadow:0 0 7px color-mix(in srgb,var(--accent) 30%,transparent)}.leg-summary>b{font-size:17px;display:block}.player-bottom small{font-size:8px;display:block;color:#afbdce;margin-top:3px;white-space:nowrap}.player-average{text-align:right}.player-average b{font-size:15px;font-weight:450;white-space:nowrap}.winner{display:flex;align-items:center;gap:10px;border:1px solid #497c59;background:#123225;border-radius:15px;padding:10px;font-size:14px}.winner svg{color:#ffd451;width:26px;height:26px}.winner button{margin-left:auto;background:#174538;border:1px solid #6ecdaa;border-radius:10px;padding:9px;font-size:11px}.save-error{color:#ffc1c1;padding:8px}.setup{padding:32px;max-width:850px;margin:auto;min-height:430px;background:radial-gradient(ellipse at top,#162b3d,#091018 70%);border:1px solid #293b4e;border-radius:24px}.eyebrow{color:#43c9ff;font-size:12px;letter-spacing:.16em;font-weight:650}.setup h1{font-size:40px;margin:7px 0 28px}.setup-grid{display:grid;grid-template-columns:1fr 1fr;gap:30px}.setup label{display:block;color:#b7c8db;font-size:13px;margin-bottom:10px}.seg{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.seg.best{grid-template-columns:repeat(5,1fr)}.seg button{min-height:50px;background:linear-gradient(145deg,#223344,#101d2a);border:1px solid #3a5065;border-radius:12px;font-weight:650}.seg button.on{background:linear-gradient(145deg,#245a87,#132e4a);border-color:#42ccff;box-shadow:inset 0 0 17px #21caff25}.names{display:grid;gap:9px;margin-top:12px}.names input{width:100%;min-height:50px;padding:0 14px;color:#f6f9ff;background:#101d29;border:1px solid #344b61;border-radius:12px;font-size:17px}.hint{color:#a9bdd3;font-size:14px;margin:14px 0}.start{width:100%;min-height:60px;margin-top:25px;background:linear-gradient(135deg,#157abd,#24bcdc);border:1px solid #55cfff;border-radius:15px;font-size:17px;font-weight:700;box-shadow:0 0 22px #1bafff20}
    @container (min-width:1400px){.app{gap:18px;min-height:860px;padding:14px}.pad{padding:22px;grid-template-rows:76px 120px 1fr 136px;gap:20px}.pad-header{gap:26px}.brand b{font-size:38px}.brand svg{width:48px;height:48px}.brand small,.match-label small{font-size:15px}.match-label b{font-size:22px}.settings svg{width:34px;height:34px}.mults button{font-size:21px;gap:15px}.mults svg{width:40px;height:40px}.numbers{gap:13px}.numbers button{font-size:46px}.special b{font-size:25px}.special small{font-size:14px}.special svg{width:39px;height:39px}.history-stack button{font-size:15px}.board{padding:22px;gap:16px}.hero{grid-template-columns:65px minmax(0,1.45fr) minmax(0,1fr);gap:18px;min-height:300px}.score-ring{max-width:330px}.won-legs>b{font-size:54px}.won-legs small{font-size:13px}.stats-column{gap:32px}.average>b{font-size:38px}.stats-column small{font-size:14px}.last-visit>b{font-size:24px}.checkout>b{font-size:20px}.secondary-stats{font-size:13px}.visit-strip{min-height:120px;grid-template-columns:minmax(0,1fr) 115px}.dart-chip{padding:15px 8px}.dart-chip>b{font-size:29px}.dart-chip small{font-size:18px}.visit-total small{font-size:14px}.visit-total b{font-size:42px}.score-ring.mini{max-width:160px}.player{padding:12px 18px}.player-average b{font-size:21px}.player-bottom small{font-size:11px}.leg-dots i{width:14px;height:14px}.leg-summary>b{font-size:24px}}
    @container (min-width:800px) and (max-width:1050px){.app{grid-template-columns:44% minmax(0,1fr);gap:10px;padding:8px}.pad{padding:12px;gap:10px;grid-template-rows:58px 80px 1fr 92px}.brand{padding-right:10px;gap:7px}.brand b{font-size:26px}.brand svg{width:28px;height:28px}.match-label{gap:6px}.match-label b{font-size:12px}.match-label small{font-size:8px}.pad-header{gap:10px}.pad-header .match-label svg{display:none}.settings{padding:4px}.settings svg{width:23px;height:23px}.mults{gap:8px}.mults button{font-size:12px}.numbers{gap:8px}.special{gap:6px}.special b{font-size:15px}.special small{font-size:8px}.history-stack button{gap:3px;font-size:10px}.history-stack svg{width:16px;height:16px}.board{padding:13px;gap:10px}.hero{grid-template-columns:32px minmax(0,1.25fr) minmax(0,1fr);gap:8px}.won-legs>b{font-size:28px}.won-legs small{font-size:7px}.stats-column{gap:16px}.stats-column>div{padding-left:9px}.average>b{font-size:23px}.stats-column small{font-size:8px}.last-visit>b,.checkout>b{font-size:12px}.secondary-stats{font-size:8px}.visit-strip{padding:8px;gap:8px;grid-template-columns:minmax(0,1fr) 68px}.dart-chip>b{font-size:18px}.visit-total b{font-size:25px}.player{padding:8px 7px}.player-average b{font-size:12px}.player-bottom{gap:3px}.leg-dots i{width:7px;height:7px}.mini .ring-text span{font-size:11px}}
    @container (max-width:799px){.app{grid-template-columns:1fr;padding:8px}.pad{grid-template-rows:58px 80px 320px 96px}.hero{min-height:240px}.numbers button{font-size:32px}.board{min-height:550px}.setup{padding:24px}.setup-grid{grid-template-columns:1fr;gap:22px}.pad-header .match-label svg{display:none}.mini .ring-text b{font-size:30px}.mini .ring-text span{font-size:14px}}

    ha-card{position:relative}.board{position:relative}.winner{position:absolute;top:65px;left:18px;right:18px;z-index:2;padding:7px 10px;font-size:11px;background:#123225ed}.winner svg{width:20px;height:20px}.winner button{padding:6px;font-size:10px}.current-player{border-color:var(--accent);box-shadow:inset 0 0 18px var(--tint),0 0 12px var(--tint)}.board header{gap:10px}.stats-button{display:flex;align-items:center;gap:6px;margin-left:auto;padding:8px 10px;min-height:40px;border:1px solid #34536b;border-radius:11px;background:#102333;color:#b2e8ff;font-size:16px;font-weight:650}.stats-button span{font-size:9px;letter-spacing:.045em}.dart-count{flex-basis:100%;color:#c1dce9}.mini-darts{display:flex;justify-content:center;gap:5px;font-size:9px;color:#c8ddec;margin-top:7px}.mini-darts span{color:#819db5}.players{flex-shrink:0}.mini-darts{min-height:14px;font-size:11px;align-items:center}.mini-darts b{font-size:13px;color:#e2f6ff}.hero{min-height:220px}.score-ring.mini{max-width:100px}.overlay{position:absolute;inset:0;z-index:20;display:grid;place-items:center;padding:20px;background:#030812dd;backdrop-filter:blur(9px);border-radius:24px}.modal{width:min(850px,100%);max-height:calc(100dvh -110px);overflow:auto;border:1px solid #345f7d;border-radius:25px;padding:28px;background:radial-gradient(ellipse at top,#173747,#0a1521 70%);box-shadow:0 18px 85px #000a;color:#f5f9ff;outline:0}.modal-heading{display:flex;justify-content:space-between;align-items:center;gap:15px}.modal-heading small{font-size:11px;color:#83bed7;letter-spacing:.1em}.modal h2{font-size:30px;margin:8px 0 20px}.modal-close{width:44px;height:44px;border:1px solid #3c5b72;border-radius:12px;color:#c4dbea;background:#102437;font-size:28px}.average-tabs{display:flex;gap:8px;flex-wrap:wrap;max-height:100px;overflow:auto;margin:0 0 18px}.average-tabs button{border:1px solid #2b4d65;background:#0b2030;border-radius:11px;padding:10px 14px;min-height:44px;font-size:13px}.average-tabs button.selected{border-color:#39ceff;background:#17405b;color:#e5faff}.stats-table-wrap{width:100%;overflow:auto}.stats-table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;min-width:550px;text-align:right}.stats-table th,.stats-table td{padding:13px 10px;border-bottom:1px solid #2c455a;font-size:14px;white-space:nowrap}.stats-table thead th{font-size:10px;color:#9ab4c9;letter-spacing:.035em}.stats-table th:first-child{text-align:left;white-space:normal;overflow-wrap:anywhere;max-width:150px}.stats-table tbody th{font-weight:550}.stats-table tr.leg-winner{background:#173d3d80}.won-tag{font-size:8px;color:#93f3c7;display:inline-block;margin-left:5px}.stats-note{font-size:11px;line-height:1.6;color:#8ca9bf;margin:18px 0}.result-caption{font-size:14px;color:#b7e6fa;margin:0 0 15px}.modal-primary{background:linear-gradient(135deg,#197eb9,#20b9cf)!important;border:1px solid #48ccff!important;color:white;padding:12px 18px;min-height:48px;border-radius:12px;font-weight:650;font-size:12px}.modal-actions{display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:22px}.modal-actions button{border:1px solid #355d77;border-radius:12px;background:#102435;padding:12px 16px;min-height:48px;font-size:11px;font-weight:600}.celebration-modal{position:relative;text-align:center;overflow:auto}.winner-trophy{position:relative;display:grid;place-items:center;margin:0 auto 15px;width:78px;height:78px;border-radius:50%;background:radial-gradient(#f3c64b30,transparent 70%);color:#ffda69}.winner-trophy svg{width:65px;height:65px;filter:drop-shadow(0 0 15px #ffd23a60)}.winner-kicker{position:relative;color:#73dffc;letter-spacing:.18em;font-size:12px;font-weight:600}.celebration-modal h2{position:relative;font-size:clamp(32px,4cqw,58px);margin:9px 0 12px;overflow-wrap:anywhere}.winner-checkout{position:relative;font-size:19px;color:#d6f4ff;margin:0 0 18px}.winner-checkout span{font-size:13px;color:#9fbacd}.winner-metrics{position:relative;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}.winner-metrics>div{background:#102838;border:1px solid #294f65;border-radius:14px;padding:12px}.winner-metrics small{font-size:9px;display:block;color:#94bbcf}.winner-metrics b{font-size:27px;display:block;margin-top:6px}.winner-metrics b span{font-size:12px;font-weight:400}.celebration-rays{position:absolute;inset:0;pointer-events:none;overflow:hidden}.celebration-rays i{position:absolute;top:20%;left:50%;width:5px;height:12px;border-radius:3px;background:#41d2ff;transform:rotate(calc(var(--i)*30deg)) translateY(-125px);opacity:.4}.celebration-rays i:nth-child(3n){background:#ffcb54}.celebration-rays i:nth-child(3n+1){background:#fa5ab1}
    @container (min-width:1400px){.hero{min-height:280px}.score-ring.mini{max-width:145px}.mini-darts{font-size:12px;min-height:14px}.stats-button{font-size:22px;padding:10px 14px}.stats-button span{font-size:12px}.modal{width:min(1000px,100%)}.stats-table th,.stats-table td{font-size:17px}.stats-table thead th{font-size:12px}}
    @container (max-width:1050px){.stats-button{padding:6px;font-size:14px}.stats-button span{display:none}.board header{gap:6px}.mini-darts{font-size:8px}.mini-darts span{display:none}.modal{padding:18px}.stats-table th,.stats-table td{padding:10px 8px}.winner-metrics{gap:6px}.winner-metrics b{font-size:22px}}
    @media(prefers-reduced-motion:no-preference){.modal{animation:modal-in .28s ease-out}.winner-trophy{animation:trophy-in .65s cubic-bezier(.18,.8,.25,1.2)}.celebration-rays i{animation:celebrate-particle 1.8s ease-out infinite both;animation-delay:calc(var(--i)*.07s)}@keyframes modal-in{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}@keyframes trophy-in{from{opacity:0;transform:scale(.45) rotate(-18deg)}to{opacity:1;transform:none}}@keyframes celebrate-particle{from{opacity:0;transform:rotate(calc(var(--i)*30deg)) translateY(-40px)}30%{opacity:.8}to{opacity:0;transform:rotate(calc(var(--i)*30deg)) translateY(-180px)}}}

    .hero .ring-text b,.hero .ring-text span{color:var(--accent)}.hero .score-ring .track{stroke:color-mix(in srgb,var(--accent) 38%,#152332)}.setup-title{display:flex;align-items:center;justify-content:space-between}.setup .two{grid-template-columns:1fr 1fr}.setup .field{margin-top:16px}.setup input[type=number],.setup select{display:block;width:100%;box-sizing:border-box;min-height:46px;background:#101d29;color:#f6f9ff;border:1px solid #344b61;border-radius:10px;padding:8px 12px;font-size:16px;margin-top:8px}.setup .toggle{display:flex;align-items:center;gap:10px;margin-top:17px;min-height:30px}.toggle input{width:22px;height:22px;accent-color:#2cc5ff}.wide{grid-column:1/-1}.fullscreen-button{min-width:38px;flex-shrink:0}.fullscreen-button span{font-size:29px;line-height:1}.pad-header{gap:10px}.pad-header .brand{padding-right:8px}.pad-header .match-label{flex:1}.setup .seg button{font-size:14px}.leg-dots{flex-wrap:wrap;max-width:130px}
    .da-home,.da-page{position:relative;min-height:100dvh;background:radial-gradient(ellipse at 50% 25%,#112a3a 0,#070e16 55%,#050a0f 100%);color:#f4f8fd}.da-home{display:flex;flex-direction:column;padding:20px 26px}.da-toolbar{display:flex;align-items:center;justify-content:space-between;min-height:54px;gap:12px;flex-shrink:0}.da-toolbar>div{display:flex;align-items:center;gap:8px}.da-icon,.da-toolbar .settings{display:inline-flex;align-items:center;justify-content:center;background:#10202d;border:1px solid #33495b;color:#c5dcec;border-radius:13px;width:50px;min-height:50px;padding:9px;font-size:27px;margin:0}.da-icon svg{width:27px;height:27px}.da-home-content{display:flex;flex:1;justify-content:center;align-items:center;padding:12px 0 36px}.da-brand{width:min(100%,940px,99dvh);display:flex;flex-direction:column;align-items:center;gap:20px}.da-logo{display:block;width:100%;height:auto;max-height:66dvh;object-fit:contain;filter:drop-shadow(0 10px 40px #0005)}.da-home-actions{width:50%;display:flex;flex-direction:column;gap:14px;align-items:stretch}.da-primary,.da-secondary,.da-tertiary,.da-danger{border-radius:14px;min-height:52px;padding:12px 20px;font-weight:650;border:1px solid #385c76;background:#122738;color:#e8f4fc;font-size:15px}.da-primary{min-height:64px;background:linear-gradient(135deg,#0577b9,#12b5ed);border-color:#49cbfb;box-shadow:0 8px 28px #008cce20;font-size:22px;letter-spacing:.1em}.da-home-actions .da-secondary{font-size:15px;letter-spacing:.08em}.da-tertiary{background:transparent;border:0;font-size:12px;color:#8cb5ce}.da-page{padding:20px clamp(18px,4vw,72px) 50px}.da-page>h1{font-size:34px;font-weight:600;margin:28px 0}.da-settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.da-box{background:#0c1925;border:1px solid #294153;border-radius:22px;padding:24px;min-width:0}.da-box h2{font-size:20px;margin:0 0 20px;font-weight:600}.da-box p{font-size:13px;line-height:1.6;color:#a9bfd0}.da-box label{display:block;color:#b6cedf;font-size:14px;margin-top:20px}.da-box select,.da-page select{width:100%;min-height:50px;background:#101f2e;color:#f0f7ff;border:1px solid #35536b;border-radius:12px;padding:10px;font:inherit}.da-box input[type=range]{display:block;width:100%;margin-top:16px;accent-color:#18b9f1}.da-upload{display:block!important;position:relative;border:1px dashed #47799a;background:#10293a;padding:16px;border-radius:13px;margin:14px 0!important;cursor:pointer}.da-upload input{display:block;width:100%;margin-top:12px;font:inherit;color:#c4d9e8}.da-preview{width:100%;max-height:260px;object-fit:contain;background:repeating-conic-gradient(#102231 0% 25%,#152a3a 0% 50%) 50%/24px 24px;border-radius:14px}.da-audio-choice{display:flex;gap:8px;align-items:center;margin:8px 0}.da-audio-choice select{min-width:0;flex:1}.da-audio-choice button{min-width:50px;flex-shrink:0}.da-sound-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:#9cbdce}.da-sound-row button{font-size:12px;min-height:44px;padding:9px}.da-notice{padding:12px 18px;background:#172b38;color:#c0d9e9;border:1px solid #36576e;border-radius:12px;font-size:12px;line-height:1.6;max-width:900px;margin:16px auto}.da-notice button{margin-left:12px;border:1px solid #497d9e;background:#15394e;border-radius:8px;padding:8px;color:#ecfaff}.da-profile-tabs{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:26px}.da-profile-tabs button{min-height:48px;border:1px solid #34546c;background:#102332;border-radius:12px;padding:10px 18px}.da-profile-tabs .selected{border-color:#27bdf5;background:#174464}.da-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px;margin:20px 0}.da-tiles>div{background:#0e2130;border:1px solid #2b4a61;border-radius:16px;padding:18px}.da-tiles small{font-size:11px;color:#a0bdcf;display:block}.da-tiles b{display:block;font-size:30px;margin-top:10px;color:#d4f1ff}.da-page>.da-box{margin-top:20px}.da-duel{display:grid;grid-template-columns:1fr auto 1fr;gap:20px;align-items:center;text-align:center;padding:24px 0}.da-duel b{font-size:48px;color:#29bff5}.da-duel h3{font-size:19px}.da-duel>span{font-size:32px;color:#758ea0}.da-history>div{display:grid;grid-template-columns:110px 1fr auto;gap:8px 16px;border-bottom:1px solid #2a4052;padding:16px 0;font-size:13px}.da-history small{grid-column:2/-1;color:#8fb0c7}.da-history time{color:#9bb2c6}.da-danger-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:25px}.da-danger{color:#ffd5df;border-color:#8d4357;background:#3b1b29}.da-confirm{position:fixed;inset:0;display:grid;place-items:center;background:#02070ddc;backdrop-filter:blur(8px);z-index:10001;padding:20px}.da-confirm>.da-box{width:min(560px,100%)}.da-confirm-actions{display:flex;justify-content:flex-end;gap:12px;margin-top:22px}.da-name-field{position:relative}.da-name-menu{position:absolute;left:0;right:0;top:100%;max-height:220px;overflow:auto;z-index:30;border:1px solid #3c6989;border-radius:10px;background:#0d2333;box-shadow:0 12px 24px #0008}.da-name-menu[hidden]{display:none}.da-name-menu button{display:block;width:100%;min-height:48px;text-align:left;border:0;border-bottom:1px solid #29465d;background:transparent;color:#e9f8ff;padding:12px 16px}.setup-title>div:last-child{display:flex;gap:6px;align-items:center}.setup-title .settings{margin:0}.da-empty{padding:36px;background:#0d1b28;border:1px solid #29465e;border-radius:20px}.da-empty p{color:#94b2c8;font-size:14px}.pad-header{gap:7px}.pad-header .settings{margin-left:0}.pad-header .match-label{min-width:0}.pad-header .match-label b{white-space:normal}.hero .ring-text b,.hero .ring-text span{color:var(--accent)}
    @media(max-width:700px){.da-home{padding:12px}.da-brand{gap:18px}.da-home-content{padding-top:25px}.da-brand{width:min(100%,82.5dvh)}.da-logo{max-height:55dvh}.da-home-actions{gap:10px}.da-primary{font-size:17px;min-height:56px;padding:12px 4px}.da-home-actions .da-secondary{font-size:11px;padding:12px 4px}.da-settings-grid{grid-template-columns:1fr}.da-page{padding:14px}.da-box{padding:18px}.da-tiles{grid-template-columns:repeat(2,1fr)}.da-duel{gap:9px}.da-history>div{grid-template-columns:1fr auto}.da-history time{grid-column:1/-1}.da-history small{grid-column:1/-1}.da-duel p{font-size:11px}}
    @media(orientation:landscape) and (max-height:700px){.da-home{padding:10px 20px}.da-logo{max-height:58dvh}.da-brand{width:min(78vw,700px,87dvh);gap:8px}.da-home-actions{gap:8px}.da-home-actions button{min-height:45px;font-size:14px}.da-home-content{padding:0 0 8px}}


    .players[data-count="2"]{grid-template-columns:repeat(2,minmax(0,1fr));align-items:stretch;gap:16px}.players[data-count="2"]>.player{max-width:none;width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;align-items:stretch}.players[data-count="2"] .score-ring.mini{margin-inline:auto;flex-shrink:0}.players[data-count="2"] .player-bottom{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:center;gap:12px;margin-top:auto;padding-top:10px;min-height:56px}.players[data-count="2"] .leg-summary,.players[data-count="2"] .player-average{text-align:center}.players[data-count="2"] .leg-dots{margin-inline:auto;justify-content:center}.players[data-count="2"] .mini-darts{min-height:20px;margin-top:10px}

    .hero{grid-template-columns:42px minmax(0,1.55fr) minmax(0,1fr)}.hero>.score-ring{max-width:245px}.settings:not(.armed){display:inline-flex;align-items:center;justify-content:center;width:44px;min-width:44px;height:44px;padding:7px;box-sizing:border-box;font-size:29px;line-height:1}.settings:not(.armed) svg,.da-icon svg{width:29px;height:29px}.fullscreen-button span,.da-icon{font-size:29px;line-height:1}.da-toolbar .settings:not(.armed),.setup-title .settings:not(.armed){width:50px;height:50px;min-height:50px}.da-icon{box-sizing:border-box}.pad-header #quit:not(.armed){font-size:29px}
    @container(min-width:1400px){.hero{grid-template-columns:65px minmax(0,1.65fr) minmax(0,1fr);min-height:350px}.hero>.score-ring{max-width:345px}.players[data-count="2"] .score-ring.mini{max-width:115px}}
    @container(max-width:1050px){.hero{grid-template-columns:32px minmax(0,1.45fr) minmax(0,1fr)}}
    .setup-title .da-icon,.setup-title .fullscreen-button{display:inline-flex;align-items:center;justify-content:center;width:50px;min-width:50px;height:50px;min-height:50px;padding:0;margin:0;border:1px solid #33495b;border-radius:13px;background:#10202d;box-sizing:border-box}.da-icon>svg{display:block;width:27px;height:27px;flex-shrink:0}.setup-title .fullscreen-button>span{display:block;line-height:1}
    .celebration-rays{opacity:0;transition:opacity .8s ease-out}.celebration-rays.is-running{opacity:1}.celebration-rays.is-fading{opacity:0}.celebration-rays[hidden]{display:none}.celebration-rays i{opacity:0}
    @media(prefers-reduced-motion:reduce){.celebration-rays{display:none}}
    @media(prefers-reduced-motion:no-preference){button{transition:background .12s,border-color .12s,box-shadow .12s,transform .1s}}
    `;
  }
}

if (!customElements.get("dart-score-card")) customElements.define("dart-score-card", DartScoreCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "dart-score-card",
  name: "Dart Score Card",
  description: "501 darts scorer for Home Assistant"
});


