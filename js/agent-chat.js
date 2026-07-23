// js/agent-chat.js
// Floating AI Copilot chat widget. Include via:
// <script src="js/agent-chat.js"></script>
// Guard flag prevents double-render if included on a page twice (same
// pattern as navbar.js's window._nexflowNavbarDone).

(function () {
  if (window._nexflowAgentChatDone) return;
  window._nexflowAgentChatDone = true;

  const EDGE_FUNCTION_URL = 'https://jhqxvpihauvhfclosuxn.supabase.co/functions/v1/agent-query';
  const ANON_KEY = SUPABASE_ANON_KEY;

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
    .nf-confirm-text { font-size: 14px; color: var(--text); line-height: 1.5; }
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
    @media (max-width: 480px) {
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
    panel.classList.remove('nf-panel-closing');
    panel.style.display = 'flex';
    requestAnimationFrame(() => panel.classList.add('nf-panel-visible'));
    if (!hasShownWelcome) {
      hasShownWelcome = true;
      addMessage(
        t(
          'Hi! Ask me about stock, GRNs, consumption, suppliers, dispatches, or if you have enough stock to produce.',
          'नमस्कार! स्टॉक, GRN, वापर, पुरवठादार, dispatch किंवा production साठी stock विचारा.'
        ),
        'nf-msg-bot'
      );
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
        } else {
          addMessage(data.error || t('Could not save. Please try again.', 'जतन करता आले नाही. पुन्हा प्रयत्न करा.'), 'nf-msg-error');
        }
      } catch (err) {
        card.remove();
        addMessage(t('Something went wrong — check your connection and try again.', 'काहीतरी चूक झाली — कनेक्शन तपासा आणि पुन्हा प्रयत्न करा.'), 'nf-msg-error');
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
        'issue_detail', 'bom_detail', 'top_supplier'
      ];
      if (READ_ONLY_TEXT_INTENTS.includes(data.intent)) {
        // Informational only — no write, no confirm button needed.
        addMessage(confirm.confirm_text, 'nf-msg-bot');
      } else if (data.intent === 'create_grn') {
        // Show unresolved items as errors first, then a confirm card per
        // matched item — one message can report several materials at once.
        if (confirm.blocked_items?.length) {
          confirm.blocked_items.forEach(bi => {
            addMessage(bi.reason, 'nf-msg-error');
          });
        }
        if (confirm.items?.length) {
          confirm.items.forEach(item => {
            addConfirmCard(item.confirm_text, item.data, tenantId);
          });
        }
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
