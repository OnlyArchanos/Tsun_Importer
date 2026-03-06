// ═══════════════════════════════════════════════════════════════════
//  Tsun Importer — content.js  v4.0
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  /* ── Constants ──────────────────────────────────────────────── */
  const ATSU_TRACKER_MAP_URL = 'https://atsu.moe/tracker-map.json';
  const ATSU_SEARCH_PATH     = '/collections/manga/documents/search';
  const ATSU_PAGE_PATH       = '/api/manga/page';
  const ATSU_BOOKMARKS_PATH  = '/api/user/syncBookmarks';
  const ATSU_CHAPTERS_PATH   = '/api/manga/allChapters';
  const ATSU_PROGRESS_PATH   = '/api/read/syncProgress';
  const LS_RESUME_KEY        = 'tsunImporter_resumeState';
  const LS_RESOLVED_KEY      = 'tsunImporter_phase2Resolved';
  const LS_PREFS_KEY         = 'tsunImporter_prefs';
  const TRACKER_MAP_TTL_MS   = 30 * 60 * 1000;
  const SEARCH_CONCURRENCY   = 6;
  const SEARCH_DELAY_MS      = 80;
  const BOOKMARK_CHUNK       = 10;
  const BOOKMARK_DELAY_MS    = 350;
  const STATUS_MAP = {
    'Reading':'Reading','Completed':'Completed','Dropped':'Dropped',
    'Plan to Read':'PlanToRead','Planned':'PlanToRead',
    'On-Hold':'OnHold','Paused':'OnHold',
    'Re-Reading':'ReReading','Rereading':'ReReading',
  };

  /* ── Prefs (persisted) ──────────────────────────────────────── */
  let prefs = { dark: true, sound: true, skipOwned: true };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(LS_PREFS_KEY)||'{}')); } catch {}
  function savePrefs(){ try{localStorage.setItem(LS_PREFS_KEY,JSON.stringify(prefs));}catch{} }

  /* ── State ──────────────────────────────────────────────────── */
  let importQueue=[],importIndex=0,isPaused=false,isRunning=false,isCancelled=false;
  let failedEntries=[],pendingEntries=[],currentFormat=null;
  let trackerArr=null,trackerByMal={},trackerByMu={},trackerFetchedAt=0;
  let ownedCache={};
  const cStats={ exact:0, found:0, owned:0, dup:0, fail:0 };

  /* ══════════════════════════════════════════════════════════════
     SOUND ENGINE — Web Audio API, zero deps
  ══════════════════════════════════════════════════════════════ */
  let _actx=null;
  function actx(){ if(!_actx) _actx=new(window.AudioContext||window.webkitAudioContext)(); return _actx; }

  function playTick(){
    if(!prefs.sound) return;
    try{
      const c=actx(), o=c.createOscillator(), g=c.createGain();
      o.connect(g); g.connect(c.destination);
      o.type='sine'; o.frequency.value=1200;
      g.gain.setValueAtTime(0.04,c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.07);
      o.start(); o.stop(c.currentTime+0.07);
    }catch{}
  }
  function playSuccess(){
    if(!prefs.sound) return;
    try{
      const c=actx();
      [523.25,659.25,783.99,1046.5].forEach((f,i)=>{
        const o=c.createOscillator(),g=c.createGain();
        o.type='sine'; o.connect(g); g.connect(c.destination);
        o.frequency.value=f;
        const t=c.currentTime+i*0.11;
        g.gain.setValueAtTime(0,t);
        g.gain.linearRampToValueAtTime(0.13,t+0.02);
        g.gain.exponentialRampToValueAtTime(0.0001,t+0.32);
        o.start(t); o.stop(t+0.32);
      });
    }catch{}
  }
  function playError(){
    if(!prefs.sound) return;
    try{
      const c=actx(), o=c.createOscillator(), g=c.createGain();
      o.type='sawtooth'; o.connect(g); g.connect(c.destination);
      o.frequency.setValueAtTime(260,c.currentTime);
      o.frequency.exponentialRampToValueAtTime(120,c.currentTime+0.22);
      g.gain.setValueAtTime(0.09,c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+0.24);
      o.start(); o.stop(c.currentTime+0.24);
    }catch{}
  }
  function playPause(){
    if(!prefs.sound) return;
    try{
      const c=actx();
      [440,370].forEach((f,i)=>{
        const o=c.createOscillator(),g=c.createGain();
        o.type='sine'; o.connect(g); g.connect(c.destination);
        o.frequency.value=f;
        const t=c.currentTime+i*0.09;
        g.gain.setValueAtTime(0.07,t);
        g.gain.exponentialRampToValueAtTime(0.0001,t+0.15);
        o.start(t); o.stop(t+0.15);
      });
    }catch{}
  }

  /* ── Styles ─────────────────────────────────────────────────── */
  const style = document.createElement('style');
  style.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

/* ── Keyframes ── */
@keyframes t-in    {from{opacity:0;transform:translateY(20px) scale(.96)}to{opacity:1;transform:none}}
@keyframes t-up    {from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes t-pop   {0%{opacity:0;transform:scale(.86)}58%{transform:scale(1.05)}100%{opacity:1;transform:none}}
@keyframes t-shim  {0%{transform:translateX(-120%)}100%{transform:translateX(420%)}}
@keyframes t-pulse {0%,100%{opacity:1}50%{opacity:.25}}
@keyframes t-spin  {to{transform:rotate(360deg)}}
@keyframes t-glow  {0%,100%{box-shadow:0 0 0 0 rgba(99,102,241,0)}50%{box-shadow:0 0 20px 4px rgba(99,102,241,.22)}}
@keyframes t-row   {from{opacity:0;transform:translateX(-7px)}to{opacity:1;transform:none}}
@keyframes t-dot   {0%,100%{transform:scale(1)}50%{transform:scale(1.65)}}
@keyframes t-toast {0%{opacity:0;transform:translate(-50%,6px) scale(.96)}12%{opacity:1;transform:translate(-50%,0) scale(1)}82%{opacity:1}100%{opacity:0;transform:translate(-50%,-5px)}}
@keyframes t-num   {from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
@keyframes t-flip  {0%{transform:scaleY(1)}48%{transform:scaleY(0)}100%{transform:scaleY(1)}}
@keyframes t-cf    {0%{transform:translateY(0) rotate(0deg);opacity:1}100%{transform:translateY(-55px) rotate(400deg);opacity:0}}
@keyframes t-theme {0%{opacity:0;transform:scale(.8) rotate(-20deg)}100%{opacity:1;transform:none}}

/* ═══════════════════════════════════════════════════════
   THEME VARIABLES — all colours reference these
═══════════════════════════════════════════════════════ */
#tsun-panel{
  --bg:      rgba(10,10,16,.92);
  --bg2:     rgba(255,255,255,.026);
  --bg3:     rgba(255,255,255,.016);
  --border:  rgba(255,255,255,.09);
  --border2: rgba(255,255,255,.055);
  --text:    #e2e2ee;
  --text2:   #50506c;
  --text3:   #30303e;
  --card:    rgba(255,255,255,.028);
  --acc:     #6366f1;
  --acc2:    rgba(99,102,241,.12);
  --acc3:    rgba(99,102,241,.22);
  --green:   #4ade80;
  --blue:    #60a5fa;
  --yellow:  #facc15;
  --red:     #f87171;
  --owned:   #a78bfa;
  --dup:     #fb923c;
  --shadow:  0 40px 90px rgba(0,0,0,.8),0 10px 32px rgba(0,0,0,.55);
  --inset:   inset 0 1px 0 rgba(255,255,255,.07);
  --mono:    'JetBrains Mono',ui-monospace,monospace;
}
#tsun-panel.t-light{
  --bg:      rgba(252,252,253,.96);
  --bg2:     rgba(0,0,0,.028);
  --bg3:     rgba(0,0,0,.018);
  --border:  rgba(0,0,0,.1);
  --border2: rgba(0,0,0,.06);
  --text:    #1c1c2e;
  --text2:   #6b6b88;
  --text3:   #a0a0bc;
  --card:    rgba(0,0,0,.025);
  --acc:     #4f46e5;
  --acc2:    rgba(79,70,229,.1);
  --acc3:    rgba(79,70,229,.2);
  --shadow:  0 20px 60px rgba(0,0,0,.18),0 6px 20px rgba(0,0,0,.1);
  --inset:   inset 0 1px 0 rgba(255,255,255,.6);
}

/* ── Panel shell ── */
#tsun-panel{
  position:fixed!important;
  bottom:24px!important;right:24px!important;
  min-width:280px!important;min-height:120px!important;max-width:820px!important;max-height:96vh!important;
  background:var(--bg)!important;
  backdrop-filter:blur(40px) saturate(180%)!important;
  -webkit-backdrop-filter:blur(40px) saturate(180%)!important;
  border:1px solid var(--border)!important;
  border-radius:14px!important;
  box-shadow:var(--shadow),var(--inset)!important;
  font-family:'Inter',system-ui,sans-serif!important;
  font-feature-settings:'cv02','cv03','cv04','cv11'!important;
  color:var(--text)!important;
  z-index:2147483647!important;
  overflow:hidden!important;
  animation:t-in .4s cubic-bezier(.34,1.1,.64,1) both!important;
  user-select:none!important;
  display:flex!important;flex-direction:column!important;
  transition:box-shadow .25s,background .3s,border-color .3s!important;
}
#tsun-panel::before{
  content:''!important;position:absolute!important;inset:0!important;border-radius:14px!important;
  background:linear-gradient(148deg,rgba(255,255,255,.05) 0%,transparent 28%)!important;
  pointer-events:none!important;z-index:0!important;
}
#tsun-panel.t-light::before{background:linear-gradient(148deg,rgba(255,255,255,.7) 0%,transparent 28%)!important}
#tsun-panel.t-drag{box-shadow:0 60px 120px rgba(0,0,0,.88),0 16px 48px rgba(0,0,0,.6)!important;transition:none!important}

/* ── Resize handles ── */
.t-rz{position:absolute!important;z-index:20!important}
.t-rz-se{bottom:0!important;right:0!important;width:18px!important;height:18px!important;cursor:se-resize!important;
  background:radial-gradient(circle,rgba(255,255,255,.22) 1.2px,transparent 1.2px) 3px 3px/4px 4px,
             radial-gradient(circle,rgba(255,255,255,.22) 1.2px,transparent 1.2px) 7px 7px/4px 4px,
             radial-gradient(circle,rgba(255,255,255,.22) 1.2px,transparent 1.2px) 11px 11px/4px 4px!important}
