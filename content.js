// ═══════════════════════════════════════════════════════════════════
//  Tsun Importer — content.js  v3.0
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  /* ── Constants ──────────────────────────────────────────────── */
  const ATSU_TRACKER_MAP_URL = 'https://atsu.moe/tracker-map.json';
  const ATSU_SEARCH_PATH     = '/collections/manga/documents/search';
  const ATSU_BOOKMARKS_PATH  = '/api/user/syncBookmarks';
  const ATSU_CHAPTERS_PATH   = '/api/manga/allChapters';
  const ATSU_PROGRESS_PATH   = '/api/read/syncProgress';
  const LS_RESUME_KEY        = 'tsunImporter_resumeState';
  const LS_RESOLVED_KEY      = 'tsunImporter_phase2Resolved';
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

  /* ── State ──────────────────────────────────────────────────── */
  let importQueue=[],importIndex=0,isPaused=false,isRunning=false,isCancelled=false;
  let failedEntries=[],pendingEntries=[],currentFormat=null;
  let trackerArr=null,trackerByMal={},trackerByMu={},trackerFetchedAt=0;

  /* ── Styles ─────────────────────────────────────────────────── */
  const style = document.createElement('style');
  style.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap');

/* ── Keyframes ── */
@keyframes t-in    {from{opacity:0;transform:translateY(22px) scale(.95)}to{opacity:1;transform:none}}
@keyframes t-up    {from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
@keyframes t-pop   {0%{opacity:0;transform:scale(.84)}60%{transform:scale(1.06)}100%{opacity:1;transform:none}}
@keyframes t-shim  {0%{transform:translateX(-120%)}100%{transform:translateX(420%)}}
@keyframes t-pulse {0%,100%{opacity:1}50%{opacity:.28}}
@keyframes t-spin  {to{transform:rotate(360deg)}}
@keyframes t-glow  {0%,100%{box-shadow:0 0 0 0 rgba(255,107,107,0)}50%{box-shadow:0 0 20px 4px rgba(255,107,107,.3)}}
@keyframes t-row   {from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}
@keyframes t-dot   {0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.7);opacity:.7}}
@keyframes t-toast {0%{opacity:0;transform:translateY(8px) scale(.95)}15%{opacity:1;transform:none}80%{opacity:1}100%{opacity:0;transform:translateY(-4px)}}
@keyframes t-num   {from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes t-flip  {0%{transform:scaleY(1)}50%{transform:scaleY(0)}100%{transform:scaleY(1)}}
@keyframes t-border{0%,100%{border-color:rgba(255,255,255,.1)}50%{border-color:rgba(255,107,107,.4)}}
@keyframes t-confetti{0%{transform:translateY(0) rotate(0deg);opacity:1}100%{transform:translateY(-60px) rotate(360deg);opacity:0}}
@keyframes t-wipe  {from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0% 0 0)}}

/* ── Panel shell — width/height set via JS, no !important on those ── */
#tsun-panel{
  position:fixed!important;
  bottom:24px!important;right:24px!important;
  /* width/height set by JS after creation */
  min-width:280px!important;min-height:120px!important;max-width:800px!important;max-height:96vh!important;
  background:rgba(9,9,15,.9)!important;
  backdrop-filter:blur(36px) saturate(200%)!important;
  -webkit-backdrop-filter:blur(36px) saturate(200%)!important;
  border:1px solid rgba(255,255,255,.1)!important;
  border-radius:14px!important;
  box-shadow:0 48px 100px rgba(0,0,0,.85),0 10px 32px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08)!important;
  font-family:'Syne',system-ui,sans-serif!important;
  color:#e4e4ec!important;
  z-index:2147483647!important;
  overflow:hidden!important;
  animation:t-in .42s cubic-bezier(.34,1.1,.64,1) both!important;
  user-select:none!important;
  display:flex!important;flex-direction:column!important;
  transition:box-shadow .3s!important;
}
#tsun-panel::before{
  content:''!important;position:absolute!important;inset:0!important;border-radius:14px!important;
  background:linear-gradient(155deg,rgba(255,255,255,.06) 0%,transparent 30%)!important;
  pointer-events:none!important;z-index:0!important;
}
#tsun-panel.t-resizing{cursor:se-resize!important;transition:none!important}
#tsun-panel.t-drag-active{box-shadow:0 64px 120px rgba(0,0,0,.9),0 16px 48px rgba(0,0,0,.65),inset 0 1px 0 rgba(255,255,255,.08)!important;transition:none!important}

/* ── Resize handles (all 8 edges+corners) ── */
.t-rz{position:absolute!important;z-index:20!important;user-select:none!important}
.t-rz-se{bottom:0!important;right:0!important;width:18px!important;height:18px!important;cursor:se-resize!important;
  background:radial-gradient(circle,rgba(255,255,255,.2) 1px,transparent 1px) 3px 3px/4px 4px,
             radial-gradient(circle,rgba(255,255,255,.2) 1px,transparent 1px) 7px 7px/4px 4px,
             radial-gradient(circle,rgba(255,255,255,.2) 1px,transparent 1px) 11px 11px/4px 4px!important}
.t-rz-e {top:18px!important;right:0!important;width:5px!important;bottom:18px!important;cursor:e-resize!important;
  background:linear-gradient(transparent,rgba(255,255,255,.06),transparent)!important;}
.t-rz-s {left:18px!important;bottom:0!important;height:5px!important;right:18px!important;cursor:s-resize!important;
  background:linear-gradient(to right,transparent,rgba(255,255,255,.06),transparent)!important;}
.t-rz-w {top:18px!important;left:0!important;width:5px!important;bottom:18px!important;cursor:w-resize!important}
.t-rz-n {left:18px!important;top:0!important;height:5px!important;right:18px!important;cursor:n-resize!important}
.t-rz-ne{top:0!important;right:0!important;width:18px!important;height:18px!important;cursor:ne-resize!important}
.t-rz-sw{bottom:0!important;left:0!important;width:18px!important;height:18px!important;cursor:sw-resize!important}
.t-rz-nw{top:0!important;left:0!important;width:18px!important;height:18px!important;cursor:nw-resize!important}

/* ── Header ── */
#tsun-header{
  display:flex!important;align-items:center!important;justify-content:space-between!important;
  padding:11px 14px!important;background:rgba(255,255,255,.025)!important;
  border-bottom:1px solid rgba(255,255,255,.07)!important;
  cursor:grab!important;position:relative!important;z-index:2!important;flex-shrink:0!important;
  transition:background .2s!important;
}
#tsun-header:hover{background:rgba(255,255,255,.038)!important}
#tsun-header:active{cursor:grabbing!important}
#tsun-header-left{display:flex!important;align-items:center!important;gap:9px!important}
#tsun-dot{
  width:8px!important;height:8px!important;border-radius:50%!important;
  background:rgba(255,255,255,.18)!important;flex-shrink:0!important;
  transition:background .4s,box-shadow .4s!important;
}
#tsun-dot.running{background:#4dde8e!important;box-shadow:0 0 8px #4dde8e88!important;animation:t-dot 1.4s ease-in-out infinite!important}
#tsun-dot.paused {background:#ffd966!important;box-shadow:0 0 6px #ffd96688!important}
#tsun-dot.done   {background:#4daede!important;box-shadow:0 0 8px #4daede88!important}
#tsun-dot.error  {background:#ff6b6b!important;box-shadow:0 0 8px #ff6b6b88!important}
#tsun-title{font-size:12px!important;font-weight:700!important;letter-spacing:.08em!important;text-transform:uppercase!important;color:#c8c8d8!important}
#tsun-badge{
  font-family:'DM Mono',monospace!important;font-size:9px!important;padding:2px 7px!important;
  border-radius:4px!important;display:none!important;font-weight:500!important;letter-spacing:.06em!important;text-transform:uppercase!important;
  transition:opacity .2s,transform .2s!important;
}
#tsun-badge.csv{background:rgba(77,222,142,.12)!important;color:#4dde8e!important;display:inline-block!important;border:1px solid rgba(77,222,142,.25)!important}
#tsun-badge.txt{background:rgba(77,174,222,.12)!important;color:#4daede!important;display:inline-block!important;border:1px solid rgba(77,174,222,.25)!important}
#tsun-badge.xml{background:rgba(222,77,174,.12)!important;color:#de4dae!important;display:inline-block!important;border:1px solid rgba(222,77,174,.25)!important}

