// ═══════════════════════════════════════════════════════════════════
//  Tsun Importer — background.js  (MV3 service worker)
//  Handles: navigation persistence across page reloads
// ═══════════════════════════════════════════════════════════════════

const ATSU_ORIGIN   = 'https://atsu.moe';
const ALARM_PREFIX  = 'tsun_resume_';

// ─── Track which tab has an active import ────────────────────────
// NOTE: MV3 service workers can be terminated when idle; activeTabId
// resets on restart. The onUpdated listener handles that gracefully
// by firing for all new atsu.moe tabs regardless.
let activeTabId = null;

chrome.runtime.onMessage.addListener((msg, sender) => {
  switch (msg.type) {
    case 'IMPORT_STARTED':
      activeTabId = sender.tab?.id ?? null;
      break;
    case 'IMPORT_DONE':
      activeTabId = null;
      break;
    case 'RESUME_AVAILABLE':
      if (activeTabId === null) activeTabId = sender.tab?.id ?? null;
      break;
  }
});

// ─── Single onUpdated handler covers both the tracked tab and new tabs ──
// Bug fix 3: use tab.url (always present) instead of changeInfo.url
// (which is undefined on same-tab refresh), so refreshing atsu.moe
// correctly triggers auto-resume.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const url = tab.url || '';
  if (!url.startsWith(ATSU_ORIGIN)) return;
  scheduleAutoResume(tabId);
});

// ─── Schedule AUTO_RESUME via chrome.alarms (Bug fix 4) ──────────
// setTimeout in MV3 service workers is unreliable — the worker can be
// terminated before a pending timeout fires, silently dropping the message.
// chrome.alarms persist across service worker restarts.
function scheduleAutoResume(tabId) {
  const alarmName = ALARM_PREFIX + tabId;
  // Store the target tabId so the alarm handler knows who to message.
  // chrome.storage.session is scoped to the browser session (not persisted to disk).
  chrome.storage.session.set({ [alarmName]: tabId });
  // delayInMinutes: 1/60 ≈ 1 second — enough for the content script to inject.
  chrome.alarms.create(alarmName, { delayInMinutes: 1 / 60 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const data  = await chrome.storage.session.get(alarm.name);
  const tabId = data[alarm.name];
  await chrome.storage.session.remove(alarm.name);
  if (!tabId) return;

  chrome.tabs.sendMessage(tabId, { type: 'AUTO_RESUME' }, () => {
    void chrome.runtime.lastError; // suppress "no receiver" errors
  });
});
