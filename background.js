importScripts('config.js');

chrome.runtime.onInstalled.addListener(() => {
  console.log('Stackd installed.');
});

// Detect the OAuth success redirect, extract JWT, save it, close the tab
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
