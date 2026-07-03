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
/* ── NEXFLOW P2 NAVBAR v3 ── */
#nx-navbar{position:fixed;top:0;left:0;right:0;z-index:400;background:rgba(12,14,20,0.97);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border);font-family:var(--font)}
#nx-navbar::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,92,26,0.16) 35%,rgba(255,92,26,0.16) 65%,transparent);pointer-events:none}

/* Inner layout */
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
.nx-burger span{display:block;width:16px;height:1.5px;background:var(--light);border-radius:2px;transition:all .2s}

/* Mobile drawer */
.nx-mobile{display:none;flex-direction:column;position:fixed;top:56px;left:0;right:0;z-index:399;background:rgba(12,14,20,0.98);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border);padding:8px 0 20px;max-height:calc(100vh - 56px);overflow-y:auto;-webkit-overflow-scrolling:touch}
.nx-mobile.open{display:flex}
.nx-mlinks{display:flex;flex-direction:column;gap:1px;padding:0 10px}
.nx-mlink{display:flex;align-items:center;font-family:var(--condensed);font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;color:var(--mid);text-decoration:none;padding:10px 12px;border-radius:var(--radius-sm);border-left:2px solid transparent;transition:all .1s}
.nx-mlink:hover{color:var(--text);background:var(--surface2)}
.nx-mlink.nx-active{color:var(--orange);border-left-color:var(--orange);background:var(--orange-dim)}
.nx-mdiv{height:1px;background:var(--border);margin:10px 10px}
.nx-mfooter{padding:0 10px;display:flex;flex-direction:column;gap:10px}
.nx-muser{display:flex;align-items:center;gap:10px;padding:6px 2px}
.nx-mactions{display:flex;gap:8px}
.nx-mactions .nx-lang{flex:1;text-align:center}
.nx-mactions .nx-logout-btn{flex:1;text-align:center}

/* Responsive */
body{padding-top:56px}
@media(max-width:900px){
  .nx-links,.nx-user-badge,.nx-lang,.nx-logout-btn{display:none}
  .nx-burger{display:flex}
  .nx-nav-inner{padding:0 14px}
  .nx-logo{font-size:16px}
}
@media(max-width:480px){
  #nx-navbar{height:52px}
  .nx-nav-inner{height:52px;padding:0 12px}
  .nx-mobile{top:52px}
  body{padding-top:52px}
  .nx-logo{font-size:14px;letter-spacing:1px}
}
</style>
<nav id="nx-navbar">
  <div class="nx-nav-inner">
    <a href="index.html" class="nx-logo">NEXFLOW<span class="nx-logo-accent"> P2</span></a>
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
      <button class="nx-burger" id="nx-burger" aria-label="Toggle menu"><span></span><span></span><span></span></button>
    </div>
  </div>
  <div class="nx-mobile" id="nx-mobile">
    <div class="nx-mlinks">${mobileLinksHTML}</div>
    <div class="nx-mdiv"></div>
    <div class="nx-mfooter">
      <div class="nx-muser" id="nx-muser" style="display:none">
        <div class="nx-avatar" id="nx-mavatar">--</div>
        <div class="nx-user-details">
          <span class="nx-user-email" id="nx-memail-text"></span>
          <span class="nx-plan-chip" id="nx-mplan-chip"></span>
        </div>
      </div>
      <div class="nx-mactions">
        <button id="nx-mlang-btn" class="nx-lang">मराठी</button>
        <button class="nx-logout-btn nx-do-logout">Logout</button>
      </div>
    </div>
  </div>
</nav>`;
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

            // Mobile
            const muser   = document.getElementById('nx-muser');
            const mavatar = document.getElementById('nx-mavatar');
            const memail  = document.getElementById('nx-memail-text');
            const mplan   = document.getElementById('nx-mplan-chip');
            if (mavatar) mavatar.textContent = initials;
            if (memail)  memail.textContent  = user.email;
            if (muser)   muser.style.display = 'flex';

            // Plan badge
            try {
                const { data: t } = await window.supabase
                    .from('p2_tenants').select('plan').eq('id', user.id).single();
                if (t?.plan) {
                    const p = t.plan.toLowerCase();
                    const label = p.toUpperCase();
                    if (planEl)  { planEl.textContent  = label; planEl.className  = `nx-plan-chip ${p}`; }
                    if (mplan)   { mplan.textContent   = label; mplan.className   = `nx-plan-chip ${p}`; }
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

            // Apply saved lang
            const lang = localStorage.getItem('nexflow_lang') || 'en';
            if (window.applyLang) window.applyLang(lang);
        } catch(e) { console.error('Navbar user info error:', e); }
    }

    function initLang() {
        const saved = localStorage.getItem('nexflow_lang') || 'en';
        function updateLabel(lang) {
            const label = lang === 'en' ? 'मराठी' : 'English';
            ['nx-lang-btn','nx-mlang-btn'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = label;
            });
        }
        updateLabel(saved);
        ['nx-lang-btn','nx-mlang-btn'].forEach(id => {
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
        const btn  = document.getElementById('nx-burger');
        const menu = document.getElementById('nx-mobile');
        if (!btn || !menu) return;

        btn.addEventListener('click', e => {
            e.stopPropagation();
            const isOpen = menu.classList.toggle('open');
            // Animate burger to X
            const spans = btn.querySelectorAll('span');
            if (isOpen) {
                spans[0].style.transform = 'translateY(5.5px) rotate(45deg)';
                spans[1].style.opacity   = '0';
                spans[2].style.transform = 'translateY(-5.5px) rotate(-45deg)';
            } else {
                spans.forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
            }
        });

        // Close on mobile link tap
        menu.querySelectorAll('a').forEach(a => {
            a.addEventListener('click', () => {
                menu.classList.remove('open');
                btn.querySelectorAll('span').forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
            });
        });

        // Close on outside tap
        document.addEventListener('click', e => {
            if (!document.getElementById('nx-navbar')?.contains(e.target)) {
                menu.classList.remove('open');
                btn.querySelectorAll('span').forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
            }
        });
    }

    async function initNavbar() {
        document.querySelectorAll('nav').forEach(el => el.remove());
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
