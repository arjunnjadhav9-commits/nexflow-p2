// js/agent-chat.js
// Two independent floating widgets, both included via:
// <script src="js/agent-chat.js"></script>
// Guard flag prevents double-render if included on a page twice (same
// pattern as navbar.js's window._nexflowNavbarDone).
//
// 1. AI Copilot FAB (buildCopilotWidget) — Pro/Founder plan + agent-role
//    gated, unchanged behaviour from before A4 Phase 1.
// 2. Support FAB (buildSupportWidget) — A4 Phase 1. Available to every
//    logged-in, non-demo user regardless of plan or role: a Lite tenant has
//    no Copilot to ask and is exactly who most needs a way to reach the
//    founder. Deliberately does NOT inherit the Copilot's gate — see the
//    restructure below.

(async function () {
  if (window._nexflowAgentChatDone) return;
  window._nexflowAgentChatDone = true;

  // Resolved once, shared by both widgets. Doesn't wait on the page's own
  // checkAuth() (which may not have run yet at this point in page load).
  let user = null;
  try {
    if (window.supabase) {
      const { data } = await window.supabase.auth.getUser();
      user = data?.user || null;
    }
  } catch (_) {}

  if (!user) return; // no session — neither widget has anything to attach to

  const tenantId = user.user_metadata?.tenant_id || user.id;
  const isDemo = window.isDemo === true;

  function t(en, mr) {
    return (localStorage.getItem('nexflow_lang') === 'mr') ? mr : en;
  }

  // agent-query verifies tenant_id against the caller's real session — every
  // call site must send the logged-in user's own access token, not the bare
  // anon key. Falls back to the anon key only if no session is available,
  // which the server correctly rejects as Unauthorized.
  async function getAuthHeader() {
    const { data: { session } } = await window.supabase.auth.getSession();
    return `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`;
  }

  const EDGE_FUNCTION_URL = 'https://jhqxvpihauvhfclosuxn.supabase.co/functions/v1/agent-query';

  // Copilot FAB eligibility only — this used to be a set of early `return`s
  // that aborted the entire file if any check failed, which meant a Lite
  // tenant (or any role without `agent` access) got no FAB at all and,
  // before A4 Phase 1, no way to reach support from inside the app either.
  // Narrowed to a boolean so it only gates buildCopilotWidget() below.
  let showCopilot = false;
  try {
    if (window.supabase && typeof fetchUserRole === 'function' && typeof canAccess === 'function') {
      const role = await fetchUserRole(user.id, tenantId);
      if (canAccess(role, 'agent')) {
        const { data: settingsData } = await window.supabase
          .from('p2_tenant_settings')
          .select('plan')
          .eq('tenant_id', tenantId)
          .maybeSingle();
        const plan = settingsData?.plan || 'founder';
        showCopilot = (plan === 'pro' || plan === 'founder');
      }
    }
  } catch (_) {
    showCopilot = false;
  }

  // ============================================================
  // Widget 1 — AI Copilot FAB. Internals unchanged from before A4
  // Phase 1 — moved into a function, not rewritten.
  // ============================================================
  function buildCopilotWidget() {
    const ANON_KEY = SUPABASE_ANON_KEY;

    async function getTenantId() {
      // Owner: user.id IS the tenant_id. Invited staff (supervisor is the one
      // non-owner role with agent access, per the gate above) have their own
      // auth uid stamped as user_metadata.tenant_id instead — without this
      // fallback the AI Copilot was broken for that entire role, sending
      // every message under the wrong tenant.
      const { data, error } = await window.supabase.auth.getUser();
      if (error || !data?.user) return null;
      return data.user.user_metadata?.tenant_id || data.user.id;
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
        padding: 8px 10px; border-top: 1px solid var(--border);
        background: var(--surface);
      }
      .nf-search-toggle-btn {
        display: flex; align-items: center; justify-content: center; gap: 6px;
        width: 100%; background: var(--surface2); border: 1px solid var(--border2);
        color: var(--light); font-size: 13px; font-family: var(--font);
        padding: 7px 10px; border-radius: 20px; cursor: pointer;
        transition: border-color 0.15s, color 0.15s;
      }
      .nf-search-toggle-btn:hover { border-color: var(--orange); color: var(--orange); }
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

    // Fetches the full active-material list (ordered by lowest stock first)
    // for the search panel behind the "Search materials" toggle button.
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

      const moreBtn = document.createElement('button');
      moreBtn.className = 'nf-search-toggle-btn';
      moreBtn.textContent = t('🔍 Search materials', '🔍 साहित्य शोधा');
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
          headers: { 'Content-Type': 'application/json', 'Authorization': await getAuthHeader() },
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
          addMessage(t("I don't have information on that. Try checking the relevant page in the app — Stock, Dispatch, GRN, or Reports.", 'त्याबद्दल माहिती नाही. अॅपमधील योग्य पेज तपासा — Stock, Dispatch, GRN किंवा Reports.'), 'nf-msg-bot');
          return;
        }

        const confirm = data.confirm;
        if (!confirm) {
          addMessage(t('No response generated.', 'प्रतिसाद मिळाला नाही.'), 'nf-msg-error');
          return;
        }

        // Every intent is read-only — the backend always returns
        // { status: 'ready', confirm_text }, so there's nothing left to branch on.
        addMessage(confirm.confirm_text, 'nf-msg-bot');
      } catch (err) {
        removeTyping();
        addMessage(t('Something went wrong — check your connection and try again.', 'काहीतरी चूक झाली — कनेक्शन तपासा आणि पुन्हा प्रयत्न करा.'), 'nf-msg-error');
      }
    }

    panel.querySelector('#nf-agent-send').addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
  }

  // ============================================================
  // Widget 2 — Support FAB. New, A4 Phase 1. Bottom-left, so it
  // never collides with the Copilot FAB (bottom-right).
  // ============================================================
  function buildSupportWidget() {
    const THREAD_KEY = `nexflow_support_thread_${tenantId}`;

    const style = document.createElement('style');
    style.textContent = `
      #nf-support-fab {
        position: fixed; bottom: calc(20px + env(safe-area-inset-bottom, 0px)); left: 20px; z-index: 500;
        width: 48px; height: 48px; border-radius: 50%;
        background: var(--surface2); border: 1px solid var(--border2);
        box-shadow: var(--shadow-md);
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; color: var(--text); font-size: 20px;
        transition: transform 0.15s ease, border-color 0.15s ease;
      }
      #nf-support-fab:hover { transform: scale(1.06); border-color: var(--orange); }
      #nf-support-panel {
        position: fixed; bottom: calc(80px + env(safe-area-inset-bottom, 0px)); left: 20px; z-index: 500;
        width: 340px; max-width: calc(100vw - 32px); max-height: calc(100vh - 120px);
        background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
        box-shadow: var(--shadow-md);
        display: none; flex-direction: column; overflow: hidden;
        font-family: var(--font);
      }
      #nf-support-header {
        background: var(--surface); border-bottom: 2px solid var(--orange);
        color: var(--text); padding: 10px 14px; font-weight: 700; font-size: 14px;
        display: flex; justify-content: space-between; align-items: center;
      }
      #nf-support-close { background: none; border: none; color: var(--mid); font-size: 20px; cursor: pointer; }
      #nf-support-close:hover { color: var(--text); }
      #nf-support-tabs { display: flex; border-bottom: 1px solid var(--border); }
      .nf-support-tab {
        flex: 1; text-align: center; padding: 9px; font-size: 13px; font-family: var(--font);
        background: none; border: none; color: var(--mid); cursor: pointer;
        border-bottom: 2px solid transparent;
      }
      .nf-support-tab.active { color: var(--orange); border-bottom-color: var(--orange); }
      #nf-support-body { padding: 12px; display: flex; flex-direction: column; gap: 8px; max-height: 60vh; overflow-y: auto; }
      #nf-support-body textarea, #nf-support-body input {
        background: var(--surface2); border: 1px solid var(--border2); color: var(--text);
        border-radius: var(--radius-sm); padding: 8px 10px; font-size: 13px; font-family: var(--font);
        width: 100%; box-sizing: border-box;
      }
      #nf-support-body textarea { min-height: 70px; resize: vertical; }
      #nf-support-body label { font-size: 11px; color: var(--mid); text-transform: uppercase; letter-spacing: 0.5px; }
      .nf-support-submit {
        background: var(--orange); border: none; color: var(--white); font-size: 13px; font-weight: 600;
        border-radius: 20px; padding: 9px; cursor: pointer; font-family: var(--font);
      }
      .nf-support-submit:disabled { opacity: 0.5; cursor: not-allowed; }
      .nf-support-status { font-size: 12px; color: var(--mid); }
      .nf-support-status.ok { color: var(--green, #2e9e5b); }
      .nf-support-status.error { color: var(--red, #d64545); }
    `;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'nf-support-fab';
    fab.title = t('Contact support', 'सपोर्ट संपर्क');
    fab.textContent = '🛟';
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'nf-support-panel';
    panel.innerHTML = `
      <div id="nf-support-header">
        <span>${t('Support', 'सपोर्ट')}</span>
        <button id="nf-support-close">×</button>
      </div>
      <div id="nf-support-tabs">
        <button class="nf-support-tab active" data-tab="question">${t('Ask a question', 'प्रश्न विचारा')}</button>
        <button class="nf-support-tab" data-tab="bug">${t('Report a bug', 'तक्रार नोंदवा')}</button>
      </div>
      <div id="nf-support-body">
        <div id="nf-support-question-tab">
          <textarea id="nf-support-question-input" placeholder="${t('What do you need help with?', 'तुम्हाला काय मदत हवी आहे?')}"></textarea>
          <button class="nf-support-submit" id="nf-support-question-send">${t('Send', 'पाठवा')}</button>
          <div class="nf-support-status" id="nf-support-question-status"></div>
        </div>
        <div id="nf-support-bug-tab" style="display:none;">
          <label>${t('What were you trying to do?', 'तुम्ही काय करत होता?')}</label>
          <input id="nf-support-bug-action" type="text" />
          <label>${t('What did you expect to happen?', 'काय होणे अपेक्षित होते?')}</label>
          <input id="nf-support-bug-expected" type="text" />
          <label>${t('What actually happened?', 'प्रत्यक्षात काय झाले?')}</label>
          <input id="nf-support-bug-actual" type="text" />
          <button class="nf-support-submit" id="nf-support-bug-send">${t('Submit', 'सबमिट करा')}</button>
          <div class="nf-support-status" id="nf-support-bug-status"></div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    let isOpen = false;
    function openPanel() {
      isOpen = true;
      fab.style.display = 'none';
      panel.style.display = 'flex';
    }
    function closePanel() {
      isOpen = false;
      panel.style.display = 'none';
      fab.style.display = 'flex';
    }
    fab.addEventListener('click', () => { if (isOpen) closePanel(); else openPanel(); });
    panel.querySelector('#nf-support-close').addEventListener('click', closePanel);

    panel.querySelectorAll('.nf-support-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.nf-support-tab').forEach((el) => el.classList.remove('active'));
        tab.classList.add('active');
        const isQuestion = tab.dataset.tab === 'question';
        panel.querySelector('#nf-support-question-tab').style.display = isQuestion ? 'block' : 'none';
        panel.querySelector('#nf-support-bug-tab').style.display = isQuestion ? 'none' : 'block';
      });
    });

    async function postSupportAction(payload) {
      const res = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': await getAuthHeader() },
        body: JSON.stringify(payload),
      });
      return res.json().catch(() => ({ status: 'error', error: 'Invalid response' }));
    }

    // Ask a question — double-submit guard on the Send button per this
    // codebase's standing convention (grn.html, dispatch.html, etc.), not a
    // server-side dedupe key, since opsAlert's own dedupe would otherwise
    // have to be reused for a purpose it isn't suited to (see the escalation
    // path notes in agent-query's submitSupportMessage).
    const questionInput = panel.querySelector('#nf-support-question-input');
    const questionSendBtn = panel.querySelector('#nf-support-question-send');
    const questionStatus = panel.querySelector('#nf-support-question-status');

    questionSendBtn.addEventListener('click', async () => {
      const message = questionInput.value.trim();
      if (!message) return;
      questionSendBtn.disabled = true;
      questionStatus.className = 'nf-support-status';
      questionStatus.textContent = t('Sending...', 'पाठवत आहे...');
      try {
        const existingThreadId = localStorage.getItem(THREAD_KEY) || null;
        const data = await postSupportAction({
          action: 'submit_support_message',
          tenant_id: tenantId,
          thread_id: existingThreadId,
          message,
          lang: localStorage.getItem('nexflow_lang') === 'mr' ? 'mr' : 'en',
        });
        if (data.status === 'ok' && data.thread_id) {
          localStorage.setItem(THREAD_KEY, data.thread_id);
          questionInput.value = '';
          questionStatus.className = 'nf-support-status ok';
          questionStatus.textContent = t("Sent. We'll get back to you soon.", 'पाठवले. आम्ही लवकरच उत्तर देऊ.');
        } else {
          questionStatus.className = 'nf-support-status error';
          questionStatus.textContent = data.error || t('Something went wrong.', 'काहीतरी चूक झाली.');
        }
      } catch (err) {
        questionStatus.className = 'nf-support-status error';
        questionStatus.textContent = t('Something went wrong — check your connection and try again.', 'काहीतरी चूक झाली — कनेक्शन तपासा आणि पुन्हा प्रयत्न करा.');
      } finally {
        questionSendBtn.disabled = false;
      }
    });

    // Report a bug
    const bugActionInput = panel.querySelector('#nf-support-bug-action');
    const bugExpectedInput = panel.querySelector('#nf-support-bug-expected');
    const bugActualInput = panel.querySelector('#nf-support-bug-actual');
    const bugSendBtn = panel.querySelector('#nf-support-bug-send');
    const bugStatus = panel.querySelector('#nf-support-bug-status');

    bugSendBtn.addEventListener('click', async () => {
      const action_taken = bugActionInput.value.trim();
      const expected = bugExpectedInput.value.trim();
      const actual = bugActualInput.value.trim();
      if (!action_taken || !expected || !actual) {
        bugStatus.className = 'nf-support-status error';
        bugStatus.textContent = t('Please fill in all three fields.', 'कृपया तिन्ही रकाने भरा.');
        return;
      }
      bugSendBtn.disabled = true;
      bugStatus.className = 'nf-support-status';
      bugStatus.textContent = t('Submitting...', 'सबमिट करत आहे...');
      try {
        const data = await postSupportAction({
          action: 'submit_bug_report',
          tenant_id: tenantId,
          page: location.pathname,
          action_taken,
          expected,
          actual,
          browser: navigator.userAgent,
        });
        if (data.status === 'ok') {
          bugActionInput.value = '';
          bugExpectedInput.value = '';
          bugActualInput.value = '';
          bugStatus.className = 'nf-support-status ok';
          bugStatus.textContent = t('Reported. Thank you.', 'तक्रार नोंदवली. धन्यवाद.');
        } else {
          bugStatus.className = 'nf-support-status error';
          bugStatus.textContent = data.error || t('Something went wrong.', 'काहीतरी चूक झाली.');
        }
      } catch (err) {
        bugStatus.className = 'nf-support-status error';
        bugStatus.textContent = t('Something went wrong — check your connection and try again.', 'काहीतरी चूक झाली — कनेक्शन तपासा आणि पुन्हा प्रयत्न करा.');
      } finally {
        bugSendBtn.disabled = false;
      }
    });
  }

  if (showCopilot) buildCopilotWidget();
  if (!isDemo) buildSupportWidget();
})();
