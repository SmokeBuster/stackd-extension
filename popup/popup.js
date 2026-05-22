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
  const loginScreen = document.getElementById('loginScreen');
  const mainApp     = document.getElementById('mainApp');

  const { authToken } = await chrome.storage.local.get('authToken');

  if (!authToken) {
    loginScreen.classList.remove('hidden');
    wireLoginScreen();
    return;
  }

  // Fetch initial data in parallel
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
    // Server unreachable — show a friendly error
    loginScreen.classList.remove('hidden');
    loginScreen.innerHTML = `
      <div style="text-align:center;padding:32px 24px;color:#fff">
        <div style="font-size:36px;margin-bottom:12px">⚠️</div>
        <strong>Can't reach the server</strong>
        <p style="margin-top:8px;font-size:13px;opacity:.8">Unable to connect to the Stackd server. Please try again.</p>
      </div>`;
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

// ── Main app ──────────────────────────────────────────────────────────────────
async function initMainApp(user, codes) {
  let currentDomain = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) currentDomain = new URL(tab.url).hostname.replace(/^www\./, '');
  } catch (_) {}

  // ── State
  let activeCategory = 'All';
  let allCodes = codes;            // kept in sync with the server
  let coinBalance = user.coinBalance;

  // ── Coin display
  setCoinAmount(coinBalance);

  // ── Site banner
  const siteName = document.getElementById('siteName');
  const siteMatch = currentDomain && allCodes.some(c => currentDomain.includes(c.domain.replace(/^www\./, '')));
  if (siteMatch)           siteName.textContent = currentDomain;
  else if (currentDomain)  siteName.textContent = `${currentDomain} (showing all)`;

  // ── Initial render
  renderPills();
  renderCodes(filtered(), currentDomain);
  renderGiftCards(STACKD.giftCards);

  // ── AI Picks (fire-and-forget after initial render)
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
    const el = document.getElementById('coinAmount');
    el.textContent = n.toLocaleString();
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
      document.getElementById(tab.dataset.tab === 'codes' ? 'codesPanel' : 'giftcardsPanel').classList.add('active');
    });
  });

  // ── Search ───────────────────────────────────────────────────────────────────
  const searchInput = document.getElementById('searchInput');
  const clearBtn    = document.getElementById('clearBtn');

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    clearBtn.classList.toggle('visible', q.length > 0);
    renderCodes(filtered(q), currentDomain);
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.classList.remove('visible');
    renderCodes(filtered(''), currentDomain);
    searchInput.focus();
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

      // Re-fetch both codes and user balance
      const [freshCodes, freshUser] = await Promise.all([apiFetch('/api/codes'), apiFetch('/api/me')]);
      allCodes = freshCodes;
      coinBalance = freshUser.coinBalance;

      setCoinAmount(coinBalance);
      animateCoin();
      renderPills();
      renderCodes(filtered(), currentDomain);
      closeAddPanel();

      ['fieldBrand', 'fieldUrl', 'fieldEmoji', 'fieldCode', 'fieldDesc'].forEach(id => {
        document.getElementById(id).value = '';
      });
      document.getElementById('fieldCategory').value  = 'Food';
      document.getElementById('fieldExpiry').value    = '30 days';
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
          gcModalBody.insertAdjacentHTML('beforeend', `<p style="color:#EF4444;font-size:12px;text-align:center;margin-top:8px">${err.message}</p>`);
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

  // ── Sign out ─────────────────────────────────────────────────────────────────
  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await chrome.storage.local.remove('authToken');
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    wireLoginScreen();
  });
}

// ── AI Picks ──────────────────────────────────────────────────────────────────
async function loadAiPicks(domain) {
  const section = document.getElementById('aiPicks');
  const list    = document.getElementById('aiPicksList');

  // Show skeleton while loading
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
          <button class="copy-btn" data-code="${code.code}">Copy</button>
        </div>
        <div class="card-footer">
          <span class="expires-tag">⏱ ${code.expiresIn}</span>
          ${isSiteMatch ? '<span class="site-tag">✓ This site</span>' : ''}
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(btn.dataset.code); } catch (_) {
        const el = document.createElement('textarea');
        el.value = btn.dataset.code;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      btn.textContent = '✓ Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
    });
  });
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
