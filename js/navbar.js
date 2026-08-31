(function() {
    'use strict';

    if (window._nexflowNavbarDone || document.getElementById('nx-navbar')) return;
    window._nexflowNavbarDone = true;

    function getCurrentPage() {
        return window.location.pathname.split('/').pop() || 'index.html';
    }

    function isActive(href) {
        const cur = getCurrentPage();
        if (href === 'index.html' && (cur === '' || cur === 'index.html')) return true;
        if (href === 'ca-report.html' && (cur === 'reports.html' || cur === 'ca-report.html')) return true;
        return cur === href;
    }

    const NAV_LINKS = [
        { href: 'index.html',            en: 'Dashboard',   mr: 'डॅशबोर्ड',   page: 'dashboard'   },
        { href: 'grn.html',              en: 'GRN',         mr: 'GRN',        page: 'grn'         },
        { href: 'production-issue.html', en: 'Issue',       mr: 'इश्यू',      page: 'issue'       },
        { href: 'dispatch.html',         en: 'Dispatch',    mr: 'डिस्पॅच',    page: 'dispatch'    },
        { href: 'invoices.html',         en: 'Invoices',    mr: 'इनव्हॉइस',  page: 'invoices'    },
        { href: 'rm-dispatch.html',      en: 'RM Dispatch', mr: 'RM डिस्पॅच', page: 'rm_dispatch' },
        { href: 'products.html',         en: 'Products',    mr: 'उत्पादने',   page: 'products'    },
        { href: 'reports.html',          en: 'Reports',     mr: 'अहवाल',      page: 'reports'     },
        { href: 'scanner.html',          en: '📷 Scanner',  mr: '📷 स्कॅनर', page: 'scanner'     },
        { href: 'settings.html',         en: 'Settings',    mr: 'सेटिंग्ज',   page: 'settings'    }
    ];

    function getInitials(email) {
        if (!email) return '?';
        const name = email.split('@')[0];
        const parts = name.split(/[._-]/);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return name.slice(0, 2).toUpperCase();
    }

    function buildNavbar(role) {
        const visibleLinks = typeof canAccess === 'function'
            ? NAV_LINKS.filter(l => canAccess(role, l.page))
            : NAV_LINKS;

        const linksHTML = visibleLinks.map(l => {
            const active = isActive(l.href) ? ' nx-active' : '';
            return `<a href="${l.href}" class="nx-link${active}" data-en="${l.en}" data-mr="${l.mr}">${l.en}</a>`;
        }).join('');

        const mobileLinksHTML = visibleLinks.map(l => {
            const active = isActive(l.href) ? ' nx-active' : '';
            return `<a href="${l.href}" class="nx-mlink${active}" data-en="${l.en}" data-mr="${l.mr}">${l.en}</a>`;
        }).join('');

        return `
<style>
/* ── NEXFLOW P2 NAVBAR v4 — LEFT DRAWER ── */
#nx-navbar{position:fixed;top:0;left:0;right:0;width:100%;z-index:400;background:rgba(12,14,20,0.97);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border);font-family:var(--font);box-sizing:border-box;overflow:visible}
#nx-navbar::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,92,26,0.16) 35%,rgba(255,92,26,0.16) 65%,transparent);pointer-events:none}

.nx-nav-inner{display:flex;align-items:center;height:56px;padding:0 20px;gap:0;width:100%;box-sizing:border-box}

/* Logo */
.nx-logo{font-family:var(--condensed);font-weight:900;font-size:18px;color:var(--white);text-decoration:none;letter-spacing:1.5px;text-transform:uppercase;white-space:nowrap;flex-shrink:0;line-height:1}
.nx-logo-accent{color:var(--orange)}
.nx-logo-sep{width:1px;height:14px;background:var(--border2);margin:0 18px;flex-shrink:0}

/* Desktop links */
.nx-links{display:flex;align-items:center;gap:0;flex:1;overflow:hidden}
.nx-link{font-family:var(--condensed);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;color:var(--mid);text-decoration:none;padding:0 10px;height:56px;display:flex;align-items:center;white-space:nowrap;transition:color .15s;border-bottom:2px solid transparent;flex-shrink:0}
.nx-link:hover{color:var(--text)}
.nx-link.nx-active{color:var(--orange);border-bottom-color:var(--orange)}

/* Right controls */
.nx-right{display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:auto}

/* Notification bell */
.nx-notif{position:relative;flex-shrink:0}
.nx-notif-bell{position:relative;display:flex;align-items:center;justify-content:center;width:34px;height:34px;background:transparent;border:1px solid var(--border2);border-radius:var(--radius-sm);cursor:pointer;font-size:15px;transition:all .15s;color:var(--mid)}
.nx-notif-bell:hover{border-color:rgba(255,92,26,0.4);color:var(--text)}
.nx-notif-badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;background:var(--orange);color:#fff;border-radius:8px;font-family:var(--condensed);font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1;border:2px solid rgba(12,14,20,0.97)}
.nx-notif-panel{position:absolute;top:calc(100% + 8px);right:0;width:340px;max-height:420px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:0 12px 32px rgba(0,0,0,0.4);overflow:hidden;display:flex;flex-direction:column;z-index:401}
.nx-notif-panel-header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border);flex-shrink:0}
.nx-notif-panel-title{font-family:var(--condensed);font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;color:var(--text)}
.nx-notif-markall{font-family:var(--condensed);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--orange);background:none;border:none;cursor:pointer;padding:0}
.nx-notif-markall:hover{text-decoration:underline}
.nx-notif-list{overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch}
.nx-notif-item{display:flex;gap:10px;padding:11px 14px;border-bottom:1px solid var(--border)}
.nx-notif-item:last-child{border-bottom:none}
.nx-notif-item.unread{background:rgba(255,92,26,0.06)}
.nx-notif-icon{flex-shrink:0;font-size:15px;line-height:1.3}
.nx-notif-body{min-width:0;flex:1}
.nx-notif-title{font-size:12px;font-weight:700;color:var(--text);margin-bottom:2px}
.nx-notif-text{font-size:11.5px;color:var(--mid);line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nx-notif-time{font-size:10px;color:var(--mid);margin-top:3px;opacity:0.7}
.nx-notif-unread-dot{flex-shrink:0;width:6px;height:6px;border-radius:50%;background:var(--orange);margin-top:5px}
.nx-notif-empty{padding:28px 14px;text-align:center;font-size:12px;color:var(--mid)}

/* Language toggle */
.nx-lang{font-family:var(--condensed);font-size:11px;font-weight:800;letter-spacing:0.8px;text-transform:uppercase;color:var(--mid);background:transparent;border:1px solid var(--border2);padding:5px 11px;border-radius:var(--radius-sm);cursor:pointer;transition:all .15s;white-space:nowrap}
.nx-lang:hover{color:var(--orange);border-color:rgba(255,92,26,0.4)}

/* User badge */
.nx-user-badge{display:flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:5px 10px 5px 7px;white-space:nowrap}
.nx-avatar{width:26px;height:26px;background:var(--orange-dim);border:1px solid rgba(255,92,26,0.25);border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:var(--condensed);font-size:10px;font-weight:900;color:var(--orange);flex-shrink:0;letter-spacing:0}
.nx-user-details{display:flex;flex-direction:column;gap:2px}
.nx-user-email{font-size:11px;color:var(--mid);line-height:1;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nx-plan-chip{font-family:var(--condensed);font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;padding:2px 6px;border-radius:3px;background:var(--orange-dim);color:var(--orange);border:1px solid rgba(255,92,26,0.22);width:fit-content;line-height:1.2}
.nx-plan-chip.pro{background:var(--green-dim);color:var(--green);border-color:rgba(34,216,122,0.22)}
.nx-plan-chip.lite{background:rgba(136,146,168,0.12);color:var(--mid);border-color:rgba(136,146,168,0.2)}

/* Manual link — small secondary link, desktop (below email) and mobile drawer (below nav links) */
.nx-manual-link{font-size:11px;color:var(--mid);text-decoration:none;line-height:1.3;background:none;white-space:nowrap;transition:color .15s}
.nx-manual-link:hover{color:var(--text);text-decoration:underline}
.nx-drawer-manual{padding:10px 16px;border-top:1px solid var(--border);flex-shrink:0}

/* Logout */
.nx-logout-btn{font-family:var(--condensed);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;background:transparent;color:var(--mid);border:1px solid var(--border);padding:5px 12px;border-radius:var(--radius-sm);cursor:pointer;transition:all .15s;white-space:nowrap}
.nx-logout-btn:hover{color:var(--red);border-color:rgba(239,68,68,0.4);background:rgba(239,68,68,0.06)}

/* Hamburger */
.nx-burger{display:none;flex-direction:column;gap:4px;background:none;border:1px solid var(--border2);padding:7px 9px;border-radius:var(--radius-sm);cursor:pointer;flex-shrink:0;transition:border-color .15s}
.nx-burger:hover{border-color:var(--orange)}
.nx-burger span{display:block;width:16px;height:1.5px;background:var(--light);border-radius:2px;transition:transform .22s ease,opacity .22s ease}

/* ── LEFT DRAWER OVERLAY ── */
.nx-overlay{display:none;position:fixed;inset:0;z-index:398;background:rgba(0,0,0,0.55);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);opacity:0;transition:opacity .25s ease}
.nx-overlay.open{display:block;opacity:1}

/* Left drawer panel */
.nx-drawer{position:fixed;top:0;left:0;bottom:0;z-index:399;width:272px;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;transform:translateX(-100%);transition:transform .25s cubic-bezier(0.4,0,0.2,1);will-change:transform;overflow:hidden}
.nx-drawer.open{transform:translateX(0)}

/* Drawer header */
.nx-drawer-header{display:flex;align-items:center;justify-content:space-between;padding:0 16px;height:56px;border-bottom:1px solid var(--border);flex-shrink:0}
.nx-drawer-logo{font-family:var(--condensed);font-weight:900;font-size:17px;color:var(--white);text-decoration:none;letter-spacing:1.5px;text-transform:uppercase}
.nx-drawer-logo span{color:var(--orange)}
.nx-drawer-close{background:none;border:1px solid var(--border2);color:var(--mid);width:28px;height:28px;border-radius:var(--radius-sm);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;line-height:1;transition:all .15s;flex-shrink:0}
.nx-drawer-close:hover{color:var(--white);border-color:var(--mid)}

/* Drawer links */
.nx-drawer-links{flex:1;overflow-y:auto;padding:10px 10px 0;-webkit-overflow-scrolling:touch}
.nx-mlink{display:flex;align-items:center;font-family:var(--condensed);font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;color:var(--mid);text-decoration:none;padding:10px 14px;border-radius:var(--radius-sm);border-left:2px solid transparent;transition:all .12s;margin-bottom:2px}
.nx-mlink:hover{color:var(--text);background:var(--surface2)}
.nx-mlink.nx-active{color:var(--orange);border-left-color:var(--orange);background:var(--orange-dim)}

/* Drawer footer */
.nx-drawer-footer{border-top:1px solid var(--border);padding:14px 16px;display:flex;flex-direction:column;gap:10px;flex-shrink:0}
.nx-drawer-user{display:flex;align-items:center;gap:10px}
.nx-drawer-actions{display:flex;gap:8px}
.nx-drawer-actions .nx-lang{flex:1;text-align:center}
.nx-drawer-actions .nx-logout-btn{flex:1;text-align:center}

/* Responsive */
body{padding-top:56px}
@media(max-width:900px){
  .nx-links,.nx-user-badge,.nx-lang,.nx-logout-btn{display:none}
  .nx-drawer .nx-logout-btn{display:block}
  .nx-drawer .nx-lang{display:block}
  .nx-burger{display:flex}
  .nx-nav-inner{padding:0 14px}
  .nx-logo{font-size:16px}
}
@media(max-width:480px){
  #nx-navbar{height:52px}
  .nx-nav-inner{height:52px;padding:0 12px}
  .nx-drawer-header{height:52px}
  body{padding-top:52px}
  .nx-logo{font-size:14px;letter-spacing:1px}
  .nx-notif-panel{position:fixed;top:52px;left:8px;right:8px;width:auto;max-height:70vh}
}
</style>
<nav id="nx-navbar">
  <div class="nx-nav-inner">
    <button class="nx-burger" id="nx-burger" aria-label="Open menu"><span></span><span></span><span></span></button>
    <a href="index.html" class="nx-logo" style="margin-left:12px">NEXFLOW<span class="nx-logo-accent"> P2</span></a>
    <div class="nx-logo-sep"></div>
    <div class="nx-links">${linksHTML}</div>
    <div class="nx-right">
      <button id="nx-lang-btn" class="nx-lang" aria-label="Toggle language">मराठी</button>
      <div class="nx-notif" id="nx-notif">
        <button class="nx-notif-bell" id="nx-notif-bell" aria-label="Notifications">
          🔔
          <span class="nx-notif-badge" id="nx-notif-badge" style="display:none">0</span>
        </button>
        <div class="nx-notif-panel" id="nx-notif-panel" style="display:none">
          <div class="nx-notif-panel-header">
            <span class="nx-notif-panel-title">Notifications</span>
            <button class="nx-notif-markall" id="nx-notif-markall">Mark all read</button>
          </div>
          <div class="nx-notif-list" id="nx-notif-list">
            <div class="nx-notif-empty">No notifications yet.</div>
          </div>
        </div>
      </div>
      <div class="nx-user-badge" id="nx-user-badge" style="display:none">
        <div class="nx-avatar" id="nx-avatar">--</div>
        <div class="nx-user-details">
          <span class="nx-user-email" id="nx-email-text"></span>
          <a href="manual.html" class="nx-manual-link" data-en="📖 Manual" data-mr="📖 मार्गदर्शिका">📖 Manual</a>
          <span class="nx-plan-chip" id="nx-plan-chip"></span>
        </div>
      </div>
      <button class="nx-logout-btn nx-do-logout" data-en="Logout" data-mr="बाहेर पडा">Logout</button>
    </div>
  </div>
</nav>

<!-- Overlay -->
<div class="nx-overlay" id="nx-overlay"></div>

<!-- Left Drawer -->
<div class="nx-drawer" id="nx-drawer">
  <div class="nx-drawer-header">
    <a href="index.html" class="nx-drawer-logo">NEXFLOW<span> P2</span></a>
    <button class="nx-drawer-close" id="nx-drawer-close" aria-label="Close menu">✕</button>
  </div>
  <div class="nx-drawer-links">${mobileLinksHTML}</div>
  <div class="nx-drawer-manual">
    <a href="manual.html" class="nx-manual-link" id="nx-drawer-manual-link" data-en="📖 User Manual" data-mr="📖 वापरकर्ता मार्गदर्शिका">📖 User Manual</a>
  </div>
  <div class="nx-drawer-footer">
    <div class="nx-drawer-user" id="nx-drawer-user" style="display:none">
      <div class="nx-avatar" id="nx-davatar">--</div>
      <div class="nx-user-details">
        <span class="nx-user-email" id="nx-demail-text"></span>
        <span class="nx-plan-chip" id="nx-dplan-chip"></span>
      </div>
    </div>
    <div class="nx-drawer-actions">
      <button id="nx-dlang-btn" class="nx-lang">मराठी</button>
      <button class="nx-logout-btn nx-do-logout">Logout</button>
    </div>
  </div>
</div>`;
    }

    function openDrawer() {
        document.getElementById('nx-drawer')?.classList.add('open');
        document.getElementById('nx-overlay')?.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeDrawer() {
        document.getElementById('nx-drawer')?.classList.remove('open');
        document.getElementById('nx-overlay')?.classList.remove('open');
        document.body.style.overflow = '';
    }

    async function initUserInfo() {
        try {
            if (!window.supabase) return;
            const { data: { user } } = await window.supabase.auth.getUser();
            if (!user) return;

            const initials = getInitials(user.email);

            // Desktop badge
            const badge   = document.getElementById('nx-user-badge');
            const avatar  = document.getElementById('nx-avatar');
            const emailEl = document.getElementById('nx-email-text');
            const planEl  = document.getElementById('nx-plan-chip');
            if (avatar)  avatar.textContent  = initials;
            if (emailEl) emailEl.textContent = user.email;
            if (badge)   badge.style.display = 'flex';

            // Drawer
            const duser  = document.getElementById('nx-drawer-user');
            const davatar= document.getElementById('nx-davatar');
            const demail = document.getElementById('nx-demail-text');
            const dplan  = document.getElementById('nx-dplan-chip');
            if (davatar) davatar.textContent = initials;
            if (demail)  demail.textContent  = user.email;
            if (duser)   duser.style.display = 'flex';

            // Plan badge
            try {
                const { data: t } = await window.supabase
                    .from('p2_tenants').select('plan').eq('id', user.id).single();
                if (t?.plan) {
                    const p = t.plan.toLowerCase();
                    const label = p.toUpperCase();
                    if (planEl) { planEl.textContent = label; planEl.className = `nx-plan-chip ${p}`; }
                    if (dplan)  { dplan.textContent  = label; dplan.className  = `nx-plan-chip ${p}`; }
                }
            } catch(_) {}

            // Logout
            document.querySelectorAll('.nx-do-logout').forEach(btn => {
                btn.addEventListener('click', async () => {
                    await window.supabase.auth.signOut();
                    ['user_role','tenant_id','nexflow_tenant_id'].forEach(k => localStorage.removeItem(k));
                    sessionStorage.removeItem('nexflow_role');
                    window.location.href = 'login.html';
                });
            });

            const lang = localStorage.getItem('nexflow_lang') || 'en';
            if (window.applyLang) window.applyLang(lang);
        } catch(e) { console.error('Navbar user info error:', e); }
    }

    function initLang() {
        const saved = localStorage.getItem('nexflow_lang') || 'en';
        function updateLabel(lang) {
            const label = lang === 'en' ? 'मराठी' : 'English';
            ['nx-lang-btn','nx-dlang-btn'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = label;
            });
        }
        updateLabel(saved);
        ['nx-lang-btn','nx-dlang-btn'].forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('click', () => {
                const cur  = localStorage.getItem('nexflow_lang') || 'en';
                const next = cur === 'en' ? 'mr' : 'en';
                localStorage.setItem('nexflow_lang', next);
                if (window.applyLang) {
                    window.applyLang(next);
                } else {
                    document.querySelectorAll('[data-en]').forEach(el => {
                        if (['INPUT','SELECT','TEXTAREA'].includes(el.tagName))
                            el.placeholder = next === 'mr' ? el.dataset.mr : el.dataset.en;
                        else
                            el.textContent = next === 'mr' ? el.dataset.mr : el.dataset.en;
                    });
                }
                updateLabel(next);
            });
        });
    }

    function initBurger() {
        const burger  = document.getElementById('nx-burger');
        const overlay = document.getElementById('nx-overlay');
        const closeBtn= document.getElementById('nx-drawer-close');

        burger?.addEventListener('click', openDrawer);
        overlay?.addEventListener('click', closeDrawer);
        closeBtn?.addEventListener('click', closeDrawer);

        // Close on link tap
        document.querySelectorAll('.nx-mlink, #nx-drawer-manual-link').forEach(a => {
            a.addEventListener('click', closeDrawer);
        });

        // Close on Escape
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeDrawer();
        });
    }

    let notifTenantId = null;

    function escapeHtmlNotif(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    function notifIcon(type) {
        if (type === 'low_stock') return '⚠️';
        if (type === 'payment_overdue') return '💰';
        return '🔔';
    }

    function timeAgo(iso) {
        const diffMs = Date.now() - new Date(iso).getTime();
        const mins = Math.floor(diffMs / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        return `${days}d ago`;
    }

    function updateNotifBadge(count) {
        const badge = document.getElementById('nx-notif-badge');
        if (!badge) return;
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }

    async function fetchUnreadCount() {
        if (!window.supabase || !notifTenantId) return;
        const { count } = await window.supabase
            .from('p2_notifications')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', notifTenantId)
            .is('read_at', null);
        updateNotifBadge(count || 0);
    }

    async function loadNotifications() {
        const list = document.getElementById('nx-notif-list');
        if (!list || !window.supabase || !notifTenantId) return;

        const { data, error } = await window.supabase
            .from('p2_notifications')
            .select('id, type, title, body, read_at, created_at')
            .eq('tenant_id', notifTenantId)
            .order('created_at', { ascending: false })
            .limit(10);

        if (error || !data || data.length === 0) {
            list.innerHTML = '<div class="nx-notif-empty">No notifications yet.</div>';
            return;
        }

        list.innerHTML = data.map(n => {
            const truncated = n.body.length > 60 ? n.body.slice(0, 60) + '…' : n.body;
            return `<div class="nx-notif-item${n.read_at ? '' : ' unread'}" data-id="${n.id}">
                <span class="nx-notif-icon">${notifIcon(n.type)}</span>
                <div class="nx-notif-body">
                    <div class="nx-notif-title">${escapeHtmlNotif(n.title)}</div>
                    <div class="nx-notif-text">${escapeHtmlNotif(truncated)}</div>
                    <div class="nx-notif-time">${timeAgo(n.created_at)}</div>
                </div>
                ${n.read_at ? '' : '<span class="nx-notif-unread-dot"></span>'}
            </div>`;
        }).join('');

        const visibleIds = data.filter(n => !n.read_at).map(n => n.id);
        if (visibleIds.length > 0) {
            await window.supabase
                .from('p2_notifications')
                .update({ read_at: new Date().toISOString() })
                .in('id', visibleIds)
                .is('read_at', null);
            updateNotifBadge(0);
            list.querySelectorAll('.nx-notif-item.unread').forEach(el => {
                el.classList.remove('unread');
                el.querySelector('.nx-notif-unread-dot')?.remove();
            });
        }
    }

    async function markAllNotifsRead() {
        if (!window.supabase || !notifTenantId) return;
        await window.supabase
            .from('p2_notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('tenant_id', notifTenantId)
            .is('read_at', null);
        updateNotifBadge(0);
        document.querySelectorAll('.nx-notif-item.unread').forEach(el => {
            el.classList.remove('unread');
            el.querySelector('.nx-notif-unread-dot')?.remove();
        });
    }

    function toggleNotifPanel(force) {
        const panel = document.getElementById('nx-notif-panel');
        if (!panel) return;
        const shouldOpen = force !== undefined ? force : panel.style.display === 'none';
        panel.style.display = shouldOpen ? 'flex' : 'none';
        if (shouldOpen) loadNotifications();
    }

    async function initNotifications() {
        if (!window.supabase) return;
        const { data: { user } } = await window.supabase.auth.getUser();
        if (!user) return;
        notifTenantId = user.user_metadata?.tenant_id || user.id;

        await fetchUnreadCount();

        document.getElementById('nx-notif-bell')?.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleNotifPanel();
        });

        document.getElementById('nx-notif-markall')?.addEventListener('click', (e) => {
            e.stopPropagation();
            markAllNotifsRead();
        });

        document.addEventListener('click', (e) => {
            const wrap = document.getElementById('nx-notif');
            if (wrap && !wrap.contains(e.target)) toggleNotifPanel(false);
        });

        // Realtime — increments the badge live, never auto-opens the panel.
        try {
            window.supabase
                .channel('notifications:' + notifTenantId)
                .on('postgres_changes', {
                    event: 'INSERT', schema: 'public', table: 'p2_notifications',
                    filter: `tenant_id=eq.${notifTenantId}`
                }, () => { fetchUnreadCount(); })
                .subscribe();
        } catch (_) {}
    }

    async function initNavbar() {
        document.querySelectorAll('nav').forEach(el => el.remove());
        document.getElementById('nx-overlay')?.remove();
        document.getElementById('nx-drawer')?.remove();

        let c = document.getElementById('navbar-container');
        if (!c) {
            c = document.createElement('div');
            c.id = 'navbar-container';
            document.body.insertBefore(c, document.body.firstChild);
        }

        let role = 'owner';
        try {
            if (window.supabase && typeof fetchUserRole === 'function') {
                const { data: { user } } = await window.supabase.auth.getUser();
                if (user) {
                    const tenantId = user.user_metadata?.tenant_id || user.id;
                    role = await fetchUserRole(user.id, tenantId);
                }
            }
        } catch (_) {}

        c.innerHTML = buildNavbar(role);
        initLang();
        initBurger();
        await initUserInfo();
        await initNotifications();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initNavbar);
    else initNavbar();

    window.initNavbar = initNavbar;
})();