#tsun-panel.t-light .t-rz-se{background:radial-gradient(circle,rgba(0,0,0,.18) 1.2px,transparent 1.2px) 3px 3px/4px 4px,radial-gradient(circle,rgba(0,0,0,.18) 1.2px,transparent 1.2px) 7px 7px/4px 4px,radial-gradient(circle,rgba(0,0,0,.18) 1.2px,transparent 1.2px) 11px 11px/4px 4px!important}
.t-rz-e {top:18px!important;right:0!important;width:5px!important;bottom:18px!important;cursor:e-resize!important}
.t-rz-s {left:18px!important;bottom:0!important;height:5px!important;right:18px!important;cursor:s-resize!important}
.t-rz-w {top:18px!important;left:0!important;width:5px!important;bottom:18px!important;cursor:w-resize!important}
.t-rz-n {left:18px!important;top:0!important;height:5px!important;right:18px!important;cursor:n-resize!important}
.t-rz-ne{top:0!important;right:0!important;width:18px!important;height:18px!important;cursor:ne-resize!important}
.t-rz-sw{bottom:0!important;left:0!important;width:18px!important;height:18px!important;cursor:sw-resize!important}
.t-rz-nw{top:0!important;left:0!important;width:18px!important;height:18px!important;cursor:nw-resize!important}

/* ── Header ── */
#tsun-header{
  display:flex!important;align-items:center!important;justify-content:space-between!important;
  padding:10px 13px!important;
  background:var(--bg2)!important;
  border-bottom:1px solid var(--border)!important;
  cursor:grab!important;position:relative!important;z-index:2!important;flex-shrink:0!important;
  transition:background .3s!important;
}
#tsun-header:hover{background:var(--bg3)!important}
#tsun-header:active{cursor:grabbing!important}
#tsun-hl{display:flex!important;align-items:center!important;gap:8px!important}
#tsun-dot{
  width:7px!important;height:7px!important;border-radius:50%!important;flex-shrink:0!important;
  background:var(--text3)!important;transition:background .35s,box-shadow .35s!important;
}
#tsun-dot.running{background:var(--green)!important;box-shadow:0 0 8px var(--green)!important;animation:t-dot 1.5s ease-in-out infinite!important}
#tsun-dot.paused {background:var(--yellow)!important;box-shadow:0 0 6px var(--yellow)!important}
#tsun-dot.done   {background:var(--blue)!important;  box-shadow:0 0 8px var(--blue)!important}
#tsun-dot.error  {background:var(--red)!important;   box-shadow:0 0 8px var(--red)!important}
#tsun-title{
  font-size:11.5px!important;font-weight:600!important;letter-spacing:.06em!important;
  text-transform:uppercase!important;color:var(--text)!important;opacity:.7!important;
}
#tsun-badge{
  font-family:var(--mono)!important;font-size:9px!important;padding:2px 6px!important;
  border-radius:4px!important;display:none!important;font-weight:500!important;
  letter-spacing:.05em!important;text-transform:uppercase!important;
}
#tsun-badge.csv{background:rgba(74,222,128,.12)!important;color:var(--green)!important;display:inline-block!important;border:1px solid rgba(74,222,128,.24)!important}
#tsun-badge.txt{background:rgba(96,165,250,.12)!important;color:var(--blue)!important;display:inline-block!important;border:1px solid rgba(96,165,250,.24)!important}
#tsun-badge.xml{background:rgba(167,139,250,.12)!important;color:var(--owned)!important;display:inline-block!important;border:1px solid rgba(167,139,250,.24)!important}

/* Mini stats (when collapsed) */
#tsun-mini{display:none!important;align-items:center!important;gap:8px!important;font-family:var(--mono)!important;font-size:10px!important}
#tsun-mini.show{display:flex!important}
.t-ms{color:var(--text3)!important;transition:color .3s!important}
.t-ms.lit{color:var(--green)!important}

/* Header right controls */
#tsun-hctrls{display:flex!important;align-items:center!important;gap:8px!important}

/* Icon buttons (theme + sound) */
.t-icon-btn{
  background:none!important;border:none!important;cursor:pointer!important;
  padding:3px!important;border-radius:5px!important;
  color:var(--text3)!important;font-size:13px!important;line-height:1!important;
  transition:color .2s,background .2s,transform .15s!important;
  display:flex!important;align-items:center!important;justify-content:center!important;
}
.t-icon-btn:hover{color:var(--text2)!important;background:var(--bg2)!important;transform:scale(1.1)!important}
.t-icon-btn.active{color:var(--acc)!important;animation:t-theme .2s both!important}

#tsun-wc{display:flex!important;align-items:center!important;gap:5px!important}
.t-wc{
  width:11px!important;height:11px!important;border-radius:50%!important;border:none!important;
  cursor:pointer!important;padding:0!important;
  transition:filter .15s,transform .12s,box-shadow .15s!important;flex-shrink:0!important;
}
.t-wc:hover{filter:brightness(1.4)!important;transform:scale(1.2)!important}
.t-wc:active{transform:scale(.88)!important}
#tsun-min-btn {background:#f9c84a!important}
#tsun-close-btn{background:#ff5f57!important}

/* ── Body ── */
#tsun-body{
  padding:12px 13px 12px!important;position:relative!important;z-index:1!important;
  overflow-y:auto!important;flex:1!important;display:flex!important;flex-direction:column!important;
}
#tsun-body::-webkit-scrollbar{width:3px!important}
#tsun-body::-webkit-scrollbar-thumb{background:var(--border2)!important;border-radius:2px!important}

/* ── Dropzone — full state ── */
#tsun-dz{
  border:1.5px dashed var(--border)!important;border-radius:10px!important;
  padding:20px 16px!important;text-align:center!important;cursor:pointer!important;
  background:var(--bg3)!important;
  transition:border-color .2s,background .2s,transform .16s,box-shadow .2s,padding .25s,margin .25s!important;
  margin-bottom:10px!important;position:relative!important;overflow:hidden!important;
}
#tsun-dz:hover{
  border-color:var(--acc)!important;background:var(--acc2)!important;
  transform:translateY(-1px)!important;box-shadow:0 4px 20px rgba(99,102,241,.12)!important;
}
#tsun-dz.drag-over{
  border-color:var(--acc)!important;background:var(--acc2)!important;
  transform:scale(1.014)!important;animation:t-glow 1s ease-in-out infinite!important;
}
#tsun-dz.locked{cursor:not-allowed!important;opacity:.25!important;pointer-events:none!important}

/* ── Dropzone — compact state (after file loaded) ── */
#tsun-dz.compact{
  padding:7px 11px!important;border-style:solid!important;
  display:flex!important;align-items:center!important;gap:8px!important;
  text-align:left!important;margin-bottom:8px!important;
  border-color:var(--border2)!important;background:var(--card)!important;
  transform:none!important;box-shadow:none!important;
}
#tsun-dz.compact:hover{border-color:var(--acc)!important;background:var(--acc2)!important;transform:none!important}
#tsun-dz.compact #tsun-dz-ico{font-size:14px!important;margin-bottom:0!important;flex-shrink:0!important}
#tsun-dz.compact #tsun-dz-main{display:none!important}
#tsun-dz-cname{display:none!important;flex:1!important;font-size:11px!important;font-family:var(--mono)!important;color:var(--text)!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;}
#tsun-dz.compact #tsun-dz-cname{display:block!important}
#tsun-dz-chg{display:none!important;font-size:9px!important;color:var(--text3)!important;font-family:var(--mono)!important;flex-shrink:0!important;white-space:nowrap!important;}
#tsun-dz.compact #tsun-dz-chg{display:block!important}

#tsun-dz-ico{font-size:20px!important;display:block!important;margin-bottom:5px!important;transition:transform .2s!important}
#tsun-dz:not(.compact):hover #tsun-dz-ico{transform:scale(1.1) translateY(-2px)!important}
#tsun-dz.drag-over #tsun-dz-ico{transform:scale(1.2)!important;animation:t-flip .35s ease!important}
#tsun-dz-txt{font-size:12px!important;color:var(--text2)!important;line-height:1.6!important}
#tsun-dz-txt strong{color:var(--text)!important;font-weight:600!important;display:block!important;margin-bottom:2px!important;font-size:13px!important}
#tsun-dz-hint{font-size:10px!important;color:var(--text3)!important;margin-top:4px!important;font-family:var(--mono)!important}
#tsun-fi-inp{display:none!important}

/* ── Cards & labels ── */
.t-card{
  background:var(--card)!important;border:1px solid var(--border2)!important;
  border-radius:9px!important;padding:9px 11px!important;margin-bottom:9px!important;
  transition:border-color .2s!important;
}
.t-lbl{
  font-size:9.5px!important;letter-spacing:.08em!important;text-transform:uppercase!important;
  color:var(--text3)!important;font-weight:600!important;margin-bottom:6px!important;display:block!important;
}
#tsun-perr{
  display:none!important;background:rgba(248,113,113,.08)!important;
  border:1px solid rgba(248,113,113,.2)!important;border-radius:9px!important;
  padding:8px 11px!important;margin-bottom:9px!important;
  font-size:11px!important;color:var(--red)!important;font-family:var(--mono)!important;
}
#tsun-perr.show{display:block!important;animation:t-up .2s both!important}
#tsun-fi{display:none!important}

/* ── Status filter ── */
#tsun-sf{display:none!important;margin-bottom:9px!important}
#tsun-sf.show{display:block!important;animation:t-up .22s both!important}
#tsun-sfb{display:flex!important;flex-wrap:wrap!important;gap:5px!important}
.t-scb{
  display:flex!important;align-items:center!important;gap:5px!important;
  background:var(--bg3)!important;border:1px solid var(--border2)!important;
  border-radius:6px!important;padding:5px 9px!important;cursor:pointer!important;
  font-size:11px!important;color:var(--text2)!important;
  transition:border-color .15s,background .15s,color .15s,transform .1s!important;
}
.t-scb:hover{transform:translateY(-1px)!important}
.t-scb input{display:none!important}
.t-scb.on{border-color:var(--acc3)!important;background:var(--acc2)!important;color:var(--text)!important}
.t-scb-dot{width:6px!important;height:6px!important;border-radius:50%!important;flex-shrink:0!important;transition:transform .15s!important}
.t-scb.on .t-scb-dot{transform:scale(1.35)!important}
.t-scb-cnt{font-family:var(--mono)!important;font-size:9px!important;color:var(--text3)!important}

