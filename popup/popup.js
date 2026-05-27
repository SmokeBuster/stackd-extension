// STACKD_API is defined in config.js (loaded before this script in popup.html)
const API = (typeof STACKD_API !== 'undefined') ? STACKD_API : 'http://localhost:3001';

// ── API helper ────────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const { authToken } = await chrome.storage.local.get('authToken');
  const res = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    await chrome.storage.local.remove('authToken');
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const loginScreen      = document.getElementById('loginScreen');
  const onboardingScreen = document.getElementById('onboardingScreen');
  const mainApp          = document.getElementById('mainApp');

  const { authToken } = await chrome.storage.local.get('authToken');

  if (!authToken) {
    loginScreen.classList.remove('hidden');
    wireLoginScreen();
    return;
  }

  let user, codes;
  try {
    [user, codes] = await Promise.all([
      apiFetch('/api/me'),
      apiFetch('/api/codes'),
    ]);
  } catch (err) {
    if (err.status === 401) {
      loginScreen.classList.remove('hidden');
      wireLoginScreen();
      return;
    }
    loginScreen.classList.remove('hidden');
    loginScreen.innerHTML = `
      <div style="text-align:center;padding:32px 24px;color:#fff">
        <div style="font-size:36px;margin-bottom:12px">⚠️</div>
        <strong>Can't reach the server</strong>
        <p style="margin-top:8px;font-size:13px;opacity:.8">Unable to connect to the Stackd server. Please try again.</p>
      </div>`;
    return;
  }

  // Show onboarding if university not set
  if (!user.university) {
    onboardingScreen.classList.remove('hidden');
    wireOnboarding(user, codes);
    return;
  }

  mainApp.classList.remove('hidden');
  initMainApp(user, codes);
});

// ── Login screen ──────────────────────────────────────────────────────────────
function wireLoginScreen() {
  document.getElementById('signInBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: `${API}/auth/google` });
    window.close();
  });
}