/* Mini-stats (shown in header when collapsed) */
#tsun-mini{
  display:none!important;align-items:center!important;gap:10px!important;
  font-family:'DM Mono',monospace!important;font-size:10px!important;
}
#tsun-mini.show{display:flex!important}
.t-ms{color:#3a3a52!important;transition:color .3s!important}
.t-ms.lit{color:#4dde8e!important}

#tsun-wc{display:flex!important;align-items:center!important;gap:6px!important}
.tsun-wc-btn{
  width:12px!important;height:12px!important;border-radius:50%!important;border:none!important;
  cursor:pointer!important;padding:0!important;transition:filter .15s,transform .12s,box-shadow .15s!important;flex-shrink:0!important;
}
.tsun-wc-btn:hover{filter:brightness(1.4)!important;transform:scale(1.18)!important}
.tsun-wc-btn:active{transform:scale(.88)!important}
#tsun-min-btn {background:#ffd04c!important}
#tsun-close-btn{background:#ff6058!important}

/* ── Body ── */
#tsun-body{
  padding:13px 14px 12px!important;position:relative!important;z-index:1!important;
  overflow-y:auto!important;flex:1!important;display:flex!important;flex-direction:column!important;
}
#tsun-body::-webkit-scrollbar{width:3px!important}
#tsun-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1)!important;border-radius:2px!important}
#tsun-body::-webkit-scrollbar-track{background:transparent!important}

/* ── Dropzone ── */
#tsun-dropzone{
  border:1.5px dashed rgba(255,255,255,.1)!important;border-radius:11px!important;
  padding:22px 16px!important;text-align:center!important;cursor:pointer!important;
  transition:border-color .2s,background .2s,transform .18s,box-shadow .2s!important;
  margin-bottom:10px!important;background:rgba(255,255,255,.016)!important;
  position:relative!important;overflow:hidden!important;
}
#tsun-dropzone::after{
  content:''!important;position:absolute!important;inset:0!important;border-radius:9px!important;
  background:linear-gradient(135deg,rgba(255,255,255,.03) 0%,transparent 60%)!important;
  pointer-events:none!important;
}
#tsun-dropzone:hover{border-color:rgba(255,255,255,.2)!important;background:rgba(255,255,255,.03)!important;transform:translateY(-1px)!important;box-shadow:0 4px 20px rgba(0,0,0,.3)!important}
#tsun-dropzone.drag-over{
  border-color:#ff6b6b!important;background:rgba(255,107,107,.07)!important;
  transform:scale(1.016) translateY(-1px)!important;
  animation:t-glow 1s ease-in-out infinite,t-border 1s ease-in-out infinite!important;
}
#tsun-dropzone.locked{cursor:not-allowed!important;opacity:.28!important;pointer-events:none!important}
#tsun-dz-icon{font-size:22px!important;margin-bottom:6px!important;display:block!important;transition:transform .2s!important}
#tsun-dropzone:hover #tsun-dz-icon{transform:scale(1.12) translateY(-2px)!important}
#tsun-dropzone.drag-over #tsun-dz-icon{transform:scale(1.25)!important;animation:t-flip .4s ease-in-out!important}
#tsun-dz-text{font-size:12px!important;color:#505068!important;line-height:1.6!important}
#tsun-dz-text strong{color:#888!important;font-weight:600!important;display:block!important;margin-bottom:2px!important}
#tsun-dz-hint{font-size:10px!important;color:#2e2e42!important;margin-top:5px!important;font-family:'DM Mono',monospace!important}
#tsun-file-input{display:none!important}

/* ── Cards ── */
.t-card{
  background:rgba(255,255,255,.03)!important;border:1px solid rgba(255,255,255,.065)!important;
  border-radius:10px!important;padding:10px 12px!important;margin-bottom:10px!important;
  transition:border-color .2s,background .2s!important;
}
.t-card:hover{border-color:rgba(255,255,255,.1)!important}

/* ── Parse error ── */
#tsun-perr{
  display:none!important;background:rgba(255,60,60,.07)!important;
  border:1px solid rgba(255,60,60,.22)!important;border-radius:9px!important;
  padding:9px 12px!important;margin-bottom:10px!important;
  font-size:11px!important;color:#ff9090!important;font-family:'DM Mono',monospace!important;
}
#tsun-perr.show{display:block!important;animation:t-up .22s both!important}

/* ── File info ── */
#tsun-fi{display:none!important;margin-bottom:10px!important}
#tsun-fi.show{display:block!important;animation:t-up .22s both!important}
#tsun-fn{
  color:#dddde8!important;font-weight:500!important;font-size:12px!important;
  white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;
  font-family:'DM Mono',monospace!important;display:block!important;margin-bottom:2px!important;
}
#tsun-fm{font-size:10px!important;color:#404055!important;font-family:'DM Mono',monospace!important}

.t-lbl{
  font-size:9px!important;letter-spacing:.1em!important;text-transform:uppercase!important;
  color:#333348!important;font-weight:700!important;margin-bottom:7px!important;display:block!important;
}

/* ── Status filter ── */
#tsun-sf{display:none!important;margin-bottom:10px!important}
#tsun-sf.show{display:block!important;animation:t-up .24s both!important}
#tsun-sf-boxes{display:flex!important;flex-wrap:wrap!important;gap:5px!important}
.t-scb{
  display:flex!important;align-items:center!important;gap:5px!important;
  background:rgba(255,255,255,.025)!important;border:1px solid rgba(255,255,255,.065)!important;
  border-radius:6px!important;padding:5px 9px!important;cursor:pointer!important;
  font-size:11px!important;color:#606080!important;
  transition:border-color .18s,background .18s,color .18s,transform .12s!important;
}
.t-scb:hover{transform:translateY(-1px)!important}
.t-scb input{display:none!important}
.t-scb.on{border-color:rgba(255,107,107,.45)!important;background:rgba(255,107,107,.07)!important;color:#c8c8c8!important}
.t-scb-dot{width:6px!important;height:6px!important;border-radius:50%!important;flex-shrink:0!important;transition:transform .15s!important}
.t-scb.on .t-scb-dot{transform:scale(1.3)!important}
.t-scb-cnt{font-family:'DM Mono',monospace!important;font-size:9px!important;color:#333348!important}
.t-scb.on .t-scb-cnt{color:rgba(255,100,100,.7)!important}

/* ── Summary ── */
#tsun-sum{display:none!important;margin-bottom:10px!important}
#tsun-sum.show{display:block!important;animation:t-up .22s both!important}
#tsun-sum-row{display:flex!important;justify-content:space-between!important;align-items:center!important;font-size:11px!important;color:#404058!important;font-family:'DM Mono',monospace!important;}
#tsun-sum-n{font-size:24px!important;font-weight:800!important;color:#e4e4ec!important;font-family:'Syne',sans-serif!important;transition:transform .15s!important}
#tsun-sum-n.bump{animation:t-pop .22s both!important}

/* ── Preview ── */
#tsun-pv{display:none!important;margin-bottom:10px!important}
#tsun-pv.show{display:block!important;animation:t-up .24s both!important}
#tsun-pv-hdr{display:flex!important;justify-content:space-between!important;align-items:center!important;margin-bottom:7px!important}
#tsun-pv-tog{
  background:none!important;border:none!important;color:#333348!important;cursor:pointer!important;
  font-family:'DM Mono',monospace!important;font-size:9px!important;padding:2px 6px!important;
  border-radius:4px!important;transition:color .15s,background .15s!important;letter-spacing:.04em!important;
}
#tsun-pv-tog:hover{color:#aaa!important;background:rgba(255,255,255,.04)!important}
#tsun-pv-vp{
  background:rgba(0,0,0,.22)!important;border:1px solid rgba(255,255,255,.055)!important;
  border-radius:9px!important;height:160px!important;overflow-y:auto!important;position:relative!important;
  transition:height .28s cubic-bezier(.4,0,.2,1)!important;
}
#tsun-pv-vp::-webkit-scrollbar{width:3px!important}
#tsun-pv-vp::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08)!important;border-radius:2px!important}
.t-pv-row{
  display:flex!important;align-items:center!important;padding:0 10px!important;gap:6px!important;
  border-bottom:1px solid rgba(255,255,255,.028)!important;
  font-size:10px!important;font-family:'DM Mono',monospace!important;
  transition:background .12s!important;
}
.t-pv-row:hover{background:rgba(255,255,255,.02)!important}
.t-pv-t{flex:1!important;color:#777!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
.t-pv-s{color:#303048!important;flex-shrink:0!important;font-size:9px!important}
.t-pv-c{color:#282840!important;flex-shrink:0!important;font-size:9px!important}

/* ── Progress ── */
#tsun-prog{display:none!important;margin-bottom:10px!important}
#tsun-prog.show{display:block!important;animation:t-up .24s both!important}
#tsun-phase{
  font-size:9px!important;letter-spacing:.1em!important;text-transform:uppercase!important;
  font-weight:700!important;margin-bottom:8px!important;min-height:13px!important;
  display:flex!important;align-items:center!important;gap:6px!important;
}
#tsun-phase::before{
  content:''!important;width:5px!important;height:5px!important;border-radius:50%!important;
  flex-shrink:0!important;transition:background .4s!important;background:currentColor!important;
  opacity:.7!important;
}
#tsun-phase.ph-res{color:#de4dae!important}
#tsun-phase.ph-imp{color:#ff6b6b!important}
#tsun-phase.ph-ch {color:#4daede!important}
#tsun-phase.ph-rl {color:#ffd966!important;animation:t-pulse .9s ease-in-out infinite!important}
#tsun-bar-wrap{
  background:rgba(255,255,255,.055)!important;border-radius:6px!important;height:5px!important;
  overflow:hidden!important;margin-bottom:7px!important;position:relative!important;
  box-shadow:inset 0 1px 2px rgba(0,0,0,.4)!important;
}
#tsun-bar{
  height:100%!important;border-radius:6px!important;width:0%!important;
  background:linear-gradient(90deg,#ff6b6b,#ff8c44)!important;
  transition:width .38s cubic-bezier(.4,0,.2,1)!important;
  position:relative!important;overflow:hidden!important;
}
#tsun-bar.ph-res-bar{background:linear-gradient(90deg,#de4dae,#9933cc)!important}
#tsun-bar.ph-ch-bar {background:linear-gradient(90deg,#4daede,#2266cc)!important}
#tsun-bar::after{
  content:''!important;position:absolute!important;inset:0!important;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent)!important;
  animation:t-shim 1.6s linear infinite!important;
}
#tsun-pr-row{display:flex!important;justify-content:space-between!important;font-family:'DM Mono',monospace!important;font-size:10px!important;color:#333350!important;}
#tsun-cur-t{
  font-size:10px!important;color:#404060!important;margin-top:5px!important;
  white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;
  font-family:'DM Mono',monospace!important;display:block!important;
  animation:t-wipe .25s ease both!important;
}
#tsun-spd{font-size:9px!important;color:#252538!important;font-family:'DM Mono',monospace!important;margin-top:3px!important;transition:color .5s!important;display:block!important;min-height:13px!important}
#tsun-spd.on{color:#4dde8e!important}

