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

// ── In-memory codes cache (lives as long as service worker is alive) ──────────
let _codesCache = null;
let _cacheTime  = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchCodes() {
  if (_codesCache && Date.now() - _cacheTime < CACHE_TTL) {
    return _codesCache;
  }

  const base = (typeof STACKD_API !== 'undefined') ? STACKD_API : 'http://localhost:3001';
  const { authToken } = await chrome.storage.local.get('authToken');
  const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  const res = await fetch(`${base}/api/codes`, { headers });
  if (!res.ok) return [];

  const codes = await res.json();
  _codesCache = codes;
  _cacheTime  = Date.now();
  return codes;
}

function codesForDomain(codes, domain) {
  return codes.filter(c => {
    const cd = (c.domain || '').replace(/^www\./, '');
    return domain.includes(cd) || cd.includes(domain);
  });
}

// ── Message handler for content script ───────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Content script asking: do you have codes for this domain?
  if (msg.type === 'STACKD_CHECK') {
    const domain = msg.domain;
    if (!domain) {
      sendResponse({ codes: [] });
      return false;
    }

    fetchCodes()
      .then(all => sendResponse({ codes: codesForDomain(all, domain).slice(0, 3) }))
      .catch(() => sendResponse({ codes: [] }));

    return true; // keep message channel open for async sendResponse
  }

  // Content script asking background to open the popup
  if (msg.type === 'STACKD_OPEN_POPUP') {
    chrome.action.openPopup().catch(() => {});
    return false;
  }
});