// ── Onboarding screen ─────────────────────────────────────────────────────────
function wireOnboarding(user, codes) {
  const onboardingScreen = document.getElementById('onboardingScreen');
  const mainApp          = document.getElementById('mainApp');
  const saveBtn          = document.getElementById('obSaveBtn');
  const skipBtn          = document.getElementById('obSkipBtn');
  const select           = document.getElementById('universitySelect');

  async function finishOnboarding(university) {
    if (university) {
      try {
        await apiFetch('/api/me/university', { method: 'PUT', body: { university } });
        user.university = university;
      } catch (_) {}
    }
    onboardingScreen.classList.add('hidden');
    mainApp.classList.remove('hidden');
    initMainApp(user, codes);
  }

  saveBtn.addEventListener('click', async () => {
    const val = select.value;
    if (!val) {
      select.style.borderColor = 'var(--red)';
      setTimeout(() => { select.style.borderColor = ''; }, 1500);
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    await finishOnboarding(val);
  });

  skipBtn.addEventListener('click', () => finishOnboarding(''));
}

// ── Main app ──────────────────────────────────────────────────────────────────
async function initMainApp(user, codes) {
  let currentDomain = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) currentDomain = new URL(tab.url).hostname.replace(/^www\./, '');
  } catch (_) {}

  // ── State
  let activeCategory = 'All';
  let allCodes       = codes;
  let coinBalance    = user.coinBalance;

  // ── Coin display
  setCoinAmount(coinBalance);

  // ── Site banner
  const siteName  = document.getElementById('siteName');
  const siteMatch = currentDomain && allCodes.some(c => currentDomain.includes(c.domain.replace(/^www\./, '')));
  if (siteMatch)          siteName.textContent = currentDomain;
  else if (currentDomain) siteName.textContent = `${currentDomain} (showing all)`;

  // ── Initial render
  renderPills();
  renderCodes(filtered(), currentDomain);
  renderGiftCards(STACKD.giftCards);

  // ── AI Picks (fire-and-forget)
  if (currentDomain) loadAiPicks(currentDomain);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function filtered(query = document.getElementById('searchInput').value.trim()) {
    return allCodes.filter(c => {
      const matchesCat = activeCategory === 'All' || c.category === activeCategory;
      const matchesQ   = !query || [c.brand, c.code, c.description, c.category].some(
        f => f.toLowerCase().includes(query.toLowerCase())
      );
      return matchesCat && matchesQ;
    });
  }

  function uniqueCategories() {
    return [...new Set(allCodes.map(c => c.category))].sort();
  }

  function setCoinAmount(n) {
    document.getElementById('coinAmount').textContent = n.toLocaleString();
  }

  function animateCoin() {
    const el = document.getElementById('coinAmount');
    el.classList.remove('coin-bump');
    void el.offsetWidth;
    el.classList.add('coin-bump');
  }

  function renderPills() {
    const container = document.getElementById('filterPills');
    container.innerHTML = ['All', ...uniqueCategories()].map(cat => `
      <button class="pill ${cat === activeCategory ? 'active' : ''}" data-cat="${cat}">${cat}</button>
    `).join('');
  }

  // ── Tab switching ────────────────────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');

      const panelMap = { codes: 'codesPanel', giftcards: 'giftcardsPanel', benefits: 'benefitsPanel' };
      document.getElementById(panelMap[tab.dataset.tab]).classList.add('active');

      if (tab.dataset.tab === 'benefits') loadBenefits(user);
    });
  });

  // ── Search ───────────────────────────────────────────────────────────────────
  const searchInput = document.getElementById('searchInput');
  const clearBtn    = document.getElementById('clearBtn');
  const aiFound     = document.getElementById('aiFound');
  const aiFoundList = document.getElementById('aiFoundList');

  let aiSearchTimer  = null;
  let lastAiQuery    = '';

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    clearBtn.classList.toggle('visible', q.length > 0);

    // Hide AI results whenever the query changes
    aiFound.hidden = true;
    clearTimeout(aiSearchTimer);

    const results = filtered(q);
    renderCodes(results, currentDomain);

    // Auto-trigger AI search after 600ms if 0 regular results and query ≥ 2 chars
    if (q.length >= 2 && results.length === 0 && q !== lastAiQuery) {
      aiSearchTimer = setTimeout(() => {
        if (searchInput.value.trim() === q) triggerAiSearch(q);
      }, 600);
    }
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.classList.remove('visible');
    clearTimeout(aiSearchTimer);
    aiFound.hidden = true;
    lastAiQuery    = '';
    renderCodes(filtered(''), currentDomain);
    searchInput.focus();
  });

  // Dismiss AI results
  document.getElementById('aiFoundDismiss').addEventListener('click', () => {
    aiFound.hidden = true;
  });

  // ── AI Smart Search ──────────────────────────────────────────────────────────
  async function triggerAiSearch(query) {
    lastAiQuery = query;
    const codesList = document.getElementById('codesList');

    // Show loading state in codes list
    codesList.innerHTML = `
      <div class="ai-search-loading">
        <div class="ai-search-spinner">🤖</div>
        <span>AI is searching for you…</span>
      </div>`;

    try {
      const { results } = await apiFetch('/api/search/ai', {
        method: 'POST',
        body:   { query },
      });

      // Save to recent searches on success
      await saveRecentSearch(query);

      if (!results || results.length === 0) {
        renderCodes([], currentDomain);
        return;
      }

      // Restore normal empty state (no DB codes for this query)
      renderCodes([], currentDomain);

      // Show AI Found section
      aiFound.hidden = false;
      aiFoundList.innerHTML = results.map(r => `
        <div class="ai-found-card" data-code="${escHtml(r.code || '')}">
          <span class="ai-found-emoji">${escHtml(r.emoji || '🏷️')}</span>
          <div class="ai-found-info">
            <div class="ai-found-brand">${escHtml(r.brand)}</div>
            <div class="ai-found-discount">${escHtml(r.discount || '')}</div>
          </div>
          ${r.code ? `<span class="ai-found-code">${escHtml(r.code)}</span>` : ''}
        </div>`).join('');

      // Copy code on click
      aiFoundList.querySelectorAll('.ai-found-card').forEach(card => {
        const code = card.dataset.code;
        if (!code) return;
        card.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(code); } catch (_) {
            const el = document.createElement('textarea');
            el.value = code;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
          }
          const codeEl = card.querySelector('.ai-found-code');
          if (codeEl) {
            const orig = codeEl.textContent;
            codeEl.textContent = '✓ Copied!';
            setTimeout(() => { codeEl.textContent = orig; }, 2000);
          }
        });
      });
    } catch (_) {
      // On failure restore the standard empty state
      renderCodes([], currentDomain);
    }
  }

  // ── Recent searches ──────────────────────────────────────────────────────────
  const recentSearchesEl   = document.getElementById('recentSearches');
  const recentSearchesList = document.getElementById('recentSearchesList');

  async function getRecentSearches() {
    const data = await chrome.storage.local.get('recentSearches');
    return Array.isArray(data.recentSearches) ? data.recentSearches : [];
  }

  async function saveRecentSearch(query) {
    const searches = await getRecentSearches();
    const updated  = [query, ...searches.filter(s => s !== query)].slice(0, 5);
    await chrome.storage.local.set({ recentSearches: updated });
  }

  searchInput.addEventListener('focus', async () => {
    const searches = await getRecentSearches();
    if (searches.length === 0) return;
    recentSearchesList.innerHTML = searches.map(s => `
      <button class="recent-search-item" data-q="${escHtml(s)}">${escHtml(s)}</button>`
    ).join('');
    recentSearchesEl.hidden = false;
  });

  searchInput.addEventListener('blur', () => {
    // Delay so clicks on recent items fire before hiding
    setTimeout(() => { recentSearchesEl.hidden = true; }, 220);
  });

  recentSearchesList.addEventListener('click', e => {
    const btn = e.target.closest('.recent-search-item');
    if (!btn) return;
    searchInput.value = btn.dataset.q;
    clearBtn.classList.add('visible');
    recentSearchesEl.hidden = true;
    searchInput.dispatchEvent(new Event('input'));
    searchInput.focus();
  });

  // ── Voice search ─────────────────────────────────────────────────────────────
  const voiceBtn = document.getElementById('voiceBtn');
  let recognition = null;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (SpeechRecognition) {
    voiceBtn.style.display = 'inline-flex';
    voiceBtn.addEventListener('click', () => {
      if (recognition) {
        recognition.stop();
        return;
      }
      recognition = new SpeechRecognition();
      recognition.continuous    = false;
      recognition.interimResults = false;
      recognition.lang          = 'en-US';

      voiceBtn.classList.add('listening');
      voiceBtn.textContent = '🔴';

      recognition.onresult = e => {
        const transcript = e.results[0][0].transcript.trim();
        if (transcript) {
          searchInput.value = transcript;
          clearBtn.classList.add('visible');
          searchInput.dispatchEvent(new Event('input'));
        }
      };

      const resetVoiceBtn = () => {
        recognition = null;
        voiceBtn.classList.remove('listening');
        voiceBtn.textContent = '🎤';
      };

      recognition.onend   = resetVoiceBtn;
      recognition.onerror = resetVoiceBtn;
      recognition.start();
    });
  } else {
    voiceBtn.style.display = 'none';
  }

  // ── Press "/" to focus search ─────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === '/' &&
        document.activeElement !== searchInput &&
        document.activeElement.tagName !== 'INPUT' &&
        document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });

  // ── Category pills ───────────────────────────────────────────────────────────
  document.getElementById('filterPills').addEventListener('click', e => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    activeCategory = pill.dataset.cat;
    renderPills();
    renderCodes(filtered(), currentDomain);
  });

  // ── Add Code Panel ───────────────────────────────────────────────────────────
  const addBtn        = document.getElementById('addBtn');
  const addPanel      = document.getElementById('addPanel');
  const addPanelClose = document.getElementById('addPanelClose');
  const submitCode    = document.getElementById('submitCode');
  const formError     = document.getElementById('formError');

  addBtn.addEventListener('click', () => {
    addPanel.classList.add('open');
    addPanel.setAttribute('aria-hidden', 'false');
    document.getElementById('fieldBrand').focus();
  });

  addPanelClose.addEventListener('click', closeAddPanel);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && addPanel.classList.contains('open')) closeAddPanel();
  });

  function closeAddPanel() {
    addPanel.classList.remove('open');
    addPanel.setAttribute('aria-hidden', 'true');
    formError.textContent = '';
    ['fieldBrand', 'fieldUrl', 'fieldCode', 'fieldDesc'].forEach(id =>
      document.getElementById(id).classList.remove('error')
    );
  }

  submitCode.addEventListener('click', async () => {
    const brand    = document.getElementById('fieldBrand').value.trim();
    const url      = document.getElementById('fieldUrl').value.trim();
    const emoji    = document.getElementById('fieldEmoji').value.trim() || '🏷';
    const code     = document.getElementById('fieldCode').value.trim().toUpperCase();
    const desc     = document.getElementById('fieldDesc').value.trim();
    const category = document.getElementById('fieldCategory').value;
    const expiresIn = document.getElementById('fieldExpiry').value;

    let valid = true;
    [['fieldBrand', brand], ['fieldUrl', url], ['fieldCode', code], ['fieldDesc', desc]].forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (!val) { el.classList.add('error'); valid = false; }
      else       { el.classList.remove('error'); }
    });
    if (!valid) { formError.textContent = 'Please fill in all required fields.'; return; }
    formError.textContent = '';

    let domain = url;
    try {
      domain = new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace(/^www\./, '');
    } catch (_) {}

    submitCode.disabled = true;
    submitCode.textContent = 'Sharing…';

    try {
      await apiFetch('/api/codes', { method: 'POST', body: { brand, domain, emoji, code, description: desc, category, expiresIn } });

      const [freshCodes, freshUser] = await Promise.all([apiFetch('/api/codes'), apiFetch('/api/me')]);
      allCodes    = freshCodes;
      coinBalance = freshUser.coinBalance;

      setCoinAmount(coinBalance);
      animateCoin();
      renderPills();
      renderCodes(filtered(), currentDomain);
      closeAddPanel();

      ['fieldBrand', 'fieldUrl', 'fieldEmoji', 'fieldCode', 'fieldDesc'].forEach(id => {
        document.getElementById(id).value = '';
      });
      document.getElementById('fieldCategory').value = 'Food';
      document.getElementById('fieldExpiry').value   = '30 days';
      document.querySelector('[data-tab="codes"]').click();
    } catch (err) {
      formError.textContent = err.message || 'Something went wrong. Try again.';
    } finally {
      submitCode.disabled = false;
      submitCode.textContent = 'Share & Earn Coins';
    }
  });

  // ── Gift Card Modal ──────────────────────────────────────────────────────────
  const gcModal     = document.getElementById('gcModal');
  const gcModalBody = document.getElementById('gcModalBody');

  function openGcModal(card) {
    gcModalBody.innerHTML = confirmHTML(card, coinBalance);
    gcModal.classList.add('open');
    gcModal.setAttribute('aria-hidden', 'false');

    document.getElementById('gcCancel').addEventListener('click', closeGcModal);

    const redeemBtn = document.getElementById('gcRedeem');
    if (redeemBtn && !redeemBtn.disabled) {
      redeemBtn.addEventListener('click', async () => {
        redeemBtn.disabled = true;
        redeemBtn.textContent = 'Redeeming…';

        const giftCode = generateGiftCode(card.brand);
        try {
          await apiFetch('/api/redeem', {
            method: 'POST',
            body: { giftCardId: card.id, brand: card.brand, value: card.value, coins: card.coins, giftCode },
          });
          const updated = await apiFetch('/api/me');
          coinBalance = updated.coinBalance;
          setCoinAmount(coinBalance);

          gcModalBody.innerHTML = successHTML(card, giftCode);
          document.getElementById('gcDone').addEventListener('click', closeGcModal);
          document.getElementById('gcCopyBtn').addEventListener('click', async () => {
            const btn = document.getElementById('gcCopyBtn');
            try { await navigator.clipboard.writeText(giftCode); } catch (_) {}
            btn.textContent = '✓ Copied!';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
          });
        } catch (err) {
          redeemBtn.disabled = false;
          redeemBtn.textContent = 'Redeem';
          gcModalBody.insertAdjacentHTML('beforeend',
            `<p style="color:#EF4444;font-size:12px;text-align:center;margin-top:8px">${err.message}</p>`);
        }
      });
    }
  }

  function closeGcModal() {
    gcModal.classList.remove('open');
    gcModal.setAttribute('aria-hidden', 'true');
  }

  gcModal.addEventListener('click', e => { if (e.target === gcModal) closeGcModal(); });

  document.getElementById('gcGrid').addEventListener('click', e => {
    const card = e.target.closest('.gc-card');
    if (!card) return;
    const gc = STACKD.giftCards.find(c => c.id === parseInt(card.dataset.id));
    if (gc) openGcModal(gc);
  });

  // ── Deal DNA Modal ───────────────────────────────────────────────────────────
  const dnaModal     = document.getElementById('dnaModal');
  const dnaModalBody = document.getElementById('dnaModalBody');

  async function openDnaModal(codeId, brandName) {
    dnaModal.classList.add('open');
    dnaModal.setAttribute('aria-hidden', 'false');

    dnaModalBody.innerHTML = `
      <div class="dna-modal-inner">
        <div class="dna-modal-header">
          <span class="dna-modal-title">🧬 Deal DNA</span>
          <span class="dna-modal-brand">${brandName}</span>
        </div>
        <div class="dna-loading">
          <div class="ai-skeleton" style="height:72px;border-radius:10px"></div>
          <div class="ai-skeleton" style="height:72px;border-radius:10px"></div>
          <div class="ai-skeleton" style="height:60px;border-radius:10px"></div>
          <div class="ai-skeleton" style="height:60px;border-radius:10px"></div>
        </div>
      </div>`;

    try {
      const { dealDna } = await apiFetch(`/api/codes/${codeId}/deal-dna`, { method: 'POST' });
      let dna = {};
      try { dna = JSON.parse(dealDna); } catch (_) { dna = { why: dealDna }; }

      dnaModalBody.innerHTML = `
        <div class="dna-modal-inner">
          <div class="dna-modal-header">
            <span class="dna-modal-title">🧬 Deal DNA</span>
            <span class="dna-modal-brand">${brandName}</span>
          </div>
          ${dna.why ? `<div class="dna-row"><div class="dna-row-label">💡 Why this deal exists</div><div class="dna-row-text">${dna.why}</div></div>` : ''}
          ${dna.catches ? `<div class="dna-row"><div class="dna-row-label">⚠️ Catches to watch for</div><div class="dna-row-text">${dna.catches}</div></div>` : ''}
          ${dna.bestTime ? `<div class="dna-row"><div class="dna-row-label">⏰ Best time to use</div><div class="dna-row-text">${dna.bestTime}</div></div>` : ''}
          ${dna.duration ? `<div class="dna-row"><div class="dna-row-label">📅 How long it lasts</div><div class="dna-row-text">${dna.duration}</div></div>` : ''}
          <button class="dna-close-btn" id="dnaCloseBtn">Close</button>
        </div>`;
    } catch (_) {
      dnaModalBody.innerHTML = `
        <div class="dna-modal-inner">
          <div class="dna-modal-header">
            <span class="dna-modal-title">🧬 Deal DNA</span>
            <span class="dna-modal-brand">${brandName}</span>
          </div>
          <div class="dna-row"><div class="dna-row-text" style="color:var(--red)">Could not load analysis. Try again.</div></div>
          <button class="dna-close-btn" id="dnaCloseBtn">Close</button>
        </div>`;
    }

    document.getElementById('dnaCloseBtn')?.addEventListener('click', closeDnaModal);
  }

  function closeDnaModal() {
    dnaModal.classList.remove('open');
    dnaModal.setAttribute('aria-hidden', 'true');
  }

  dnaModal.addEventListener('click', e => { if (e.target === dnaModal) closeDnaModal(); });

  // ── Vote Toast ───────────────────────────────────────────────────────────────
  let voteDelayTimer  = null;   // 30s delay after copy before showing toast
  let voteAutoHide    = null;   // 8s auto-dismiss once toast is visible
  let pendingVoteCode = null;

  const voteToast      = document.getElementById('voteToast');
  const voteYesBtn     = document.getElementById('voteYesBtn');
  const voteNoBtn      = document.getElementById('voteNoBtn');
  const voteDismissBtn = document.getElementById('voteDismissBtn');

  function showVoteToast(codeId) {
    pendingVoteCode = codeId;
    voteToast.classList.remove('hidden');
    clearTimeout(voteAutoHide);
    voteAutoHide = setTimeout(dismissVoteToast, 8000);
  }

  function dismissVoteToast() {
    clearTimeout(voteAutoHide);
    voteToast.classList.add('hidden');
    pendingVoteCode = null;
  }

  async function castVote(vote) {
    if (!pendingVoteCode) return;
    const codeId = pendingVoteCode;
    dismissVoteToast();

    try {
      const result = await apiFetch(`/api/codes/${codeId}/vote`, { method: 'POST', body: { vote } });

      // Update local code data for immediate UI refresh
      const idx = allCodes.findIndex(c => c.id === codeId);
      if (idx !== -1) {
        allCodes[idx].yesVotes    = result.yesVotes;
        allCodes[idx].noVotes     = result.noVotes;
        allCodes[idx].successRate = result.successRate;
        if (result.isExpired) {
          allCodes.splice(idx, 1);
        }
        renderCodes(filtered(), currentDomain);
      }
    } catch (_) {}
  }

  voteYesBtn.addEventListener('click',     () => castVote('yes'));
  voteNoBtn.addEventListener('click',      () => castVote('no'));
  voteDismissBtn.addEventListener('click', dismissVoteToast);

  // ── Benefits panel wiring ────────────────────────────────────────────────────

  function switchToBenefitsTab() {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="benefits"]').classList.add('active');
    document.getElementById('benefitsPanel').classList.add('active');
  }

  // Change school button
  document.getElementById('benefitsChangeBtn').addEventListener('click', () => {
    const onboardingScreen = document.getElementById('onboardingScreen');
    const mainApp          = document.getElementById('mainApp');
    mainApp.classList.add('hidden');
    onboardingScreen.classList.remove('hidden');

    const saveBtn = document.getElementById('obSaveBtn');
    const skipBtn = document.getElementById('obSkipBtn');
    const select  = document.getElementById('universitySelect');
    const newSave = saveBtn.cloneNode(true);
    const newSkip = skipBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSave, saveBtn);
    skipBtn.parentNode.replaceChild(newSkip, skipBtn);

    async function finish(university) {
      if (university) {
        try {
          await apiFetch('/api/me/university', { method: 'PUT', body: { university } });
          user.university = university;
        } catch (_) {}
      }
      onboardingScreen.classList.add('hidden');
      mainApp.classList.remove('hidden');
      loadBenefits(user);
      switchToBenefitsTab();
    }

    document.getElementById('obSaveBtn').addEventListener('click', async () => {
      const val = select.value;
      if (!val) {
        select.style.borderColor = 'var(--red)';
        setTimeout(() => { select.style.borderColor = ''; }, 1500);
        return;
      }
      document.getElementById('obSaveBtn').disabled = true;
      document.getElementById('obSaveBtn').textContent = 'Saving…';
      await finish(val);
    });
    document.getElementById('obSkipBtn').addEventListener('click', () => finish(''));
  });

  // Refresh Perks button
  document.getElementById('benefitsRefreshBtn').addEventListener('click', async () => {
    if (!user.university || user.university === 'Generic') {
      showInfoBanner('Set a specific university to discover AI-powered perks.');
      return;
    }
    const btn = document.getElementById('benefitsRefreshBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin">🔄</span> Discovering…';

    try {
      const data = await apiFetch(
        `/api/benefits/discover/${encodeURIComponent(user.university)}`,
        { method: 'POST' }
      );
      renderBenefits(data.benefits, data.university, data.lastDiscoveredAt);
    } catch (_) {
      await loadBenefits(user);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '🔄 Refresh';
    }
  });

  // Share Perk panel
  const addPerkPanel = document.getElementById('addPerkPanel');
  const addPerkClose = document.getElementById('addPerkClose');

  function openAddPerkPanel() {
    if (!user.university) {
      showInfoBanner('Set your university first to share perks.');
      return;
    }
    const banner = document.getElementById('perkUniBanner');
    banner.textContent = `Sharing for: ${user.university} students`;
    banner.classList.add('visible');
    addPerkPanel.classList.add('open');
    addPerkPanel.setAttribute('aria-hidden', 'false');
    document.getElementById('perkTitle').focus();
  }

  function closeAddPerkPanel() {
    addPerkPanel.classList.remove('open');
    addPerkPanel.setAttribute('aria-hidden', 'true');
    document.getElementById('perkFormError').textContent = '';
    ['perkTitle', 'perkDesc', 'perkSavings', 'perkHowToClaim', 'perkSourceUrl'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.value = ''; el.classList.remove('error'); }
    });
  }

  document.getElementById('benefitsShareBtn').addEventListener('click', openAddPerkPanel);
  addPerkClose.addEventListener('click', closeAddPerkPanel);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && addPerkPanel.classList.contains('open')) closeAddPerkPanel();
  });

  document.getElementById('submitPerk').addEventListener('click', async () => {
    const title      = document.getElementById('perkTitle').value.trim();
    const desc       = document.getElementById('perkDesc').value.trim();
    const savings    = document.getElementById('perkSavings').value.trim();
    const howToClaim = document.getElementById('perkHowToClaim').value.trim();
    const category   = document.getElementById('perkCategory').value;
    const sourceUrl  = document.getElementById('perkSourceUrl').value.trim();
    const errEl      = document.getElementById('perkFormError');

    let valid = true;
    [['perkTitle', title], ['perkDesc', desc], ['perkSavings', savings], ['perkHowToClaim', howToClaim]].forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (!val) { el.classList.add('error'); valid = false; }
      else       { el.classList.remove('error'); }
    });
    if (!valid) { errEl.textContent = 'Please fill in all required fields.'; return; }
    errEl.textContent = '';

    const btn = document.getElementById('submitPerk');
    btn.disabled = true;
    btn.textContent = 'Sharing…';

    try {
      await apiFetch('/api/benefits/community', {
        method: 'POST',
        body: { title, description: desc, savings, howToClaim, category, sourceUrl },
      });
      closeAddPerkPanel();
      await loadBenefits(user);
      switchToBenefitsTab();
    } catch (err) {
      errEl.textContent = err.message || 'Something went wrong. Try again.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Share with Fellow Students';
    }
  });

  // Upvote delegation on benefits list
  document.getElementById('benefitsList').addEventListener('click', async e => {
    const upvoteBtn = e.target.closest('.benefit-upvote-btn');
    if (!upvoteBtn) return;

    const benefitId = upvoteBtn.dataset.id;
    const wasUpvoted = upvoteBtn.classList.contains('upvoted');

    // Optimistic update
    const countEl = upvoteBtn.querySelector('.upvote-count');
    const current = parseInt(countEl?.textContent ?? '0', 10);
    if (countEl) countEl.textContent = wasUpvoted ? current - 1 : current + 1;
    upvoteBtn.classList.toggle('upvoted', !wasUpvoted);
    upvoteBtn.disabled = true;

    try {
      const result = await apiFetch(`/api/benefits/${benefitId}/upvote`, { method: 'POST' });
      if (countEl) countEl.textContent = result.upvotes;
      upvoteBtn.classList.toggle('upvoted', result.userUpvoted);
    } catch (_) {
      // Revert on failure
      if (countEl) countEl.textContent = current;
      upvoteBtn.classList.toggle('upvoted', wasUpvoted);
    } finally {
      upvoteBtn.disabled = false;
    }
  });

  function showInfoBanner(msg) {
    const existing = document.querySelector('.discovery-banner');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.className = 'discovery-banner';
    banner.innerHTML = `<span>ℹ️</span><span>${msg}</span>`;
    document.getElementById('benefitsPanel').prepend(banner);
    setTimeout(() => banner.remove(), 4000);
  }

  // ── Sign out ─────────────────────────────────────────────────────────────────
  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await chrome.storage.local.remove('authToken');
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    wireLoginScreen();
  });

  // ── Code list click delegation (DNA + Copy + Vote) ───────────────────────────
  document.getElementById('codesList').addEventListener('click', async e => {
    const dnaBtn  = e.target.closest('.dna-btn');
    const copyBtn = e.target.closest('.copy-btn');

    if (dnaBtn) {
      const codeId    = dnaBtn.dataset.codeId;
      const brandName = dnaBtn.dataset.brand;
      openDnaModal(codeId, brandName);
      return;
    }

    if (copyBtn) {
      const code   = copyBtn.dataset.code;
      const codeId = copyBtn.dataset.codeId;

      try { await navigator.clipboard.writeText(code); } catch (_) {
        const el = document.createElement('textarea');
        el.value = code;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }

      copyBtn.textContent = '✓ Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
        copyBtn.classList.remove('copied');
      }, 2000);

      // Show vote toast after 30 seconds
      clearTimeout(voteDelayTimer);
      voteDelayTimer = setTimeout(() => showVoteToast(codeId), 30000);
    }
  });
}