/* ── Summary ── */
#tsun-sum{display:none!important;margin-bottom:9px!important}
#tsun-sum.show{display:block!important;animation:t-up .2s both!important}
#tsun-sum-row{display:flex!important;justify-content:space-between!important;align-items:center!important;font-size:11.5px!important;color:var(--text2)!important;font-family:var(--mono)!important;}
#tsun-sum-n{font-size:22px!important;font-weight:700!important;color:var(--text)!important;letter-spacing:-.02em!important}
#tsun-sum-n.bump{animation:t-pop .2s both!important}

/* ── Preview ── */
#tsun-pv{display:none!important;margin-bottom:9px!important}
#tsun-pv.show{display:block!important;animation:t-up .22s both!important}
#tsun-pv-hdr{display:flex!important;justify-content:space-between!important;align-items:center!important;margin-bottom:6px!important}
#tsun-pv-tog{
  background:none!important;border:none!important;color:var(--text3)!important;cursor:pointer!important;
  font-family:var(--mono)!important;font-size:9px!important;padding:2px 6px!important;
  border-radius:4px!important;transition:color .15s,background .15s!important;
}
#tsun-pv-tog:hover{color:var(--text2)!important;background:var(--bg2)!important}
#tsun-pv-vp{
  background:rgba(0,0,0,.15)!important;border:1px solid var(--border2)!important;
  border-radius:8px!important;height:155px!important;overflow-y:auto!important;position:relative!important;
}
#tsun-panel.t-light #tsun-pv-vp{background:rgba(0,0,0,.04)!important}
#tsun-pv-vp::-webkit-scrollbar{width:3px!important}
#tsun-pv-vp::-webkit-scrollbar-thumb{background:var(--border2)!important;border-radius:2px!important}
.t-pr{
  display:flex!important;align-items:center!important;padding:0 10px!important;gap:6px!important;
  border-bottom:1px solid var(--border2)!important;font-size:10px!important;font-family:var(--mono)!important;
  transition:background .12s!important;
}
.t-pr:hover{background:var(--bg2)!important}
.t-pt{flex:1!important;color:var(--text2)!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
.t-ps{color:var(--text3)!important;flex-shrink:0!important;font-size:9px!important}
.t-pc{color:var(--text3)!important;flex-shrink:0!important;font-size:9px!important}

/* ── Progress ── */
#tsun-prog{display:none!important;margin-bottom:9px!important}
#tsun-prog.show{display:block!important;animation:t-up .22s both!important}
#tsun-phase{
  font-size:9.5px!important;letter-spacing:.08em!important;text-transform:uppercase!important;
  font-weight:600!important;margin-bottom:8px!important;min-height:14px!important;
  display:flex!important;align-items:center!important;gap:7px!important;color:var(--text2)!important;
}
#tsun-phase::before{content:''!important;width:5px!important;height:5px!important;border-radius:50%!important;flex-shrink:0!important;background:currentColor!important;opacity:.65!important;}
#tsun-phase.ph-res{color:var(--owned)!important}
#tsun-phase.ph-imp{color:var(--acc)!important}
#tsun-phase.ph-ch {color:var(--blue)!important}
#tsun-phase.ph-rl {color:var(--yellow)!important;animation:t-pulse .9s ease-in-out infinite!important}
#tsun-bw{
  background:var(--bg2)!important;border-radius:6px!important;height:4px!important;
  overflow:hidden!important;margin-bottom:7px!important;
  box-shadow:inset 0 1px 2px rgba(0,0,0,.25)!important;
}
#tsun-bar{
  height:100%!important;border-radius:6px!important;width:0%!important;
  background:linear-gradient(90deg,var(--acc),#818cf8)!important;
  transition:width .35s cubic-bezier(.4,0,.2,1)!important;
  position:relative!important;overflow:hidden!important;
}
#tsun-bar.b-res{background:linear-gradient(90deg,var(--owned),#c084fc)!important}
#tsun-bar.b-ch {background:linear-gradient(90deg,var(--blue),#38bdf8)!important}
#tsun-bar::after{content:''!important;position:absolute!important;inset:0!important;background:linear-gradient(90deg,transparent,rgba(255,255,255,.3),transparent)!important;animation:t-shim 1.6s linear infinite!important;}
#tsun-pr-row{display:flex!important;justify-content:space-between!important;font-family:var(--mono)!important;font-size:10px!important;color:var(--text3)!important;}
#tsun-cur-t{
  font-size:10px!important;color:var(--text3)!important;margin-top:5px!important;
  white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;
  font-family:var(--mono)!important;display:block!important;
}
#tsun-spd{font-size:9px!important;color:var(--text3)!important;font-family:var(--mono)!important;margin-top:3px!important;transition:color .4s!important;display:block!important;min-height:13px!important}
#tsun-spd.on{color:var(--green)!important}

/* ── Conf / stats ── */
#tsun-conf{display:none!important;margin-bottom:9px!important}
#tsun-conf.show{display:block!important;animation:t-up .2s both!important}
#tsun-conf .t-card{padding:7px 11px!important;margin-bottom:0!important}
#tsun-panel .t-cr{
  display:flex!important;flex-direction:row!important;justify-content:space-between!important;
  align-items:center!important;padding:4px 0!important;gap:8px!important;
  font-family:var(--mono)!important;font-size:10px!important;color:var(--text2)!important;
}
#tsun-panel .t-cr+.t-cr{border-top:1px solid var(--border2)!important}
#tsun-panel .t-cl{flex:1!important;white-space:nowrap!important;display:flex!important;align-items:center!important;gap:5px!important}
#tsun-panel .t-cl::before{content:''!important;width:5px!important;height:5px!important;border-radius:50%!important;flex-shrink:0!important;background:currentColor!important;opacity:.55!important}
#tsun-panel .t-cv{
  font-weight:700!important;min-width:30px!important;text-align:right!important;flex-shrink:0!important;
  font-size:13px!important;font-family:'Inter',sans-serif!important;letter-spacing:-.02em!important;
}
#tsun-panel .t-cv.bump{animation:t-num .18s both!important}
.c-ex{color:var(--green)!important}
.c-fo{color:var(--blue)!important}
.c-ow{color:var(--owned)!important}
.c-du{color:var(--dup)!important}
.c-fa{color:var(--red)!important}

/* ── Skip-owned toggle inside conf ── */
#tsun-so-row{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:5px 0 2px!important;margin-top:2px!important;border-top:1px solid var(--border2)!important}
#tsun-so-lbl{font-size:10px!important;color:var(--text2)!important;font-family:var(--mono)!important;cursor:pointer!important}
#tsun-so-tog{
  width:28px!important;height:16px!important;border-radius:8px!important;border:none!important;
  cursor:pointer!important;position:relative!important;flex-shrink:0!important;
  background:var(--border)!important;transition:background .2s!important;
}
#tsun-so-tog::after{
  content:''!important;position:absolute!important;top:2px!important;left:2px!important;
  width:12px!important;height:12px!important;border-radius:50%!important;
  background:#fff!important;transition:transform .2s!important;
}
#tsun-so-tog.on{background:var(--acc)!important}
#tsun-so-tog.on::after{transform:translateX(12px)!important}

/* ── Done ── */
#tsun-done{display:none!important;text-align:center!important;padding:10px 0 6px!important;margin-bottom:9px!important;position:relative!important}
#tsun-done.show{display:block!important;animation:t-pop .34s cubic-bezier(.34,1.4,.64,1) both!important}
#tsun-done-em{font-size:26px!important;display:block!important;margin-bottom:5px!important}
#tsun-done-ti{font-size:15px!important;font-weight:700!important;margin-bottom:4px!important;letter-spacing:-.02em!important}
#tsun-done-su{font-size:10px!important;color:var(--text2)!important;font-family:var(--mono)!important;line-height:1.7!important}
.t-cf{position:absolute!important;pointer-events:none!important;border-radius:50%!important;animation:t-cf .85s ease-out both!important}

/* ── Failed list ── */
#tsun-fails{display:none!important;margin-bottom:9px!important}
#tsun-fails.show{display:block!important;animation:t-up .22s both!important}
#tsun-fhdr{display:flex!important;justify-content:space-between!important;align-items:center!important;margin-bottom:6px!important;cursor:pointer!important}
#tsun-fhdr:hover .t-lbl{color:var(--text2)!important}
#tsun-ftog{background:none!important;border:none!important;color:var(--text3)!important;cursor:pointer!important;font-size:12px!important;padding:2px 5px!important;border-radius:4px!important;transition:color .15s,background .15s!important;}
#tsun-ftog:hover{color:var(--text2)!important;background:var(--bg2)!important}
#tsun-flist{max-height:175px!important;overflow-y:auto!important;background:rgba(0,0,0,.12)!important;border:1px solid var(--border2)!important;border-radius:8px!important;}
#tsun-panel.t-light #tsun-flist{background:rgba(0,0,0,.03)!important}
#tsun-flist::-webkit-scrollbar{width:3px!important}
#tsun-flist::-webkit-scrollbar-thumb{background:var(--border2)!important;border-radius:2px!important}
.t-fr{display:flex!important;align-items:center!important;gap:8px!important;padding:7px 11px!important;border-bottom:1px solid var(--border2)!important;transition:background .12s!important;animation:t-row .2s both!important;}
.t-fr:last-child{border-bottom:none!important}
.t-fr:hover{background:var(--bg2)!important}
.t-fr.ok{background:rgba(74,222,128,.05)!important}
.t-fi{flex:1!important;overflow:hidden!important;min-width:0!important}
.t-ft{font-size:11px!important;color:var(--text)!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;font-family:var(--mono)!important;display:block!important;opacity:.8!important}
.t-frsn{font-size:9px!important;color:var(--text3)!important;font-family:var(--mono)!important;display:block!important;margin-top:1px!important}
.t-r1{
  flex-shrink:0!important;background:none!important;border:1px solid var(--border)!important;
  border-radius:5px!important;color:var(--text3)!important;cursor:pointer!important;padding:3px 8px!important;
  font-size:10px!important;font-family:'Inter',sans-serif!important;font-weight:600!important;
  transition:border-color .15s,color .15s,background .15s,transform .1s!important;
}
.t-r1:hover{border-color:rgba(248,113,113,.4)!important;color:var(--red)!important;background:rgba(248,113,113,.07)!important;transform:scale(1.05)!important}
.t-r1:disabled{opacity:.2!important;cursor:not-allowed!important}
.t-fst{flex-shrink:0!important;font-size:12px!important;width:16px!important;text-align:center!important}
.spin{display:inline-block!important;animation:t-spin .6s linear infinite!important}

