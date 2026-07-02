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
        { href: 'index.html',            en: 'Dashboard',   mr: 'डॅशबोर्ड'    },
        { href: 'grn.html',              en: 'GRN',         mr: 'GRN'          },
        { href: 'production-issue.html', en: 'Issue',       mr: 'इश्यू'        },
        { href: 'dispatch.html',         en: 'Dispatch',    mr: 'डिस्पॅच'     },
        { href: 'rm-dispatch.html',      en: 'RM Dispatch', mr: 'RM डिस्पॅच'  },
        { href: 'products.html',         en: 'Products',    mr: 'उत्पादने'     },
        { href: 'reports.html',          en: 'Reports',     mr: 'अहवाल'        },
        { href: 'scanner.html',          en: '📷 Scanner',  mr: '📷 स्कॅनर'   },
        { href: 'settings.html',         en: 'Settings',    mr: 'सेटिंग्ज'    }
    ];

    function buildNavbar() {
        const linksHTML = NAV_LINKS.map(l => {
            const active = isActive(l.href) ? ' nx-active' : '';
            return `<a href="${l.href}" class="nx-link${active}" data-en="${l.en}" data-mr="${l.mr}">${l.en}</a>`;
        }).join('');

        const mobileLinksHTML = NAV_LINKS.map(l => {
            const active = isActive(l.href) ? ' nx-active' : '';
            return `<a href="${l.href}" class="nx-link nx-mlink${active}" data-en="${l.en}" data-mr="${l.mr}">${l.en}</a>`;
        }).join('');

        return `
<style>
.nx-nav{position:fixed;top:0;left:0;right:0;z-index:400;background:var(--surface);border-bottom:1px solid var(--border);font-family:var(--font)}
.nx-nav-inner{display:grid;grid-template-columns:180px 1fr 300px;align-items:center;padding:0 28px;height:56px}
.nx-logo{font-family:var(--condensed);font-weight:900;font-size:20px;color:var(--white);text-decoration:none;letter-spacing:1px;white-space:nowrap}
.nx-logo span{color:var(--orange)}
.nx-links{display:flex;align-items:center;gap:4px;justify-content:center}
.nx-link{font-family:var(--condensed);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--mid);text-decoration:none;padding:7px 11px;border-radius:6px;white-space:nowrap;transition:color .15s,background .15s}
.nx-link:hover{color:var(--white);background:var(--surface2)}
.nx-link.nx-active{color:var(--orange)}
.nx-right{display:flex;align-items:center;gap:10px;justify-content:flex-end}
.nx-lang{font-family:var(--condensed);font-size:12px;font-weight:700;background:var(--surface2);border:1px solid var(--border2);color:var(--white);padding:5px 14px;border-radius:6px;cursor:pointer;white-space:nowrap;transition:border-color .15s}
.nx-lang:hover{border-color:var(--orange);color:var(--orange)}
.nx-email{font-size:12px;color:var(--mid);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px}
.nx-plan{font-family:var(--condensed);font-size:10px;font-weight:800;text-transform:uppercase;background:var(--orange);color:#fff;padding:2px 8px;border-radius:4px}
.nx-plan.pro{background:var(--green)}
.nx-plan.lite{background:var(--mid)}
.nx-logout{font-family:var(--condensed);font-size:12px;font-weight:800;text-transform:uppercase;background:#dc2626;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;letter-spacing:0.5px}
.nx-logout:hover{background:#b91c1c}
.nx-burger{display:none;flex-direction:column;gap:5px;background:none;border:none;cursor:pointer;padding:4px}
.nx-burger span{display:block;width:20px;height:2px;background:var(--white);border-radius:2px}
.nx-mobile{display:none;flex-direction:column;background:var(--surface);border-top:1px solid var(--border);padding:12px 20px 16px}
.nx-mobile.open{display:flex}
.nx-mlinks{display:flex;flex-direction:column;gap:2px;margin-bottom:12px}
.nx-mlink{display:block;padding:10px 12px;border-radius:6px}
.nx-mfooter{border-top:1px solid var(--border);padding-top:12px;display:flex;flex-direction:column;gap:8px}
body{padding-top:56px}
@media(max-width:900px){.nx-links{display:none}.nx-right .nx-email,.nx-right .nx-plan,.nx-right .nx-lang{display:none}.nx-burger{display:flex}}
</style>
<nav id="nx-navbar" class="nx-nav">
  <div class="nx-nav-inner">
    <a href="index.html" class="nx-logo">NEXFLOW <span>P2</span></a>
    <div class="nx-links">${linksHTML}</div>
    <div class="nx-right">
      <button id="nx-lang" class="nx-lang">मराठी</button>
      <span class="nx-email" id="nx-email"></span>
      <span id="nx-plan"></span>
      <button class="nx-logout nx-do-logout" data-en="Logout" data-mr="बाहेर पडा">LOGOUT</button>
      <button class="nx-burger" id="nx-burger"><span></span><span></span><span></span></button>
    </div>
  </div>
  <div class="nx-mobile" id="nx-mobile">
    <div class="nx-mlinks">${mobileLinksHTML}</div>
    <div class="nx-mfooter">
      <button id="nx-mlang" class="nx-lang">मराठी</button>
      <span id="nx-memail" style="font-size:12px;color:var(--mid)"></span>
      <button class="nx-logout nx-do-logout" style="width:100%">LOGOUT</button>
    </div>
  </div>
</nav>`;
    }

    async function initUserInfo() {
        try {
            if (!window.supabase) return;
            const { data: { user } } = await window.supabase.auth.getUser();
            if (!user) return;

            const emailEl  = document.getElementById('nx-email');
            const memailEl = document.getElementById('nx-memail');
            const planEl   = document.getElementById('nx-plan');
            if (emailEl)  emailEl.textContent  = user.email;
            if (memailEl) memailEl.textContent  = user.email;

            try {
                const { data: t } = await window.supabase
                    .from('p2_tenants').select('plan').eq('id', user.id).single();
                if (t?.plan && planEl) {
                    const p = t.plan.toLowerCase();
                    planEl.className = `nx-plan ${p}`;
                    planEl.textContent = p.toUpperCase();
                }
            } catch(_) {}

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
        function update(lang) {
            const label = lang === 'en' ? 'मराठी' : 'English';
            ['nx-lang','nx-mlang'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = label;
            });
        }
        update(saved);
        ['nx-lang','nx-mlang'].forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('click', () => {
                const cur = localStorage.getItem('nexflow_lang') || 'en';
                const next = cur === 'en' ? 'mr' : 'en';
                localStorage.setItem('nexflow_lang', next);
                if (window.applyLang) window.applyLang(next);
                else document.querySelectorAll('[data-en]').forEach(el => {
                    if (['INPUT','SELECT','TEXTAREA'].includes(el.tagName))
                        el.placeholder = next === 'mr' ? el.dataset.mr : el.dataset.en;
                    else el.textContent = next === 'mr' ? el.dataset.mr : el.dataset.en;
                });
                update(next);
            });
        });
    }

    function initBurger() {
        const btn  = document.getElementById('nx-burger');
        const menu = document.getElementById('nx-mobile');
        if (!btn || !menu) return;
        btn.addEventListener('click', () => menu.classList.toggle('open'));
        document.addEventListener('click', e => {
            if (!document.getElementById('nx-navbar')?.contains(e.target))
                menu.classList.remove('open');
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