// ── Load benefits ─────────────────────────────────────────────────────────────
async function loadBenefits(user) {
  const list = document.getElementById('benefitsList');
  list.innerHTML = `
    <div class="benefits-loading">
      <div class="ai-skeleton" style="height:110px;border-radius:16px"></div>
      <div class="ai-skeleton" style="height:110px;border-radius:16px"></div>
      <div class="ai-skeleton" style="height:110px;border-radius:16px"></div>
    </div>`;

  try {
    const { university, benefits, lastDiscoveredAt } = await apiFetch('/api/benefits');
    renderBenefits(benefits, university, lastDiscoveredAt);
  } catch (_) {
    list.innerHTML = `
      <div class="benefits-empty">
        <div class="es-icon">⚠️</div>
        <p>Could not load benefits.<br>Please try again.</p>
      </div>`;
  }
}

function renderBenefits(benefits, university, lastDiscoveredAt) {
  const list     = document.getElementById('benefitsList');
  const uniLabel = document.getElementById('benefitsUniLabel');
  const lastEl   = document.getElementById('benefitsLastUpdated');

  const displayName = university && university !== 'Generic' ? university : 'Student';
  uniLabel.textContent = `${displayName} Benefits`;

  if (lastDiscoveredAt) {
    lastEl.textContent = `AI updated ${timeAgo(new Date(lastDiscoveredAt))}`;
  } else {
    lastEl.textContent = '';
  }

  if (!benefits || benefits.length === 0) {
    list.innerHTML = `
      <div class="benefits-empty">
        <div class="es-icon">🎓</div>
        <p>No benefits found yet.<br>Click <strong>Refresh</strong> to discover AI perks.</p>
      </div>`;
    return;
  }

  list.innerHTML = benefits.map((b, i) => {
    const badge = b.isAiDiscovered
      ? `<span class="benefit-ai-badge">🤖 AI Discovered</span>`
      : b.communityAdded
        ? `<span class="benefit-community-badge">👋 Added by a fellow ${escHtml(university || 'student')} student</span>`
        : '';

    const sourceLink = b.sourceUrl
      ? `<a class="benefit-source-link" href="${escHtml(b.sourceUrl)}" target="_blank" rel="noopener">↗ Official link</a>`
      : '';

    return `
      <div class="benefit-card" style="animation-delay:${i * 0.04}s">
        <div class="benefit-card-top">
          <span class="benefit-title">${escHtml(b.title)}</span>
          <span class="benefit-savings">${escHtml(b.savings)}</span>
        </div>
        ${badge || sourceLink ? `<div class="benefit-badges">${badge}${sourceLink}</div>` : ''}
        <p class="benefit-desc">${escHtml(b.description)}</p>
        <div class="benefit-did-you-know">
          <strong>✦ Did you know?</strong>
          ${didYouKnow(b)}
        </div>
        <div class="benefit-footer-row">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span class="benefit-cat-pill">${escHtml(b.category)}</span>
            <button class="benefit-claim-btn" data-claim="${escHtml(b.howToClaim)}">How to claim →</button>
          </div>
          <button class="benefit-upvote-btn ${b.userUpvoted ? 'upvoted' : ''}" data-id="${b.id}">
            ▲ <span class="upvote-count">${b.upvotes ?? 0}</span>
          </button>
        </div>
      </div>`;
  }).join('');

  // Claim button toggles inline detail
  list.querySelectorAll('.benefit-claim-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.benefit-card');
      const existing = card.querySelector('.benefit-claim-detail');
      if (existing) {
        existing.remove();
        btn.textContent = 'How to claim →';
        return;
      }
      const detail = document.createElement('div');
      detail.className = 'benefit-did-you-know benefit-claim-detail';
      detail.style.cssText = 'border-color:rgba(52,211,153,0.25);color:var(--green)';
      detail.innerHTML = `<strong style="color:var(--green)">📋 How to claim</strong>${escHtml(btn.dataset.claim)}`;
      btn.closest('.benefit-footer-row').insertAdjacentElement('beforebegin', detail);
      btn.textContent = '✕ Close';
    });
  });
}

