(() => {
  "use strict";

  // --- CONFIG & STATE ---
  const SEARCH_LIMIT = 5;
  const CHUNK_SIZE = 10;
  const POST_DELAY = 400;
  const SEARCH_DELAY = 100;

  const STATUS_MAP = {
    "Reading": "Reading", "Completed": "Completed", "Dropped": "Dropped",
    "Plan to Read": "PlanToRead", "Planned": "PlanToRead", "On-Hold": "OnHold",
    "Paused": "OnHold", "Re-Reading": "ReReading", "Rereading": "ReReading",
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- STORAGE WRAPPER ---
  const storage = {
    set: async (key, val) => {
      if (typeof chrome !== 'undefined' && chrome.storage) await chrome.storage.local.set({ [key]: val });
      else localStorage.setItem(key, JSON.stringify(val));
    },
    get: async (key) => {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        return new Promise(res => chrome.storage.local.get([key], r => res(r[key])));
      }
      return JSON.parse(localStorage.getItem(key));
    },
    remove: async (key) => {
      if (typeof chrome !== 'undefined' && chrome.storage) await chrome.storage.local.remove(key);
      else localStorage.removeItem(key);
    }
  };

  // --- STYLES (Frosted Monochrome) ---
  const styles = `
    #tsun-panel { 
      position: fixed; top: 20px; right: 20px; z-index: 999999; 
      background: rgba(10, 10, 12, 0.55); 
      backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px); 
      border: 1px solid rgba(255, 255, 255, 0.12); 
      border-radius: 14px; width: 350px; color: #fff; 
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
      box-shadow: 0 16px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1); 
      transition: height 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); 
      overflow: hidden; display: flex; flex-direction: column; 
    }
    #tsun-panel.minimized { height: 50px !important; width: 220px; }
    
    #tsun-header { 
      display: flex; justify-content: space-between; align-items: center; 
      padding: 14px 18px; cursor: grab; 
      background: rgba(255, 255, 255, 0.02); 
      border-bottom: 1px solid rgba(255, 255, 255, 0.06); 
      user-select: none; 
    }
    #tsun-header:active { cursor: grabbing; }
    #tsun-header h2 { 
      margin: 0; font-size: 14px; font-weight: 600; color: #eaeaea; 
      display: flex; align-items: center; gap: 8px; pointer-events: none; 
      letter-spacing: 0.3px;
    }
    
    .tsun-pulse { width: 6px; height: 6px; background: rgba(255,255,255,0.3); border-radius: 50%; display: inline-block; transition: 0.3s; }
    .tsun-pulse.active { background: #fff; box-shadow: 0 0 8px #fff; animation: tsun-blink 1.5s infinite; }
    @keyframes tsun-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    
    .tsun-controls { display: flex; gap: 14px; align-items: center; }
    .tsun-ctrl-btn { 
      background: transparent; border: none; color: rgba(255,255,255,0.4); 
      font-size: 14px; cursor: pointer; transition: 0.2s; padding: 0; 
      display: flex; align-items: center; justify-content: center;
    }
    .tsun-ctrl-btn:hover { color: #fff; }
    
    #tsun-body { padding: 20px; display: flex; flex-direction: column; gap: 20px; }
    
    /* Input Area Flexbox Spacing */
    #tsun-input-area { display: flex; flex-direction: column; gap: 16px; }

    .tsun-file-wrapper { 
      position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; 
      width: 100%; height: 90px; border-radius: 10px; 
      background: rgba(0,0,0,0.25); 
      border: 1px dashed rgba(255,255,255,0.15); 
      text-align: center; cursor: pointer; transition: all 0.2s ease; 
      overflow: hidden; padding: 0 15px; box-sizing: border-box;
    }
    .tsun-file-wrapper.dragover { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.5); transform: scale(1.02); }
    .tsun-file-wrapper input[type=file] { position: absolute; left: 0; top: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
    .tsun-file-text { 
      font-size: 14px; font-weight: 500; color: #ddd; pointer-events: none; margin-bottom: 4px;
      width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; 
    }
    .tsun-file-subtext { font-size: 11px; color: rgba(255,255,255,0.4); pointer-events: none; }
    
    .tsun-opt-box { 
      background: rgba(0,0,0,0.15); padding: 12px 14px; border-radius: 8px; font-size: 12px; 
      display: none; border: 1px solid rgba(255,255,255,0.04); 
    }
    .tsun-opt-box label { display: flex; align-items: center; gap: 10px; cursor: pointer; color: rgba(255,255,255,0.7); user-select: none; }
    
    .tsun-btn { 
      width: 100%; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); 
      background: rgba(255,255,255,0.08); color: #fff; font-weight: 500; font-size: 13px; 
      cursor: pointer; transition: 0.2s; backdrop-filter: blur(5px); letter-spacing: 0.5px;
    }
    .tsun-btn:hover { background: rgba(255,255,255,0.15); border-color: rgba(255,255,255,0.2); transform: translateY(-1px); }
    .tsun-btn:disabled { background: rgba(0,0,0,0.2); color: rgba(255,255,255,0.3); border-color: transparent; cursor: not-allowed; transform: none; }
    
    .tsun-btn-secondary { background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); color: rgba(255,255,255,0.6); }
    .tsun-btn-secondary:hover { background: rgba(255,255,255,0.1); color: #fff; }

    #tsun-resume-box { 
      display: none; background: rgba(0,0,0,0.3); padding: 16px; 
      border-radius: 10px; text-align: center; border: 1px solid rgba(255,255,255,0.05); 
    }
    .tsun-resume-actions { display: flex; gap: 12px; margin-top: 14px; }
    
    #tsun-ui-data { display: none; }
    .tsun-status-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .tsun-status-text { font-size: 13px; font-weight: 500; color: #ddd; }
    .tsun-eta { font-size: 11px; color: rgba(255,255,255,0.4); font-variant-numeric: tabular-nums; }
    
    .tsun-progress-bg { width: 100%; height: 4px; background: rgba(0,0,0,0.4); border-radius: 4px; overflow: hidden; margin-bottom: 20px; }
    #tsun-progress-fill { width: 0%; height: 100%; background: #fff; transition: width 0.3s ease; box-shadow: 0 0 8px rgba(255,255,255,0.4); }
    
    .tsun-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
    .tsun-stat-box { background: rgba(0,0,0,0.2); padding: 12px 6px; border-radius: 8px; text-align: center; border: 1px solid rgba(255,255,255,0.03); }
    .tsun-stat-box span { display: block; font-size: 9px; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .tsun-stat-box strong { font-size: 15px; color: #fff; font-weight: 500; }
    
    #tsun-console-wrap { display: none; background: rgba(0,0,0,0.3); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); padding: 12px; margin-bottom: 16px; }
    #tsun-console { height: 90px; overflow-y: auto; font-family: 'Consolas', monospace; font-size: 11px; color: rgba(255,255,255,0.6); display: flex; flex-direction: column; gap: 4px; }
    .tsun-console-line { word-break: break-all; }
    .tsun-log-success { color: #fff; }
    .tsun-log-warn { color: rgba(255,255,255,0.5); }
    .tsun-log-err { color: #ff6b6b; }
    
    .tsun-footer-links { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 12px; }
    .tsun-link { font-size: 11px; color: rgba(255,255,255,0.4); text-decoration: none; transition: 0.2s; }
    .tsun-link:hover { color: #fff; }
    .tsun-toggle-console { font-size: 11px; color: rgba(255,255,255,0.4); background: none; border: none; cursor: pointer; transition: 0.2s; padding: 0; }
    .tsun-toggle-console:hover { color: #fff; }
  `;
  const styleEl = document.createElement("style"); styleEl.textContent = styles; document.head.appendChild(styleEl);

  // --- UI CONSTRUCTION ---
  const panel = document.createElement("div"); panel.id = "tsun-panel";
  panel.innerHTML = 
    '<div id="tsun-header">' +
      '<h2><span class="tsun-pulse" id="tsun-indicator"></span> Tsun Importer</h2>' +
      '<div class="tsun-controls">' +
        '<button id="tsun-min" class="tsun-ctrl-btn" title="Minimize">🗕</button>' +
        '<button id="tsun-close" class="tsun-ctrl-btn" title="Close">✕</button>' +
      '</div>' +
    '</div>' +
    '<div id="tsun-body">' +
      '<div id="tsun-resume-box">' +
        '<div style="font-size:13px; margin-bottom:6px; font-weight:500; color:#fff;">Session Found</div>' +
        '<div style="font-size:11px; color:rgba(255,255,255,0.5);">Resume your previous import?</div>' +
        '<div class="tsun-resume-actions">' +
          '<button id="tsun-resume-btn" class="tsun-btn">Resume</button>' +
          '<button id="tsun-clear-btn" class="tsun-btn tsun-btn-secondary">Discard</button>' +
        '</div>' +
      '</div>' +
      '<div id="tsun-input-area">' +
        '<div class="tsun-file-wrapper" id="tsun-dropzone">' +
          '<div class="tsun-file-text" id="tsun-file-label">Drop TXT or CSV here</div>' +
          '<div class="tsun-file-subtext">or click to browse files</div>' +
          '<input id="tsun-file" type="file" accept=".csv,.txt" />' +
        '</div>' +
        '<div class="tsun-opt-box" id="tsun-csv-opts">' +
          '<label><input type="checkbox" id="tsun-opt-progress" checked /> Sync Chapter Progress</label>' +
        '</div>' +
        '<button id="tsun-run" class="tsun-btn" disabled>Waiting for file...</button>' +
      '</div>' +
      '<div id="tsun-ui-data">' +
        '<div class="tsun-status-row">' +
          '<div class="tsun-status-text" id="tsun-status">Preparing data...</div>' +
          '<div class="tsun-eta" id="tsun-eta">ETA: --:--</div>' +
        '</div>' +
        '<div class="tsun-progress-bg"><div id="tsun-progress-fill"></div></div>' +
        '<div class="tsun-stats">' +
          '<div class="tsun-stat-box"><span>Parsed</span><strong id="stat-parsed">0</strong></div>' +
          '<div class="tsun-stat-box"><span>Owned</span><strong id="stat-skipped" style="color:rgba(255,255,255,0.7);">0</strong></div>' +
          '<div class="tsun-stat-box"><span>Added</span><strong id="stat-imported" style="color:#fff;">0</strong></div>' +
          '<div class="tsun-stat-box"><span>Fails</span><strong id="stat-errors" style="color:#ff6b6b;">0</strong></div>' +
        '</div>' +
        '<div id="tsun-console-wrap"><div id="tsun-console"></div></div>' +
        '<button id="tsun-dl-errors" class="tsun-btn tsun-btn-secondary" style="margin-bottom:16px; display:none;">Download Missed List</button>' +
      '</div>' +
      '<div class="tsun-footer-links">' +
        '<a href="https://github.com/OnlyShresth/weebcentral-extractor" target="_blank" class="tsun-link">Weebcentral Guide ↗</a>' +
        '<button id="tsun-btn-console" class="tsun-toggle-console" style="display:none;">Toggle Log</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(panel);

  // --- INTERACTIVITY: Drag Window ---
  const header = panel.querySelector("#tsun-header");
  let isDragging = false, currentX, currentY, initialX, initialY, xOffset = 0, yOffset = 0;
  
  header.addEventListener("mousedown", (e) => { 
    if(!e.target.closest('.tsun-controls')) { initialX = e.clientX - xOffset; initialY = e.clientY - yOffset; isDragging = true; }
  });
  document.addEventListener("mouseup", () => { initialX = currentX; initialY = currentY; isDragging = false; });
  document.addEventListener("mousemove", (e) => { 
    if(isDragging) { e.preventDefault(); currentX = e.clientX - initialX; currentY = e.clientY - initialY; xOffset = currentX; yOffset = currentY; panel.style.transform = 'translate3d(' + currentX + 'px, ' + currentY + 'px, 0)'; }
  });

  // --- WINDOW CONTROLS (Min/Max Toggle) ---
  panel.querySelector("#tsun-close").onclick = () => panel.remove();
  const minBtn = panel.querySelector("#tsun-min");
  minBtn.onclick = () => { 
    panel.classList.toggle("minimized"); 
    const isMin = panel.classList.contains("minimized");
    minBtn.textContent = isMin ? "🗖" : "🗕";
    minBtn.title = isMin ? "Maximize" : "Minimize";
    panel.querySelector("#tsun-body").style.display = isMin ? "none" : "flex"; 
  };
  
  const consoleWrap = panel.querySelector("#tsun-console-wrap");
  panel.querySelector("#tsun-btn-console").onclick = () => {
    consoleWrap.style.display = consoleWrap.style.display === "block" ? "none" : "block";
  };

  // --- FILE HANDLING ---
  const fileInput = panel.querySelector("#tsun-file");
  const runBtn = panel.querySelector("#tsun-run");
  const inputArea = panel.querySelector("#tsun-input-area");
  const dropzone = panel.querySelector("#tsun-dropzone");

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => dropzone.addEventListener(e, ev => ev.preventDefault(), false));
  ['dragenter', 'dragover'].forEach(e => dropzone.addEventListener(e, () => dropzone.classList.add('dragover'), false));
  ['dragleave', 'drop'].forEach(e => dropzone.addEventListener(e, () => dropzone.classList.remove('dragover'), false));

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      // Added inline block and ellipsis properties directly to the injected span just to be fully safe
      panel.querySelector("#tsun-file-label").innerHTML = '<span style="color:#fff; font-weight:600; letter-spacing:0.5px; display:inline-block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom;">' + file.name + '</span>';
      panel.querySelector(".tsun-file-subtext").textContent = "File ready";
      runBtn.disabled = false; runBtn.textContent = "Start Import";
      if(file.name.endsWith('.csv')) panel.querySelector("#tsun-csv-opts").style.display = "block";
    }
  });

  // --- LOGGING & ETA ENGINE ---
  const consoleEl = document.getElementById("tsun-console");
  const tLog = (msg, type = "") => {
    const line = document.createElement("div");
    line.className = 'tsun-console-line tsun-log-' + type;
    line.textContent = '> ' + msg;
    consoleEl.appendChild(line);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  };

  let startTime = 0;
  const updateUI = (current, total, text, s) => {
    if(s) {
      document.getElementById("stat-parsed").textContent = s.parsed; 
      document.getElementById("stat-skipped").textContent = s.skipped;
      document.getElementById("stat-imported").textContent = s.imported; 
      document.getElementById("stat-errors").textContent = s.errors;
    }
    const pct = total === 0 ? 0 : Math.round((current / total) * 100);
    document.getElementById("tsun-progress-fill").style.width = pct + '%';
    document.getElementById("tsun-status").textContent = text;
    
    if (current > 0 && total > current && startTime > 0) {
      const elapsed = Date.now() - startTime;
      const rate = elapsed / current;
      const remainingMs = rate * (total - current);
      const mins = Math.floor(remainingMs / 60000);
      const secs = Math.floor((remainingMs % 60000) / 1000).toString().padStart(2, '0');
      document.getElementById("tsun-eta").textContent = 'ETA: ' + mins + ':' + secs;
    } else if (current === total) {
      document.getElementById("tsun-eta").textContent = "Done";
    }
  };

  const indicator = document.getElementById("tsun-indicator");

  // --- ERROR EXPORTER ---
  const dlErrorsBtn = document.getElementById("tsun-dl-errors");
  function exportMissedList(errorLog) {
    if(!errorLog || errorLog.length === 0) return;
    const text = "TSUN IMPORTER - MISSED MANGA LOG\n\n" + errorLog.map(e => '[Reason: ' + e.reason + '] ' + e.item).join('\n');
    const blob = new Blob([text], {type: "text/plain"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = 'Tsun_Missed_List_' + new Date().toISOString().slice(0,10) + '.txt';
    a.click(); URL.revokeObjectURL(url);
  }

  // --- API LOGIC ---
  async function checkIfOwned(mangaId) {
    try { 
      const res = await fetch('/api/manga/page?id=' + mangaId, { credentials: "include" }); 
      if(!res.ok) return false; 
      const mp = (await res.json()).mangaPage; 
      return !!(mp && (mp.bookmarkStatus || mp.bookmark || mp.continueReading)); 
    } catch (e) { return false; }
  }

  async function fetchTrackerMap() { 
    try { const res = await fetch("https://atsu.moe/tracker-map.json"); return res.ok ? await res.json() : []; } 
    catch (e) { return []; }
  }

  async function searchAtsu(query) {
    if(!query) return [];
    try {
      const params = new URLSearchParams({ q: query, limit: SEARCH_LIMIT, query_by: "title,englishTitle", include_fields: "id,title" });
      const res = await fetch('/collections/manga/documents/search?' + params.toString()); 
      return res.ok ? ((await res.json()).hits || []).map(h => h.document).filter(Boolean) : [];
    } catch (e) { return []; }
  }

  async function syncProgress(mangaId, chapterNum) {
    try {
      const res = await fetch('/api/manga/allChapters?mangaId=' + mangaId, {credentials: "include"});
      if(!res.ok) return false;
      const target = ((await res.json()).chapters || []).find(c => Number(c.number) === Number(chapterNum));
      if(!target) return false;
      
      const payload = { progress: [{ mangaScanlationId: target.scanlationMangaId, mangaId: mangaId, chapterId: target.id, page: Math.max(0, (Number(target.pageCount)||1) - 1), frac: 1, pages: Number(target.pageCount)||1, ts: Date.now(), strip: false }], deletedChapters: [] };
      const postRes = await fetch("/api/read/syncProgress", { method:"POST", headers: {"content-type": "application/json"}, body: JSON.stringify(payload) });
      return postRes.ok;
    } catch(e) { return false; }
  }

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ''));
    return lines.slice(1).map(line => {
      const cols = line.split(",").map(c => c.trim().replace(/"/g, ''));
      const obj = {}; headers.forEach((h, j) => obj[h] = cols[j] || ""); return obj;
    });
  }

  // --- STATE MACHINE (EXECUTION) ---
  let gState = null;

  async function checkState() {
    const saved = await storage.get("tsunState");
    if(saved && saved.items && saved.items.length > 0 && saved.currentIndex < saved.items.length) {
      document.getElementById("tsun-resume-box").style.display = "block";
      inputArea.style.display = "none";
      gState = saved;
    }
  }

  document.getElementById("tsun-clear-btn").onclick = async () => {
    await storage.remove("tsunState");
    document.getElementById("tsun-resume-box").style.display = "none";
    inputArea.style.display = "flex";
    gState = null;
  };

  document.getElementById("tsun-resume-btn").onclick = () => startMachine();
  
  runBtn.onclick = async () => {
    const file = fileInput.files[0]; if(!file) return;
    const isTxt = file.name.endsWith(".txt"); const isCsv = file.name.endsWith(".csv");
    if(!isTxt && !isCsv) return alert("Unsupported format.");

    const text = await file.text();
    let items = isTxt ? text.split(/\r?\n/).map(l => l.trim()).filter(Boolean) : parseCsv(text);
    
    gState = {
      isTxt, isCsv,
      doProgress: isCsv ? document.getElementById("tsun-opt-progress").checked : false,
      items: items, currentIndex: 0, importQueue: [], progressQueue: [], errorLog: [],
      stats: { parsed: items.length, skipped: 0, imported: 0, errors: 0 }
    };
    await storage.set("tsunState", gState);
    startMachine();
  };

  async function startMachine() {
    inputArea.style.display = "none";
    document.getElementById("tsun-resume-box").style.display = "none";
    document.getElementById("tsun-ui-data").style.display = "block";
    panel.querySelector("#tsun-btn-console").style.display = "block";
    indicator.classList.add("active");
    startTime = Date.now();
    
    tLog("Fetching Tracker Map...");
    const trackerMap = await fetchTrackerMap();

    // 1. MAPPING PHASE
    for (let i = gState.currentIndex; i < gState.items.length; i++) {
      gState.currentIndex = i;
      if(i % 5 === 0) await storage.set("tsunState", gState);
      
      updateUI(i, gState.items.length, 'Mapping Database...', gState.stats);
      
      let atsuId = null, targetItem = gState.items[i], identifier = "";

      if (gState.isTxt) {
        identifier = targetItem.split('/').pop();
        const muMatch = targetItem.match(/\/series\/([a-z0-9]+)/i);
        if (muMatch) {
          const mapItem = trackerMap.find(x => x.idMangaUpdates === muMatch[1]);
          if (mapItem) atsuId = mapItem.id;
        }
        if (!atsuId) {
          const slugMatch = targetItem.match(/\/series\/[a-z0-9]+\/([^/]+)/i);
          if (slugMatch) {
            const searchHits = await searchAtsu(slugMatch[1].replace(/-/g, ' '));
            if (searchHits.length > 0) atsuId = searchHits[0].id;
            await sleep(SEARCH_DELAY);
          }
        }
      } else {
        identifier = targetItem.title || "Unknown Row";
        if(targetItem.title) {
          const muId = (targetItem.mangaupdates || "").match(/\/series\/([a-z0-9]+)/i)?.[1];
          const malId = (targetItem.mal || "").match(/(\d+)/)?.[1];
          const mapItem = trackerMap.find(x => (muId && x.idMangaUpdates === muId) || (malId && x.idMal === malId));
          if (mapItem) atsuId = mapItem.id;

          if (!atsuId) {
            const searchHits = await searchAtsu(targetItem.title);
            if (searchHits.length > 0) atsuId = searchHits[0].id;
            await sleep(SEARCH_DELAY);
          }
        }
      }

      if (atsuId) {
        const isOwned = await checkIfOwned(atsuId);
        if (isOwned) {
          gState.stats.skipped++;
          tLog('[SKIP] Already owned: ' + identifier, "warn");
        } else {
          const status = gState.isCsv ? (STATUS_MAP[targetItem.type] || "PlanToRead") : "PlanToRead";
          gState.importQueue.push({ mangaId: atsuId, status, synced: false, ts: Date.now(), type: "Manga" });
          tLog('[MAP] Queued: ' + identifier, "success");
          
          if(gState.isCsv && gState.doProgress && targetItem.read && !isNaN(targetItem.read) && Number(targetItem.read) > 0) {
            gState.progressQueue.push({ mangaId: atsuId, chapter: targetItem.read });
          }
        }
      } else {
        gState.stats.errors++;
        gState.errorLog.push({ item: identifier, reason: "Not Found in Tracker/Search" });
        tLog('[ERR] Map failed: ' + identifier, "err");
      }
    }

    gState.currentIndex = gState.items.length;
    await storage.set("tsunState", gState);
    startTime = Date.now(); 

    // 2. IMPORT BOOKMARKS PHASE
    if (gState.importQueue.length > 0) {
      let posted = 0;
      for (let i = 0; i < gState.importQueue.length; i += CHUNK_SIZE) {
        const chunk = gState.importQueue.slice(i, i + CHUNK_SIZE);
        updateUI(posted, gState.importQueue.length, 'Posting Bookmarks...', gState.stats);
        
        let success = false, attempts = 0;
        while (!success && attempts < 3) {
          try {
            const res = await fetch("/api/user/syncBookmarks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(chunk) });
            if (res.status === 429) { tLog('[API] Rate limit hit. Pausing...', "warn"); await sleep(2500); attempts++; continue; }
            if (!res.ok) throw new Error("API Error");
            success = true; posted += chunk.length; gState.stats.imported += chunk.length;
            tLog('[POST] Bookmarks synced: ' + chunk.length, "success");
          } catch(e) { attempts++; await sleep(1000); }
        }
        if (!success) {
          gState.stats.errors += chunk.length;
          chunk.forEach(c => gState.errorLog.push({ item: 'ID: ' + c.mangaId, reason: "Failed to POST Bookmark" }));
          tLog('[POST ERR] Chunk failed', "err");
        }
        updateUI(posted, gState.importQueue.length, 'Posting Bookmarks...', gState.stats);
        await sleep(POST_DELAY);
      }
    }

    // 3. SYNC PROGRESS PHASE (CSV ONLY)
    if(gState.progressQueue.length > 0) {
      startTime = Date.now();
      let pCount = 0;
      for (const pItem of gState.progressQueue) {
        updateUI(pCount, gState.progressQueue.length, 'Syncing Chapters...', gState.stats);
        const success = await syncProgress(pItem.mangaId, pItem.chapter);
        if(!success) {
          gState.errorLog.push({ item: 'ID: ' + pItem.mangaId + ' (Ch ' + pItem.chapter + ')', reason: "Failed to POST Progress" });
          tLog('[ERR] Ch. ' + pItem.chapter + ' failed for ID ' + pItem.mangaId, "err");
        } else {
          tLog('[POST] Ch. ' + pItem.chapter + ' synced', "success");
        }
        pCount++;
        await sleep(POST_DELAY);
      }
    }

    // --- FINISH ---
    indicator.classList.remove("active");
    await storage.remove("tsunState");
    updateUI(100, 100, "Import Complete!", gState.stats);
    tLog("Task Finished.");
    
    if(gState.errorLog.length > 0) {
      dlErrorsBtn.style.display = "block";
      dlErrorsBtn.onclick = () => exportMissedList(gState.errorLog);
    }
  }

  checkState();
})();