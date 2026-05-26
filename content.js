(function () {
  'use strict';

  // Skip iframes and non-http pages
  if (window !== window.top) return;
  if (!location.protocol.startsWith('http')) return;

  const domain = location.hostname.replace(/^www\./, '');
  if (!domain) return;

  const HIDE_KEY      = `stackd_hide_${domain}`;
  const HIDE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  // Ask background for matching codes
  chrome.runtime.sendMessage({ type: 'STACKD_CHECK', domain }, (response) => {
    if (chrome.runtime.lastError) return;
    if (!response || !Array.isArray(response.codes) || response.codes.length === 0) return;

    // Check per-domain hide state
    chrome.storage.local.get(HIDE_KEY, (result) => {
      const hiddenAt = result[HIDE_KEY];
      if (hiddenAt && Date.now() - hiddenAt < HIDE_DURATION) return;
      setTimeout(() => mountWidget(response.codes), 2000);
    });
  });

  // ── Widget mount ─────────────────────────────────────────────────────────────
  function mountWidget(codes) {
    if (document.getElementById('stackd-host')) return;

    const host = document.createElement('div');
    host.id = 'stackd-host';
    host.style.cssText = [
      'position:fixed',
      'bottom:24px',
      'right:24px',
      'z-index:2147483647',
      'display:flex',
      'flex-direction:column',
      'align-items:flex-end',
      'gap:10px',
      'pointer-events:none',
      'font-family:inherit',
    ].join(';');
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = buildHTML(codes);

    const pill    = shadow.getElementById('st-pill');
    const card    = shadow.getElementById('st-card');
    const closeBtn = shadow.getElementById('st-close');
    const openBtn  = shadow.getElementById('st-open');

    // Slide pill in from right
    pill.style.transform = 'translateX(140px)';
    pill.style.opacity   = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pill.style.transition = 'transform 0.45s cubic-bezier(0.4,0,0.2,1), opacity 0.35s ease';
      pill.style.transform  = 'translateX(0)';
      pill.style.opacity    = '1';
    }));

    // Pill click → expand card
    pill.addEventListener('click', () => {
      pill.style.display = 'none';
      card.style.display = 'flex';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        card.style.opacity   = '1';
        card.style.transform = 'translateY(0) scale(1)';
      }));
    });

    // Pill keyboard a11y
    pill.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') pill.click();
    });

    // Close → hide for 24h
    closeBtn.addEventListener('click', () => {
      host.remove();
      const obj = {};
      obj[HIDE_KEY] = Date.now();
      chrome.storage.local.set(obj);
    });

    // Open full popup
    openBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'STACKD_OPEN_POPUP' });
    });

    // Copy buttons
    shadow.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', () => {
        copyText(btn.dataset.copy);
        const orig = btn.textContent;
        btn.textContent = '✓';
        btn.style.background = '#34D399';
        btn.style.color      = '#111';
        btn.style.boxShadow  = '0 2px 8px rgba(52,211,153,0.4)';
        setTimeout(() => {
          btn.textContent    = orig;
          btn.style.background = '';
          btn.style.color      = '';
          btn.style.boxShadow  = '';
        }, 2000);
      });
    });
  }

  // ── HTML builder ─────────────────────────────────────────────────────────────
  function buildHTML(codes) {
    const count = codes.length;
    const rows  = codes.map(c => `
      <div class="code-row">
        <div class="code-left">
          <span class="brand-emoji">${esc(c.emoji || '🏷️')}</span>
          <div class="brand-info">
            <div class="brand-name">${esc(c.brand)}</div>
            <div class="brand-desc">${esc(c.description)}</div>
          </div>
        </div>
        <div class="code-right">
          <span class="code-chip" title="${esc(c.code)}">${esc(c.code)}</span>
          <button class="copy-btn" data-copy="${esc(c.code)}">Copy</button>
        </div>
      </div>`).join('');

    return `
<style>${WIDGET_CSS}</style>
<div id="st-pill" class="pill" role="button" tabindex="0" aria-label="${count} Stackd deal${count !== 1 ? 's' : ''} available">
  🏷️ <span class="pill-count">${count} deal${count !== 1 ? 's' : ''}</span> here
</div>
<div id="st-card" class="card" role="dialog" aria-label="Stackd deals">
  <div class="card-header">
    <div class="card-logo">
      <div class="logo-mark">S</div>
      <span class="logo-text">Stackd</span>
    </div>
    <div class="card-header-right">
      <span class="deal-label">${count} deal${count !== 1 ? 's' : ''} for this site</span>
      <button id="st-close" class="close-btn" aria-label="Dismiss">✕</button>
    </div>
  </div>
  <div class="code-list">${rows}</div>
  <button id="st-open" class="open-btn">Open Stackd →</button>
</div>`;
  }

  // ── Styles (isolated inside shadow DOM) ───────────────────────────────────────
  const WIDGET_CSS = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Pill ── */
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: linear-gradient(135deg, #6366f1 0%, #818cf8 100%);
      border: 1px solid rgba(192, 193, 255, 0.35);
      border-radius: 9999px;
      padding: 10px 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 13.5px;
      font-weight: 600;
      color: #fff;
      cursor: pointer;
      pointer-events: auto;
      user-select: none;
      box-shadow: 0 4px 24px rgba(99, 102, 241, 0.5), 0 2px 8px rgba(0, 0, 0, 0.4);
      white-space: nowrap;
      letter-spacing: -0.1px;
    }
    .pill:hover {
      box-shadow: 0 6px 32px rgba(99, 102, 241, 0.65), 0 2px 8px rgba(0, 0, 0, 0.4);
      transform: translateY(-1px) !important;
    }
    .pill:active { transform: scale(0.97) !important; }
    .pill-count { font-weight: 700; }

    /* ── Card ── */
    .card {
      display: none;
      flex-direction: column;
      width: 308px;
      background: #141414;
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 18px;
      overflow: hidden;
      box-shadow:
        0 0 0 1px rgba(99, 102, 241, 0.12),
        0 16px 56px rgba(0, 0, 0, 0.75),
        0 4px 16px rgba(99, 102, 241, 0.18);
      pointer-events: auto;
      opacity: 0;
      transform: translateY(18px) scale(0.96);
      transition: opacity 0.28s ease, transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    /* ── Card header ── */
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 11px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      background: rgba(8, 8, 8, 0.5);
    }
    .card-logo {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .logo-mark {
      width: 24px;
      height: 24px;
      background: linear-gradient(135deg, rgba(99,102,241,0.45) 0%, rgba(128,131,255,0.25) 100%);
      border: 1px solid rgba(192, 193, 255, 0.25);
      border-radius: 7px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 800;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      letter-spacing: -0.5px;
    }
    .logo-text {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14.5px;
      font-weight: 700;
      color: #e5e2e1;
      letter-spacing: -0.3px;
    }
    .card-header-right {
      display: flex;
      align-items: center;
      gap: 9px;
    }
    .deal-label {
      font-family: monospace;
      font-size: 9.5px;
      font-weight: 600;
      color: rgba(192, 193, 255, 0.6);
      letter-spacing: 0.03em;
      white-space: nowrap;
    }
    .close-btn {
      width: 22px;
      height: 22px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.09);
      border-radius: 9999px;
      color: rgba(199, 196, 215, 0.55);
      font-size: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
      flex-shrink: 0;
      line-height: 1;
    }
    .close-btn:hover { background: rgba(255,255,255,0.13); color: #fff; }

    /* ── Code rows ── */
    .code-list {
      display: flex;
      flex-direction: column;
    }
    .code-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      transition: background 0.15s;
    }
    .code-row:last-child { border-bottom: none; }
    .code-row:hover { background: rgba(255, 255, 255, 0.025); }

    .code-left {
      display: flex;
      align-items: center;
      gap: 9px;
      min-width: 0;
      flex: 1;
    }
    .brand-emoji { font-size: 19px; flex-shrink: 0; line-height: 1; }
    .brand-info  { min-width: 0; }
    .brand-name {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12.5px;
      font-weight: 600;
      color: #e5e2e1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      letter-spacing: -0.1px;
    }
    .brand-desc {
      font-size: 10.5px;
      color: rgba(199, 196, 215, 0.48);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 1px;
    }

    .code-right {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-shrink: 0;
    }
    .code-chip {
      font-family: 'Courier New', 'Lucida Console', monospace;
      font-size: 10px;
      font-weight: 700;
      color: #c0c1ff;
      background: rgba(99, 102, 241, 0.14);
      border: 1.5px dashed rgba(99, 102, 241, 0.45);
      border-radius: 5px;
      padding: 3px 7px;
      letter-spacing: 0.06em;
      white-space: nowrap;
      max-width: 68px;
      overflow: hidden;
      text-overflow: ellipsis;
      display: block;
    }
    .copy-btn {
      background: #6366f1;
      color: #fff;
      border: none;
      border-radius: 9999px;
      padding: 4px 11px;
      font-size: 10.5px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: box-shadow 0.15s, background 0.15s, color 0.15s;
      box-shadow: 0 2px 10px rgba(99, 102, 241, 0.45);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      letter-spacing: 0.01em;
    }
    .copy-btn:hover  { box-shadow: 0 3px 14px rgba(99, 102, 241, 0.62); }
    .copy-btn:active { transform: scale(0.95); }

    /* ── Open Stackd button ── */
    .open-btn {
      display: block;
      width: calc(100% - 28px);
      margin: 2px 14px 13px;
      background: rgba(99, 102, 241, 0.10);
      border: 1px solid rgba(99, 102, 241, 0.28);
      border-radius: 9999px;
      padding: 9px;
      font-size: 12px;
      font-weight: 600;
      color: rgba(192, 193, 255, 0.85);
      cursor: pointer;
      text-align: center;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      letter-spacing: -0.1px;
    }
    .open-btn:hover {
      background: rgba(99, 102, 241, 0.2);
      border-color: rgba(99, 102, 241, 0.5);
      color: #fff;
    }
  `;

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function copyText(text) {
    try {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } catch (_) {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none';
    document.body.appendChild(el);
    el.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(el);
  }
})();
