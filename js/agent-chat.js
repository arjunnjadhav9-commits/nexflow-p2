// js/agent-chat.js
// Floating AI Copilot chat widget. Include via:
// <script src="js/agent-chat.js"></script>
// Guard flag prevents double-render if included on a page twice (same
// pattern as navbar.js's window._nexflowNavbarDone).

(async function () {
  if (window._nexflowAgentChatDone) return;
  window._nexflowAgentChatDone = true;

  // Agent FAB is owner/supervisor only. Resolves its own role (doesn't wait on the
  // page's own checkAuth(), which may not have run yet at this point in page load).
  try {
    if (window.supabase && typeof fetchUserRole === 'function' && typeof canAccess === 'function') {
      const { data: { user } } = await window.supabase.auth.getUser();
      if (!user) return;
      const tenantId = user.user_metadata?.tenant_id || user.id;
      const role = await fetchUserRole(user.id, tenantId);
      if (!canAccess(role, 'agent')) return;
    }
  } catch (_) {
    return;
  }

  const EDGE_FUNCTION_URL = 'https://jhqxvpihauvhfclosuxn.supabase.co/functions/v1/agent-query';
  const ANON_KEY = SUPABASE_ANON_KEY;

  // Checked once at init (mirrors window.isDemo set by auth.js/utils.js on
  // login) — not re-checked per message, per demo-blocking spec.
  const isDemo = window.isDemo === true;

  function t(en, mr) {
    return (localStorage.getItem('nexflow_lang') === 'mr') ? mr : en;
  }

  async function getTenantId() {
    // Matches your established pattern: user.id IS the tenant_id, no
    // separate tenant table lookup.
    const { data, error } = await window.supabase.auth.getUser();
    if (error || !data?.user) return null;
    return data.user.id;
  }

  // ---------- Styles ----------
  const style = document.createElement('style');
  style.textContent = `
    #nf-agent-fab {
      position: fixed; bottom: calc(20px + env(safe-area-inset-bottom, 0px)); right: 20px; z-index: 500;
      width: 56px; height: 56px; border-radius: 50%;
      background: linear-gradient(135deg, var(--orange), var(--orange2));
      box-shadow: var(--shadow-orange);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; border: none; color: var(--white); font-size: 24px;
      transition: transform 0.15s ease;
    }
    #nf-agent-fab:hover { transform: scale(1.06); }
    #nf-agent-panel {
      position: fixed; bottom: calc(88px + env(safe-area-inset-bottom, 0px)); right: 20px; z-index: 500;
      width: 380px; max-width: calc(100vw - 32px); height: 560px;
      max-height: calc(100vh - 100px);
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
      box-shadow: var(--shadow-md);
      display: none; flex-direction: column; overflow: hidden;
      font-family: var(--font);
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
    @keyframes nf-panel-in {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes nf-panel-out {
      from { opacity: 1; transform: translateY(0); }
      to { opacity: 0; transform: translateY(12px); }
    }
    #nf-agent-panel.nf-panel-visible { animation: nf-panel-in 180ms cubic-bezier(0.22,1,0.36,1) forwards; }
    #nf-agent-panel.nf-panel-closing { animation: nf-panel-out 150ms ease-in forwards; }
    #nf-agent-header {
      background: var(--surface);
      border-bottom: 2px solid var(--orange);
      color: var(--text); padding: 10px 14px; font-weight: 600;
      display: flex; justify-content: space-between; align-items: center;
      gap: 10px;
    }
    #nf-agent-header-left {
      display: flex; align-items: center; gap: 8px;
    }
    #nf-agent-header-logo {
      width: 24px; height: 24px; object-fit: contain;
    }
    #nf-agent-header-title {
      font-size: 14px; font-weight: 700; color: var(--text);
      font-family: var(--condensed, var(--font));
      letter-spacing: 0.5px;
    }
    #nf-agent-header-subtitle {
      font-size: 10px; color: var(--orange); font-weight: 600;
      letter-spacing: 1px; text-transform: uppercase;
    }
    #nf-agent-close { background: none; border: none; color: var(--mid); font-size: 20px; cursor: pointer; transition: color 0.15s; }
    #nf-agent-close:hover { color: var(--text); }
    #nf-agent-messages {
      flex: 1; overflow-y: auto; padding: 12px; background: var(--bg);
      display: flex; flex-direction: column; gap: 10px;
    }
    #nf-agent-messages::-webkit-scrollbar { width: 4px; }
    #nf-agent-messages::-webkit-scrollbar-track { background: var(--bg); }
    #nf-agent-messages::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }
    #nf-agent-messages::-webkit-scrollbar-thumb:hover { background: var(--mid); }
    .nf-msg { max-width: 85%; padding: 9px 12px; border-radius: var(--radius); font-size: 14px; line-height: 1.4; font-family: var(--font); }
    .nf-msg-user { align-self: flex-end; background: var(--orange); color: var(--white); border-bottom-right-radius: 3px; }
    .nf-msg-bot { align-self: flex-start; background: var(--surface2); border: 1px solid var(--border); border-left: 3px solid var(--orange); color: var(--text); border-bottom-left-radius: 3px; white-space: pre-wrap; padding: 10px 14px; }
    .nf-msg-error { align-self: flex-start; background: var(--red-dim); border: 1px solid var(--red); color: var(--red); }
    @keyframes nf-msg-in {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .nf-msg-enter { opacity: 0; transform: translateY(6px); animation: nf-msg-in 200ms ease-out forwards; }
    .nf-confirm-card {
      align-self: flex-start; background: var(--surface3); border: 1.5px solid var(--orange);
      border-radius: var(--radius); padding: 14px 14px 12px; max-width: 92%;
      box-shadow: 0 0 0 4px var(--orange-dim), var(--shadow-md);
    }
    .nf-confirm-label {
      font-family: var(--condensed); font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
      text-transform: uppercase; color: var(--orange); margin-bottom: 8px;
    }
    .nf-confirm-text { font-size: 14px; color: var(--text); line-height: 1.5; white-space: pre-wrap; }
    .nf-confirm-actions { display: flex; gap: 8px; margin-top: 8px; }
    .nf-btn-confirm, .nf-btn-cancel {
      flex: 1; padding: 7px 0; border-radius: var(--radius-sm); border: none; font-size: 13px; font-weight: 600; cursor: pointer; font-family: var(--font);
    }
    .nf-btn-confirm { background: var(--orange); color: var(--white); }
    .nf-btn-cancel { background: var(--surface3); color: var(--text); }
    #nf-agent-inputbar { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--border); background: var(--surface); }
    #nf-agent-input {
      flex: 1; background: var(--surface2); border: 1px solid var(--border2); color: var(--text);
      border-radius: 20px; padding: 9px 14px; font-size: 14px; font-family: var(--font);
      transition: border-color 0.15s, box-shadow 0.15s;
      min-height: 38px; max-height: 80px; overflow-y: auto;
      white-space: pre-wrap; word-break: break-word;
    }
    #nf-agent-input:focus { border-color: var(--orange); box-shadow: 0 0 0 3px var(--orange-glow); outline: none; }
    #nf-agent-input::placeholder { color: var(--mid); }
    #nf-agent-send { background: var(--orange); border: none; color: var(--white); width: 36px; height: 36px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .nf-typing { display: flex; align-items: center; gap: 5px; padding: 10px 14px; align-self: flex-start; background: var(--surface2); border: 1px solid var(--border); border-left: 3px solid var(--orange); border-radius: var(--radius); border-bottom-left-radius: 3px; }
    .nf-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--mid); animation: nf-dot-pulse 1.2s ease-in-out infinite; }
    .nf-dot:nth-child(1) { animation-delay: 0s; }
    .nf-dot:nth-child(2) { animation-delay: 0.2s; }
    .nf-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes nf-dot-pulse {
      0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }
    #nf-agent-chips {
      display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 6px;
      padding: 8px 10px; border-top: 1px solid var(--border);
      background: var(--surface);
      scrollbar-width: none; -webkit-overflow-scrolling: touch;
    }
    #nf-agent-chips::-webkit-scrollbar { display: none; }
    .nf-chip {
      background: var(--surface2); border: 1px solid var(--border2);
      color: var(--light); font-size: 12px; font-family: var(--font);
      padding: 4px 10px; border-radius: 20px; cursor: pointer;
      white-space: nowrap; transition: border-color 0.15s, color 0.15s;
    }
    .nf-chip:hover { border-color: var(--orange); color: var(--orange); }
    @media (max-width: 600px) {
      #nf-agent-panel {
        width: calc(100vw - 16px);
        height: calc(100vh - 80px);
        max-height: calc(100vh - 80px);
        bottom: calc(72px + env(safe-area-inset-bottom, 0px));
        right: 8px;
      }
      #nf-agent-send { width: 44px; height: 44px; }
    }
    .nf-chip-more {
      background: none; border: 1px solid var(--border2);
      color: var(--mid); font-size: 14px; font-family: var(--font);
      padding: 4px 10px; border-radius: 20px; cursor: pointer;
      transition: border-color 0.15s, color 0.15s; line-height: 1;
    }
    .nf-chip-more:hover { border-color: var(--orange); color: var(--orange); }
    #nf-agent-search-wrap {
      display: none; padding: 6px 10px 4px;
      background: var(--surface); border-top: 1px solid var(--border);
    }
    #nf-agent-search-wrap.open { display: block; }
    #nf-agent-search-header {
      display: flex; align-items: center; gap: 6px; margin-bottom: 4px;
    }
    #nf-agent-search-header input { flex: 1; }
    #nf-agent-search-close {
      background: none; border: none; color: var(--mid); font-size: 18px;
      cursor: pointer; padding: 0 4px; line-height: 1;
      transition: color 0.15s;
    }
    #nf-agent-search-close:hover { color: var(--text); }
    #nf-agent-search-input {
      width: 100%; background: var(--surface2); border: 1px solid var(--border2);
      color: var(--text); border-radius: 20px; padding: 7px 14px;
      font-size: 13px; font-family: var(--font); outline: none;
      transition: border-color 0.15s;
    }
    #nf-agent-search-input:focus { border-color: var(--orange); }
    #nf-agent-search-input::placeholder { color: var(--mid); }
    #nf-agent-search-results {
      display: flex; flex-direction: column; gap: 4px; padding: 6px 0 2px;
      max-height: 180px; overflow-y: auto;
      scrollbar-width: thin; scrollbar-color: var(--border2) transparent;
    }
    #nf-agent-search-results::-webkit-scrollbar { width: 3px; }
    #nf-agent-search-results::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }
    .nf-search-result-chip {
      background: var(--surface2); border: 1px solid var(--border2);
      color: var(--light); font-size: 13px; font-family: var(--font);
      padding: 8px 12px; border-radius: var(--radius-sm); cursor: pointer;
      text-align: left; transition: border-color 0.15s, color 0.15s, background 0.15s;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .nf-search-result-chip:hover { border-color: var(--orange); color: var(--orange); background: var(--surface3); }
    .nf-client-sublabel {
      font-size: 11px; font-weight: 700; color: var(--orange);
      margin-top: -4px; margin-bottom: 10px; font-family: var(--condensed, var(--font));
      letter-spacing: 0.5px;
    }
    .nf-field-label {
      font-size: 11px; font-weight: 700; color: var(--mid);
      text-transform: uppercase; letter-spacing: 0.5px;
      display: block; margin-bottom: 4px; margin-top: 8px;
    }
    .nf-field-label:first-of-type { margin-top: 0; }
    .nf-field-input, .nf-field-textarea {
      width: 100%; box-sizing: border-box;
      background: var(--surface3); border: 1px solid var(--border2, var(--border));
      color: var(--text); border-radius: var(--radius-sm); padding: 7px 10px;
      font-size: 13px; font-family: var(--font);
    }
    .nf-field-input:focus, .nf-field-textarea:focus { border-color: var(--orange); outline: none; }
    .nf-field-textarea { resize: vertical; }
    .nf-field-row { display: flex; gap: 8px; }
    .nf-field-row > div { flex: 1; min-width: 0; }
    .nf-field-error { display: none; color: var(--red); font-size: 12px; margin-top: 8px; }
    .nf-field-error.visible { display: block; }
  `;
  document.head.appendChild(style);

  // ---------- DOM ----------
  const fab = document.createElement('button');
  fab.id = 'nf-agent-fab';
  fab.innerHTML = `<img src="assets/nexflow-mark.png" width="36" height="36" style="object-fit:contain; filter:brightness(0) invert(1);">`;
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'nf-agent-panel';
  panel.innerHTML = `
    <div id="nf-agent-header">
      <div id="nf-agent-header-left">
        <img id="nf-agent-header-logo" src="assets/nexflow-mark.png" alt="Nexflow" />
        <div>
          <div id="nf-agent-header-title">NEXFLOW P2</div>
          <div id="nf-agent-header-subtitle">${t('AI Copilot', 'AI सहाय्यक')}</div>
        </div>
      </div>
      <button id="nf-agent-close">×</button>
    </div>
    <div id="nf-agent-messages"></div>
    <div id="nf-agent-inputbar">
      <textarea id="nf-agent-input" placeholder="${t('Type a message...', 'संदेश टाइप करा...')}"></textarea>
      <button id="nf-agent-send"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
    </div>
  `;
  document.body.appendChild(panel);

  const messagesEl = panel.querySelector('#nf-agent-messages');
  const inputEl = panel.querySelector('#nf-agent-input');

  if (isDemo) {
    inputEl.disabled = true;
    inputEl.placeholder = 'Demo mode — agent is read-only';
    const sendBtn = panel.querySelector('#nf-agent-send');
    sendBtn.disabled = true;
    sendBtn.style.opacity = '0.4';
    sendBtn.style.cursor = 'not-allowed';
  }

  let hasShownWelcome = false;
  let isOpen = false;
  let chipsLoaded = false;

  // Fetches the full active-material list (ordered by lowest stock first),
  // renders the top 6 as tap-to-insert chips, and keeps the full list around
  // for the "search all materials" panel behind the ⋯ button.
  async function loadMaterialChips(tenantId) {
    try {
      const { data, error } = await window.supabase
        .from('v_p2_stock_balance')
        .select('raw_material_id, name, current_stock, min_stock_level, material_code')
        .eq('tenant_id', tenantId)
        .order('current_stock', { ascending: true });
      if (error || !data?.length) {
        const existingChips = document.getElementById('nf-agent-chips');
        if (existingChips) existingChips.style.display = 'none';
        return;
      }
      renderChips(data);
    } catch {}
  }

  function insertMaterialName(name) {
    const current = inputEl.value.trim();
    inputEl.value = current ? `${current} aani ${name} ` : `${name} `;
    inputEl.focus();
  }

  function renderChips(materials) {
    const existingChips = document.getElementById('nf-agent-chips');
    if (existingChips) existingChips.remove();
    const existingSearch = document.getElementById('nf-agent-search-wrap');
    if (existingSearch) existingSearch.remove();

    const wrap = document.createElement('div');
    wrap.id = 'nf-agent-chips';
    const topSix = materials.slice(0, 6);
    topSix.forEach(m => {
      const chip = document.createElement('button');
      chip.className = 'nf-chip';
      const code = m.material_code || ''
      const shortName = m.name.length > 12 ? m.name.slice(0, 12).trim() + '…' : m.name
      chip.textContent = code ? `${code} · ${shortName}` : m.name
      chip.title = m.name
      chip.addEventListener('click', () => insertMaterialName(m.name));
      wrap.appendChild(chip);
    });

    const moreBtn = document.createElement('button');
    moreBtn.className = 'nf-chip-more';
    moreBtn.textContent = '⋯';
    moreBtn.title = t('Search all materials', 'सर्व साहित्य शोधा');
    wrap.appendChild(moreBtn);

    const inputBar = document.getElementById('nf-agent-inputbar');
    messagesEl.parentNode.insertBefore(wrap, inputBar);

    const searchWrap = document.createElement('div');
    searchWrap.id = 'nf-agent-search-wrap';
    searchWrap.innerHTML = `
      <div id="nf-agent-search-header">
        <input id="nf-agent-search-input" type="text" placeholder="${t('Search materials...', 'साहित्य शोधा...')}" autocomplete="off" />
        <button id="nf-agent-search-close" title="Close">×</button>
      </div>
      <div id="nf-agent-search-results"></div>
    `;
    messagesEl.parentNode.insertBefore(searchWrap, inputBar);

    const searchInput = searchWrap.querySelector('#nf-agent-search-input');
    const resultsEl = searchWrap.querySelector('#nf-agent-search-results');

    moreBtn.addEventListener('click', () => {
      searchWrap.classList.toggle('open');
      if (searchWrap.classList.contains('open')) searchInput.focus();
    });

    searchWrap.querySelector('#nf-agent-search-close').addEventListener('click', () => {
      searchWrap.classList.remove('open');
      searchWrap.querySelector('#nf-agent-search-input').value = '';
      searchWrap.querySelector('#nf-agent-search-results').innerHTML = '';
    });

    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      resultsEl.innerHTML = '';
      if (!q) return;
      const matches = materials.filter(m =>
        m.name.toLowerCase().includes(q) ||
        (m.material_code && m.material_code.toLowerCase().includes(q))
      ).slice(0, 8);
      matches.forEach(m => {
        const chip = document.createElement('button');
        chip.className = 'nf-search-result-chip';
        const code = m.material_code || ''
        chip.textContent = code ? `${code} · ${m.name}` : m.name
        chip.title = m.name
        chip.addEventListener('click', () => {
          insertMaterialName(m.name);
          searchWrap.classList.remove('open');
          searchInput.value = '';
          resultsEl.innerHTML = '';
        });
        resultsEl.appendChild(chip);
      });
    });
  }

  function openPanel() {
    isOpen = true;
    fab.style.display = 'none';
    panel.classList.remove('nf-panel-closing');
    panel.style.display = 'flex';
    requestAnimationFrame(() => panel.classList.add('nf-panel-visible'));
    if (!hasShownWelcome) {
      hasShownWelcome = true;
      if (isDemo) {
        addMessage(
          t(
            'This is a read-only demo. Log in with your own account to use the AI Copilot.',
            'ही फक्त वाचण्यासाठीची डेमो आहे. AI सहाय्यक वापरण्यासाठी तुमच्या स्वतःच्या खात्याने लॉगिन करा.'
          ),
          'nf-msg-bot'
        );
      } else {
        addMessage(
          t(
            'Hi! Ask me about stock, GRNs, consumption, suppliers, dispatches, or if you have enough stock to produce.',
            'नमस्कार! स्टॉक, GRN, वापर, पुरवठादार, dispatch किंवा production साठी stock विचारा.'
          ),
          'nf-msg-bot'
        );
      }
    }
    if (!chipsLoaded) {
      chipsLoaded = true;
      getTenantId().then(tid => { if (tid) loadMaterialChips(tid); });
    }
  }

  function closePanel() {
    isOpen = false;
    panel.classList.remove('nf-panel-visible');
    panel.classList.add('nf-panel-closing');
    panel.addEventListener('animationend', function onEnd() {
      panel.removeEventListener('animationend', onEnd);
      panel.classList.remove('nf-panel-closing');
      panel.style.display = 'none';
      fab.style.display = 'flex';
    }, { once: true });
  }

  fab.addEventListener('click', () => {
    if (isOpen) closePanel(); else openPanel();
  });
  panel.querySelector('#nf-agent-close').addEventListener('click', closePanel);

  function addMessage(text, cls) {
    const div = document.createElement('div');
    div.className = `nf-msg ${cls} nf-msg-enter`;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addTyping() {
    const div = document.createElement('div');
    div.className = 'nf-typing';
    div.id = 'nf-typing-indicator';
    div.innerHTML = '<span class="nf-dot"></span><span class="nf-dot"></span><span class="nf-dot"></span>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function removeTyping() {
    const el = document.getElementById('nf-typing-indicator');
    if (el) el.remove();
  }

  // Renders a create_grn confirm card with tap-to-confirm buttons.
  // Sends back ONLY IDs + quantity + unit on confirm — never the whole
  // confirm_text or displayed values — server re-derives everything.
  function addConfirmCard(confirmText, confirmData, tenantId) {
    const card = document.createElement('div');
    card.className = 'nf-confirm-card nf-msg-enter';
    card.innerHTML = `
      <div class="nf-confirm-label">AWAITING CONFIRMATION</div>
      <div class="nf-confirm-text">${confirmText}</div>
      <div class="nf-confirm-actions">
        <button class="nf-btn-confirm">${t('Confirm', 'पुष्टी करा')}</button>
        <button class="nf-btn-cancel">${t('Cancel', 'रद्द करा')}</button>
      </div>
    `;
    messagesEl.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    card.querySelector('.nf-btn-cancel').addEventListener('click', () => {
      card.remove();
      addMessage(t('Cancelled.', 'रद्द केले.'), 'nf-msg-bot');
    });

    card.querySelector('.nf-btn-confirm').addEventListener('click', async () => {
      card.querySelectorAll('button').forEach(b => b.disabled = true);
      try {
        const res = await fetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
          body: JSON.stringify({
            action: 'confirm_grn',
            tenant_id: tenantId,
            material_id: confirmData.material_id,
            supplier_id: confirmData.supplier_id,
            quantity: confirmData.quantity,
            unit: confirmData.unit,
          }),
        });
        const data = await res.json();
        card.remove();
        if (data.confirmed) {
          addMessage(
            t(
              `✅ Saved: ${data.result.grn_no} — ${data.result.quantity} ${data.result.unit} of ${data.result.material_name}`,
              `✅ जतन केले: ${data.result.grn_no} — ${data.result.material_name} चे ${data.result.quantity} ${data.result.unit}`
            ),
            'nf-msg-bot'
          );
          addGrnRateCard(data.result.grn_no, [{
            material_name: data.result.material_name,
            material_code: confirmData.material_code ?? null,
            quantity: data.result.quantity,
            unit: data.result.unit,
            transaction_id: data.result.transaction_id,
          }], tenantId);
        } else {
          addMessage(data.error || t('Could not save. Please try again.', 'जतन करता आले नाही. पुन्हा प्रयत्न करा.'), 'nf-msg-error');
        }
      } catch (err) {
        card.remove();
        addMessage(t('Something went wrong — check your connection and try again.', 'काहीतरी चूक झाली — कनेक्शन तपासा आणि पुन्हा प्रयत्न करा.'), 'nf-msg-error');
      }
    });
  }

  // Renders a combined create_grn confirm card for 2+ materials extracted
  // from one message — all items share ONE GRN number via confirm_multi_grn
  // (single-material messages keep using addConfirmCard/confirm_grn above,
  // unchanged). On success, chains into addGrnRateCard() so rate/invoice can
  // be entered immediately.
  function addMultiGrnConfirmCard(items, supplierId, tenantId) {
    const lines = items.map(item => {
      const codeStr = item.data.material_code ? ` [${item.data.material_code}]` : '';
      return `• ${item.data.material_name}${codeStr} — ${item.data.quantity} ${item.data.unit}`;
    }).join('\n');

    const supplierLine = items[0]?.data?.supplier_name ? `\nSupplier: ${items[0].data.supplier_name}` : '';
    const confirmText = `📦 GRN — ${items.length} materials${supplierLine}\n\n${lines}`;

    const card = document.createElement('div');
    card.className = 'nf-confirm-card nf-msg-enter';
    card.innerHTML = `
      <div class="nf-confirm-label">AWAITING CONFIRMATION</div>
      <div class="nf-confirm-text">${confirmText}</div>
      <div class="nf-confirm-actions">
        <button class="nf-btn-confirm">${t('Confirm', 'पुष्टी करा')}</button>
        <button class="nf-btn-cancel">${t('Cancel', 'रद्द करा')}</button>
      </div>
    `;
    messagesEl.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    const cancelBtn = card.querySelector('.nf-btn-cancel');
    const confirmBtn = card.querySelector('.nf-btn-confirm');
    const confirmBtnLabel = confirmBtn.textContent;

    cancelBtn.addEventListener('click', () => {
      card.remove();
      addMessage(t('Cancelled.', 'रद्द केले.'), 'nf-msg-bot');
    });

    confirmBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      confirmBtn.disabled = true;
      confirmBtn.textContent = '...';
      try {
        const res = await fetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
          body: JSON.stringify({
            action: 'confirm_multi_grn',
            tenant_id: tenantId,
            supplier_id: supplierId ?? null,
            items: items.map(item => ({
              material_id: item.data.material_id,
              quantity: item.data.quantity,
              unit: item.data.unit,
              material_name: item.data.material_name,
              material_code: item.data.material_code ?? null,
            })),
          }),
        });
        const data = await res.json();

        if (data.confirmed === true) {
          card.remove();
          addMessage(
            t(`✅ GRN ${data.result.grn_no} saved — ${data.result.items.length} materials received.`,
              `✅ GRN ${data.result.grn_no} जतन केले — ${data.result.items.length} साहित्य प्राप्त.`),
            'nf-msg-bot'
          );
          addGrnRateCard(data.result.grn_no, data.result.items, tenantId);
        } else if (data.confirmed === false) {
          card.remove();
          addMessage(data.error || t('Could not save. Please try again.', 'जतन करता आले नाही. पुन्हा प्रयत्न करा.'), 'nf-msg-error');
        } else {
          cancelBtn.disabled = false;
          confirmBtn.disabled = false;
          confirmBtn.textContent = confirmBtnLabel;
          addMessage(t('Something went wrong — check your connection and try again.', 'काहीतरी चूक झाली — कनेक्शन तपासा आणि पुन्हा प्रयत्न करा.'), 'nf-msg-error');
        }
      } catch (err) {
        cancelBtn.disabled = false;
        confirmBtn.disabled = false;
        confirmBtn.textContent = confirmBtnLabel;
        addMessage(t('Something went wrong — check your connection and try again.', 'काहीतरी चूक झाली — कनेक्शन तपासा आणि पुन्हा प्रयत्न करा.'), 'nf-msg-error');
      }
    });
  }

  // Renders the post-multi-GRN "Rate & Invoice" card — one row per material
  // already saved by addMultiGrnConfirmCard(). Skip/Save semantics mirror
  // addClientInfoCard(): Skip just dismisses, Save POSTs whatever is filled
  // (blank fields stay null) via update_grn_rates.
  function addGrnRateCard(grnNo, items, tenantId) {
    const rowsHtml = items.map((item, idx) => {
      const codeStr = item.material_code ? ` [${item.material_code}]` : '';
      return `
        <div style="border-bottom: 1px solid var(--border); padding: 10px 0; ${idx === items.length - 1 ? 'border-bottom:none;' : ''}">
          <div style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 6px;">
            ${item.material_name}${codeStr} — ${item.quantity} ${item.unit}
          </div>
          <div class="nf-field-row">
            <div>
              <label class="nf-field-label">${t('Rate (₹)', 'दर (₹)')}</label>
              <input type="number" step="0.01" min="0" class="nf-field-input" data-txn-id="${item.transaction_id}" data-field="rate" placeholder="0.00" />
            </div>
            <div>
              <label class="nf-field-label">${t('Invoice No', 'इनव्हॉइस क्र.')}</label>
              <input type="text" class="nf-field-input" data-txn-id="${item.transaction_id}" data-field="invoice" placeholder="${t('Optional', 'वैकल्पिक')}" />
            </div>
          </div>
        </div>
      `;
    }).join('');

    const card = document.createElement('div');
    card.className = 'nf-confirm-card nf-msg-enter';
    card.innerHTML = `
      <div class="nf-confirm-label">📋 ${t('RATE & INVOICE', 'दर आणि इनव्हॉइस')}</div>
      <div class="nf-client-sublabel">GRN ${grnNo}</div>
      ${rowsHtml}
      <div class="nf-field-error" data-field="error"></div>
      <div class="nf-confirm-actions">
        <button class="nf-btn-confirm" data-action="save">${t('Save', 'जतन करा')}</button>
        <button class="nf-btn-cancel" data-action="skip">${t('Skip', 'वगळा')}</button>
      </div>
    `;
    messagesEl.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    const saveBtn = card.querySelector('[data-action="save"]');
    const skipBtn = card.querySelector('[data-action="skip"]');
    const errorEl = card.querySelector('[data-field="error"]');
    const saveBtnLabel = saveBtn.textContent;

    skipBtn.addEventListener('click', () => {
      card.remove();
      addMessage(t('Skipped — rate and invoice can be updated from GRN history.', 'वगळले — दर आणि इनव्हॉइस GRN history मधून अपडेट करा.'), 'nf-msg-bot');
    });

    saveBtn.addEventListener('click', async () => {
      errorEl.classList.remove('visible');
      errorEl.textContent = '';
      saveBtn.disabled = true;
      skipBtn.disabled = true;
      saveBtn.textContent = '...';

      const updates = items.map(item => {
        const rateInput = card.querySelector(`[data-txn-id="${item.transaction_id}"][data-field="rate"]`);
        const invoiceInput = card.querySelector(`[data-txn-id="${item.transaction_id}"][data-field="invoice"]`);
        const rateVal = rateInput?.value.trim();
        const invoiceVal = invoiceInput?.value.trim();
        return {
          transaction_id: item.transaction_id,
          rate: rateVal ? parseFloat(rateVal) : null,
          invoice_no: invoiceVal || null,
        };
      });

      try {
        const res = await fetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
          body: JSON.stringify({
            action: 'update_grn_rates',
            tenant_id: tenantId,
            updates,
          }),
        });
        const data = await res.json();
        if (data.status === 'ok' && data.confirmed) {
          card.remove();
          addMessage(t('✅ Rate and invoice saved.', '✅ दर आणि इनव्हॉइस जतन केले.'), 'nf-msg-bot');
        } else {
          errorEl.textContent = data.error || t('Could not save. Please try again.', 'जतन करता आले नाही. पुन्हा प्रयत्न करा.');
          errorEl.classList.add('visible');
          saveBtn.disabled = false;
          skipBtn.disabled = false;
          saveBtn.textContent = saveBtnLabel;
        }
      } catch (err) {
        errorEl.textContent = t('Something went wrong — check your connection and try again.', 'काहीतरी चूक झाली — कनेक्शन तपासा आणि पुन्हा प्रयत्न करा.');
        errorEl.classList.add('visible');
        saveBtn.disabled = false;
        skipBtn.disabled = false;
        saveBtn.textContent = saveBtnLabel;
      }
    });
  }

  // Renders a create_production_issue confirm card. Sends back ONLY IDs +
  // quantity + the already-matched bom_lines on confirm — server re-fetches
  // and re-validates everything at write time (mirrors addConfirmCard()).
  // Unlike the GRN card, a non-success response doesn't always remove the
  // card: a duplicate rejection (confirmed:false) is a definitive business
  // outcome (the backend never accepts a force-retry from chat), so it's
  // treated like GRN's error path — but a true server/network failure keeps
  // the card and re-enables its buttons so the user can retry without
  // burning another agent query on re-parsing the same message.
  function addProductionIssueConfirmCard(confirmText, confirmData, tenantId) {
    const card = document.createElement('div');
    card.className = 'nf-confirm-card nf-msg-enter';
    card.innerHTML = `
      <div class="nf-confirm-label">AWAITING CONFIRMATION</div>
      <div class="nf-confirm-text">${confirmText}</div>
      <div class="nf-confirm-actions">
        <button class="nf-btn-confirm">${t('Confirm', 'पुष्टी करा')}</button>
        <button class="nf-btn-cancel">${t('Cancel', 'रद्द करा')}</button>
      </div>
    `;
    messagesEl.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    const cancelBtn = card.querySelector('.nf-btn-cancel');
    const confirmBtn = card.querySelector('.nf-btn-confirm');
    const confirmBtnLabel = confirmBtn.textContent;

    cancelBtn.addEventListener('click', () => {
      card.remove();
      addMessage(t('Cancelled.', 'रद्द केले.'), 'nf-msg-bot');
    });

    confirmBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      confirmBtn.disabled = true;
      confirmBtn.textContent = '...';
      try {
        const res = await fetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
          body: JSON.stringify({
            action: 'confirm_production_issue',
            tenant_id: tenantId,
            product_id: confirmData.product_id,
            product_name: confirmData.product_name,
            quantity: confirmData.quantity,
            bom_lines: confirmData.bom_lines,
          }),
        });
        const data = await res.json();

        if (data.confirmed === true) {
          card.remove();
          if (data.next === 'client_info') {
            addMessage(
              t(
                `✅ Challan ${data.result?.challan_number} — ${data.result?.product_name} × ${data.result?.quantity} issued.`,
                `✅ चलन ${data.result?.challan_number} — ${data.result?.product_name} × ${data.result?.quantity} इश्यू झाले.`
              ),
              'nf-msg-bot'
            );
            addClientInfoCard(
              data.result?.order_id,
              data.result?.challan_number,
              data.result?.product_name,
              data.result?.quantity,
              tenantId
            );
          } else {
            addMessage(
              t(
                `✅ Production issue complete!\nChallan: ${data.result.challan_number}\n${data.result.product_name} × ${data.result.quantity} issued.`,
                `✅ Production issue पूर्ण झाले!\nचलन: ${data.result.challan_number}\n${data.result.product_name} × ${data.result.quantity} इश्यू झाले.`
              ),
              'nf-msg-bot'
            );
          }
        } else if (data.confirmed === false) {
          card.remove();
          addMessage(data.error || t('Could not save. Please try again.', 'जतन करता आले नाही. पुन्हा प्रयत्न करा.'), 'nf-msg-error');
        } else {
          // status === 'error' (or an unexpected shape) — a real failure,
          // not a business rejection, so keep the card and let the user
          // retry the same write without re-triggering the parse phase.
          cancelBtn.disabled = false;
          confirmBtn.disabled = false;
          confirmBtn.textContent = confirmBtnLabel;
          addMessage(t('Something went wrong — check your connection and try again.', 'काहीतरी चूक झाली — कनेक्शन तपासा आणि पुन्हा प्रयत्न करा.'), 'nf-msg-error');
        }
      } catch (err) {
        cancelBtn.disabled = false;
        confirmBtn.disabled = false;
        confirmBtn.textContent = confirmBtnLabel;
        addMessage(t('Something went wrong — check your connection and try again.', 'काहीतरी चूक झाली — कनेक्शन तपासा आणि पुन्हा प्रयत्न करा.'), 'nf-msg-error');
      }
    });
  }

  // Renders a create_product_dispatch / create_rm_dispatch confirm card.
  // dispatchType is 'product_dispatch' | 'rm_dispatch' so the POST action
  // builds directly as `confirm_${dispatchType}`. Mirrors
  // addProductionIssueConfirmCard's confirmed/not-confirmed/real-failure
  // branching, but the client-info card is ALWAYS shown on success — not
  // gated on data.next — since it's mandatory for these two intents.
  function addDispatchConfirmCard(confirmText, confirmData, tenantId, dispatchType) {
    const card = document.createElement('div');
    card.className = 'nf-confirm-card nf-msg-enter';
    card.innerHTML = `
      <div class="nf-confirm-label">AWAITING CONFIRMATION</div>
      <div class="nf-confirm-text">${confirmText}</div>
      <div class="nf-confirm-actions">
        <button class="nf-btn-confirm">${t('Confirm', 'पुष्टी करा')}</button>
        <button class="nf-btn-cancel">${t('Cancel', 'रद्द करा')}</button>
      </div>
    `;
    messagesEl.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    const cancelBtn = card.querySelector('.nf-btn-cancel');
    const confirmBtn = card.querySelector('.nf-btn-confirm');
    const confirmBtnLabel = confirmBtn.textContent;

    cancelBtn.addEventListener('click', () => {
      card.remove();
      addMessage(t('Cancelled.', 'रद्द केले.'), 'nf-msg-bot');
    });

    confirmBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      confirmBtn.disabled = true;
      confirmBtn.textContent = '...';
      try {
        const res = await fetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
          body: JSON.stringify({
            action: `confirm_${dispatchType}`,
            tenant_id: tenantId,
            items: confirmData.items,
          }),
        });
        const data = await res.json();

        if (data.confirmed === true) {
          card.remove();
          addMessage(
            t(
              `✅ Challan ${data.result?.challan_number} created.`,
              `✅ चलन ${data.result?.challan_number} तयार झाले.`
            ),
            'nf-msg-bot'
          );
          addClientInfoCard(data.result?.order_id, data.result?.challan_number, null, null, tenantId, true);
        } else if (data.confirmed === false) {
          card.remove();
          addMessage(data.error || t('Could not save. Please try again.', 'जतन करता आले नाही. पुन्हा प्रयत्न करा.'), 'nf-msg-error');
        } else {
          // status === 'error' (or an unexpected shape) — a real failure,
          // not a business rejection, so keep the card and let the user
          // retry the same write without re-triggering the parse phase.
          cancelBtn.disabled = false;
          confirmBtn.disabled = false;
          confirmBtn.textContent = confirmBtnLabel;
          addMessage(t('Something went wrong — check your connection and try again.', 'काहीतरी चूक झाली — कनेक्शन तपासा आणि पुन्हा प्रयत्न करा.'), 'nf-msg-error');
        }
      } catch (err) {
        cancelBtn.disabled = false;
        confirmBtn.disabled = false;
        confirmBtn.textContent = confirmBtnLabel;
        addMessage(t('Something went wrong — check your connection and try again.', 'काहीतरी चूक झाली — कनेक्शन तपासा आणि पुन्हा प्रयत्न करा.'), 'nf-msg-error');
      }
    });
  }

  // Populates the PO-number datalist for a given client. Takes card/tenantId/
  // poListId explicitly (not closed over) so it can be called from the
  // client-name change handler inside addClientInfoCard without nesting.
  function loadPOSuggestions(clientName, tenantId, card, poListId) {
    if (!clientName || !tenantId) return;
    window.supabase
      .from('p2_client_po_numbers')
      .select('po_number')
      .eq('tenant_id', tenantId)
      .eq('client_name', clientName)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        const dl = card.querySelector('#' + CSS.escape(poListId));
        if (!dl) return;
        dl.innerHTML = '';
        (data || []).forEach(row => {
          const opt = document.createElement('option');
          opt.value = row.po_number;
          dl.appendChild(opt);
        });
      })
      .catch(() => {});
  }

  let clientInfoCardSeq = 0;

  // Renders the post-production-issue "Add Client Info" card. Unlike the
  // confirm cards above, this has Skip/Save semantics rather than Cancel/
  // Confirm — Skip just dismisses, Save POSTs to add_production_issue_client.
  // datalist ids must be document-unique (the browser resolves an <input
  // list="X"> via getElementById, not DOM proximity), hence the seq counter.
  function addClientInfoCard(orderId, challanNumber, productName, quantity, tenantId, mandatory = false) {
    const seq = ++clientInfoCardSeq;
    const clientListId = `nf-client-suggestions-${seq}`;
    const poListId = `nf-po-suggestions-${seq}`;

    const card = document.createElement('div');
    card.className = 'nf-confirm-card nf-msg-enter';
    card.innerHTML = `
      <div class="nf-confirm-label">📋 ${t('ADD CLIENT INFO', 'क्लायंट माहिती जोडा')}</div>
      <div class="nf-client-sublabel">${t('CHALLAN', 'चलन')} ${challanNumber}</div>

      <label class="nf-field-label">${t('Client Name', 'क्लायंटचे नाव')}</label>
      <input type="text" class="nf-field-input" list="${clientListId}" data-field="client-name" autocomplete="off" />
      <datalist id="${clientListId}"></datalist>

      <label class="nf-field-label">${t('Client Address', 'क्लायंटचा पत्ता')}</label>
      <textarea rows="2" class="nf-field-textarea" data-field="client-address"></textarea>

      <div class="nf-field-row">
        <div>
          <label class="nf-field-label">${t('PO Number', 'PO क्रमांक')}</label>
          <input type="text" class="nf-field-input" list="${poListId}" data-field="po-number" autocomplete="off" />
          <datalist id="${poListId}"></datalist>
        </div>
        <div>
          <label class="nf-field-label">${t('Transport', 'वाहतूक')}</label>
          <input type="text" class="nf-field-input" data-field="vehicle" autocomplete="off" />
        </div>
      </div>

      <div class="nf-field-error" data-field="error"></div>

      <div class="nf-confirm-actions">
        <button class="nf-btn-confirm" data-action="save">${t('Save', 'जतन करा')}</button>
        <button class="nf-btn-cancel" data-action="skip">${t('Skip', 'वगळा')}</button>
      </div>
    `;
    messagesEl.appendChild(card);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    const nameInput = card.querySelector('[data-field="client-name"]');
    const addressInput = card.querySelector('[data-field="client-address"]');
    const poInput = card.querySelector('[data-field="po-number"]');
    const vehicleInput = card.querySelector('[data-field="vehicle"]');
    const errorEl = card.querySelector('[data-field="error"]');
    const saveBtn = card.querySelector('[data-action="save"]');
    const skipBtn = card.querySelector('[data-action="skip"]');
    const saveBtnLabel = saveBtn.textContent;

    if (mandatory) {
      skipBtn.style.display = 'none';
    }

    let clientsMap = {};
    window.supabase
      .from('p2_clients')
      .select('name, address')
      .eq('tenant_id', tenantId)
      .order('name')
      .then(({ data }) => {
        const dl = card.querySelector('#' + CSS.escape(clientListId));
        (data || []).forEach(c => {
          clientsMap[c.name.trim().toLowerCase()] = c;
          const opt = document.createElement('option');
          opt.value = c.name;
          dl.appendChild(opt);
        });
      })
      .catch(() => {});

    nameInput.addEventListener('change', () => {
      const key = nameInput.value.trim().toLowerCase();
      const match = clientsMap[key];
      if (match) addressInput.value = match.address || '';
      if (nameInput.value.trim()) {
        loadPOSuggestions(nameInput.value.trim(), tenantId, card, poListId);
      }
    });

    skipBtn.addEventListener('click', () => {
      card.remove();
      addMessage(
        t(
          'Skipped — you can add client info from challan.html',
          'वगळले — challan.html वरून client माहिती नंतर जोडा'
        ),
        'nf-msg-bot'
      );
    });

    saveBtn.addEventListener('click', async () => {
      const clientName = nameInput.value.trim();
      errorEl.classList.remove('visible');
      errorEl.textContent = '';
      if (!clientName) {
        errorEl.textContent = t('Client name is required.', 'क्लायंटचे नाव आवश्यक आहे.');
        errorEl.classList.add('visible');
        return;
      }
      saveBtn.disabled = true;
      skipBtn.disabled = true;
      saveBtn.textContent = '...';
      try {
        const res = await fetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
          body: JSON.stringify({
            action: 'add_production_issue_client',
            tenant_id: tenantId,
            order_id: orderId,
            client_name: clientName,
            client_address: addressInput.value.trim(),
            po_number: poInput.value.trim(),
            vehicle_number: vehicleInput.value.trim(),
          }),
        });
        const data = await res.json();
        if (data.status === 'ok' && data.confirmed) {
          card.remove();
          addMessage(t('✅ Client info saved.', '✅ क्लायंट माहिती जतन केली.'), 'nf-msg-bot');
        } else {
          errorEl.textContent = data.error || t('Could not save. Please try again.', 'जतन करता आले नाही. पुन्हा प्रयत्न करा.');
          errorEl.classList.add('visible');
          saveBtn.disabled = false;
          skipBtn.disabled = false;
          saveBtn.textContent = saveBtnLabel;
        }
      } catch (err) {
        errorEl.textContent = t('Something went wrong — check your connection and try again.', 'काहीतरी चूक झाली — कनेक्शन तपासा आणि पुन्हा प्रयत्न करा.');
        errorEl.classList.add('visible');
        saveBtn.disabled = false;
        skipBtn.disabled = false;
        saveBtn.textContent = saveBtnLabel;
      }
    });
  }

  async function sendMessage() {
    const message = inputEl.value.trim();
    if (!message) return;
    inputEl.value = '';
    addMessage(message, 'nf-msg-user');

    const tenantId = await getTenantId();
    if (!tenantId) {
      addMessage(t('Could not verify your account. Please log in again.', 'खाते तपासता आले नाही. पुन्हा लॉगिन करा.'), 'nf-msg-error');
      return;
    }

    const typingEl = addTyping();
    try {
      const res = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ tenant_id: tenantId, message }),
      });
      removeTyping();

      if (res.status === 429) {
        const data = await res.json();
        addMessage(data.error || t('Daily limit reached.', 'दैनिक मर्यादा गाठली.'), 'nf-msg-error');
        return;
      }

      const data = await res.json();

      if (data.status === 'error') {
        addMessage(data.error || t('Something went wrong.', 'काहीतरी चूक झाली.'), 'nf-msg-error');
        return;
      }
      if (data.intent === 'unknown') {
        addMessage(t("I didn't understand that. Try asking about stock or reporting a GRN.", 'मला ते समजले नाही. स्टॉक विचारा किंवा GRN नोंदवा.'), 'nf-msg-bot');
        return;
      }

      const confirm = data.confirm;
      if (!confirm) {
        addMessage(t('No response generated.', 'प्रतिसाद मिळाला नाही.'), 'nf-msg-error');
        return;
      }

      if (confirm.status === 'blocked') {
        addMessage(confirm.reason || t('Could not process that.', 'ते प्रक्रिया करता आले नाही.'), 'nf-msg-error');
        return;
      }

      // status === 'ready'
      const READ_ONLY_TEXT_INTENTS = [
        'check_stock', 'recent_grn', 'consumption_summary',
        'supplier_history', 'low_stock_list', 'grn_detail', 'pending_dispatches',
        'grn_summary', 'top_consumption', 'material_list', 'stock_check_product',
        'zero_stock_list', 'dispatch_summary', 'supplier_delivery_check',
        'challan_detail', 'issue_summary', 'product_code_lookup',
        'top_received', 'product_list', 'supplier_list', 'dispatch_detail',
        'issue_detail', 'bom_detail', 'top_supplier',
        'invoice_total', 'invoice_detail', 'grn_completeness'
      ];
      if (READ_ONLY_TEXT_INTENTS.includes(data.intent)) {
        // Informational only — no write, no confirm button needed.
        addMessage(confirm.confirm_text, 'nf-msg-bot');
      } else if (data.intent === 'create_grn') {
        // Show unresolved items as errors first. A single matched material
        // keeps the existing one-card-per-item flow; multiple materials get
        // one combined card that shares a single GRN number.
        if (confirm.blocked_items?.length) {
          confirm.blocked_items.forEach(bi => {
            addMessage(bi.reason, 'nf-msg-error');
          });
        }
        if (confirm.items?.length) {
          if (confirm.items.length === 1) {
            addConfirmCard(confirm.items[0].confirm_text, confirm.items[0].data, tenantId);
          } else {
            addMultiGrnConfirmCard(confirm.items, confirm.supplier_id, tenantId);
          }
        }
      } else if (data.intent === 'create_production_issue') {
        addProductionIssueConfirmCard(confirm.confirm_text, confirm.confirm_data, tenantId);
      } else if (data.intent === 'create_product_dispatch') {
        addDispatchConfirmCard(confirm.confirm_text, confirm.confirm_data, tenantId, 'product_dispatch');
      } else if (data.intent === 'create_rm_dispatch') {
        addDispatchConfirmCard(confirm.confirm_text, confirm.confirm_data, tenantId, 'rm_dispatch');
      } else if (data.intent === 'send_challan') {
        // Write intent, but no confirm card — the edge function already
        // executed the send and confirm_text is the plain result message.
        addMessage(confirm.confirm_text, 'nf-msg-bot');
      } else if (data.intent === 'send_tally_export') {
        // Write intent, but no confirm card — the edge function already sent
        // the export and confirm_text is the plain result message.
        addMessage(confirm.confirm_text, 'nf-msg-bot');
      } else if (data.intent === 'send_invoice') {
        // Write intent, but no confirm card — the edge function already
        // created/sent the invoice and confirm_text is the plain result message.
        addMessage(confirm.confirm_text, 'nf-msg-bot');
      }
    } catch (err) {
      removeTyping();
      addMessage(t('Something went wrong — check your connection and try again.', 'काहीतरी चूक झाली — कनेक्शन तपासा आणि पुन्हा प्रयत्न करा.'), 'nf-msg-error');
    }
  }

  panel.querySelector('#nf-agent-send').addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
})();