/* ── Keyboard hint ── */
#tsun-kbh{
  font-size:9px!important;color:var(--text3)!important;font-family:var(--mono)!important;
  text-align:center!important;padding:4px 0 0!important;transition:color .3s!important;
}
#tsun-kbh.lit{color:var(--text2)!important}

/* ── Toast ── */
#tsun-toast{
  position:absolute!important;bottom:68px!important;left:50%!important;
  transform:translate(-50%,0)!important;
  background:var(--bg)!important;border:1px solid var(--border)!important;
  border-radius:8px!important;padding:7px 14px!important;
  font-size:11px!important;font-family:var(--mono)!important;color:var(--text)!important;
  white-space:nowrap!important;pointer-events:none!important;z-index:30!important;
  opacity:0!important;box-shadow:0 4px 20px rgba(0,0,0,.3)!important;
}
#tsun-toast.show{animation:t-toast 2.8s ease forwards!important}
#tsun-toast.t-ok {border-color:rgba(74,222,128,.35)!important;color:var(--green)!important}
#tsun-toast.t-err{border-color:rgba(248,113,113,.35)!important;color:var(--red)!important}
#tsun-toast.t-inf{border-color:var(--acc3)!important;color:var(--acc)!important}

/* ── Buttons ── */
#tsun-btns{margin-top:auto!important;padding-top:8px!important;flex-shrink:0!important}
#tsun-bp{display:flex!important;gap:6px!important;margin-bottom:6px!important}
#tsun-bs{display:flex!important;gap:5px!important;flex-wrap:wrap!important}
.tb{
  flex:1!important;border:none!important;border-radius:8px!important;padding:9px 10px!important;
  font-family:'Inter',sans-serif!important;font-size:11px!important;font-weight:600!important;
  letter-spacing:.01em!important;cursor:pointer!important;white-space:nowrap!important;
  position:relative!important;overflow:hidden!important;
  transition:filter .15s,transform .11s,box-shadow .18s,opacity .15s!important;
}
.tb::after{content:''!important;position:absolute!important;inset:0!important;background:rgba(255,255,255,.08)!important;opacity:0!important;transition:opacity .13s!important;border-radius:8px!important;}
.tb:hover:not(:disabled)::after{opacity:.5!important}
.tb:active:not(:disabled){transform:scale(.95)!important}
.tb:active:not(:disabled)::after{opacity:1!important}
.tb:disabled{opacity:.17!important;cursor:not-allowed!important;transform:none!important}
#tsun-start{
  background:linear-gradient(135deg,var(--acc),#4f46e5)!important;color:#fff!important;
  box-shadow:0 2px 16px rgba(99,102,241,.38)!important;
}
#tsun-start:hover:not(:disabled){filter:brightness(1.1)!important;box-shadow:0 4px 24px rgba(99,102,241,.56)!important}
#tsun-pause{display:none!important;background:var(--bg2)!important;border:1px solid var(--border)!important;color:var(--text)!important;opacity:.8!important}
#tsun-pause.show{display:block!important;animation:t-up .16s both!important}
#tsun-pause:hover:not(:disabled){background:var(--bg3)!important;opacity:1!important}
#tsun-cancel{display:none!important;background:rgba(248,113,113,.07)!important;border:1px solid rgba(248,113,113,.18)!important;color:var(--red)!important;opacity:.8!important}
#tsun-cancel.show{display:block!important;animation:t-up .16s both!important}
#tsun-cancel:hover{opacity:1!important}
#tsun-retry{display:none!important;background:rgba(74,222,128,.07)!important;border:1px solid rgba(74,222,128,.18)!important;color:var(--green)!important}
#tsun-retry.show{display:block!important}
#tsun-retry:hover{background:rgba(74,222,128,.13)!important}
#tsun-logdl{display:none!important;background:rgba(250,204,21,.06)!important;border:1px solid rgba(250,204,21,.18)!important;color:var(--yellow)!important}
#tsun-logdl.show{display:block!important}
#tsun-logdl:hover{background:rgba(250,204,21,.12)!important}
#tsun-expq{display:none!important;background:rgba(96,165,250,.07)!important;border:1px solid rgba(96,165,250,.18)!important;color:var(--blue)!important}
#tsun-expq.show{display:block!important}
#tsun-expq:hover{background:rgba(96,165,250,.13)!important}