/* ── Conf stats ── */
#tsun-conf{display:none!important;margin-bottom:10px!important}
#tsun-conf.show{display:block!important;animation:t-up .22s both!important}
#tsun-conf .t-card{padding:8px 12px!important;margin-bottom:0!important}
#tsun-panel .t-cr{display:flex!important;flex-direction:row!important;justify-content:space-between!important;align-items:center!important;padding:4px 0!important;gap:8px!important;font-family:'DM Mono',monospace!important;font-size:10px!important;color:#404060!important;}
#tsun-panel .t-cr+.t-cr{border-top:1px solid rgba(255,255,255,.04)!important}
#tsun-panel .t-cl{flex:1!important;white-space:nowrap!important}
#tsun-panel .t-cv{font-weight:800!important;min-width:32px!important;text-align:right!important;flex-shrink:0!important;font-size:14px!important;font-family:'Syne',sans-serif!important;transition:transform .2s!important;}
#tsun-panel .t-cv.bump{animation:t-num .2s both!important}
.c-ex{color:#4dde8e!important}.c-fo{color:#4daede!important}.c-fa{color:#ff6b6b!important}

/* ── Done ── */
#tsun-done{display:none!important;text-align:center!important;padding:10px 0 6px!important;margin-bottom:10px!important;position:relative!important}
#tsun-done.show{display:block!important;animation:t-pop .36s cubic-bezier(.34,1.4,.64,1) both!important}
#tsun-done-emoji{font-size:28px!important;display:block!important;margin-bottom:4px!important}
#tsun-done-title{font-size:16px!important;font-weight:800!important;margin-bottom:4px!important}
#tsun-done-sub{font-size:10px!important;color:#404060!important;font-family:'DM Mono',monospace!important;line-height:1.6!important}

/* ── Confetti pieces ── */
.t-cf{position:absolute!important;pointer-events:none!important;border-radius:50%!important;animation:t-confetti .8s ease-out both!important}

/* ── Failed list ── */
#tsun-fails{display:none!important;margin-bottom:10px!important}
#tsun-fails.show{display:block!important;animation:t-up .24s both!important}
#tsun-fails-hdr{display:flex!important;justify-content:space-between!important;align-items:center!important;margin-bottom:7px!important;cursor:pointer!important;}
#tsun-fails-hdr:hover .t-lbl{color:#666!important}
#tsun-fails-tog{background:none!important;border:none!important;color:#333350!important;cursor:pointer!important;font-size:13px!important;padding:2px 5px!important;border-radius:4px!important;transition:color .15s,background .15s!important;line-height:1!important;}
#tsun-fails-tog:hover{color:#aaa!important;background:rgba(255,255,255,.04)!important}
#tsun-fails-list{max-height:180px!important;overflow-y:auto!important;background:rgba(0,0,0,.2)!important;border:1px solid rgba(255,255,255,.055)!important;border-radius:9px!important;}
#tsun-fails-list::-webkit-scrollbar{width:3px!important}
#tsun-fails-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.09)!important;border-radius:2px!important}
.t-fr{display:flex!important;align-items:center!important;gap:8px!important;padding:7px 11px!important;border-bottom:1px solid rgba(255,255,255,.035)!important;transition:background .15s!important;animation:t-row .22s both!important;}
.t-fr:last-child{border-bottom:none!important}
.t-fr:hover{background:rgba(255,255,255,.018)!important}
.t-fr.ok{background:rgba(77,222,142,.04)!important}
.t-fi{flex:1!important;overflow:hidden!important;min-width:0!important}
.t-ft{font-size:11px!important;color:#aaa!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;font-family:'DM Mono',monospace!important;display:block!important}
.t-frsn{font-size:9px!important;color:#2e2e46!important;font-family:'DM Mono',monospace!important;display:block!important;margin-top:1px!important}
.t-r1{
  flex-shrink:0!important;background:none!important;border:1px solid rgba(255,255,255,.07)!important;
  border-radius:5px!important;color:#444!important;cursor:pointer!important;padding:3px 8px!important;
  font-size:10px!important;font-family:'Syne',sans-serif!important;font-weight:700!important;
  transition:border-color .15s,color .15s,background .15s,transform .1s!important;
}
.t-r1:hover{border-color:rgba(255,107,107,.4)!important;color:#ff8080!important;background:rgba(255,107,107,.06)!important;transform:scale(1.05)!important}
.t-r1:disabled{opacity:.2!important;cursor:not-allowed!important}
.t-fst{flex-shrink:0!important;font-size:13px!important;width:16px!important;text-align:center!important}
.spin{display:inline-block!important;animation:t-spin .6s linear infinite!important}

/* ── Keyboard shortcut hint ── */
#tsun-kbhint{
  font-size:9px!important;color:#262638!important;font-family:'DM Mono',monospace!important;
  text-align:center!important;padding:4px 0 0!important;letter-spacing:.02em!important;
  transition:color .3s!important;
}
#tsun-kbhint.lit{color:#3a3a55!important}

/* ── Toast ── */
#tsun-toast{
  position:absolute!important;bottom:72px!important;left:50%!important;transform:translateX(-50%)!important;
  background:rgba(30,30,44,.95)!important;border:1px solid rgba(255,255,255,.1)!important;
  border-radius:8px!important;padding:7px 14px!important;
  font-size:11px!important;font-family:'DM Mono',monospace!important;color:#ccc!important;
  white-space:nowrap!important;pointer-events:none!important;z-index:30!important;
  opacity:0!important;
}
#tsun-toast.show{animation:t-toast 2.8s ease forwards!important}
#tsun-toast.t-ok {border-color:rgba(77,222,142,.3)!important;color:#4dde8e!important}
#tsun-toast.t-err{border-color:rgba(255,107,107,.3)!important;color:#ff8080!important}

/* ── Buttons ── */
#tsun-btns{margin-top:auto!important;padding-top:8px!important;flex-shrink:0!important}
#tsun-btn-p{display:flex!important;gap:7px!important;margin-bottom:6px!important}
#tsun-btn-s{display:flex!important;gap:6px!important;flex-wrap:wrap!important}
.tb{
  flex:1!important;border:none!important;border-radius:8px!important;padding:9px 10px!important;
  font-family:'Syne',sans-serif!important;font-size:11px!important;font-weight:700!important;
  letter-spacing:.04em!important;cursor:pointer!important;white-space:nowrap!important;
  position:relative!important;overflow:hidden!important;
  transition:filter .15s,transform .12s,box-shadow .2s,opacity .15s!important;
}
.tb::after{content:''!important;position:absolute!important;inset:0!important;background:rgba(255,255,255,.1)!important;opacity:0!important;transition:opacity .15s!important;border-radius:8px!important;}
.tb:hover:not(:disabled)::after{opacity:.4!important}
.tb:active:not(:disabled){transform:scale(.95)!important}
.tb:active:not(:disabled)::after{opacity:1!important}
.tb:disabled{opacity:.18!important;cursor:not-allowed!important;transform:none!important}
#tsun-start{background:linear-gradient(135deg,#ff5555,#ff2222)!important;color:#fff!important;box-shadow:0 2px 18px rgba(255,40,40,.38)!important;}
#tsun-start:hover:not(:disabled){filter:brightness(1.12)!important;box-shadow:0 4px 26px rgba(255,40,40,.56)!important}
#tsun-pause{display:none!important;background:rgba(255,255,255,.055)!important;border:1px solid rgba(255,255,255,.1)!important;color:#b0b0c8!important;}
#tsun-pause.show{display:block!important;animation:t-up .18s both!important}
#tsun-pause:hover:not(:disabled){background:rgba(255,255,255,.09)!important}
#tsun-cancel{display:none!important;background:rgba(255,50,50,.06)!important;border:1px solid rgba(255,50,50,.17)!important;color:#bb6868!important;}
#tsun-cancel.show{display:block!important;animation:t-up .18s both!important}
#tsun-cancel:hover{background:rgba(255,50,50,.13)!important;color:#ff8888!important}
#tsun-retry{display:none!important;background:rgba(77,222,142,.06)!important;border:1px solid rgba(77,222,142,.18)!important;color:#4dde8e!important}
#tsun-retry.show{display:block!important}
#tsun-retry:hover{background:rgba(77,222,142,.12)!important}
#tsun-logdl{display:none!important;background:rgba(255,170,50,.06)!important;border:1px solid rgba(255,170,50,.18)!important;color:#c09040!important}
#tsun-logdl.show{display:block!important}
#tsun-logdl:hover{background:rgba(255,170,50,.12)!important}
#tsun-expq{display:none!important;background:rgba(77,174,222,.06)!important;border:1px solid rgba(77,174,222,.18)!important;color:#4daede!important}
#tsun-expq.show{display:block!important}
#tsun-expq:hover{background:rgba(77,174,222,.12)!important}

/* ── Footer ── */
#tsun-footer{
  padding-top:8px!important;border-top:1px solid rgba(255,255,255,.045)!important;
  margin-top:8px!important;flex-shrink:0!important;
  display:flex!important;justify-content:space-between!important;align-items:center!important;
}
.t-flink{font-size:10px!important;color:#2a2a40!important;text-decoration:none!important;font-family:'DM Mono',monospace!important;transition:color .15s!important;}
.t-flink:hover{color:#777!important}
#tsun-ver{font-size:9px!important;color:#1e1e30!important;font-family:'DM Mono',monospace!important}
  `;
  document.head.appendChild(style);

  /* ── Panel HTML ─────────────────────────────────────────────── */
  const panel = document.createElement('div');
  panel.id = 'tsun-panel';
  panel.innerHTML = `
    <div id="tsun-header">
      <div id="tsun-header-left">
        <span id="tsun-dot"></span>
        <span id="tsun-title">Tsun Importer</span>
        <span id="tsun-badge"></span>
      </div>
      <div id="tsun-mini">
        <span class="t-ms" id="t-ms-ex">—</span>
        <span style="color:#1e1e30">·</span>
        <span class="t-ms" id="t-ms-fo">—</span>
        <span style="color:#1e1e30">·</span>
        <span class="t-ms" id="t-ms-fa">—</span>
      </div>
      <div id="tsun-wc">
        <button class="tsun-wc-btn" id="tsun-min-btn"   title="Minimise (M)"></button>
        <button class="tsun-wc-btn" id="tsun-close-btn" title="Close"></button>
      </div>
    </div>

    <div id="tsun-body">
      <div id="tsun-dropzone">
        <span id="tsun-dz-icon">📂</span>
        <div id="tsun-dz-text">
          <strong>Drop your file here</strong>
          Comick <code>.csv</code> · MU/Weebcentral <code>.txt</code> · MAL <code>.xml</code>
        </div>
        <div id="tsun-dz-hint">or click to browse</div>
        <input type="file" id="tsun-file-input" accept=".csv,.txt,.xml">
      </div>

      <div id="tsun-perr"></div>

      <div id="tsun-fi" class="t-card">
        <span id="tsun-fn"></span>
        <span id="tsun-fm"></span>
      </div>

      <div id="tsun-sf">
        <span class="t-lbl">Import statuses</span>
        <div id="tsun-sf-boxes"></div>
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
        <div id="tsun-bar-wrap"><div id="tsun-bar"></div></div>
        <div id="tsun-pr-row">
          <span id="tsun-pr-n">0 / 0</span>
          <span id="tsun-skip-n"></span>
        </div>
        <span id="tsun-cur-t"></span>
        <span id="tsun-spd"></span>
      </div>

      <div id="tsun-conf">
        <div class="t-card">
          <div class="t-cr"><span class="t-cl">Tracker map</span><span class="t-cv c-ex" id="c-ex">0</span></div>
          <div class="t-cr"><span class="t-cl">Title search</span><span class="t-cv c-fo" id="c-fo">0</span></div>
          <div class="t-cr"><span class="t-cl">Not found</span>  <span class="t-cv c-fa" id="c-fa">0</span></div>
        </div>
      </div>

      <div id="tsun-done">
        <span id="tsun-done-emoji"></span>
        <div id="tsun-done-title"></div>
        <div id="tsun-done-sub"></div>
      </div>

      <div id="tsun-fails">
        <div id="tsun-fails-hdr">
          <span class="t-lbl" style="margin-bottom:0">Failed entries</span>
          <button id="tsun-fails-tog">▾</button>
        </div>
        <div id="tsun-fails-list"></div>
      </div>

      <div id="tsun-btns">
        <div id="tsun-btn-p">
          <button class="tb" id="tsun-start" disabled>Start Import</button>
          <button class="tb" id="tsun-pause">Pause</button>
          <button class="tb" id="tsun-cancel">✕ Cancel</button>
        </div>
        <div id="tsun-btn-s">
          <button class="tb" id="tsun-retry">↺ Retry All</button>
          <button class="tb" id="tsun-logdl">⬇ Error Log</button>
          <button class="tb" id="tsun-expq">⬇ Export</button>
        </div>
      </div>

      <div id="tsun-kbhint">Space · pause &nbsp;|&nbsp; Esc · cancel &nbsp;|&nbsp; M · minimise</div>

      <div id="tsun-footer">
        <a href="https://github.com/OnlyShresth/weebcentral-extractor" target="_blank" class="t-flink">Weebcentral Guide ↗</a>
        <span id="tsun-ver">v3.0</span>
      </div>
    </div>

    <!-- resize handles -->
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

  /* ── Set initial size via JS (so CSS can't fight us) ─────── */
  panel.style.width  = '390px';
  panel.style.height = 'auto';

  /* ── Element refs ───────────────────────────────────────────── */
  const $ = id => document.getElementById(id);
  const dz=    $('tsun-dropzone'), fi=$('tsun-file-input');
  const perr=  $('tsun-perr'),     fInfo=$('tsun-fi'), fn=$('tsun-fn'), fm=$('tsun-fm');
  const badge= $('tsun-badge'),    dot=$('tsun-dot');
  const sf=    $('tsun-sf'),       sfBoxes=$('tsun-sf-boxes');
  const sumBox=$('tsun-sum'),      sumN=$('tsun-sum-n');
  const pvSec= $('tsun-pv'),       pvVp=$('tsun-pv-vp'), pvTog=$('tsun-pv-tog');
  const progSec=$('tsun-prog'),    phLbl=$('tsun-phase'), bar=$('tsun-bar');
  const prN=   $('tsun-pr-n'),     skipN=$('tsun-skip-n'), curT=$('tsun-cur-t'), spdLbl=$('tsun-spd');
  const confBox=$('tsun-conf');
  const doneBox=$('tsun-done');
  const failsSec=$('tsun-fails'),  failList=$('tsun-fails-list');
  const startBtn=$('tsun-start'),  pauseBtn=$('tsun-pause'), cancelBtn=$('tsun-cancel');
  const retryBtn=$('tsun-retry'),  logBtn=$('tsun-logdl'),   expBtn=$('tsun-expq');
  const toast=  $('tsun-toast'),   kbhint=$('tsun-kbhint');
  const miniBox=$('tsun-mini');
  const cStats={exact:0,found:0,fail:0};

  /* ── Toast helper ───────────────────────────────────────────── */
  let toastTimer;
  function showToast(msg,type=''){
    clearTimeout(toastTimer);
    toast.textContent=msg; toast.className='show '+(type?'t-'+type:'');
    toastTimer=setTimeout(()=>toast.className='',3000);
  }

  /* ── Number count-up animation ──────────────────────────────── */
  function animNum(el,to){
    const from=parseInt(el.textContent)||0; if(from===to) return;
    const dur=Math.min(600,Math.abs(to-from)*18); const start=performance.now();
    function step(now){
      const t=Math.min(1,(now-start)/dur); const v=Math.round(from+(to-from)*t);
      el.textContent=v; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
      if(t<1) requestAnimationFrame(step); else el.textContent=to;
    }
    requestAnimationFrame(step);
  }

  /* ═══════════════════════════════════════════════════════════
     DRAG
     On first move, snapshot pixel size and switch to left/top
     anchoring so CSS bottom/right don't fight us.
  ═══════════════════════════════════════════════════════════ */
  let dragOffX=0,dragOffY=0,dragging=false,dragAnchored=false;
  $('tsun-header').addEventListener('mousedown',e=>{
    if(e.target.classList.contains('tsun-wc-btn')) return;
    dragging=true; dragAnchored=false;
    const r=panel.getBoundingClientRect();
    dragOffX=e.clientX-r.left; dragOffY=e.clientY-r.top;
    panel.style.transition='none'; panel.classList.add('t-drag-active');
    e.preventDefault();
  });
  document.addEventListener('mousemove',e=>{
    if(!dragging) return;
    if(!dragAnchored){
      dragAnchored=true;
      const r=panel.getBoundingClientRect();
      panel.style.width=r.width+'px'; panel.style.height=r.height+'px';
      panel.style.right='auto'; panel.style.bottom='auto';
    }
    const x=Math.max(0,Math.min(e.clientX-dragOffX,window.innerWidth-panel.offsetWidth));
    const y=Math.max(0,Math.min(e.clientY-dragOffY,window.innerHeight-panel.offsetHeight));
    panel.style.left=x+'px'; panel.style.top=y+'px';
  });
  document.addEventListener('mouseup',()=>{
    if(!dragging) return; dragging=false;
    panel.style.transition=''; panel.classList.remove('t-drag-active');
  });

  /* ═══════════════════════════════════════════════════════════
     RESIZE — 8-directional via data-dir attribute
     Anchors the opposite corner so the panel grows/shrinks
     in the correct direction without jumping.
  ═══════════════════════════════════════════════════════════ */
  let rzActive=false,rzDir='',rzStartX=0,rzStartY=0;
  let rzStartW=0,rzStartH=0,rzStartL=0,rzStartT=0;
  const MIN_W=280, MIN_H=120, MAX_W=800;

  document.querySelectorAll('.t-rz').forEach(h=>{
    h.addEventListener('mousedown',e=>{
      rzActive=true; rzDir=h.dataset.dir;
      rzStartX=e.clientX; rzStartY=e.clientY;
      const r=panel.getBoundingClientRect();
      rzStartW=r.width; rzStartH=r.height; rzStartL=r.left; rzStartT=r.top;
      // Anchor to opposite corner
      panel.style.right='auto'; panel.style.bottom='auto';
      panel.style.left=rzStartL+'px'; panel.style.top=rzStartT+'px';
      panel.style.width=rzStartW+'px'; panel.style.height=rzStartH+'px';
      panel.classList.add('t-resizing');
      panel.style.transition='none';
      e.preventDefault(); e.stopPropagation();
    });
  });

  document.addEventListener('mousemove',e=>{
    if(!rzActive) return;
    const dx=e.clientX-rzStartX, dy=e.clientY-rzStartY;
    let w=rzStartW,h=rzStartH,l=rzStartL,t=rzStartT;

    if(rzDir.includes('e')) w=Math.max(MIN_W,Math.min(MAX_W,rzStartW+dx));
    if(rzDir.includes('s')) h=Math.max(MIN_H,rzStartH+dy);
    if(rzDir.includes('w')){ const nw=Math.max(MIN_W,Math.min(MAX_W,rzStartW-dx)); l=rzStartL+(rzStartW-nw); w=nw; }
    if(rzDir.includes('n')){ const nh=Math.max(MIN_H,rzStartH-dy); t=rzStartT+(rzStartH-nh); h=nh; }

    panel.style.width=w+'px'; panel.style.height=h+'px';
    panel.style.left=l+'px'; panel.style.top=t+'px';
    // Adjust body max-height
    $('tsun-body').style.maxHeight=(h-46)+'px';
  });
  document.addEventListener('mouseup',()=>{
    if(!rzActive) return; rzActive=false;
    panel.classList.remove('t-resizing'); panel.style.transition='';
  });

  /* ── Window controls ────────────────────────────────────────── */
  let collapsed=false;
  $('tsun-min-btn').addEventListener('click',e=>{
    e.stopPropagation(); collapsed=!collapsed;
    $('tsun-body').style.display=collapsed?'none':'';
    miniBox.classList.toggle('show', collapsed&&isRunning);
  });
  $('tsun-close-btn').addEventListener('click',e=>{
    e.stopPropagation();
    if(isRunning&&!confirm('Import running. Close anyway?')) return;
    panel.remove();
  });

  /* ── Keyboard shortcuts ─────────────────────────────────────── */
  document.addEventListener('keydown',e=>{
    if(!panel.isConnected) return;
    // Don't fire when user is typing in an input
    if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if(e.key===' '&&isRunning){e.preventDefault();pauseBtn.click();kbhint.classList.add('lit');setTimeout(()=>kbhint.classList.remove('lit'),400);}
    if(e.key==='Escape'&&isPaused){cancelBtn.click();}
    if((e.key==='m'||e.key==='M')&&!e.ctrlKey&&!e.metaKey){$('tsun-min-btn').click();}
  });

  /* ── Drop file ──────────────────────────────────────────────── */
  dz.addEventListener('dragover', e=>{e.preventDefault();if(!isRunning)dz.classList.add('drag-over');});
  dz.addEventListener('dragleave',()=>dz.classList.remove('drag-over'));
  dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag-over');const f=e.dataTransfer.files[0];if(f)handleFile(f);});
  dz.addEventListener('click',()=>{if(!isRunning)fi.click();});
  fi.addEventListener('change',()=>{if(fi.files[0])handleFile(fi.files[0]);});

  /* ── File handling ──────────────────────────────────────────── */
  async function handleFile(file){
    if(isRunning) return;
    resetUI();
    const ext=file.name.split('.').pop().toLowerCase();
    if(!['csv','txt','xml'].includes(ext)){showToast('Unsupported file','err');showErr('Unsupported file. Use .csv, .txt or .xml');return;}
    currentFormat=ext;
    const text=(await file.text()).replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    fn.textContent=file.name;
    fm.textContent={csv:'Comick CSV',txt:'MU / Weebcentral TXT',xml:'MyAnimeList XML'}[ext];
    badge.textContent=ext.toUpperCase(); badge.className=ext;
    fInfo.classList.add('show');
    try{ pendingEntries=ext==='csv'?parseCSV(text):ext==='txt'?parseTXT(text):parseXML(text); }
    catch(er){showErr('Parse error: '+er.message);showToast('Parse failed','err');return;}
    if(!pendingEntries.length){showErr('No valid entries found.');startBtn.disabled=true;return;}
    if(ext==='xml'){buildSF(pendingEntries);sf.classList.add('show');}
    updateSum(); buildPrev(pendingEntries); pvSec.classList.add('show');
    startBtn.disabled=false;
    showToast(`${pendingEntries.length} entries loaded`,'ok');
  }
  function showErr(m){perr.textContent='⚠ '+m;perr.classList.add('show');}

  /* ── Parsers ────────────────────────────────────────────────── */
  function parseCSV(t){
    const lines=t.split('\n').filter(l=>l.trim());
    if(lines.length<2) return [];
    const hdr=csvL(lines[0]).map(h=>h.toLowerCase());
    const ti=hdr.findIndex(h=>h.includes('title')),ui=hdr.findIndex(h=>h.includes('url')||h.includes('link')),ci=hdr.findIndex(h=>h.includes('chapter'));
    return lines.slice(1).map(l=>{const c=csvL(l);return{title:c[ti]||'',url:c[ui]||'',chapter:parseInt(c[ci])||0,source:'comick'};}).filter(e=>e.title||e.url);
  }
  function parseTXT(t){ return t.split('\n').map(l=>l.trim()).filter(l=>l.startsWith('https://www.mangaupdates.com')).map(url=>({url,source:'mu'})); }
  function parseXML(t){
    const doc=new DOMParser().parseFromString(t,'application/xml');
    if(doc.querySelector('parsererror')) throw new Error('Invalid XML');
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
  const SCOLORS={'Reading':'#4daede','Completed':'#4dde8e','On-Hold':'#ffd966','Dropped':'#ff6b6b','Plan to Read':'#aaaacc'};
  function buildSF(entries){
    const counts={};entries.forEach(e=>{if(e.status)counts[e.status]=(counts[e.status]||0)+1;});
    sfBoxes.innerHTML='';
    Object.entries(counts).sort((a,b)=>b[1]-a[1]).forEach(([st,cnt])=>{
      const lbl=document.createElement('label');lbl.className='t-scb on';
      const cb=document.createElement('input');cb.type='checkbox';cb.className='t-sci';cb.dataset.status=st;cb.checked=true;
      const d=document.createElement('span');d.className='t-scb-dot';d.style.background=SCOLORS[st]||'#666';
      const tx=document.createTextNode(' '+st+' ');
      const cn=document.createElement('span');cn.className='t-scb-cnt';cn.textContent=cnt;
      lbl.appendChild(cb);lbl.appendChild(d);lbl.appendChild(tx);lbl.appendChild(cn);
      cb.addEventListener('change',ev=>{lbl.classList.toggle('on',ev.target.checked);updateSum();});
      sfBoxes.appendChild(lbl);
    });
  }
  function getSelSt(){return[...sfBoxes.querySelectorAll('.t-sci:checked')].map(i=>i.dataset.status);}
  function getFiltered(){return currentFormat!=='xml'?pendingEntries:pendingEntries.filter(e=>getSelSt().includes(e.status));}
  function updateSum(){
    const n=getFiltered().length;
    animNum(sumN,n); sumN.classList.remove('bump'); void sumN.offsetWidth; sumN.classList.add('bump');
    sumBox.classList.add('show'); buildPrev(getFiltered());
  }

  /* ── Preview virtual scroll ─────────────────────────────────── */
  let pvOpen=false,pvEntries=[];const RH=22;
  pvTog.addEventListener('click',()=>{
    pvOpen=!pvOpen;
    pvVp.style.display=pvOpen?'block':'none';
    pvTog.textContent=pvOpen?'Hide ▴':'Show ▾';
    if(pvOpen)renderPv();
  });
  pvVp.addEventListener('scroll',renderPv,{passive:true});
  function buildPrev(e){pvEntries=e;if(pvOpen)renderPv();}
  function renderPv(){
    if(!pvOpen||!pvEntries.length)return;
    const st=pvVp.scrollTop,vph=pvVp.clientHeight;
    const s=Math.max(0,Math.floor(st/RH)-2),e=Math.min(pvEntries.length,Math.ceil((st+vph)/RH)+3);
    let sp=pvVp.querySelector('.t-pvsp');
    if(!sp){sp=document.createElement('div');sp.className='t-pvsp';sp.style.cssText='position:relative';pvVp.innerHTML='';pvVp.appendChild(sp);}
    sp.style.height=(pvEntries.length*RH)+'px';
    [...sp.querySelectorAll('.t-pv-row')].forEach(el=>{const i=parseInt(el.dataset.i,10);if(i<s||i>=e)el.remove();});
    const ex=new Set([...sp.querySelectorAll('.t-pv-row')].map(el=>parseInt(el.dataset.i,10)));
    for(let i=s;i<e;i++){
      if(ex.has(i))continue;
      const en=pvEntries[i];
      const row=document.createElement('div');row.className='t-pv-row';row.dataset.i=i;
      row.style.cssText=`position:absolute;top:${i*RH}px;left:0;right:0;height:${RH}px;`;
      const tt=document.createElement('span');tt.className='t-pv-t';tt.textContent=en.title||en.url||'—';
      const sv=document.createElement('span');sv.className='t-pv-s';sv.textContent=en.status||en.source||'';
      const ch=document.createElement('span');ch.className='t-pv-c';ch.textContent=en.chaptersRead>0?`ch.${en.chaptersRead}`:'';
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
    if(trackerArr&&(now-trackerFetchedAt)<TRACKER_MAP_TTL_MS) return;
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
    if(!query) return null;
    try{
      const params=new URLSearchParams({q:query,limit:5,query_by:'title,englishTitle',include_fields:'id,title'});
      const res=await fetch(ATSU_SEARCH_PATH+'?'+params);
      if(!res.ok) return null;
      return (await res.json()).hits?.[0]?.document??null;
    }catch{return null;}
  }

  /* ── Resolve entry ──────────────────────────────────────────── */
  async function resolveEntry(entry){
    if(entry.source==='mal'){
      if(entry.malId&&trackerByMal[String(entry.malId)]) return{atsuId:trackerByMal[String(entry.malId)],confidence:'exact'};
      if(entry.title){const hit=await searchAtsu(entry.title);if(hit)return{atsuId:hit.id,confidence:'found'};}
      return{atsuId:null,confidence:null};
    }
    if(entry.source==='mu'){
      const muId=entry.url.match(/\/series\/([a-z0-9]+)/i)?.[1];
      if(muId&&trackerByMu[muId]) return{atsuId:trackerByMu[muId],confidence:'exact'};
      const slug=entry.url.match(/\/series\/[a-z0-9]+\/([^/]+)/i)?.[1];
      if(slug){const hit=await searchAtsu(slug.replace(/-/g,' '));if(hit)return{atsuId:hit.id,confidence:'found'};}
      return{atsuId:null,confidence:null};
    }
    if(entry.source==='comick'){
      const muId=entry.url.match(/mangaupdates\.com\/series\/([a-z0-9]+)/i)?.[1];
      if(muId&&trackerByMu[muId]) return{atsuId:trackerByMu[muId],confidence:'exact'};
      if(entry.title){const hit=await searchAtsu(entry.title);if(hit)return{atsuId:hit.id,confidence:'found'};}
      return{atsuId:null,confidence:null};
    }
    return{atsuId:null,confidence:null};
  }

  /* ── Bookmark / chapter ─────────────────────────────────────── */
  async function postBookmarks(chunk){
    for(let a=0;a<3;a++){
      try{
        const res=await fetch(ATSU_BOOKMARKS_PATH,{method:'POST',headers:{'content-type':'application/json'},credentials:'include',body:JSON.stringify(chunk)});
        if(res.status===429){await sleep(2500);continue;}
        if(res.ok) return true;
      }catch{}
      await sleep(800);
    }
    return false;
  }
  async function syncChapter(atsuId,chapterNum){
    try{
      const res=await fetch(ATSU_CHAPTERS_PATH+'?mangaId='+atsuId,{credentials:'include'});
      if(!res.ok) return false;
      const target=((await res.json()).chapters||[]).find(c=>Number(c.number)===Number(chapterNum));
      if(!target) return false;
      const payload={progress:[{mangaScanlationId:target.scanlationMangaId,mangaId:atsuId,chapterId:target.id,page:Math.max(0,(Number(target.pageCount)||1)-1),frac:1,pages:Number(target.pageCount)||1,ts:Date.now(),strip:false}],deletedChapters:[]};
      return (await fetch(ATSU_PROGRESS_PATH,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})).ok;
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
  $('tsun-fails-hdr').addEventListener('click',()=>{failsOpen=!failsOpen;failList.style.display=failsOpen?'block':'none';$('tsun-fails-tog').textContent=failsOpen?'▾':'▸';});
  function buildFails(){
    failList.innerHTML='';
    failedEntries.forEach((en,idx)=>{
      const row=document.createElement('div');row.className='t-fr';row.style.animationDelay=Math.min(idx*.028,.35)+'s';
      const st=document.createElement('span');st.className='t-fst';st.textContent='✗';st.style.color='#ff6b6b';
      const inf=document.createElement('div');inf.className='t-fi';
      const tl=document.createElement('div');tl.className='t-ft';tl.textContent=en.title||en.url||en.malId||'—';
      const re=document.createElement('div');re.className='t-frsn';re.textContent=en.reason||'Unknown';
      inf.appendChild(tl);inf.appendChild(re);
      const rb=document.createElement('button');rb.className='t-r1';rb.textContent='↺';
      rb.addEventListener('click',async()=>{
        rb.disabled=true;st.innerHTML='<span class="spin">⟳</span>';
        const r=await retrySingle(en);
        if(r.success){st.textContent='✓';st.style.color='#4dde8e';row.classList.add('ok');re.textContent='Imported';rb.style.display='none';failedEntries.splice(failedEntries.indexOf(en),1);}
        else{st.textContent='✗';st.style.color='#ff6b6b';re.textContent=r.reason;rb.disabled=false;}
      });
      row.appendChild(st);row.appendChild(inf);row.appendChild(rb);failList.appendChild(row);
    });
  }

  /* ── Confetti burst ─────────────────────────────────────────── */
  function confetti(){
    const colors=['#4dde8e','#ffd966','#ff6b6b','#4daede','#de4dae','#ff9944'];
    for(let i=0;i<14;i++){
      const el=document.createElement('div');el.className='t-cf';
      const sz=4+Math.random()*5;
      el.style.cssText=`width:${sz}px;height:${sz}px;background:${colors[i%colors.length]};
        left:${20+Math.random()*60}%;top:${30+Math.random()*30}%;
        animation-delay:${Math.random()*.4}s;animation-duration:${.7+Math.random()*.5}s`;
      doneBox.appendChild(el);
      setTimeout(()=>el.remove(),1400);
    }
  }

  /* ── Export ─────────────────────────────────────────────────── */
  expBtn.addEventListener('click',()=>{
    const urls=failedEntries.filter(e=>e.url).map(e=>e.url);
    if(!urls.length){showToast('Nothing to export','err');return;}
    const el=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([urls.join('\n')],{type:'text/plain'})),download:'tsun_failed.txt'});
    el.click();URL.revokeObjectURL(el.href);showToast('Exported '+urls.length+' entries','ok');
  });

  /* ── Conf stats ─────────────────────────────────────────────── */
  function updConf(){
    animNum($('c-ex'),cStats.exact);
    animNum($('c-fo'),cStats.found);
    animNum($('c-fa'),cStats.fail);
    // Mini header stats
    $('t-ms-ex').textContent=cStats.exact||'—'; $('t-ms-ex').classList.toggle('lit',cStats.exact>0);
    $('t-ms-fo').textContent=cStats.found||'—'; $('t-ms-fo').classList.toggle('lit',cStats.found>0);
    $('t-ms-fa').textContent=cStats.fail||'—';
  }

  /* ── Speed / ETA ────────────────────────────────────────────── */
  let p1Start=0;
  function updSpd(done,total){
    const el=(Date.now()-p1Start)/1000;if(el<0.5||done<2)return;
    const rate=done/el,rem=total-done,eta=rem/Math.max(rate,.001);
    const etaStr=eta<60?Math.ceil(eta)+'s':eta<3600?Math.floor(eta/60)+'m '+Math.ceil(eta%60)+'s':(eta/3600).toFixed(1)+'h';
    spdLbl.textContent=`${rate.toFixed(1)}/s · ETA ${etaStr}`;spdLbl.className='on';
  }

  /* ── Progress helpers ───────────────────────────────────────── */
  function setProgress(cur,tot,title=''){
    const pct=tot>0?Math.round((cur/tot)*100):0;
    bar.style.width=pct+'%'; prN.textContent=`${cur} / ${tot}`; curT.textContent=title;
  }
  function setPhase(cls,lbl,barCls=''){
    phLbl.textContent=lbl; phLbl.className=cls;
    bar.className=barCls;
  }
  function setDot(s){dot.className=s||'';}
  function updMini(){if(collapsed)miniBox.classList.toggle('show',isRunning);}

  /* ── Reset ──────────────────────────────────────────────────── */
  function resetUI(){
    currentFormat=null;pendingEntries=[];importQueue=[];importIndex=0;
    isPaused=false;isRunning=false;isCancelled=false;failedEntries=[];
    pvEntries=[];pvOpen=false;cStats.exact=cStats.found=cStats.fail=0;
    [fInfo,sf,sumBox,pvSec,progSec,confBox,doneBox,failsSec].forEach(el=>el.classList.remove('show'));
    [pauseBtn,cancelBtn,retryBtn,logBtn,expBtn].forEach(el=>el.classList.remove('show'));
    perr.classList.remove('show');badge.className='';
    startBtn.disabled=false;startBtn.textContent='Start Import';pauseBtn.textContent='Pause';
    sfBoxes.innerHTML='';pvVp.innerHTML='';pvVp.style.display='none';
    pvTog.textContent='Show ▾';failList.innerHTML='';
    skipN.textContent='';spdLbl.textContent='';spdLbl.className='';
    updConf();dz.classList.remove('locked');setDot('');miniBox.classList.remove('show');
    $('tsun-body').style.maxHeight='';
  }

  /* ── Done ───────────────────────────────────────────────────── */
  function showDone(imported,skipped){
    const allGood=!failedEntries.length;
    $('tsun-done-emoji').textContent=allGood?'🎉':'⚠️';
    $('tsun-done-title').textContent=allGood?'Import Complete!':'Import Done';
    $('tsun-done-sub').innerHTML=`${imported} imported &nbsp;·&nbsp; ${skipped} skipped &nbsp;·&nbsp; ${failedEntries.length} failed`;
    doneBox.classList.add('show');
    if(allGood) confetti();
    progSec.classList.remove('show');pauseBtn.classList.remove('show');cancelBtn.classList.remove('show');
    startBtn.disabled=true;dz.classList.remove('locked');
    setDot(failedEntries.length?'error':'done');
    if(failedEntries.length){buildFails();failsSec.classList.add('show');retryBtn.classList.add('show');logBtn.classList.add('show');}
    if(failedEntries.filter(e=>e.url).length) expBtn.classList.add('show');
    showToast(allGood?`Done! ${imported} manga imported`:`Done — ${failedEntries.length} failed`, allGood?'ok':'err');
    updMini();
  }

  window.addEventListener('beforeunload',e=>{if(isRunning){e.preventDefault();e.returnValue='';}});

  /* ── Start ──────────────────────────────────────────────────── */
  startBtn.addEventListener('click',async()=>{
    if(isRunning) return;
    const resume=loadResume();let intoP2=false,resumedResolved=null;
    if(resume&&resume.format===currentFormat){
      const sr=loadResolved();
      const rem=resume.phase===2?(sr?.length??0)-resume.index:(resume.queue?.length??0)-resume.index;
      if(confirm(`Resume previous import? (${rem} entries left)`)){
        importQueue=resume.queue;importIndex=resume.index;
        if(currentFormat==='xml'&&resume.phase===2&&sr){intoP2=true;resumedResolved=sr;}
      }else{clearResume();importQueue=getFiltered().map(e=>({...e}));importIndex=0;}
    }else{clearResume();importQueue=getFiltered().map(e=>({...e}));importIndex=0;}

    failedEntries=[];cStats.exact=cStats.found=cStats.fail=0;
    [pvSec,sumBox,sf].forEach(el=>el.classList.remove('show'));
    progSec.classList.add('show');pauseBtn.classList.add('show');
    startBtn.disabled=true;doneBox.classList.remove('show');failsSec.classList.remove('show');
    [retryBtn,logBtn,expBtn].forEach(el=>el.classList.remove('show'));
    dz.classList.add('locked');setDot('running');bgNotify('IMPORT_STARTED');
    updMini();

    if(currentFormat==='xml'){confBox.classList.add('show');await runMAL(intoP2?resumedResolved:null);}
    else await runDirect();
  });

  pauseBtn.addEventListener('click',()=>{
    isPaused=!isPaused;
    pauseBtn.textContent=isPaused?'▶ Resume':'⏸ Pause';
    cancelBtn.classList.toggle('show',isPaused);
    setDot(isPaused?'paused':'running');
    showToast(isPaused?'Paused — press Space to resume':'Resumed');
  });
  cancelBtn.addEventListener('click',()=>{if(!isPaused)return;isCancelled=true;isPaused=false;});

  retryBtn.addEventListener('click',async()=>{
    if(isRunning)return;
    [retryBtn,logBtn,expBtn].forEach(el=>el.classList.remove('show'));
    doneBox.classList.remove('show');failsSec.classList.remove('show');
    cStats.exact=cStats.found=cStats.fail=0;updConf();
    importQueue=[...failedEntries];failedEntries=[];importIndex=0;
    progSec.classList.add('show');pauseBtn.classList.add('show');
    startBtn.disabled=true;isPaused=false;isCancelled=false;pauseBtn.textContent='⏸ Pause';
    dz.classList.add('locked');setDot('running');
    if(currentFormat==='xml')await runMAL(null);else await runDirect();
  });

  logBtn.addEventListener('click',()=>{
    const el=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([failedEntries.map(e=>`[${e.reason||'?'}] ${e.title||e.url||e.malId||'—'}`).join('\n')],{type:'text/plain'})),download:'tsun_errors.txt'});
    el.click();URL.revokeObjectURL(el.href);showToast('Error log downloaded');
  });

  function handleCancel(){
    isRunning=false;isCancelled=false;isPaused=false;
    [pauseBtn,cancelBtn].forEach(el=>el.classList.remove('show'));
    progSec.classList.remove('show');dz.classList.remove('locked');
    clearResume();bgNotify('IMPORT_DONE');setDot('paused');
    if(failedEntries.length){buildFails();failsSec.classList.add('show');logBtn.classList.add('show');}
    doneBox.classList.add('show');
    $('tsun-done-emoji').textContent='⏹';
    $('tsun-done-title').textContent='Import Cancelled';
    $('tsun-done-sub').textContent=`${failedEntries.length} entries not imported`;
    showToast('Import cancelled','err');updMini();
  }

  /* ── MAL import ─────────────────────────────────────────────── */
  async function runMAL(resumedResolved=null){
    isRunning=true;isCancelled=false;
    const total=importQueue.length;let resolved=resumedResolved?[...resumedResolved]:[];
    if(!resumedResolved){
      setPhase('ph-res','Phase 1 — Resolving titles','ph-res-bar');
      await ensureTrackerMap();p1Start=Date.now();
      let nextIdx=importIndex,doneCount=importIndex;
      async function worker(){
        while(true){
          while(isPaused&&!isCancelled)await sleep(150);
          if(isCancelled)return;
          const i=nextIdx++;if(i>=total)return;
          const entry=importQueue[i];
          const{atsuId,confidence}=await resolveEntry(entry);
          if(isCancelled)return;
          if(atsuId){resolved.push({...entry,atsuId,confidence});cStats[confidence==='exact'?'exact':'found']++;}
          else{cStats.fail++;failedEntries.push({...entry,reason:'Not found in tracker or search'});}
          doneCount++;setProgress(doneCount,total,entry.title);updConf();updSpd(doneCount-importIndex,total-importIndex);
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
      setProgress(Math.min(i+BOOKMARK_CHUNK,bms.length),bms.length,'Posting bookmarks…');
      const ok=await postBookmarks(chunk);
      if(ok)imported+=chunk.length;
      else{skipped+=chunk.length;chunk.forEach((_,j)=>{const e=resolved[p2Start+i+j];if(e)failedEntries.push({...e,reason:'Bookmark POST failed'});});}
      await sleep(BOOKMARK_DELAY_MS);
    }
    const withProg=resolved.filter(e=>e.chaptersRead>0);
    if(withProg.length){
      setPhase('ph-ch','Phase 3 — Syncing chapters','ph-ch-bar');
      for(let i=0;i<withProg.length;i++){
        while(isPaused&&!isCancelled)await sleep(300);
        if(isCancelled)break;
        setProgress(i+1,withProg.length,withProg[i].title);
        await syncChapter(withProg[i].atsuId,withProg[i].chaptersRead);
        await sleep(200);
      }
    }
    importIndex=resolved.length;clearResume();isRunning=false;bgNotify('IMPORT_DONE');showDone(imported,skipped);
  }

  /* ── Direct import ──────────────────────────────────────────── */
  async function runDirect(){
    isRunning=true;isCancelled=false;
    const total=importQueue.length;let imported=0,skipped=0;
    await ensureTrackerMap();
    setPhase('ph-res','Resolving titles','ph-res-bar');p1Start=Date.now();
    const resolved=[];let nextIdx=importIndex,doneCount=importIndex;
    async function dw(){
      while(true){
        while(isPaused&&!isCancelled)await sleep(150);
        if(isCancelled)return;
        const i=nextIdx++;if(i>=total)return;
        const entry=importQueue[i];
        const{atsuId,confidence}=await resolveEntry(entry);
        if(isCancelled)return;
        if(atsuId)resolved.push({...entry,atsuId,confidence});
        else failedEntries.push({...entry,reason:'Not found'});
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
      if(ok)imported+=Math.min(BOOKMARK_CHUNK,bms.length-i);else skipped+=Math.min(BOOKMARK_CHUNK,bms.length-i);
      setProgress(Math.min(i+BOOKMARK_CHUNK,bms.length),bms.length,'Posting bookmarks…');
      await sleep(BOOKMARK_DELAY_MS);
    }
    clearResume();isRunning=false;bgNotify('IMPORT_DONE');showDone(imported,skipped);
  }

  function bgNotify(type){try{if(typeof chrome!=='undefined'&&chrome.runtime?.sendMessage)chrome.runtime.sendMessage({type});}catch{}}
  try{if(typeof chrome!=='undefined'&&chrome.runtime?.onMessage){chrome.runtime.onMessage.addListener(msg=>{if(msg.type==='AUTO_RESUME'){if(collapsed){$('tsun-body').style.display='';collapsed=false;}const s=loadResume();if(s&&!isRunning)startBtn.click();}});}}catch{}

  function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

  /* ── Resume banner ──────────────────────────────────────────── */
  (()=>{
    const s=loadResume();if(!s)return;
    const sr=loadResolved();
    const rem=s.phase===2?(sr?.length??0)-s.index:(s.queue?.length??0)-s.index;
    const bar=document.createElement('div');
    bar.style.cssText="position:fixed;top:0;left:0;right:0;background:rgba(8,8,16,.94);backdrop-filter:blur(16px);color:#de4dae;font-family:'Syne',sans-serif;font-size:12px;font-weight:600;padding:9px 18px;text-align:center;z-index:2147483646;cursor:pointer;border-bottom:1px solid rgba(222,77,174,.22);animation:t-up .3s both;";
    bar.textContent=`Tsun Importer — unfinished import (${rem} entries left). Click to dismiss · open panel to resume.`;
    bar.addEventListener('click',()=>bar.remove());
    document.body.prepend(bar);bgNotify('RESUME_AVAILABLE');
  })();

})();
