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
        { href: 'index.html',            en: 'Dashboard',   mr: 'डॅशबोर्ड'   },
        { href: 'grn.html',              en: 'GRN',         mr: 'GRN'         },
        { href: 'production-issue.html', en: 'Issue',       mr: 'इश्यू'       },
        { href: 'dispatch.html',         en: 'Dispatch',    mr: 'डिस्पॅच'    },
        { href: 'rm-dispatch.html',      en: 'RM Dispatch', mr: 'RM डिस्पॅच' },
        { href: 'products.html',         en: 'Products',    mr: 'उत्पादने'    },
        { href: 'reports.html',          en: 'Reports',     mr: 'अहवाल'       },
        { href: 'scanner.html',          en: '📷 Scanner',  mr: '📷 स्कॅनर'  },
        { href: 'settings.html',         en: 'Settings',    mr: 'सेटिंग्ज'   }
    ];

    function getInitials(email) {
        if (!email) return '?';
        const name = email.split('@')[0];
        const parts = name.split(/[._-]/);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return name.slice(0, 2).toUpperCase();
    }

    function buildNavbar() {
        const linksHTML = NAV_LINKS.map(l => {
            const active = isActive(l.href) ? ' nx-active' : '';
            return `<a href="${l.href}" class="nx-link${active}" data-en="${l.en}" data-mr="${l.mr}">${l.en}</a>`;
        }).join('');

        const mobileLinksHTML = NAV_LINKS.map(l => {
            const active = isActive(l.href) ? ' nx-active' : '';
            return `<a href="${l.href}" class="nx-mlink${active}" data-en="${l.en}" data-mr="${l.mr}">${l.en}</a>`;
        }).join('');

        return `
<style>
/* ── NEXFLOW P2 NAVBAR v4 — LEFT DRAWER ── */
#nx-navbar{position:fixed;top:0;left:0;right:0;z-index:400;background:rgba(12,14,20,0.97);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border);font-family:var(--font)}
#nx-navbar::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,92,26,0.16) 35%,rgba(255,92,26,0.16) 65%,transparent);pointer-events:none}

.nx-nav-inner{display:flex;align-items:center;height:56px;padding:0 20px;gap:0}

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
.nx-right{display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:12px}

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
      <div class="nx-user-badge" id="nx-user-badge" style="display:none">
        <div class="nx-avatar" id="nx-avatar">--</div>
        <div class="nx-user-details">
          <span class="nx-user-email" id="nx-email-text"></span>
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
        document.querySelectorAll('.nx-mlink').forEach(a => {
            a.addEventListener('click', closeDrawer);
        });

        // Close on Escape
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeDrawer();
        });
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
        c.innerHTML = buildNavbar();
        initLang();
        initBurger();
        await initUserInfo();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initNavbar);
    else initNavbar();

    window.initNavbar = initNavbar;
})();