function didYouKnow(benefit) {
  const facts = {
    'Software':    'Most universities have campus-wide software licenses — always check with your IT department first.',
    'Streaming':   'Student streaming discounts are verified each year — renew before your semester ends.',
    'Shopping':    'Stack student discounts with seasonal sales for maximum savings.',
    'Electronics': 'Apple and Microsoft EDU prices are often cheaper than Black Friday deals.',
    'Travel':      'Always book travel with your student ID — savings add up fast.',
    'Food':        'Campus dining discounts often combine with loyalty apps for extra rewards.',
    'Music':       'Student music plans often include perks like ad-free podcasts and offline listening.',
    'Gaming':      'Many game studios offer student bundles — check the platform\'s student hub.',
  };
  return facts[benefit.category] || 'Combining multiple student discounts can save you thousands each year.';
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(date) {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60)                     return 'just now';
  if (secs < 3600)                   return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400)                  return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 86400 * 7)              return `${Math.floor(secs / 86400)} days ago`;
  return date.toLocaleDateString();
}

// ── AI Picks ──────────────────────────────────────────────────────────────────
async function loadAiPicks(domain) {
  const section = document.getElementById('aiPicks');
  const list    = document.getElementById('aiPicksList');

  section.hidden = false;
  list.innerHTML = `
    <div class="ai-skeleton"></div>
    <div class="ai-skeleton"></div>
    <div class="ai-skeleton"></div>`;

  try {
    const { suggestions } = await apiFetch('/api/ai-suggest', {
      method: 'POST',
      body: { domain },
    });

    if (!suggestions || suggestions.length === 0) {
      section.hidden = true;
      return;
    }

    list.innerHTML = suggestions.map(s => `
      <div class="ai-pick-card" data-code="${s.code}">
        <span class="ai-pick-emoji">${s.emoji}</span>
        <div class="ai-pick-info">
          <div class="ai-pick-brand">${s.brand}</div>
          <div class="ai-pick-reason">${s.reason}</div>
        </div>
        <span class="ai-pick-code">${s.code}</span>
      </div>`).join('');

    list.querySelectorAll('.ai-pick-card').forEach(card => {
      card.addEventListener('click', async () => {
        const code = card.dataset.code;
        try { await navigator.clipboard.writeText(code); } catch (_) {
          const el = document.createElement('textarea');
          el.value = code;
          document.body.appendChild(el);
          el.select();
          document.execCommand('copy');
          document.body.removeChild(el);
        }
        const codeEl = card.querySelector('.ai-pick-code');
        const orig = codeEl.textContent;
        codeEl.textContent = '✓ Copied!';
        setTimeout(() => { codeEl.textContent = orig; }, 2000);
      });
    });
  } catch (_) {
    section.hidden = true;
  }
}

