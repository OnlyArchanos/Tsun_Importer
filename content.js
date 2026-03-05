// ═══════════════════════════════════════════════════════════════════
//  Tsun Importer — content.js
//  Supports: Comick .csv | Weebcentral/MangaUpdates .txt | MAL .xml
// ═══════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     CONSTANTS
  ═══════════════════════════════════════════════════════════════ */
  const ATSU_TRACKER_MAP_URL  = 'https://atsu.moe/tracker-map.json';
  const ATSU_SEARCH_URL       = 'https://atsu.moe/api/search';
  const ATSU_BOOKMARK_URL     = 'https://atsu.moe/api/bookmark';
  const MU_SEARCH_URL         = 'https://api.mangaupdates.com/v1/series/search';

  const LS_RESUME_KEY         = 'tsunImporter_resumeState';
  const LS_RESOLVED_KEY       = 'tsunImporter_phase2Resolved'; // separate key — avoids per-iteration MB writes
  const LS_MAL_CACHE_KEY      = 'tsunImporter_malCache';

  const TRACKER_MAP_TTL_MS    = 30 * 60 * 1000; // 30 min staleness
  const MU_BASE_DELAY_MS      = 350;
  const MAX_MU_RETRIES        = 4;

  /* ═══════════════════════════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════════════════════════ */
  let importQueue          = [];
  let importIndex          = 0;
  let isPaused             = false;
  let isRunning            = false;
  let isCancelled          = false;
  let trackerMap           = null;
  let trackerMapFetchedAt  = 0;
  let reverseTrackerMap    = null;
  let failedEntries        = [];
  let pendingEntries       = [];
  let currentFormat        = null; // 'csv' | 'txt' | 'xml'
  let malResolutionCache   = {};
  let currentPhase2Resolved = []; // module-level so cancel handler can export it

  /* ═══════════════════════════════════════════════════════════════
     STYLES
  ═══════════════════════════════════════════════════════════════ */
  const style = document.createElement('style');
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap');

    @keyframes tsun-fadeSlideUp {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0);   }
    }
    @keyframes tsun-shimmer {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(400%);  }
    }
    @keyframes tsun-pulse {
      0%, 100% { opacity: 1;   }
      50%       { opacity: 0.4; }
    }
    @keyframes tsun-spin {
      to { transform: rotate(360deg); }
    }
    @keyframes tsun-pop {
      0%   { transform: scale(0.92); opacity: 0; }
      60%  { transform: scale(1.03);             }
      100% { transform: scale(1);    opacity: 1; }
    }
    @keyframes tsun-rowIn {
      from { opacity: 0; transform: translateX(-4px); }
      to   { opacity: 1; transform: translateX(0);    }
    }

    .tsun-reveal { animation: tsun-fadeSlideUp 0.22s cubic-bezier(0.4,0,0.2,1) both; }
    .tsun-pop    { animation: tsun-pop 0.28s cubic-bezier(0.34,1.56,0.64,1) both; }

    #tsun-panel {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 388px;
      background: #0c0c0f;
      border: 1px solid #252530;
      border-radius: 16px;
      box-shadow: 0 32px 80px rgba(0,0,0,0.8),
                  0 0 0 1px rgba(255,255,255,0.04) inset;
      font-family: 'Syne', sans-serif;
      color: #e8e8ec;
      z-index: 99999;
      overflow: hidden;
    }

    #tsun-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 13px 16px;
      background: #111118;
      border-bottom: 1px solid #1c1c26;
      cursor: pointer;
      user-select: none;
    }
    #tsun-header-left { display: flex; align-items: center; gap: 9px; }

    #tsun-logo {
      width: 28px; height: 28px;
      background: linear-gradient(135deg, #ff6b6b, #ff3333);
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 800; color: #fff;
      letter-spacing: -0.5px; flex-shrink: 0;
      box-shadow: 0 2px 8px rgba(255,68,68,0.4);
    }
    #tsun-title { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; color: #f0f0f5; }

    #tsun-badge {
      font-family: 'DM Mono', monospace;
      font-size: 10px; padding: 2px 7px; border-radius: 4px;
      font-weight: 500; letter-spacing: 0.05em; display: none;
    }
    #tsun-badge.csv { background:#1a3a2a; color:#4dde8e; display:inline-block; }
    #tsun-badge.txt { background:#1a2a3a; color:#4daede; display:inline-block; }
    #tsun-badge.xml { background:#3a1a2a; color:#de4dae; display:inline-block; }

    #tsun-toggle-btn {
      background:none; border:none; color:#555; cursor:pointer;
      font-size:17px; line-height:1; padding:0; transition:color 0.2s;
    }
    #tsun-toggle-btn:hover { color:#aaa; }

    #tsun-body { padding: 14px 16px; max-height: 82vh; overflow-y: auto; }
    #tsun-body::-webkit-scrollbar { width:4px; }
    #tsun-body::-webkit-scrollbar-track { background:transparent; }
    #tsun-body::-webkit-scrollbar-thumb { background:#2a2a38; border-radius:2px; }

    /* ── Dropzone ── */
    #tsun-dropzone {
      border: 1.5px dashed #2a2a38;
      border-radius: 10px;
      padding: 26px 16px;
      text-align: center;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s, transform 0.15s;
      margin-bottom: 12px;
    }
    #tsun-dropzone:hover { border-color: #3a3a50; background: rgba(255,255,255,0.015); }
    #tsun-dropzone.drag-over {
      border-color: #ff6b6b;
      background: rgba(255,107,107,0.07);
      transform: scale(1.01);
    }
    #tsun-dropzone.running-lock { cursor: not-allowed; opacity: 0.4; }
    #tsun-dropzone-icon { font-size: 24px; margin-bottom: 6px; }
    #tsun-dropzone-text { font-size: 12px; color: #777; line-height: 1.5; }
    #tsun-dropzone-text strong { color: #aaa; font-weight: 600; }
    #tsun-file-input { display: none; }

    /* ── File info ── */
    #tsun-file-info { display:none; margin-bottom:12px; }
    #tsun-file-info.visible { display:block; animation: tsun-fadeSlideUp 0.2s both; }
    #tsun-file-info-inner {
      background: #14141e; border: 1px solid #242432;
      border-radius: 8px; padding: 9px 11px;
      font-size: 11px; color: #888; font-family: 'DM Mono', monospace;
    }
    #tsun-file-name {
      color: #dddde8; font-weight: 500; font-size: 12px;
      margin-bottom: 2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }

    /* ── Parse error ── */
    #tsun-parse-error {
      display: none;
      background: rgba(255,80,80,0.08);
      border: 1px solid rgba(255,80,80,0.25);
      border-radius: 8px;
      padding: 9px 11px;
      margin-bottom: 12px;
      font-size: 11px; color: #ff8080;
      font-family: 'DM Mono', monospace;
    }
    #tsun-parse-error.visible { display:block; animation: tsun-fadeSlideUp 0.2s both; }

    /* ── Status filter ── */
    #tsun-status-filter { display:none; margin-bottom:12px; }
    #tsun-status-filter.visible { display:block; animation: tsun-fadeSlideUp 0.2s both; }
    .tsun-section-label {
      font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
      color: #444; font-weight: 600; margin-bottom: 7px;
    }
    #tsun-status-checkboxes { display: flex; flex-wrap: wrap; gap: 5px; }
    .tsun-status-cb {
      display: flex; align-items: center; gap: 5px;
      background: #14141e; border: 1px solid #242432;
      border-radius: 6px; padding: 5px 9px;
      cursor: pointer; font-size: 11px; color: #888;
      transition: border-color 0.15s, background 0.15s, color 0.15s;
      user-select: none;
    }
    .tsun-status-cb input { display:none; }
    .tsun-status-cb.checked { border-color:#ff6b6b; background:rgba(255,107,107,0.07); color:#eee; }
    .tsun-cb-dot { width:6px; height:6px; border-radius:50%; background:#333; flex-shrink:0; transition:background 0.15s; }
    .tsun-status-cb.checked .tsun-cb-dot { background:#ff6b6b; }
    .tsun-status-count { font-family:'DM Mono',monospace; font-size:10px; color:#444; margin-left:1px; }
    .tsun-status-cb.checked .tsun-status-count { color:#ff6b6b; }

    /* ── Summary ── */
    #tsun-summary { display:none; margin-bottom:12px; }
    #tsun-summary.visible { display:block; animation: tsun-fadeSlideUp 0.2s both; }
    #tsun-summary-inner {
      background: #14141e; border: 1px solid #242432;
      border-radius: 8px; padding: 9px 11px;
    }
    #tsun-summary-row {
      display:flex; justify-content:space-between; align-items:center;
      font-size:11px; color:#666; font-family:'DM Mono',monospace;
    }
    #tsun-summary-count { font-size:20px; font-weight:800; color:#e8e8ec; font-family:'Syne',sans-serif; }

    /* ── Preview table ── */
    #tsun-preview-section { display:none; margin-bottom:12px; }
    #tsun-preview-section.visible { display:block; animation: tsun-fadeSlideUp 0.22s both; }
    #tsun-preview-header {
      display:flex; justify-content:space-between; align-items:center;
      margin-bottom:7px;
    }
    #tsun-preview-toggle {
      background:none; border:none; color:#555; cursor:pointer;
      font-family:'DM Mono',monospace; font-size:10px; padding:0;
      transition:color 0.15s;
    }
    #tsun-preview-toggle:hover { color:#aaa; }
    #tsun-preview-viewport {
      background: #0f0f16; border: 1px solid #1e1e2a;
      border-radius: 8px; height: 176px; overflow-y: auto;
      position: relative;
    }
    #tsun-preview-viewport::-webkit-scrollbar { width:3px; }
    #tsun-preview-viewport::-webkit-scrollbar-thumb { background:#2a2a38; border-radius:2px; }
    .tsun-preview-row {
      display: flex; align-items: center;
      padding: 0 10px; gap: 6px;
      border-bottom: 1px solid rgba(255,255,255,0.03);
      font-size: 10px; font-family:'DM Mono',monospace;
    }
    .tsun-preview-row:nth-child(even) { background: rgba(255,255,255,0.015); }
    .tsun-preview-title { flex:1; color:#bbb; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tsun-preview-status { color:#555; flex-shrink:0; font-size:9px; }
    .tsun-preview-ch { color:#444; flex-shrink:0; font-size:9px; text-align:right; }

    /* ── Progress ── */
    #tsun-progress-section { display:none; margin-bottom:12px; }
    #tsun-progress-section.visible { display:block; animation: tsun-fadeSlideUp 0.22s both; }

    #tsun-phase-label {
      font-size:10px; letter-spacing:0.08em; text-transform:uppercase;
      font-weight:600; margin-bottom:6px; min-height:14px;
      transition: color 0.3s;
    }
    #tsun-phase-label.phase-resolve { color: #de4dae; }
    #tsun-phase-label.phase-import  { color: #ff6b6b; }
    #tsun-phase-label.phase-ratelimit {
      color: #ffd966;
      animation: tsun-pulse 1s ease-in-out infinite;
    }

    #tsun-progress-bar-wrap {
      background: #181824; border-radius:4px; height:7px;
      overflow:hidden; margin-bottom:6px; position:relative;
    }
    #tsun-progress-bar {
      height:100%; border-radius:4px; width:0%;
      background: linear-gradient(90deg, #ff6b6b, #ff9966);
      transition: width 0.35s ease;
      position: relative; overflow:hidden;
    }
    #tsun-progress-bar::after {
      content:''; position:absolute; top:0; left:0; right:0; bottom:0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
      animation: tsun-shimmer 1.6s linear infinite;
    }
    #tsun-progress-label {
      display:flex; justify-content:space-between;
      font-family:'DM Mono',monospace; font-size:10px; color:#444;
    }
    #tsun-current-title {
      font-size:10px; color:#666; margin-top:5px;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      font-family:'DM Mono',monospace;
    }

    /* ── Confidence ── */
    #tsun-confidence { display:none; margin-bottom:12px; }
    #tsun-confidence.visible { display:block; animation: tsun-fadeSlideUp 0.2s both; }
    #tsun-confidence-inner {
      background:#14141e; border:1px solid #242432;
      border-radius:8px; padding:8px 11px;
      font-size:10px; font-family:'DM Mono',monospace;
    }
    .tsun-conf-row { display:flex; justify-content:space-between; padding:2px 0; color:#555; }
    .tsun-conf-row span:last-child { font-weight:500; }
    .tsun-conf-exact  { color:#4dde8e; }
    .tsun-conf-alt    { color:#ffd966; }
    .tsun-conf-fuzzy  { color:#ff9966; }
    .tsun-conf-failed { color:#ff6b6b; }

    /* ── Done ── */
    #tsun-done { display:none; padding:8px 0 4px; }
    #tsun-done.visible { display:block; animation: tsun-pop 0.3s both; }
    #tsun-done-title { font-size:15px; font-weight:800; margin-bottom:3px; }
    #tsun-done-sub { font-size:11px; color:#555; font-family:'DM Mono',monospace; }

    /* ── Failed entries list ── */
    #tsun-failed-section { display:none; margin-top:10px; }
    #tsun-failed-section.visible { display:block; animation: tsun-fadeSlideUp 0.22s both; }
    #tsun-failed-section-header {
      display:flex; justify-content:space-between; align-items:center;
      margin-bottom:7px; cursor:pointer; user-select:none;
    }
    #tsun-failed-collapse {
      background:none; border:none; color:#444; cursor:pointer;
      font-size:13px; padding:0; transition:transform 0.2s, color 0.2s;
    }
    #tsun-failed-collapse:hover { color:#aaa; }
    #tsun-failed-list {
      max-height:200px; overflow-y:auto;
      background:#0f0f16; border:1px solid #1e1e2a; border-radius:8px;
    }
    #tsun-failed-list::-webkit-scrollbar { width:3px; }
    #tsun-failed-list::-webkit-scrollbar-thumb { background:#2a2a38; border-radius:2px; }
    .tsun-failed-row {
      display:flex; align-items:center; gap:8px;
      padding:7px 10px; border-bottom:1px solid rgba(255,255,255,0.04);
      transition:background 0.15s;
      animation: tsun-rowIn 0.18s both;
    }
    .tsun-failed-row:last-child { border-bottom:none; }
    .tsun-failed-row:hover { background:rgba(255,255,255,0.025); }
    .tsun-failed-row.success { background: rgba(77,222,142,0.05); }
    .tsun-failed-row.error   { background: rgba(255,107,107,0.05); }
    .tsun-failed-info { flex:1; overflow:hidden; }
    .tsun-failed-title {
      font-size:11px; color:#bbb; white-space:nowrap;
      overflow:hidden; text-overflow:ellipsis; font-family:'DM Mono',monospace;
    }
    .tsun-failed-reason { font-size:10px; color:#555; font-family:'DM Mono',monospace; }
    .tsun-retry-single {
      flex-shrink:0; background:none; border:1px solid #2a2a3a;
      border-radius:5px; color:#888; cursor:pointer; padding:3px 7px;
      font-size:10px; font-family:'Syne',sans-serif; font-weight:600;
      transition:border-color 0.15s, color 0.15s, background 0.15s;
    }
    .tsun-retry-single:hover { border-color:#ff6b6b; color:#ff6b6b; background:rgba(255,107,107,0.06); }
    .tsun-retry-single:disabled { opacity:0.3; cursor:not-allowed; }
    .tsun-row-status { flex-shrink:0; font-size:13px; width:18px; text-align:center; }
    .tsun-spin { display:inline-block; animation: tsun-spin 0.7s linear infinite; }

    /* ── Buttons ── */
    #tsun-btn-primary { display:flex; gap:7px; margin-bottom:7px; }
    #tsun-btn-secondary { display:flex; gap:7px; flex-wrap:wrap; }

    .tsun-btn {
      flex:1; border:none; border-radius:8px; padding:9px 12px;
      font-family:'Syne',sans-serif; font-size:11px; font-weight:700;
      letter-spacing:0.04em; cursor:pointer;
      transition:opacity 0.15s, transform 0.1s, background 0.15s;
      white-space:nowrap;
    }
    .tsun-btn:active:not(:disabled) { transform:scale(0.96); }
    .tsun-btn:disabled { opacity:0.25; cursor:not-allowed; }

    #tsun-start-btn {
      background:linear-gradient(135deg,#ff6b6b,#ff3333); color:#fff;
      box-shadow: 0 2px 12px rgba(255,68,68,0.3);
    }
    #tsun-start-btn:hover:not(:disabled) { opacity:0.85; }

    #tsun-pause-btn { display:none; background:#16161f; border:1px solid #2e2e3e; color:#bbb; }
    #tsun-pause-btn.visible { display:block; }
    #tsun-pause-btn:hover:not(:disabled) { background:#1e1e2e; border-color:#3e3e50; }

    #tsun-cancel-btn {
      display:none; background:#1e1414; border:1px solid #3e2020; color:#cc7070; font-size:11px;
    }
    #tsun-cancel-btn.visible { display:block; }
    #tsun-cancel-btn:hover { background:#281414; border-color:#552020; color:#ff8888; }

    #tsun-retry-btn { display:none; background:#141e15; border:1px solid #2a4030; color:#4dde8e; }
    #tsun-retry-btn.visible { display:block; }
    #tsun-retry-btn:hover { background:#182018; }

    #tsun-log-btn { display:none; background:#1e1a14; border:1px solid #3a3020; color:#cc9944; }
    #tsun-log-btn.visible { display:block; }
    #tsun-log-btn:hover { background:#241e14; }

    #tsun-export-btn { display:none; background:#141a22; border:1px solid #2030408a; color:#4daede; }
    #tsun-export-btn.visible { display:block; }
    #tsun-export-btn:hover { background:#18202c; }
  `;
  document.head.appendChild(style);

  /* ═══════════════════════════════════════════════════════════════
     PANEL HTML
  ═══════════════════════════════════════════════════════════════ */
  const panel = document.createElement('div');
  panel.id = 'tsun-panel';
  panel.innerHTML = `
    <div id="tsun-header">
      <div id="tsun-header-left">
        <div id="tsun-logo">TI</div>
        <span id="tsun-title">Tsun Importer</span>
        <span id="tsun-badge"></span>
      </div>
      <button id="tsun-toggle-btn">−</button>
    </div>

    <div id="tsun-body">

      <div id="tsun-dropzone">
        <div id="tsun-dropzone-icon">📂</div>
        <div id="tsun-dropzone-text">
          <strong>Drop your file here</strong><br>
          Comick <code>.csv</code> · MU/Weebcentral <code>.txt</code> · MAL <code>.xml</code>
        </div>
        <input type="file" id="tsun-file-input" accept=".csv,.txt,.xml">
      </div>

      <div id="tsun-parse-error"></div>

      <div id="tsun-file-info">
        <div id="tsun-file-info-inner">
          <div id="tsun-file-name"></div>
          <span id="tsun-file-meta"></span>
        </div>
      </div>

      <div id="tsun-status-filter">
        <div class="tsun-section-label">Import statuses</div>
        <div id="tsun-status-checkboxes"></div>
      </div>

      <div id="tsun-summary">
        <div id="tsun-summary-inner">
          <div id="tsun-summary-row">
            <span>Selected to import</span>
            <span id="tsun-summary-count">—</span>
          </div>
        </div>
      </div>

      <div id="tsun-preview-section">
        <div id="tsun-preview-header">
          <div class="tsun-section-label" style="margin-bottom:0">Preview</div>
          <button id="tsun-preview-toggle">Show ▾</button>
        </div>
        <div id="tsun-preview-viewport" style="display:none"></div>
      </div>

      <div id="tsun-progress-section">
        <div id="tsun-phase-label"></div>
        <div id="tsun-progress-bar-wrap">
          <div id="tsun-progress-bar"></div>
        </div>
        <div id="tsun-progress-label">
          <span id="tsun-progress-text">0 / 0</span>
          <span id="tsun-skipped-text"></span>
        </div>
        <div id="tsun-current-title"></div>
      </div>

      <div id="tsun-confidence">
        <div id="tsun-confidence-inner">
          <div class="tsun-conf-row"><span>Exact match</span><span id="conf-exact" class="tsun-conf-exact">0</span></div>
          <div class="tsun-conf-row"><span>Alt title match</span><span id="conf-alt" class="tsun-conf-alt">0</span></div>
          <div class="tsun-conf-row"><span>Fuzzy match</span><span id="conf-fuzzy" class="tsun-conf-fuzzy">0</span></div>
          <div class="tsun-conf-row"><span>Unresolved</span><span id="conf-failed" class="tsun-conf-failed">0</span></div>
        </div>
      </div>

      <div id="tsun-done">
        <div id="tsun-done-title">✓ Import Complete</div>
        <div id="tsun-done-sub"></div>
      </div>

      <div id="tsun-failed-section">
        <div id="tsun-failed-section-header">
          <div class="tsun-section-label" style="margin-bottom:0">Failed entries</div>
          <button id="tsun-failed-collapse">▾</button>
        </div>
        <div id="tsun-failed-list"></div>
      </div>

      <div id="tsun-btn-primary">
        <button class="tsun-btn" id="tsun-start-btn" disabled>Start Import</button>
        <button class="tsun-btn" id="tsun-pause-btn">Pause</button>
        <button class="tsun-btn" id="tsun-cancel-btn">✕ Cancel</button>
      </div>
      <div id="tsun-btn-secondary">
        <button class="tsun-btn" id="tsun-retry-btn">↺ Retry All</button>
        <button class="tsun-btn" id="tsun-log-btn">⬇ Error Log</button>
        <button class="tsun-btn" id="tsun-export-btn">⬇ Export Queue</button>
      </div>

    </div>
  `;
  document.body.appendChild(panel);

  /* ═══════════════════════════════════════════════════════════════
     ELEMENT REFS
  ═══════════════════════════════════════════════════════════════ */
  const $  = id => document.getElementById(id);
  const dropzone        = $('tsun-dropzone');
  const fileInput       = $('tsun-file-input');
  const parseError      = $('tsun-parse-error');
  const fileInfo        = $('tsun-file-info');
  const fileName        = $('tsun-file-name');
  const fileMeta        = $('tsun-file-meta');
  const badge           = $('tsun-badge');
  const statusFilter    = $('tsun-status-filter');
  const statusCbs       = $('tsun-status-checkboxes');
  const summary         = $('tsun-summary');
  const summaryCount    = $('tsun-summary-count');
  const previewSection  = $('tsun-preview-section');
  const previewViewport = $('tsun-preview-viewport');
  const previewToggle   = $('tsun-preview-toggle');
  const progressSection = $('tsun-progress-section');
  const phaseLabel      = $('tsun-phase-label');
  const progressBar     = $('tsun-progress-bar');
  const progressText    = $('tsun-progress-text');
  const skippedText     = $('tsun-skipped-text');
  const currentTitle    = $('tsun-current-title');
  const confidenceBox   = $('tsun-confidence');
  const doneBox         = $('tsun-done');
  const failedSection   = $('tsun-failed-section');
  const failedList      = $('tsun-failed-list');
  const startBtn        = $('tsun-start-btn');
  const pauseBtn        = $('tsun-pause-btn');
  const cancelBtn       = $('tsun-cancel-btn');
  const retryBtn        = $('tsun-retry-btn');
  const logBtn          = $('tsun-log-btn');
  const exportBtn       = $('tsun-export-btn');
  const confStats       = { exact: 0, alt: 0, fuzzy: 0, failed: 0 };

  /* ═══════════════════════════════════════════════════════════════
     COLLAPSE TOGGLE
  ═══════════════════════════════════════════════════════════════ */
  let collapsed = false;
  $('tsun-header').addEventListener('click', e => {
    if (e.target === $('tsun-toggle-btn') || e.target.closest('#tsun-toggle-btn')) return;
    toggleCollapse();
  });
  $('tsun-toggle-btn').addEventListener('click', e => { e.stopPropagation(); toggleCollapse(); });
  function toggleCollapse() {
    collapsed = !collapsed;
    $('tsun-body').style.display = collapsed ? 'none' : 'block';
    $('tsun-toggle-btn').textContent = collapsed ? '+' : '−';
  }

  /* ═══════════════════════════════════════════════════════════════
     DRAG & DROP
  ═══════════════════════════════════════════════════════════════ */
  dropzone.addEventListener('dragover',  e => { e.preventDefault(); if (!isRunning) dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', ()  => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelected(file);
  });
  dropzone.addEventListener('click', () => { if (!isRunning) fileInput.click(); });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFileSelected(fileInput.files[0]); });

  /* ═══════════════════════════════════════════════════════════════
     FILE HANDLING
  ═══════════════════════════════════════════════════════════════ */
  async function handleFileSelected(file) {
    if (isRunning) return;
    resetUI();

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'txt', 'xml'].includes(ext)) {
      showParseError('Unsupported file type. Please use .csv, .txt or .xml');
      return;
    }

    currentFormat = ext;
    // Normalise line endings (Windows CRLF fix)
    const raw  = await file.text();
    const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    fileName.textContent = file.name;
    const labels = { csv:'Comick CSV', txt:'MU / Weebcentral TXT', xml:'MyAnimeList XML' };
    fileMeta.textContent = labels[ext];
    badge.textContent = ext.toUpperCase();
    badge.className = ext;
    fileInfo.classList.add('visible');

    try {
      if (ext === 'csv')      pendingEntries = parseComickCSV(text);
      else if (ext === 'txt') pendingEntries = parseMUTxt(text);
      else                    pendingEntries = parseMALXML(text);
    } catch (err) {
      showParseError('Parse failed: ' + err.message);
      return;
    }

    // Empty file validation
    if (pendingEntries.length === 0) {
      showParseError('No valid entries found in this file. Check the format and try again.');
      startBtn.disabled = true;
      return;
    }

    if (ext === 'xml') {
      buildStatusFilter(pendingEntries);
      statusFilter.classList.add('visible');
    }

    updateSummary();
    buildPreviewTable(pendingEntries);
    previewSection.classList.add('visible');
    startBtn.disabled = false;
  }

  function showParseError(msg) {
    parseError.textContent = '⚠ ' + msg;
    parseError.classList.add('visible');
  }

  /* ═══════════════════════════════════════════════════════════════
     PARSERS
  ═══════════════════════════════════════════════════════════════ */
  function parseComickCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers    = parseCSVLine(lines[0]).map(h => h.toLowerCase());
    const titleIdx   = headers.findIndex(h => h.includes('title'));
    const urlIdx     = headers.findIndex(h => h.includes('url') || h.includes('link'));
    const chapterIdx = headers.findIndex(h => h.includes('chapter'));
    return lines.slice(1).map(line => {
      const cols = parseCSVLine(line);
      return { title: cols[titleIdx] || '', url: cols[urlIdx] || '',
               chapter: parseInt(cols[chapterIdx]) || 0, source: 'comick' };
    }).filter(e => e.title || e.url);
  }

  function parseMUTxt(text) {
    return text.split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('https://www.mangaupdates.com'))
      .map(url => ({ url, source: 'mu' }));
  }

  function parseMALXML(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Invalid XML file.');
    const entries = [];
    doc.querySelectorAll('manga').forEach(node => {
      const g = tag => node.querySelector(tag)?.textContent?.trim() ?? '';
      entries.push({
        malId:        g('manga_mangadb_id'),
        title:        g('manga_title'),
        chaptersRead: parseInt(g('my_read_chapters'), 10) || 0,
        status:       g('my_status'),
        source:       'mal',
      });
    });
    return entries;
  }

  // RFC-4180 CSV parser with "" escaped-quote support
  function parseCSVLine(line) {
    const result = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) { result.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    result.push(cur.trim());
    return result;
  }

  /* ═══════════════════════════════════════════════════════════════
     STATUS FILTER (MAL only)
  ═══════════════════════════════════════════════════════════════ */
  const STATUS_COLORS = {
    'Reading':      '#4daede', 'Completed':    '#4dde8e',
    'On-Hold':      '#ffd966', 'Dropped':      '#ff6b6b',
    'Plan to Read': '#aaaacc',
  };

  function buildStatusFilter(entries) {
    const counts = {};
    entries.forEach(e => { const s = e.status || ''; if (s) counts[s] = (counts[s] || 0) + 1; });
    statusCbs.innerHTML = '';
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
      const label    = document.createElement('label');
      label.className = 'tsun-status-cb checked';
      const cb       = document.createElement('input');
      cb.type        = 'checkbox'; cb.className = 'tsun-status-input';
      cb.dataset.status = status; cb.checked = true;
      const dot      = document.createElement('span');
      dot.className  = 'tsun-cb-dot';
      dot.style.background = STATUS_COLORS[status] || '#666';
      const txt      = document.createTextNode(' ' + status + ' ');
      const cntSpan  = document.createElement('span');
      cntSpan.className = 'tsun-status-count'; cntSpan.textContent = count;
      label.appendChild(cb); label.appendChild(dot);
      label.appendChild(txt); label.appendChild(cntSpan);
      cb.addEventListener('change', e => { label.classList.toggle('checked', e.target.checked); updateSummary(); });
      statusCbs.appendChild(label);
    });
  }

  function getSelectedStatuses() {
    return [...statusCbs.querySelectorAll('.tsun-status-input:checked')].map(i => i.dataset.status);
  }

  function getFilteredEntries() {
    if (currentFormat !== 'xml') return pendingEntries;
    const sel = getSelectedStatuses();
    return pendingEntries.filter(e => sel.includes(e.status));
  }

  function updateSummary() {
    summaryCount.textContent = getFilteredEntries().length.toLocaleString();
    summary.classList.add('visible');
    buildPreviewTable(getFilteredEntries());
  }

  /* ═══════════════════════════════════════════════════════════════
     PREVIEW TABLE (virtual scroller)
  ═══════════════════════════════════════════════════════════════ */
  let previewOpen = false;
  const ROW_H = 22;

  previewToggle.addEventListener('click', () => {
    previewOpen = !previewOpen;
    previewViewport.style.display = previewOpen ? 'block' : 'none';
    previewToggle.textContent = previewOpen ? 'Hide ▴' : 'Show ▾';
    if (previewOpen) renderPreviewRows();
  });
  previewViewport.addEventListener('scroll', renderPreviewRows, { passive: true });

  let previewEntries = [];
  function buildPreviewTable(entries) {
    previewEntries = entries;
    if (previewOpen) renderPreviewRows();
  }

  function renderPreviewRows() {
    if (!previewOpen || !previewEntries.length) return;
    const scrollTop = previewViewport.scrollTop;
    const vpH       = previewViewport.clientHeight;
    const start     = Math.max(0, Math.floor(scrollTop / ROW_H) - 2);
    const end       = Math.min(previewEntries.length, Math.ceil((scrollTop + vpH) / ROW_H) + 3);
    const totalH    = previewEntries.length * ROW_H;

    // Ensure spacer div exists as first child
    let spacer = previewViewport.querySelector('.tsun-preview-spacer');
    if (!spacer) {
      spacer = document.createElement('div');
      spacer.className = 'tsun-preview-spacer';
      spacer.style.cssText = 'position:relative;';
      previewViewport.innerHTML = '';
      previewViewport.appendChild(spacer);
    }
    spacer.style.height = totalH + 'px';

    // Remove out-of-view rows
    [...spacer.querySelectorAll('.tsun-preview-row')].forEach(el => {
      const idx = parseInt(el.dataset.idx, 10);
      if (idx < start || idx >= end) el.remove();
    });

    // Add missing rows
    const existing = new Set([...spacer.querySelectorAll('.tsun-preview-row')].map(el => parseInt(el.dataset.idx, 10)));
    for (let i = start; i < end; i++) {
      if (existing.has(i)) continue;
      const entry = previewEntries[i];
      const row   = document.createElement('div');
      row.className = 'tsun-preview-row';
      row.dataset.idx = i;
      row.style.cssText = `position:absolute;top:${i * ROW_H}px;left:0;right:0;height:${ROW_H}px;`;

      const title = document.createElement('span'); title.className = 'tsun-preview-title';
      title.textContent = entry.title || entry.url || '—';
      const st    = document.createElement('span'); st.className = 'tsun-preview-status';
      st.textContent = entry.status || entry.source || '';
      const ch    = document.createElement('span'); ch.className = 'tsun-preview-ch';
      ch.textContent = (entry.chaptersRead != null && entry.chaptersRead > 0) ? `ch.${entry.chaptersRead}` : '';

      row.appendChild(title); row.appendChild(st); row.appendChild(ch);
      spacer.appendChild(row);
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     CACHE / RESUME HELPERS
  ═══════════════════════════════════════════════════════════════ */
  function loadMALCache() {
    try { malResolutionCache = JSON.parse(localStorage.getItem(LS_MAL_CACHE_KEY) || '{}'); }
    catch { malResolutionCache = {}; }
  }
  function saveMALCache() {
    try { localStorage.setItem(LS_MAL_CACHE_KEY, JSON.stringify(malResolutionCache)); } catch {}
  }

  // Resolved array stored in a separate key to avoid overwriting it on every Phase 2 checkpoint
  function saveResumeResolved(resolved) {
    try { localStorage.setItem(LS_RESOLVED_KEY, JSON.stringify(resolved)); } catch {}
  }
  function loadResumeResolved() {
    try { const r = localStorage.getItem(LS_RESOLVED_KEY); return r ? JSON.parse(r) : null; }
    catch { return null; }
  }

  function saveResumeState(extra = {}) {
    try {
      localStorage.setItem(LS_RESUME_KEY, JSON.stringify({
        format: currentFormat, queue: importQueue, index: importIndex, ...extra,
      }));
    } catch {}
  }
  function loadResumeState() {
    try { const r = localStorage.getItem(LS_RESUME_KEY); return r ? JSON.parse(r) : null; }
    catch { return null; }
  }
  function clearResumeState() {
    localStorage.removeItem(LS_RESUME_KEY);
    localStorage.removeItem(LS_RESOLVED_KEY);
  }

  /* ═══════════════════════════════════════════════════════════════
     TRACKER MAP (with 30-min staleness)
  ═══════════════════════════════════════════════════════════════ */
  async function getTrackerMap() {
    const now = Date.now();
    if (trackerMap && (now - trackerMapFetchedAt) < TRACKER_MAP_TTL_MS) return trackerMap;
    try {
      const res = await fetch(ATSU_TRACKER_MAP_URL);
      const fresh = await res.json();
      trackerMap = fresh;
      trackerMapFetchedAt = now;
      reverseTrackerMap = null; // invalidate reverse map on refresh
    } catch {
      if (!trackerMap) trackerMap = {}; // first-fetch failure: empty map
      // On refresh failure: keep stale map, reset timer to avoid hammering
      trackerMapFetchedAt = now;
    }
    return trackerMap;
  }

  /* ═══════════════════════════════════════════════════════════════
     NORMALISE TITLE
  ═══════════════════════════════════════════════════════════════ */
  function normaliseTitle(t) {
    return t.toLowerCase()
      .replace(/^(the|a|an)\s+/i, '')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ═══════════════════════════════════════════════════════════════
     MU RESOLVER  (with 429 rate-limit backoff)
  ═══════════════════════════════════════════════════════════════ */
  async function resolveMALEntry(entry) {
    const { malId, title } = entry;

    // 1. Memory cache
    if (malResolutionCache[malId]) return malResolutionCache[malId];

    // 2. Tracker map
    const map = await getTrackerMap();
    if (map[malId]) {
      const result = { muUrl: map[malId], confidence: 'exact' };
      malResolutionCache[malId] = result; saveMALCache();
      return result;
    }

    // 3. MU API with rate-limit backoff loop
    for (let attempt = 0; attempt <= MAX_MU_RETRIES; attempt++) {
      let res;
      try {
        res = await fetch(MU_SEARCH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ search: title, per_page: 5 }),
        });
      } catch {
        // Network error — exponential backoff then retry
        if (attempt === MAX_MU_RETRIES) return { muUrl: null, confidence: null };
        await sleep(800 * (attempt + 1));
        continue;
      }

      // 429 Rate limited
      if (res.status === 429) {
        if (attempt === MAX_MU_RETRIES) return { muUrl: null, confidence: null };
        const retryAfterSec = Math.min(parseInt(res.headers.get('Retry-After') || '10', 10), 60);
        // Countdown in the phase label
        for (let s = retryAfterSec; s > 0; s--) {
          phaseLabel.textContent = `Rate limited — resuming in ${s}s…`;
          phaseLabel.className   = 'phase-ratelimit';
          await sleep(1000);
          // Honour pause/cancel even during wait
          while (isPaused && !isCancelled) await sleep(300);
          if (isCancelled) return { muUrl: null, confidence: null };
        }
        phaseLabel.textContent = 'Phase 1 — Resolving via MangaUpdates API';
        phaseLabel.className   = 'phase-resolve';
        continue; // retry
      }

      if (!res.ok) return { muUrl: null, confidence: null };

      const data    = await res.json();
      const results = data.results ?? [];
      if (!results.length) return { muUrl: null, confidence: null };

      const normTarget = normaliseTitle(title);

      // Exact title match
      for (const r of results) {
        if (normaliseTitle(r.record?.title ?? '') === normTarget) {
          const result = { muUrl: `https://www.mangaupdates.com/series/${r.record.series_id}`, confidence: 'exact' };
          malResolutionCache[malId] = result; saveMALCache();
          return result;
        }
      }
      // Alt title match
      for (const r of results) {
        for (const assoc of (r.record?.associated ?? [])) {
          if (normaliseTitle(assoc.title ?? '') === normTarget) {
            const result = { muUrl: `https://www.mangaupdates.com/series/${r.record.series_id}`, confidence: 'alt' };
            malResolutionCache[malId] = result; saveMALCache();
            return result;
          }
        }
      }
      // Fuzzy fallback
      const shortTarget = normTarget.split(' ').slice(0, 4).join(' ');
      const topNorm     = normaliseTitle(results[0].record?.title ?? '');
      if (shortTarget.length > 8 && topNorm.startsWith(shortTarget)) {
        const result = { muUrl: `https://www.mangaupdates.com/series/${results[0].record.series_id}`, confidence: 'fuzzy' };
        malResolutionCache[malId] = result; saveMALCache();
        return result;
      }

      return { muUrl: null, confidence: null }; // no match found — don't retry
    }

    return { muUrl: null, confidence: null };
  }

  /* ═══════════════════════════════════════════════════════════════
     ATSU BOOKMARK API
  ═══════════════════════════════════════════════════════════════ */
  async function getAtsuSeriesId(muUrl) {
    const map = await getTrackerMap();
    if (!reverseTrackerMap) {
      reverseTrackerMap = Object.fromEntries(Object.entries(map).map(([id, url]) => [url, id]));
    }
    if (reverseTrackerMap[muUrl]) return reverseTrackerMap[muUrl];
    try {
      const res  = await fetch(`${ATSU_SEARCH_URL}?q=${encodeURIComponent(muUrl)}`);
      const data = await res.json();
      return data?.results?.[0]?.id ?? null;
    } catch { return null; }
  }

  async function bookmarkOnAtsu(seriesId, chaptersRead) {
    try {
      const res = await fetch(ATSU_BOOKMARK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ seriesId, progress: chaptersRead }),
      });
      return res.ok;
    } catch { return false; }
  }

  /* ═══════════════════════════════════════════════════════════════
     SINGLE-ENTRY RETRY
  ═══════════════════════════════════════════════════════════════ */
  async function retrySingleEntry(entry) {
    let muUrl = entry.muUrl || null;

    if (!muUrl) {
      if (currentFormat === 'xml') {
        // Clear cache so resolver gets a fresh attempt
        if (entry.malId) delete malResolutionCache[entry.malId];
        const { muUrl: resolved } = await resolveMALEntry(entry);
        muUrl = resolved;
      } else if (currentFormat === 'csv') {
        const map = await getTrackerMap();
        muUrl = map[entry.url] || await searchAtsuForComick(entry);
      }
      if (!muUrl) return { success: false, reason: 'Still no match found' };
    }

    const seriesId = await getAtsuSeriesId(muUrl);
    if (!seriesId) return { success: false, reason: 'Series not found on Atsu' };
    const ok = await bookmarkOnAtsu(seriesId, entry.chaptersRead || entry.chapter || 0);
    return ok ? { success: true } : { success: false, reason: 'Bookmark API error' };
  }

  /* ═══════════════════════════════════════════════════════════════
     FAILED ENTRIES LIST  (per-entry retry UI)
  ═══════════════════════════════════════════════════════════════ */
  let failedListOpen = true;

  $('tsun-failed-section-header').addEventListener('click', () => {
    failedListOpen = !failedListOpen;
    failedList.style.display = failedListOpen ? 'block' : 'none';
    $('tsun-failed-collapse').textContent = failedListOpen ? '▾' : '▸';
  });

  function buildFailedList() {
    failedList.innerHTML = '';
    if (!failedEntries.length) return;

    failedEntries.forEach((entry, idx) => {
      const row      = document.createElement('div');
      row.className  = 'tsun-failed-row';
      row.style.animationDelay = Math.min(idx * 0.03, 0.3) + 's';

      const statusEl = document.createElement('span');
      statusEl.className = 'tsun-row-status';
      statusEl.textContent = '✗';
      statusEl.style.color = '#ff6b6b';

      const info     = document.createElement('div'); info.className = 'tsun-failed-info';
      const titleEl  = document.createElement('div'); titleEl.className = 'tsun-failed-title';
      titleEl.textContent = entry.title || entry.url || entry.malId || '—';
      const reasonEl = document.createElement('div'); reasonEl.className = 'tsun-failed-reason';
      reasonEl.textContent = entry.reason || 'Unknown error';
      info.appendChild(titleEl); info.appendChild(reasonEl);

      const retryOneBtn = document.createElement('button');
      retryOneBtn.className = 'tsun-retry-single';
      retryOneBtn.textContent = '↺';
      retryOneBtn.title = 'Retry this entry';
      retryOneBtn.addEventListener('click', async () => {
        retryOneBtn.disabled = true;
        statusEl.innerHTML = '<span class="tsun-spin">⟳</span>';
        const result = await retrySingleEntry(entry);
        if (result.success) {
          statusEl.textContent = '✓'; statusEl.style.color = '#4dde8e';
          row.classList.add('success');
          reasonEl.textContent = 'Imported successfully';
          retryOneBtn.style.display = 'none';
          // Remove from failedEntries
          const i = failedEntries.indexOf(entry);
          if (i !== -1) failedEntries.splice(i, 1);
        } else {
          statusEl.textContent = '✗'; statusEl.style.color = '#ff6b6b';
          row.classList.add('error');
          reasonEl.textContent = result.reason;
          retryOneBtn.disabled = false;
        }
      });

      row.appendChild(statusEl); row.appendChild(info); row.appendChild(retryOneBtn);
      failedList.appendChild(row);
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     EXPORT QUEUE
  ═══════════════════════════════════════════════════════════════ */
  function getExportableUrls() {
    // Resolved Phase 2 entries not yet imported (remaining in queue) + failed entries with muUrl
    const fromRemaining = currentPhase2Resolved.slice(importIndex).map(e => e.muUrl).filter(Boolean);
    const fromFailed    = failedEntries.filter(e => e.muUrl).map(e => e.muUrl);
    return [...new Set([...fromRemaining, ...fromFailed])];
  }

  function triggerExport() {
    const urls = getExportableUrls();
    if (!urls.length) { alert('No resolved MU URLs to export.'); return; }
    const blob = new Blob([urls.join('\n')], { type: 'text/plain' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'tsun_remaining_queue.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  exportBtn.addEventListener('click', triggerExport);

  /* ═══════════════════════════════════════════════════════════════
     CONFIDENCE COUNTER
  ═══════════════════════════════════════════════════════════════ */
  function updateConfidence() {
    $('conf-exact').textContent  = confStats.exact;
    $('conf-alt').textContent    = confStats.alt;
    $('conf-fuzzy').textContent  = confStats.fuzzy;
    $('conf-failed').textContent = confStats.failed;
  }

  /* ═══════════════════════════════════════════════════════════════
     UI HELPERS
  ═══════════════════════════════════════════════════════════════ */
  function setProgress(current, total, title = '') {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressBar.style.width = pct + '%';
    progressText.textContent = `${current} / ${total}`;
    currentTitle.textContent = title;
  }

  function setPhase(phase, label) {
    phaseLabel.textContent = label;
    phaseLabel.className   = 'phase-' + phase;
  }

  function resetUI() {
    currentFormat = null; pendingEntries = []; importQueue = [];
    importIndex = 0; isPaused = false; isRunning = false; isCancelled = false;
    failedEntries = []; currentPhase2Resolved = [];
    confStats.exact = confStats.alt = confStats.fuzzy = confStats.failed = 0;
    previewEntries = []; previewOpen = false;

    [fileInfo, statusFilter, summary, previewSection, progressSection,
     confidenceBox, doneBox, failedSection].forEach(el => el.classList.remove('visible'));
    [pauseBtn, cancelBtn, retryBtn, logBtn, exportBtn].forEach(el => el.classList.remove('visible'));
    parseError.classList.remove('visible');
    badge.className = '';
    startBtn.disabled = false;
    startBtn.textContent = 'Start Import';
    pauseBtn.textContent = 'Pause';
    statusCbs.innerHTML = '';
    previewViewport.innerHTML = '';
    previewViewport.style.display = 'none';
    previewToggle.textContent = 'Show ▾';
    failedList.innerHTML = '';
    skippedText.textContent = '';
    updateConfidence();
    dropzone.classList.remove('running-lock');
  }

  function showDone(imported, skipped) {
    doneBox.classList.add('visible');
    $('tsun-done-sub').textContent =
      `${imported} imported · ${skipped} skipped · ${failedEntries.length} failed`;
    progressSection.classList.remove('visible');
    pauseBtn.classList.remove('visible');
    cancelBtn.classList.remove('visible');
    startBtn.disabled = true;
    dropzone.classList.remove('running-lock');

    if (failedEntries.length) {
      buildFailedList();
      failedSection.classList.add('visible');
      retryBtn.classList.add('visible');
      logBtn.classList.add('visible');
    }
    const exportUrls = getExportableUrls();
    if (exportUrls.length) exportBtn.classList.add('visible');
  }

  /* ═══════════════════════════════════════════════════════════════
     BEFORE-UNLOAD GUARD
  ═══════════════════════════════════════════════════════════════ */
  window.addEventListener('beforeunload', e => {
    if (isRunning) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ═══════════════════════════════════════════════════════════════
     START BUTTON
  ═══════════════════════════════════════════════════════════════ */
  startBtn.addEventListener('click', async () => {
    if (isRunning) return;

    const resume = loadResumeState();
    let resumeIntoPhase2 = false;
    let resumedResolved  = null;

    if (resume && resume.format === currentFormat) {
      const savedResolved = loadResumeResolved();
      const remaining = resume.phase === 2
        ? (savedResolved?.length ?? 0) - resume.index
        : (resume.queue?.length ?? 0) - resume.index;
      const ok = confirm(`Resume previous import? (${remaining} entries left)`);
      if (ok) {
        importQueue = resume.queue;
        importIndex = resume.index;
        if (currentFormat === 'xml' && resume.phase === 2 && savedResolved) {
          resumeIntoPhase2 = true;
          resumedResolved  = savedResolved;
        }
      } else {
        clearResumeState();
        importQueue = buildImportQueue(getFilteredEntries());
        importIndex = 0;
      }
    } else {
      clearResumeState();
      importQueue = buildImportQueue(getFilteredEntries());
      importIndex = 0;
    }

    // Shared setup — runs unconditionally before any branch (Bug fix A)
    failedEntries = []; currentPhase2Resolved = [];
    confStats.exact = confStats.alt = confStats.fuzzy = confStats.failed = 0;
    loadMALCache();

    previewSection.classList.remove('visible');
    summary.classList.remove('visible');
    statusFilter.classList.remove('visible');
    progressSection.classList.add('visible');
    pauseBtn.classList.add('visible');
    startBtn.disabled = true;
    doneBox.classList.remove('visible');
    failedSection.classList.remove('visible');
    [retryBtn, logBtn, exportBtn].forEach(el => el.classList.remove('visible'));
    dropzone.classList.add('running-lock');

    bgNotify('IMPORT_STARTED');

    if (currentFormat === 'xml') {
      confidenceBox.classList.add('visible');
      await runMALImport(resumeIntoPhase2 ? resumedResolved : null);
    } else {
      await runDirectImport();
    }
  });

  function buildImportQueue(entries) { return entries.map(e => ({ ...e })); }

  /* ═══════════════════════════════════════════════════════════════
     PAUSE / CANCEL
  ═══════════════════════════════════════════════════════════════ */
  pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
    cancelBtn.classList.toggle('visible', isPaused);
  });

  cancelBtn.addEventListener('click', () => {
    if (!isPaused) return; // only cancellable while paused
    isCancelled = true;
    isPaused    = false;   // unblock the while(isPaused) spin so cancel propagates immediately
  });

  /* ═══════════════════════════════════════════════════════════════
     RETRY ALL FAILED
  ═══════════════════════════════════════════════════════════════ */
  retryBtn.addEventListener('click', async () => {
    if (isRunning) return;

    retryBtn.classList.remove('visible');
    logBtn.classList.remove('visible');
    exportBtn.classList.remove('visible');
    doneBox.classList.remove('visible');
    failedSection.classList.remove('visible');

    confStats.exact = confStats.alt = confStats.fuzzy = confStats.failed = 0;
    updateConfidence();

    // Capture before clearing failedEntries — avoids stale-ref bugs
    let retryResumedResolved = null;
    if (currentFormat === 'xml') {
      const needsResolution = failedEntries.filter(e => !e.muUrl);
      const alreadyResolved = failedEntries.filter(e =>  e.muUrl);
      needsResolution.forEach(e => { if (e.malId) delete malResolutionCache[e.malId]; });
      saveMALCache();
      retryResumedResolved = alreadyResolved.length ? alreadyResolved : null;
      failedEntries = [];
      importQueue   = needsResolution;
      importIndex   = 0;
      currentPhase2Resolved = [];
    } else {
      importQueue   = [...failedEntries];
      failedEntries = [];
      importIndex   = 0;
    }

    progressSection.classList.add('visible');
    pauseBtn.classList.add('visible');
    startBtn.disabled = true;
    isPaused = false; isCancelled = false;
    pauseBtn.textContent = 'Pause';
    dropzone.classList.add('running-lock');

    if (currentFormat === 'xml') {
      await runMALImport(retryResumedResolved);
    } else {
      await runDirectImport();
    }
  });

  /* ═══════════════════════════════════════════════════════════════
     ERROR LOG DOWNLOAD
  ═══════════════════════════════════════════════════════════════ */
  logBtn.addEventListener('click', () => {
    const lines = failedEntries.map(e =>
      `[${e.reason || 'Unknown'}] ${e.title || e.url || e.malId || '—'}`
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'tsun_import_errors.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  /* ═══════════════════════════════════════════════════════════════
     HANDLE CANCELLATION
  ═══════════════════════════════════════════════════════════════ */
  function handleCancellation() {
    isRunning   = false;
    isCancelled = false;
    isPaused    = false;
    pauseBtn.classList.remove('visible');
    cancelBtn.classList.remove('visible');
    progressSection.classList.remove('visible');
    dropzone.classList.remove('running-lock');
    clearResumeState();
    bgNotify('IMPORT_DONE');

    // Show export option if there are resolved URLs to save
    const urls = getExportableUrls();
    if (urls.length) {
      doneBox.classList.add('visible');
      $('tsun-done-title').textContent = '⚠ Import Cancelled';
      $('tsun-done-sub').textContent   = `${urls.length} resolved entries ready to export`;
      exportBtn.classList.add('visible');
    }
    if (failedEntries.length) {
      buildFailedList();
      failedSection.classList.add('visible');
      logBtn.classList.add('visible');
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     MAL IMPORT  (2-phase)
  ═══════════════════════════════════════════════════════════════ */
  async function runMALImport(resumedResolved = null) {
    isRunning = true;
    isCancelled = false;
    const total    = importQueue.length;
    let   resolved = resumedResolved ? [...resumedResolved] : [];

    // ── Phase 1: Resolve MAL → MU URLs ──
    if (!resumedResolved) {
      setPhase('resolve', 'Phase 1 — Resolving via MangaUpdates API');

      for (let i = importIndex; i < total; i++) {
        while (isPaused && !isCancelled) await sleep(300);
        if (isCancelled) { currentPhase2Resolved = resolved; handleCancellation(); return; }

        importIndex = i;
        saveResumeState({ phase: 1 });

        const entry = importQueue[i];
        setProgress(i + 1, total, entry.title);

        const { muUrl, confidence } = await resolveMALEntry(entry);
        // Check cancel again — resolveMALEntry may have returned early due to isCancelled during rate-limit wait
        if (isCancelled) { currentPhase2Resolved = resolved; handleCancellation(); return; }

        if (muUrl) {
          resolved.push({ ...entry, muUrl, confidence });
          confStats[confidence]++;
        } else {
          confStats.failed++;
          failedEntries.push({ ...entry, reason: 'No MangaUpdates match found' });
        }
        updateConfidence();
        await sleep(MU_BASE_DELAY_MS);
      }
    }

    // Save resolved to its own key ONCE before Phase 2 (Bug fix B+C)
    // Bug fix 1: capture p2Start BEFORE resetting importIndex — after the reset
    // importIndex is 0, so computing it afterwards always gives 0 regardless of resume.
    const p2Start = resumedResolved ? importIndex : 0;
    importIndex = 0; // reset so per-iteration checkpoints store correct Phase 2 positions
    currentPhase2Resolved = resolved;
    saveResumeResolved(resolved);
    saveResumeState({ phase: 2 });

    // ── Phase 2: Import to Atsu ──
    setPhase('import', 'Phase 2 — Importing to Atsu.moe');
    let imported = 0, skipped = 0;

    for (let i = p2Start; i < resolved.length; i++) {
      while (isPaused && !isCancelled) await sleep(300);
      if (isCancelled) { importIndex = i; handleCancellation(); return; }

      importIndex = i;
      saveResumeState({ phase: 2 }); // only checkpoint the index

      const entry = resolved[i];
      setProgress(i + 1, resolved.length, entry.title);
      skippedText.textContent = `${skipped} skipped`;

      const seriesId = await getAtsuSeriesId(entry.muUrl);
      if (!seriesId) {
        failedEntries.push({ ...entry, reason: 'Series not found on Atsu' });
        confStats.failed++; updateConfidence(); continue;
      }
      const ok = await bookmarkOnAtsu(seriesId, entry.chaptersRead);
      if (ok) { imported++; }
      else    { skipped++; failedEntries.push({ ...entry, reason: 'Already bookmarked or API error' }); }

      await sleep(200);
    }

    // Bug fix 2: advance importIndex to resolved.length so getExportableUrls slice is
    // empty on normal completion — otherwise the last loop value (resolved.length-1)
    // causes slice to return [lastEntry] and shows the Export Queue button erroneously.
    importIndex = resolved.length;
    clearResumeState();
    isRunning = false;
    bgNotify('IMPORT_DONE');
    showDone(imported, skipped);
  }

  /* ═══════════════════════════════════════════════════════════════
     DIRECT IMPORT  (CSV / TXT)
  ═══════════════════════════════════════════════════════════════ */
  async function runDirectImport() {
    isRunning   = true;
    isCancelled = false;
    const total = importQueue.length;
    let imported = 0, skipped = 0;
    setPhase('import', 'Importing to Atsu.moe');

    for (let i = importIndex; i < total; i++) {
      while (isPaused && !isCancelled) await sleep(300);
      if (isCancelled) { importIndex = i; handleCancellation(); return; }

      importIndex = i;
      saveResumeState();

      const entry = importQueue[i];
      setProgress(i + 1, total, entry.title || entry.url);
      skippedText.textContent = `${skipped} skipped`;

      let muUrl = entry.url;
      if (entry.source === 'comick') {
        const map = await getTrackerMap();
        muUrl = map[entry.url] || await searchAtsuForComick(entry);
      }

      if (!muUrl) { failedEntries.push({ ...entry, reason: 'Could not resolve to MU URL' }); continue; }

      const seriesId = await getAtsuSeriesId(muUrl);
      if (!seriesId) { failedEntries.push({ ...entry, reason: 'Series not found on Atsu' }); continue; }

      const ok = await bookmarkOnAtsu(seriesId, entry.chapter || 0);
      if (ok) { imported++; }
      else    { skipped++; }

      await sleep(200);
    }

    clearResumeState();
    isRunning = false;
    bgNotify('IMPORT_DONE');
    showDone(imported, skipped);
  }

  async function searchAtsuForComick(entry) {
    try {
      const res  = await fetch(`${ATSU_SEARCH_URL}?q=${encodeURIComponent(entry.title)}`);
      const data = await res.json();
      return data?.results?.[0]?.muUrl ?? null;
    } catch { return null; }
  }

  /* ═══════════════════════════════════════════════════════════════
     BACKGROUND MESSAGING  (navigation persistence)
  ═══════════════════════════════════════════════════════════════ */
  function bgNotify(type) {
    try { if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) chrome.runtime.sendMessage({ type }); }
    catch { /* extension context invalidated — safe to ignore */ }
  }

  // Listen for AUTO_RESUME from background when we navigate back to atsu.moe
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'AUTO_RESUME') {
          // Expand panel and surface the resume prompt
          if (collapsed) toggleCollapse();
          const saved = loadResumeState();
          if (saved && !isRunning) startBtn.click();
        }
      });
    }
  } catch { /* extension context not available */ }

  /* ═══════════════════════════════════════════════════════════════
     UTILITY
  ═══════════════════════════════════════════════════════════════ */
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ═══════════════════════════════════════════════════════════════
     ON LOAD — resume banner
  ═══════════════════════════════════════════════════════════════ */
  const savedResume = loadResumeState();
  if (savedResume) {
    const savedResolved = loadResumeResolved();
    const remaining = savedResume.phase === 2
      ? (savedResolved?.length ?? 0) - savedResume.index
      : (savedResume.queue?.length ?? 0) - savedResume.index;
    const bar = document.createElement('div');
    bar.style.cssText = `
      position:fixed; top:0; left:0; right:0;
      background:#111120; color:#de4dae;
      font-family:'Syne',sans-serif; font-size:12px; font-weight:600;
      padding:9px 18px; text-align:center;
      z-index:100000; cursor:pointer;
      border-bottom:1px solid #2a1a3a;
      animation: tsun-fadeSlideUp 0.3s both;
    `;
    bar.textContent = `Tsun Importer — unfinished import (${remaining} entries left). Click to dismiss, then open the panel to resume.`;
    bar.addEventListener('click', () => bar.remove());
    document.body.prepend(bar);
    bgNotify('RESUME_AVAILABLE');
  }

})();
