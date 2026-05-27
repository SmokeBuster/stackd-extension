importScripts('config.js');

chrome.runtime.onInstalled.addListener(() => {
  console.log('Stackd installed.');
});

// ── OAuth: detect success redirect, extract JWT, save it, close tab ──────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url) return;

  let successBase;
  try {
    successBase = new URL('/auth/success', STACKD_API).href;
  } catch (_) {
    return;
  }

  if (!tab.url.startsWith(successBase)) return;

  const token = new URL(tab.url).searchParams.get('token');
  if (token) {
    await chrome.storage.local.set({ authToken: token });
    chrome.tabs.remove(tabId);
  }
});

// ── Persistent codes cache (survives service-worker restarts) ─────────────────
// In-memory mirror for the same run — avoids redundant storage reads
let _memCodes = null;
let _memTime  = 0;

const CODES_CACHE_KEY = 'stackd_bg_codes_cache';
const CACHE_TTL       = 5 * 60 * 1000; // 5 minutes

async function fetchCodes() {
  // 1. Check in-memory mirror (fastest — same SW activation)
  if (_memCodes && Date.now() - _memTime < CACHE_TTL) {
    return _memCodes;
  }

  // 2. Check persistent storage (survives SW restarts)
  const stored = await chrome.storage.local.get(CODES_CACHE_KEY);
  const entry  = stored[CODES_CACHE_KEY];
  if (entry && (Date.now() - entry.time) < CACHE_TTL) {
    _memCodes = entry.codes;
    _memTime  = entry.time;
    return _memCodes;
  }

  // 3. Fetch fresh from API
  const base = (typeof STACKD_API !== 'undefined') ? STACKD_API : 'http://localhost:3001';
  const { authToken } = await chrome.storage.local.get('authToken');
  const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  const res = await fetch(`${base}/api/codes`, { headers });
  if (!res.ok) return [];

  const codes = await res.json();

  // Persist to storage and update in-memory mirror
  const now = Date.now();
  await chrome.storage.local.set({ [CODES_CACHE_KEY]: { codes, time: now } });
  _memCodes = codes;
  _memTime  = now;

  return codes;
}

function codesForDomain(codes, domain) {
  return codes.filter(c => {
    const cd = (c.domain || '').replace(/^www\./, '');
    return domain.includes(cd) || cd.includes(domain);
  });
}

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'STACKD_CHECK') {
    const domain = msg.domain;
    if (!domain) {
      sendResponse({ codes: [] });
      return false;
    }

    fetchCodes()
      .then(all => sendResponse({ codes: codesForDomain(all, domain).slice(0, 3) }))
      .catch(() => sendResponse({ codes: [] }));

    return true; // keep channel open for async sendResponse
  }

  if (msg.type === 'STACKD_OPEN_POPUP') {
    chrome.action.openPopup().catch(() => {});
    return false;
  }
});