/* ── Footer ── */
#tsun-foot{
  padding-top:7px!important;border-top:1px solid var(--border2)!important;
  margin-top:7px!important;flex-shrink:0!important;
  display:flex!important;justify-content:space-between!important;align-items:center!important;
}
.t-fl{font-size:9.5px!important;color:var(--text3)!important;text-decoration:none!important;font-family:var(--mono)!important;transition:color .15s!important;}
.t-fl:hover{color:var(--text2)!important}
#tsun-ver{font-size:9px!important;color:var(--text3)!important;font-family:var(--mono)!important;opacity:.5!important}
  `;
  document.head.appendChild(style);

  /* ── Panel HTML ─────────────────────────────────────────────── */
  const panel = document.createElement('div');
  panel.id = 'tsun-panel';
  if(!prefs.dark) panel.classList.add('t-light');

  panel.innerHTML = `
    <div id="tsun-header">
      <div id="tsun-hl">
        <span id="tsun-dot"></span>
        <span id="tsun-title">Tsun</span>
        <span id="tsun-badge"></span>
      </div>
      <div id="tsun-mini">
        <span class="t-ms" id="t-ms-ex">—</span>
        <span style="opacity:.25">·</span>
        <span class="t-ms" id="t-ms-fo">—</span>
        <span style="opacity:.25">·</span>
        <span class="t-ms" id="t-ms-fa">—</span>
      </div>
      <div id="tsun-hctrls">
        <button class="t-icon-btn" id="tsun-sound-btn" title="Toggle sounds">🔔</button>
        <button class="t-icon-btn" id="tsun-theme-btn" title="Toggle theme">🌙</button>
        <div id="tsun-wc">
          <button class="t-wc" id="tsun-min-btn"   title="Minimise (M)"></button>
          <button class="t-wc" id="tsun-close-btn" title="Close"></button>
        </div>
      </div>
    </div>

    <div id="tsun-body">
      <div id="tsun-dz">
        <span id="tsun-dz-ico">📂</span>
        <div id="tsun-dz-main">
          <div id="tsun-dz-txt">
            <strong>Drop your file here</strong>
            Comick <code>.csv</code> · MU/Weebcentral <code>.txt</code> · MAL <code>.xml</code>
          </div>
          <div id="tsun-dz-hint">or click to browse</div>
        </div>
        <span id="tsun-dz-cname"></span>
        <span id="tsun-dz-chg">click to change</span>
        <input type="file" id="tsun-fi-inp" accept=".csv,.txt,.xml">
      </div>

      <div id="tsun-perr"></div>

      <div id="tsun-sf">
        <span class="t-lbl">Import statuses</span>
        <div id="tsun-sfb"></div>
      </div>

      <div id="tsun-sum" class="t-card">
        <div id="tsun-sum-row">
          <span>Selected to import</span>
          <span id="tsun-sum-n">—</span>
        </div>
      </div>

      <div id="tsun-pv">
        <div id="tsun-pv-hdr">
          <span class="t-lbl" style="margin-bottom:0">Preview</span>
          <button id="tsun-pv-tog">Show ▾</button>
        </div>
        <div id="tsun-pv-vp" style="display:none"></div>
      </div>

      <div id="tsun-prog">
        <div id="tsun-phase"></div>
        <div id="tsun-bw"><div id="tsun-bar"></div></div>
        <div id="tsun-pr-row">
          <span id="tsun-pr-n">0 / 0</span>
          <span id="tsun-skip-n"></span>
        </div>
        <span id="tsun-cur-t"></span>
        <span id="tsun-spd"></span>
      </div>

      <div id="tsun-conf">
        <div class="t-card">
          <div class="t-cr" style="color:var(--green)">   <span class="t-cl">Tracker map</span><span class="t-cv c-ex" id="c-ex">0</span></div>
          <div class="t-cr" style="color:var(--blue)">    <span class="t-cl">Title search</span><span class="t-cv c-fo" id="c-fo">0</span></div>
          <div class="t-cr" style="color:var(--owned)">   <span class="t-cl">Already owned</span><span class="t-cv c-ow" id="c-ow">0</span></div>
          <div class="t-cr" style="color:var(--dup)">     <span class="t-cl">Duplicates</span>  <span class="t-cv c-du" id="c-du">0</span></div>
          <div class="t-cr" style="color:var(--red)">     <span class="t-cl">Not found</span>   <span class="t-cv c-fa" id="c-fa">0</span></div>
          <div id="tsun-so-row">
            <label id="tsun-so-lbl" for="tsun-so-tog">Skip already owned</label>
            <button id="tsun-so-tog" class="${prefs.skipOwned?'on':''}" role="switch"></button>
          </div>
        </div>
      </div>

      <div id="tsun-done">
        <span id="tsun-done-em"></span>
        <div id="tsun-done-ti"></div>
        <div id="tsun-done-su"></div>
      </div>

      <div id="tsun-fails">
        <div id="tsun-fhdr">
          <span class="t-lbl" style="margin-bottom:0">Failed entries</span>
          <button id="tsun-ftog">▾</button>
        </div>
        <div id="tsun-flist"></div>
      </div>

      <div id="tsun-btns">
        <div id="tsun-bp">
          <button class="tb" id="tsun-start" disabled>Start Import</button>
          <button class="tb" id="tsun-pause">Pause</button>
          <button class="tb" id="tsun-cancel">✕ Cancel</button>
        </div>
        <div id="tsun-bs">
          <button class="tb" id="tsun-retry">↺ Retry All</button>
          <button class="tb" id="tsun-logdl">⬇ Error Log</button>
          <button class="tb" id="tsun-expq">⬇ Export</button>
        </div>
      </div>

      <div id="tsun-kbh">Space · pause &nbsp;|&nbsp; Esc · cancel &nbsp;|&nbsp; M · minimise</div>

      <div id="tsun-foot">
        <a href="https://github.com/OnlyShresth/weebcentral-extractor" target="_blank" class="t-fl">Weebcentral Guide ↗</a>
        <span id="tsun-ver">v4.0</span>
      </div>
    </div>

    <div class="t-rz t-rz-se" data-dir="se"></div>
    <div class="t-rz t-rz-e"  data-dir="e"></div>
    <div class="t-rz t-rz-s"  data-dir="s"></div>
    <div class="t-rz t-rz-w"  data-dir="w"></div>
    <div class="t-rz t-rz-n"  data-dir="n"></div>
    <div class="t-rz t-rz-ne" data-dir="ne"></div>
    <div class="t-rz t-rz-sw" data-dir="sw"></div>
    <div class="t-rz t-rz-nw" data-dir="nw"></div>

    <div id="tsun-toast"></div>
  `;
  document.body.appendChild(panel);
  panel.style.width = '390px';

  /* ── Refs ───────────────────────────────────────────────────── */
  const $ = id => document.getElementById(id);
  const dz=$('tsun-dz'), fiInp=$('tsun-fi-inp');
  const perr=$('tsun-perr');
  const badge=$('tsun-badge'), dot=$('tsun-dot');
  const sf=$('tsun-sf'), sfb=$('tsun-sfb');
  const sumBox=$('tsun-sum'), sumN=$('tsun-sum-n');
  const pvSec=$('tsun-pv'), pvVp=$('tsun-pv-vp'), pvTog=$('tsun-pv-tog');
  const progSec=$('tsun-prog'), phLbl=$('tsun-phase'), bar=$('tsun-bar');
  const prN=$('tsun-pr-n'), skipN=$('tsun-skip-n'), curT=$('tsun-cur-t'), spdLbl=$('tsun-spd');
  const confBox=$('tsun-conf');
  const doneBox=$('tsun-done');
  const failsSec=$('tsun-fails'), failList=$('tsun-flist');
  const startBtn=$('tsun-start'), pauseBtn=$('tsun-pause'), cancelBtn=$('tsun-cancel');
  const retryBtn=$('tsun-retry'), logBtn=$('tsun-logdl'), expBtn=$('tsun-expq');
  const toast=$('tsun-toast'), kbh=$('tsun-kbh'), miniBox=$('tsun-mini');
  const themeBtn=$('tsun-theme-btn'), soundBtn=$('tsun-sound-btn'), soTog=$('tsun-so-tog');

  /* ── Theme / sound / skip-owned toggles ─────────────────────── */
  function applyTheme(){
    panel.classList.toggle('t-light',!prefs.dark);
    themeBtn.textContent = prefs.dark ? '🌙' : '☀️';
    themeBtn.classList.toggle('active',!prefs.dark);
  }
  themeBtn.addEventListener('click',e=>{
    e.stopPropagation(); prefs.dark=!prefs.dark; applyTheme(); savePrefs();
    showToast(prefs.dark?'Dark mode':'Light mode','inf');
  });
  applyTheme();

  function applySound(){
    soundBtn.textContent = prefs.sound ? '🔔' : '🔕';
    soundBtn.classList.toggle('active',!prefs.sound);
  }
  soundBtn.addEventListener('click',e=>{
    e.stopPropagation(); prefs.sound=!prefs.sound; applySound(); savePrefs();
    if(prefs.sound) playTick();
    showToast(prefs.sound?'Sounds on':'Sounds off','inf');
  });
  applySound();

  soTog.addEventListener('click',e=>{
    e.stopPropagation(); prefs.skipOwned=!prefs.skipOwned;
    soTog.classList.toggle('on',prefs.skipOwned); savePrefs();
    showToast(prefs.skipOwned?'Skipping owned manga':'Importing duplicates too','inf');
  });

  /* ── Toast ──────────────────────────────────────────────────── */
  let toastTimer;
  function showToast(msg,type=''){
    clearTimeout(toastTimer);
    toast.textContent=msg; toast.className='show'+(type?' t-'+type:'');
    toastTimer=setTimeout(()=>toast.className='',3100);
  }

  /* ── Number count-up ────────────────────────────────────────── */
  function animNum(el,to){
    const from=parseInt(el.textContent)||0; if(from===to)return;
    const dur=Math.min(550,Math.abs(to-from)*16); const start=performance.now();
    (function step(now){
      const t=Math.min(1,(now-start)/dur);
      el.textContent=Math.round(from+(to-from)*t);
      el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
      if(t<1) requestAnimationFrame(step); else el.textContent=to;
    })(performance.now());
  }

  /* ═══════════════════════════════════════════════════════
     DRAG
  ═══════════════════════════════════════════════════════ */
  let dragOffX=0,dragOffY=0,dragging=false,dragAnch=false;
  $('tsun-header').addEventListener('mousedown',e=>{
    if(e.target.closest('#tsun-hctrls')) return;
    dragging=true; dragAnch=false;
    const r=panel.getBoundingClientRect();
    dragOffX=e.clientX-r.left; dragOffY=e.clientY-r.top;
    panel.style.transition='none'; panel.classList.add('t-drag');
    e.preventDefault();
  });
  document.addEventListener('mousemove',e=>{
    if(!dragging)return;
    if(!dragAnch){
      dragAnch=true;
      const r=panel.getBoundingClientRect();
      panel.style.width=r.width+'px'; panel.style.height=r.height+'px';
      panel.style.right='auto'; panel.style.bottom='auto';
    }
    panel.style.left=Math.max(0,Math.min(e.clientX-dragOffX,window.innerWidth-panel.offsetWidth))+'px';
    panel.style.top =Math.max(0,Math.min(e.clientY-dragOffY,window.innerHeight-panel.offsetHeight))+'px';
  });
  document.addEventListener('mouseup',()=>{
    if(!dragging)return; dragging=false; panel.style.transition=''; panel.classList.remove('t-drag');
  });

  /* ═══════════════════════════════════════════════════════
     RESIZE — 8 directions
  ═══════════════════════════════════════════════════════ */
  let rzA=false,rzDir='',rzSX=0,rzSY=0,rzSW=0,rzSH=0,rzSL=0,rzST=0;
  const MIN_W=280,MIN_H=120,MAX_W=820;
  panel.querySelectorAll('.t-rz').forEach(h=>{
    h.addEventListener('mousedown',e=>{
      rzA=true; rzDir=h.dataset.dir;
      rzSX=e.clientX; rzSY=e.clientY;
      const r=panel.getBoundingClientRect();
      rzSW=r.width; rzSH=r.height; rzSL=r.left; rzST=r.top;
      panel.style.right='auto'; panel.style.bottom='auto';
      panel.style.left=rzSL+'px'; panel.style.top=rzST+'px';
      panel.style.width=rzSW+'px'; panel.style.height=rzSH+'px';
      panel.style.transition='none';
      e.preventDefault(); e.stopPropagation();
    });
  });
  document.addEventListener('mousemove',e=>{
    if(!rzA)return;
    const dx=e.clientX-rzSX,dy=e.clientY-rzSY;
    let w=rzSW,h=rzSH,l=rzSL,t=rzST;
    if(rzDir.includes('e')) w=Math.max(MIN_W,Math.min(MAX_W,rzSW+dx));
    if(rzDir.includes('s')) h=Math.max(MIN_H,rzSH+dy);
    if(rzDir.includes('w')){ const nw=Math.max(MIN_W,Math.min(MAX_W,rzSW-dx)); l=rzSL+(rzSW-nw); w=nw; }
    if(rzDir.includes('n')){ const nh=Math.max(MIN_H,rzSH-dy); t=rzST+(rzSH-nh); h=nh; }
    panel.style.width=w+'px'; panel.style.height=h+'px';
    panel.style.left=l+'px'; panel.style.top=t+'px';
    $('tsun-body').style.maxHeight=(h-46)+'px';
  });
  document.addEventListener('mouseup',()=>{ if(rzA){rzA=false; panel.style.transition='';} });

  /* ── Window controls ────────────────────────────────────────── */
  let collapsed=false;
  $('tsun-min-btn').addEventListener('click',e=>{
    e.stopPropagation(); collapsed=!collapsed;
    $('tsun-body').style.display=collapsed?'none':'';
    miniBox.classList.toggle('show',collapsed&&isRunning);
  });
  $('tsun-close-btn').addEventListener('click',e=>{
    e.stopPropagation();
    if(isRunning&&!confirm('Import running. Close anyway?'))return;
    panel.remove();
  });

  /* ── Keyboard shortcuts — capture:true intercepts page scroll ── */
  document.addEventListener('keydown',e=>{
    if(!panel.isConnected)return;
    if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;
    if(e.target.isContentEditable)return;
    if(e.key===' '&&isRunning){e.preventDefault();e.stopImmediatePropagation();pauseBtn.click();kbh.classList.add('lit');setTimeout(()=>kbh.classList.remove('lit'),400);}
    if(e.key==='Escape'&&isPaused){e.preventDefault();cancelBtn.click();}
    if((e.key==='m'||e.key==='M')&&!e.ctrlKey&&!e.metaKey&&!e.altKey)$('tsun-min-btn').click();
  },{capture:true});

  /* ── File drop ──────────────────────────────────────────────── */
  dz.addEventListener('dragover',e=>{e.preventDefault();if(!isRunning)dz.classList.add('drag-over');});
  dz.addEventListener('dragleave',()=>dz.classList.remove('drag-over'));
  dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag-over');const f=e.dataTransfer.files[0];if(f)handleFile(f);});
  dz.addEventListener('click',e=>{if(!isRunning&&!dz.classList.contains('compact'))fiInp.click();});
  $('tsun-dz-chg').addEventListener('click',e=>{e.stopPropagation();if(!isRunning)fiInp.click();});
  fiInp.addEventListener('change',()=>{if(fiInp.files[0])handleFile(fiInp.files[0]);});

  /* ── File handling ──────────────────────────────────────────── */
  async function handleFile(file){
    if(isRunning)return;
    resetUI();
    const ext=file.name.split('.').pop().toLowerCase();
    if(!['csv','txt','xml'].includes(ext)){showToast('Unsupported file','err');showErr('Use .csv, .txt or .xml');return;}
    currentFormat=ext;
    const text=(await file.text()).replace(/\r\n/g,'\n').replace(/\r/g,'\n');

    // Collapse dropzone to compact strip
    $('tsun-dz-ico').textContent={csv:'📊',txt:'📄',xml:'📋'}[ext]||'📂';
    $('tsun-dz-cname').textContent=file.name;
    dz.classList.add('compact');
    badge.textContent=ext.toUpperCase(); badge.className=ext;

    try{ pendingEntries=ext==='csv'?parseCSV(text):ext==='txt'?parseTXT(text):parseXML(text); }
    catch(er){showErr('Parse error: '+er.message);showToast('Parse failed','err');dz.classList.remove('compact');return;}
    if(!pendingEntries.length){showErr('No valid entries found.');startBtn.disabled=true;return;}
    if(ext==='xml'){buildSF(pendingEntries);sf.classList.add('show');}
    updateSum(); buildPrev(pendingEntries); pvSec.classList.add('show');
    startBtn.disabled=false;
    showToast(pendingEntries.length+' entries loaded','ok');
    playTick();
  }
  function showErr(m){perr.textContent='⚠ '+m;perr.classList.add('show');}

  /* ── Parsers ────────────────────────────────────────────────── */
  function parseCSV(t){
    const lines=t.split('\n').filter(l=>l.trim()); if(lines.length<2)return[];
    const hdr=csvL(lines[0]).map(h=>h.toLowerCase());
    const ti=hdr.findIndex(h=>h.includes('title')),ui=hdr.findIndex(h=>h.includes('url')||h.includes('link')),ci=hdr.findIndex(h=>h.includes('chapter'));
    return lines.slice(1).map(l=>{const c=csvL(l);return{title:c[ti]||'',url:c[ui]||'',chapter:parseInt(c[ci])||0,source:'comick'};}).filter(e=>e.title||e.url);
  }
  function parseTXT(t){ return t.split('\n').map(l=>l.trim()).filter(l=>l.startsWith('https://www.mangaupdates.com')).map(url=>({url,source:'mu'})); }
  function parseXML(t){
    const doc=new DOMParser().parseFromString(t,'application/xml');
    if(doc.querySelector('parsererror'))throw new Error('Invalid XML');
    const out=[];
    doc.querySelectorAll('manga').forEach(n=>{
      const g=tag=>n.querySelector(tag)?.textContent?.trim()??'';
      out.push({malId:g('manga_mangadb_id'),title:g('manga_title'),chaptersRead:parseInt(g('my_read_chapters'),10)||0,status:g('my_status'),source:'mal'});
    });
    return out;
  }
  function csvL(line){
    const r=[];let cur='',q=false;
    for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(c===','&&!q){r.push(cur.trim());cur='';}else cur+=c;}
    r.push(cur.trim());return r;
  }

  /* ── Status filter ──────────────────────────────────────────── */
  const SCOLORS={'Reading':'#60a5fa','Completed':'#4ade80','On-Hold':'#facc15','Dropped':'#f87171','Plan to Read':'#a78bfa'};
  function buildSF(entries){
    const counts={};entries.forEach(e=>{if(e.status)counts[e.status]=(counts[e.status]||0)+1;});
    sfb.innerHTML='';
    Object.entries(counts).sort((a,b)=>b[1]-a[1]).forEach(([st,cnt])=>{
      const lbl=document.createElement('label');lbl.className='t-scb on';
      const cb=document.createElement('input');cb.type='checkbox';cb.className='t-sci';cb.dataset.status=st;cb.checked=true;
      const d=document.createElement('span');d.className='t-scb-dot';d.style.background=SCOLORS[st]||'#888';
      const tx=document.createTextNode(' '+st+' ');
      const cn=document.createElement('span');cn.className='t-scb-cnt';cn.textContent=cnt;
      lbl.appendChild(cb);lbl.appendChild(d);lbl.appendChild(tx);lbl.appendChild(cn);
      cb.addEventListener('change',ev=>{lbl.classList.toggle('on',ev.target.checked);updateSum();});
      sfb.appendChild(lbl);
    });
  }
  function getSelSt(){return[...sfb.querySelectorAll('.t-sci:checked')].map(i=>i.dataset.status);}
  function getFiltered(){return currentFormat!=='xml'?pendingEntries:pendingEntries.filter(e=>getSelSt().includes(e.status));}
  function updateSum(){
    const n=getFiltered().length;
    animNum(sumN,n); sumBox.classList.add('show'); buildPrev(getFiltered());
  }

  /* ── Preview ────────────────────────────────────────────────── */
  let pvOpen=false,pvEntries=[];const RH=22;
  pvTog.addEventListener('click',()=>{pvOpen=!pvOpen;pvVp.style.display=pvOpen?'block':'none';pvTog.textContent=pvOpen?'Hide ▴':'Show ▾';if(pvOpen)renderPv();});
  pvVp.addEventListener('scroll',renderPv,{passive:true});
  function buildPrev(e){pvEntries=e;if(pvOpen)renderPv();}
  function renderPv(){
    if(!pvOpen||!pvEntries.length)return;
    const st=pvVp.scrollTop,vh=pvVp.clientHeight;
    const s=Math.max(0,Math.floor(st/RH)-2),e=Math.min(pvEntries.length,Math.ceil((st+vh)/RH)+3);
    let sp=pvVp.querySelector('.t-pvsp');
    if(!sp){sp=document.createElement('div');sp.className='t-pvsp';sp.style.cssText='position:relative';pvVp.innerHTML='';pvVp.appendChild(sp);}
    sp.style.height=(pvEntries.length*RH)+'px';
    [...sp.querySelectorAll('.t-pr')].forEach(el=>{const i=parseInt(el.dataset.i,10);if(i<s||i>=e)el.remove();});
    const ex=new Set([...sp.querySelectorAll('.t-pr')].map(el=>parseInt(el.dataset.i,10)));
    for(let i=s;i<e;i++){
      if(ex.has(i))continue;
      const en=pvEntries[i];
      const row=document.createElement('div');row.className='t-pr';row.dataset.i=i;
      row.style.cssText=`position:absolute;top:${i*RH}px;left:0;right:0;height:${RH}px;`;
      const tt=document.createElement('span');tt.className='t-pt';tt.textContent=en.title||en.url||'—';
      const sv=document.createElement('span');sv.className='t-ps';sv.textContent=en.status||en.source||'';
      const ch=document.createElement('span');ch.className='t-pc';ch.textContent=en.chaptersRead>0?`ch.${en.chaptersRead}`:'';
      row.appendChild(tt);row.appendChild(sv);row.appendChild(ch);sp.appendChild(row);
    }
  }

  /* ── Resume ─────────────────────────────────────────────────── */
  function saveResolved(r){try{localStorage.setItem(LS_RESOLVED_KEY,JSON.stringify(r));}catch{}}
  function loadResolved(){try{const r=localStorage.getItem(LS_RESOLVED_KEY);return r?JSON.parse(r):null;}catch{return null;}}
  function saveResume(x={}){try{localStorage.setItem(LS_RESUME_KEY,JSON.stringify({format:currentFormat,queue:importQueue,index:importIndex,...x}));}catch{}}
  function loadResume(){try{const r=localStorage.getItem(LS_RESUME_KEY);return r?JSON.parse(r):null;}catch{return null;}}
  function clearResume(){localStorage.removeItem(LS_RESUME_KEY);localStorage.removeItem(LS_RESOLVED_KEY);}

  /* ── Tracker map ────────────────────────────────────────────── */
  async function ensureTrackerMap(){
    const now=Date.now();
    if(trackerArr&&(now-trackerFetchedAt)<TRACKER_MAP_TTL_MS)return;
    try{
      const arr=await(await fetch(ATSU_TRACKER_MAP_URL)).json();
      trackerArr=arr;trackerByMal={};trackerByMu={};
      for(const item of arr){
        if(item.idMal)          trackerByMal[String(item.idMal)]=item.id;
        if(item.idMangaUpdates) trackerByMu[item.idMangaUpdates]=item.id;
      }
      trackerFetchedAt=now;
    }catch{if(!trackerArr){trackerArr=[];trackerByMal={};trackerByMu={};}trackerFetchedAt=now;}
  }

  /* ── Atsu search ────────────────────────────────────────────── */
  async function searchAtsu(query){
    if(!query)return null;
    try{
      const p=new URLSearchParams({q:query,limit:5,query_by:'title,englishTitle',include_fields:'id,title'});
      const res=await fetch(ATSU_SEARCH_PATH+'?'+p);
      return res.ok?(await res.json()).hits?.[0]?.document??null:null;
    }catch{return null;}
  }

  /* ══════════════════════════════════════════════════════════════
     ALREADY-OWNED CHECK
     Hits /api/manga/page?id=X and checks bookmark fields.
     Results are cached to avoid re-checking in retries.
  ══════════════════════════════════════════════════════════════ */
  async function checkOwned(atsuId){
    if(atsuId in ownedCache) return ownedCache[atsuId];
    try{
      const res=await fetch(ATSU_PAGE_PATH+'?id='+atsuId,{credentials:'include'});
      if(!res.ok){ownedCache[atsuId]=false;return false;}
      const mp=(await res.json()).mangaPage;
      const owned=!!(mp&&(mp.bookmarkStatus||mp.bookmark||mp.continueReading));
      ownedCache[atsuId]=owned; return owned;
    }catch{ownedCache[atsuId]=false;return false;}
  }

  /* ── Resolve entry ──────────────────────────────────────────── */
  async function resolveEntry(entry){
    if(entry.source==='mal'){
      if(entry.malId&&trackerByMal[String(entry.malId)])return{atsuId:trackerByMal[String(entry.malId)],confidence:'exact'};
      if(entry.title){const h=await searchAtsu(entry.title);if(h)return{atsuId:h.id,confidence:'found'};}
      return{atsuId:null,confidence:null};
    }
    if(entry.source==='mu'){
      const muId=entry.url.match(/\/series\/([a-z0-9]+)/i)?.[1];
      if(muId&&trackerByMu[muId])return{atsuId:trackerByMu[muId],confidence:'exact'};
      const slug=entry.url.match(/\/series\/[a-z0-9]+\/([^/]+)/i)?.[1];
      if(slug){const h=await searchAtsu(slug.replace(/-/g,' '));if(h)return{atsuId:h.id,confidence:'found'};}
      return{atsuId:null,confidence:null};
    }
    if(entry.source==='comick'){
      const muId=entry.url.match(/mangaupdates\.com\/series\/([a-z0-9]+)/i)?.[1];
      if(muId&&trackerByMu[muId])return{atsuId:trackerByMu[muId],confidence:'exact'};
      if(entry.title){const h=await searchAtsu(entry.title);if(h)return{atsuId:h.id,confidence:'found'};}
      return{atsuId:null,confidence:null};
    }
    return{atsuId:null,confidence:null};
  }

  /* ── Bookmark / chapter ─────────────────────────────────────── */
  async function postBookmarks(chunk){
    for(let a=0;a<3;a++){
      try{
        const res=await fetch(ATSU_BOOKMARKS_PATH,{method:'POST',headers:{'content-type':'application/json'},credentials:'include',body:JSON.stringify(chunk)});
        if(res.status===429){await sleep(2500);continue;} if(res.ok)return true;
      }catch{}
      await sleep(800);
    }
    return false;
  }
  async function syncChapter(atsuId,chapterNum){
    try{
      const res=await fetch(ATSU_CHAPTERS_PATH+'?mangaId='+atsuId,{credentials:'include'});
      if(!res.ok)return false;
      const target=((await res.json()).chapters||[]).find(c=>Number(c.number)===Number(chapterNum));
      if(!target)return false;
      const payload={progress:[{mangaScanlationId:target.scanlationMangaId,mangaId:atsuId,chapterId:target.id,page:Math.max(0,(Number(target.pageCount)||1)-1),frac:1,pages:Number(target.pageCount)||1,ts:Date.now(),strip:false}],deletedChapters:[]};
      return(await fetch(ATSU_PROGRESS_PATH,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})).ok;
    }catch{return false;}
  }

  /* ── Single retry ───────────────────────────────────────────── */
  async function retrySingle(entry){
    await ensureTrackerMap();
    const{atsuId}=await resolveEntry(entry);
    if(!atsuId)return{success:false,reason:'Still no match'};
    const ok=await postBookmarks([{mangaId:atsuId,status:STATUS_MAP[entry.status]||'PlanToRead',synced:false,ts:Date.now(),type:'Manga'}]);
    if(!ok)return{success:false,reason:'Bookmark POST failed'};
    if(entry.chaptersRead>0)await syncChapter(atsuId,entry.chaptersRead);
    return{success:true};
  }

  /* ── Failed list ────────────────────────────────────────────── */
  let failsOpen=true;
  $('tsun-fhdr').addEventListener('click',()=>{failsOpen=!failsOpen;failList.style.display=failsOpen?'block':'none';$('tsun-ftog').textContent=failsOpen?'▾':'▸';});
  function buildFails(){
    failList.innerHTML='';
    failedEntries.forEach((en,idx)=>{
      const row=document.createElement('div');row.className='t-fr';row.style.animationDelay=Math.min(idx*.026,.32)+'s';
      const st=document.createElement('span');st.className='t-fst';st.textContent='✗';st.style.color='var(--red)';
      const inf=document.createElement('div');inf.className='t-fi';
      const tl=document.createElement('div');tl.className='t-ft';tl.textContent=en.title||en.url||en.malId||'—';
      const re=document.createElement('div');re.className='t-frsn';re.textContent=en.reason||'Unknown';
      inf.appendChild(tl);inf.appendChild(re);
      const rb=document.createElement('button');rb.className='t-r1';rb.textContent='↺';
      rb.addEventListener('click',async()=>{
        rb.disabled=true;st.innerHTML='<span class="spin">⟳</span>';
        const r=await retrySingle(en);
        if(r.success){st.textContent='✓';st.style.color='var(--green)';row.classList.add('ok');re.textContent='Imported';rb.style.display='none';failedEntries.splice(failedEntries.indexOf(en),1);playTick();}
        else{st.textContent='✗';st.style.color='var(--red)';re.textContent=r.reason;rb.disabled=false;playError();}
      });
      row.appendChild(st);row.appendChild(inf);row.appendChild(rb);failList.appendChild(row);
    });
  }

  /* ── Confetti ───────────────────────────────────────────────── */
  function confetti(){
    const cols=['#4ade80','#facc15','#f87171','#60a5fa','#a78bfa','#fb923c'];
    for(let i=0;i<16;i++){
      const el=document.createElement('div');el.className='t-cf';
      const sz=3+Math.random()*6;
      el.style.cssText=`width:${sz}px;height:${sz}px;background:${cols[i%cols.length]};left:${15+Math.random()*70}%;top:${25+Math.random()*35}%;animation-delay:${Math.random()*.45}s;animation-duration:${.7+Math.random()*.5}s`;
      doneBox.appendChild(el);setTimeout(()=>el.remove(),1500);
    }
  }

  /* ── Export ─────────────────────────────────────────────────── */
  expBtn.addEventListener('click',()=>{
    const urls=failedEntries.filter(e=>e.url).map(e=>e.url);
    if(!urls.length){showToast('Nothing to export','err');return;}
    const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([urls.join('\n')],{type:'text/plain'})),download:'tsun_failed.txt'});
    a.click();URL.revokeObjectURL(a.href);showToast('Exported '+urls.length+' entries','ok');
  });

  /* ── Stats ──────────────────────────────────────────────────── */
  function updConf(){
    animNum($('c-ex'),cStats.exact); animNum($('c-fo'),cStats.found);
    animNum($('c-ow'),cStats.owned); animNum($('c-du'),cStats.dup);
    animNum($('c-fa'),cStats.fail);
    $('t-ms-ex').textContent=cStats.exact||'—'; $('t-ms-ex').classList.toggle('lit',cStats.exact>0);
    $('t-ms-fo').textContent=cStats.found||'—'; $('t-ms-fo').classList.toggle('lit',cStats.found>0);
    $('t-ms-fa').textContent=cStats.fail||'—';
  }

  /* ── Speed ──────────────────────────────────────────────────── */
  let p1Start=0;
  function updSpd(done,total){
    const el=(Date.now()-p1Start)/1000; if(el<0.5||done<2)return;
    const rate=done/el,eta=(total-done)/Math.max(rate,.001);
    spdLbl.textContent=`${rate.toFixed(1)}/s · ETA ${eta<60?Math.ceil(eta)+'s':eta<3600?Math.floor(eta/60)+'m '+Math.ceil(eta%60)+'s':(eta/3600).toFixed(1)+'h'}`;
    spdLbl.className='on';
  }

  /* ── Progress ───────────────────────────────────────────────── */
  function setProgress(cur,tot,title=''){bar.style.width=(tot>0?Math.round(cur/tot*100):0)+'%';prN.textContent=`${cur} / ${tot}`;curT.textContent=title;}
  function setPhase(cls,lbl,barCls=''){phLbl.textContent=lbl;phLbl.className=cls;bar.className=barCls;}
  function setDot(s){dot.className=s||'';}
  function updMini(){if(collapsed)miniBox.classList.toggle('show',isRunning);}

  /* ── Reset ──────────────────────────────────────────────────── */
  function resetUI(){
    currentFormat=null;pendingEntries=[];importQueue=[];importIndex=0;
    isPaused=false;isRunning=false;isCancelled=false;failedEntries=[];ownedCache={};
    pvEntries=[];pvOpen=false;
    cStats.exact=cStats.found=cStats.owned=cStats.dup=cStats.fail=0;
    [sf,sumBox,pvSec,progSec,confBox,doneBox,failsSec].forEach(el=>el.classList.remove('show'));
    [pauseBtn,cancelBtn,retryBtn,logBtn,expBtn].forEach(el=>el.classList.remove('show'));
    perr.classList.remove('show');badge.className='';
    dz.classList.remove('compact','locked');
    $('tsun-dz-ico').textContent='📂';
    startBtn.disabled=false;startBtn.textContent='Start Import';pauseBtn.textContent='Pause';
    sfb.innerHTML='';pvVp.innerHTML='';pvVp.style.display='none';pvTog.textContent='Show ▾';
    failList.innerHTML='';skipN.textContent='';spdLbl.textContent='';spdLbl.className='';
    updConf();setDot('');miniBox.classList.remove('show');
    $('tsun-body').style.maxHeight='';
  }

  /* ── Done ───────────────────────────────────────────────────── */
  function showDone(imported,owned,dups){
    const allGood=!failedEntries.length;
    $('tsun-done-em').textContent=allGood?'🎉':'⚠️';
    $('tsun-done-ti').textContent=allGood?'Import Complete!':'Import Done';
    const parts=[`${imported} imported`];
    if(owned>0) parts.push(`${owned} already owned`);
    if(dups>0)  parts.push(`${dups} duplicates`);
    parts.push(`${failedEntries.length} failed`);
    $('tsun-done-su').textContent=parts.join(' · ');
    doneBox.classList.add('show');
    if(allGood){confetti();playSuccess();}else playError();
    progSec.classList.remove('show');pauseBtn.classList.remove('show');cancelBtn.classList.remove('show');
    startBtn.disabled=true;dz.classList.remove('locked');dz.style.display='';
    setDot(failedEntries.length?'error':'done');
    if(failedEntries.length){buildFails();failsSec.classList.add('show');retryBtn.classList.add('show');logBtn.classList.add('show');}
    if(failedEntries.filter(e=>e.url).length)expBtn.classList.add('show');
    showToast(allGood?`Done! ${imported} manga imported`:`Done — ${failedEntries.length} failed`,allGood?'ok':'err');
    updMini();
  }

  window.addEventListener('beforeunload',e=>{if(isRunning){e.preventDefault();e.returnValue='';}});

  /* ── Start ──────────────────────────────────────────────────── */
  startBtn.addEventListener('click',async()=>{
    if(isRunning)return;
    startBtn.blur();
    const resume=loadResume();let intoP2=false,resumedResolved=null;
    if(resume&&resume.format===currentFormat){
      const sr=loadResolved();
      const rem=resume.phase===2?(sr?.length??0)-resume.index:(resume.queue?.length??0)-resume.index;
      if(confirm(`Resume previous import? (${rem} entries left)`)){
        importQueue=resume.queue;importIndex=resume.index;
        if(currentFormat==='xml'&&resume.phase===2&&sr){intoP2=true;resumedResolved=sr;}
      }else{clearResume();importQueue=getFiltered().map(e=>({...e}));importIndex=0;}
    }else{clearResume();importQueue=getFiltered().map(e=>({...e}));importIndex=0;}

    failedEntries=[];ownedCache={};cStats.exact=cStats.found=cStats.owned=cStats.dup=cStats.fail=0;
    [pvSec,sumBox,sf].forEach(el=>el.classList.remove('show'));
    dz.style.display='none';
    progSec.classList.add('show');pauseBtn.classList.add('show');
    startBtn.disabled=true;doneBox.classList.remove('show');failsSec.classList.remove('show');
    [retryBtn,logBtn,expBtn].forEach(el=>el.classList.remove('show'));
    dz.classList.add('locked');setDot('running');bgNotify('IMPORT_STARTED');updMini();

    if(currentFormat==='xml'){confBox.classList.add('show');await runMAL(intoP2?resumedResolved:null);}
    else await runDirect();
  });

  pauseBtn.addEventListener('click',()=>{
    pauseBtn.blur(); cancelBtn.blur();
    isPaused=!isPaused;
    pauseBtn.textContent=isPaused?'▶ Resume':'⏸ Pause';
    cancelBtn.classList.toggle('show',isPaused);
    setDot(isPaused?'paused':'running');
    playPause();
    showToast(isPaused?'Paused':'Resumed');
  });
  cancelBtn.addEventListener('click',()=>{if(!isPaused)return;isCancelled=true;isPaused=false;});

  retryBtn.addEventListener('click',async()=>{
    if(isRunning)return;
    [retryBtn,logBtn,expBtn].forEach(el=>el.classList.remove('show'));
    doneBox.classList.remove('show');failsSec.classList.remove('show');
    cStats.exact=cStats.found=cStats.owned=cStats.dup=cStats.fail=0;updConf();
    importQueue=[...failedEntries];failedEntries=[];importIndex=0;
    progSec.classList.add('show');pauseBtn.classList.add('show');
    startBtn.disabled=true;isPaused=false;isCancelled=false;pauseBtn.textContent='⏸ Pause';
    dz.classList.add('locked');setDot('running');
    if(currentFormat==='xml')await runMAL(null);else await runDirect();
  });

  logBtn.addEventListener('click',()=>{
    const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([failedEntries.map(e=>`[${e.reason||'?'}] ${e.title||e.url||e.malId||'—'}`).join('\n')],{type:'text/plain'})),download:'tsun_errors.txt'});
    a.click();URL.revokeObjectURL(a.href);showToast('Error log downloaded');
  });

  function handleCancel(){
    isRunning=false;isCancelled=false;isPaused=false;
    [pauseBtn,cancelBtn].forEach(el=>el.classList.remove('show'));
    progSec.classList.remove('show');dz.classList.remove('locked');dz.style.display='';
    clearResume();bgNotify('IMPORT_DONE');setDot('paused');
    if(failedEntries.length){buildFails();failsSec.classList.add('show');logBtn.classList.add('show');}
    doneBox.classList.add('show');
    $('tsun-done-em').textContent='⏹';
    $('tsun-done-ti').textContent='Import Cancelled';
    $('tsun-done-su').textContent=`${failedEntries.length} entries not imported`;
    showToast('Cancelled','err');updMini();
  }

  /* ══════════════════════════════════════════════════════════════
     MAL IMPORT

     Phase 1 — Resolution + owned/dup check (concurrent workers)
       For each entry:
         1. resolveEntry()  → atsuId
         2. dup check       → if atsuId already in resolvedSet, skip
         3. owned check     → if checkOwned() && prefs.skipOwned, skip
         4. otherwise       → push to resolved[]

     Phase 2 — Batch bookmark POST
     Phase 3 — Chapter progress sync
  ══════════════════════════════════════════════════════════════ */
  async function runMAL(resumedResolved=null){
    isRunning=true;isCancelled=false;
    const total=importQueue.length;
    let resolved=resumedResolved?[...resumedResolved]:[];
    let ownedCount=0, dupCount=0;

    if(!resumedResolved){
      setPhase('ph-res','Phase 1 — Resolving & checking','b-res');
      await ensureTrackerMap(); p1Start=Date.now();
      let nextIdx=importIndex,doneCount=importIndex;
      const resolvedSet=new Set(resolved.map(e=>e.atsuId));
      let tickCounter=0;

      async function worker(){
        while(true){
          while(isPaused&&!isCancelled)await sleep(150);
          if(isCancelled)return;
          const i=nextIdx++;if(i>=total)return;
          const entry=importQueue[i];
          const{atsuId,confidence}=await resolveEntry(entry);
          if(isCancelled)return;

          if(atsuId){
            // ── Duplicate within this import list ──────────────
            if(resolvedSet.has(atsuId)){
              cStats.dup++; dupCount++;
            }
            // ── Already owned on Atsu ──────────────────────────
            else if(prefs.skipOwned&&await checkOwned(atsuId)){
              cStats.owned++; ownedCount++;
              resolvedSet.add(atsuId);
            }
            // ── Good to import ─────────────────────────────────
            else{
              resolved.push({...entry,atsuId,confidence});
              resolvedSet.add(atsuId);
              cStats[confidence==='exact'?'exact':'found']++;
              // play a subtle tick every 5 resolved
              tickCounter++;
              if(tickCounter%5===0) playTick();
            }
          }else{
            cStats.fail++;
            failedEntries.push({...entry,reason:'Not found in tracker or search'});
          }

          doneCount++;
          setProgress(doneCount,total,entry.title);
          updConf();
          updSpd(doneCount-importIndex,total-importIndex);
          skipN.textContent=`${ownedCount} owned · ${dupCount} dup`;
          if(i>importIndex){importIndex=i;saveResume({phase:1});}
          await sleep(SEARCH_DELAY_MS);
        }
      }
      await Promise.all(Array.from({length:SEARCH_CONCURRENCY},(_,k)=>sleep(k*40).then(worker)));
      if(isCancelled){handleCancel();return;}
    }

    spdLbl.textContent='';spdLbl.className='';
    const p2Start=resumedResolved?importIndex:0;
    importIndex=0;saveResolved(resolved);saveResume({phase:2});

    setPhase('ph-imp','Phase 2 — Posting bookmarks');
    let imported=0,skipped=0;
    const bms=resolved.slice(p2Start).map(e=>({mangaId:e.atsuId,status:STATUS_MAP[e.status]||'PlanToRead',synced:false,ts:Date.now(),type:'Manga'}));
    for(let i=0;i<bms.length;i+=BOOKMARK_CHUNK){
      while(isPaused&&!isCancelled)await sleep(300);
      if(isCancelled){importIndex=p2Start+i;handleCancel();return;}
      const chunk=bms.slice(i,i+BOOKMARK_CHUNK);
      setProgress(Math.min(i+BOOKMARK_CHUNK,bms.length),bms.length,'Posting…');
      const ok=await postBookmarks(chunk);
      if(ok)imported+=chunk.length;
      else{skipped+=chunk.length;chunk.forEach((_,j)=>{const e=resolved[p2Start+i+j];if(e)failedEntries.push({...e,reason:'Bookmark POST failed'});});}
      await sleep(BOOKMARK_DELAY_MS);
    }

    const withProg=resolved.filter(e=>e.chaptersRead>0);
    if(withProg.length){
      setPhase('ph-ch','Phase 3 — Syncing chapters','b-ch');
      for(let i=0;i<withProg.length;i++){
        while(isPaused&&!isCancelled)await sleep(300);
        if(isCancelled)break;
        setProgress(i+1,withProg.length,withProg[i].title);
        await syncChapter(withProg[i].atsuId,withProg[i].chaptersRead);
        await sleep(200);
      }
    }

    importIndex=resolved.length;clearResume();isRunning=false;
    bgNotify('IMPORT_DONE');showDone(imported,ownedCount,dupCount);
  }

  /* ── Direct import (CSV / TXT) ──────────────────────────────── */
  async function runDirect(){
    isRunning=true;isCancelled=false;
    const total=importQueue.length;let imported=0;
    await ensureTrackerMap();
    setPhase('ph-res','Resolving titles','b-res'); p1Start=Date.now();
    const resolved=[];const resolvedSet=new Set();
    let nextIdx=importIndex,doneCount=importIndex,tickCounter=0;
    async function dw(){
      while(true){
        while(isPaused&&!isCancelled)await sleep(150);
        if(isCancelled)return;
        const i=nextIdx++;if(i>=total)return;
        const entry=importQueue[i];
        const{atsuId}=await resolveEntry(entry);
        if(isCancelled)return;
        if(atsuId&&!resolvedSet.has(atsuId)){resolved.push({...entry,atsuId});resolvedSet.add(atsuId);tickCounter++;if(tickCounter%5===0)playTick();}
        else if(!atsuId)failedEntries.push({...entry,reason:'Not found'});
        doneCount++;setProgress(doneCount,total,entry.title||entry.url);updSpd(doneCount,total);
        await sleep(SEARCH_DELAY_MS);
      }
    }
    await Promise.all(Array.from({length:SEARCH_CONCURRENCY},(_,k)=>sleep(k*40).then(dw)));
    if(isCancelled){handleCancel();return;}
    spdLbl.textContent='';spdLbl.className='';
    setPhase('ph-imp','Posting bookmarks');
    const bms=resolved.map(e=>({mangaId:e.atsuId,status:'PlanToRead',synced:false,ts:Date.now(),type:'Manga'}));
    for(let i=0;i<bms.length;i+=BOOKMARK_CHUNK){
      while(isPaused&&!isCancelled)await sleep(300);
      if(isCancelled){handleCancel();return;}
      const ok=await postBookmarks(bms.slice(i,i+BOOKMARK_CHUNK));
      if(ok)imported+=Math.min(BOOKMARK_CHUNK,bms.length-i);
      setProgress(Math.min(i+BOOKMARK_CHUNK,bms.length),bms.length,'Posting…');
      await sleep(BOOKMARK_DELAY_MS);
    }
    clearResume();isRunning=false;bgNotify('IMPORT_DONE');showDone(imported,0,0);
  }

  function bgNotify(type){try{if(typeof chrome!=='undefined'&&chrome.runtime?.sendMessage)chrome.runtime.sendMessage({type});}catch{}}
  try{if(typeof chrome!=='undefined'&&chrome.runtime?.onMessage){chrome.runtime.onMessage.addListener(msg=>{if(msg.type==='AUTO_RESUME'){if(collapsed){$('tsun-body').style.display='';collapsed=false;}const s=loadResume();if(s&&!isRunning)startBtn.click();}});}}catch{}

  function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

  /* ── Resume banner ──────────────────────────────────────────── */
  (()=>{
    const s=loadResume();if(!s)return;
    const sr=loadResolved();
    const rem=s.phase===2?(sr?.length??0)-s.index:(s.queue?.length??0)-s.index;
    const b=document.createElement('div');
    b.style.cssText="position:fixed;top:0;left:0;right:0;background:rgba(8,8,16,.94);backdrop-filter:blur(16px);color:#a78bfa;font-family:'Inter',sans-serif;font-size:12px;font-weight:500;padding:9px 18px;text-align:center;z-index:2147483646;cursor:pointer;border-bottom:1px solid rgba(167,139,250,.2);animation:t-up .3s both;";
    b.textContent=`Tsun Importer — unfinished import (${rem} entries left). Click to dismiss.`;
    b.addEventListener('click',()=>b.remove());
    document.body.prepend(b);bgNotify('RESUME_AVAILABLE');
  })();

})();