// ── Render referral code cards ─────────────────────────────────────────────────
function renderCodes(codes, currentDomain) {
  const list = document.getElementById('codesList');
  document.getElementById('codesCount').textContent = codes.length;

  if (codes.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">🔍</div>
        <p>No codes match your search.<br>Try a brand name or category.</p>
      </div>`;
    return;
  }

  const sorted = [...codes].sort((a, b) => {
    const aM = currentDomain && currentDomain.includes(a.domain.replace(/^www\./, ''));
    const bM = currentDomain && currentDomain.includes(b.domain.replace(/^www\./, ''));
    return Number(bM) - Number(aM);
  });

  list.innerHTML = sorted.map((code, index) => {
    const isSiteMatch = currentDomain && currentDomain.includes(code.domain.replace(/^www\./, ''));
    const isTrending  = index < 3;
    const isVerified  = (code.yesVotes ?? 0) >= 10;
    const total       = (code.yesVotes ?? 0) + (code.noVotes ?? 0);
    const rate        = total > 0 ? Math.round((code.yesVotes / total) * 100) : null;

    return `
      <div class="code-card ${isSiteMatch ? 'site-match' : ''}">
        <div class="card-top">
          <div class="brand-row">
            <div class="brand-avatar">${code.emoji}</div>
            <div>
              <div class="brand-name">${code.brand}</div>
              <div class="brand-category">${code.category}</div>
            </div>
          </div>
          <div class="card-top-right">
            ${isTrending ? '<span class="trending-badge">🔥 Trending</span>' : ''}
            <div class="earn-pill">🪙 +${code.coins}</div>
          </div>
        </div>
        <div class="card-desc">${code.description}</div>
        <div class="code-row">
          <div class="code-chip" title="${code.code}">${code.code}</div>
          <button class="copy-btn" data-code="${code.code}" data-code-id="${code.id}">Copy</button>
        </div>
        <div class="card-meta-row">
          ${isVerified
            ? '<span class="verified-badge">✅ Verified Working</span>'
            : rate !== null
              ? `<span class="success-rate-badge">${rate}% success rate</span>`
              : '<span></span>'
          }
          <button class="dna-btn" data-code-id="${code.id}" data-brand="${code.brand}">🧬 Deal DNA</button>
        </div>
        <div class="card-footer">
          <span class="expires-tag">⏱ ${code.expiresIn}</span>
          ${isSiteMatch ? '<span class="site-tag">✓ This site</span>' : ''}
        </div>
      </div>`;
  }).join('');
}

// ── Render gift cards ──────────────────────────────────────────────────────────
function renderGiftCards(cards) {
  document.getElementById('gcGrid').innerHTML = cards.map(card => `
    <div class="gc-card"
         data-id="${card.id}"
         style="background: linear-gradient(135deg, ${card.color} 0%, ${card.colorDark} 100%)"
         title="Redeem for ${card.coins} coins">
      <div class="gc-emoji">${card.emoji}</div>
      <div class="gc-brand">${card.brand}</div>
      <div class="gc-value">${card.value}</div>
      <div class="gc-cost">🪙 ${card.coins.toLocaleString()} coins</div>
    </div>
  `).join('');
}

// ── Gift card modal HTML builders ──────────────────────────────────────────────
function confirmHTML(card, coinBalance) {
  const canAfford = coinBalance >= card.coins;
  const remaining = coinBalance - card.coins;
  return `
    <div class="gc-modal-preview"
         style="background: linear-gradient(135deg, ${card.color} 0%, ${card.colorDark} 100%)">
      <div class="gc-emoji">${card.emoji}</div>
      <div>
        <div class="gc-brand">${card.brand}</div>
        <div class="gc-value">${card.value} Gift Card</div>
      </div>
    </div>
    <div class="modal-balance-table">
      <div class="balance-row">
        <span class="b-label">Your balance</span>
        <span class="b-val">🪙 ${coinBalance.toLocaleString()}</span>
      </div>
      <div class="balance-row">
        <span class="b-label">Cost</span>
        <span class="b-val">🪙 ${card.coins.toLocaleString()}</span>
      </div>
      <div class="balance-row divider">
        <span class="b-label">After redemption</span>
        <span class="b-val" style="color: ${canAfford ? 'var(--green)' : '#EF4444'}">
          🪙 ${canAfford ? remaining.toLocaleString() : '—'}
        </span>
      </div>
    </div>
    ${!canAfford ? `
      <div class="insufficient-msg">
        You need ${(card.coins - coinBalance).toLocaleString()} more coins to redeem this card.
      </div>` : ''}
    <div class="modal-actions">
      <button class="btn-cancel" id="gcCancel">Cancel</button>
      <button class="btn-redeem" id="gcRedeem" ${canAfford ? '' : 'disabled'}>
        ${canAfford ? 'Redeem' : 'Not enough coins'}
      </button>
    </div>`;
}

function successHTML(card, code) {
  return `
    <div class="modal-success">
      <div class="success-emoji">🎉</div>
      <div class="success-title">Redeemed!</div>
      <div class="success-sub">${card.brand} ${card.value} gift card</div>
      <div class="gift-code-wrap">
        <div class="gift-code" id="giftCodeText">${code}</div>
        <button class="copy-btn" id="gcCopyBtn">Copy</button>
      </div>
      <p class="success-note">Save this code — use it at checkout on the ${card.brand} website.</p>
      <button class="btn-done" id="gcDone">Done</button>
    </div>`;
}

function generateGiftCode(brand) {
  const prefix = brand.slice(0, 4).toUpperCase().padEnd(4, 'X');
  const seg = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${seg()}-${seg()}`;
}
