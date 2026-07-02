// navbar.js — Nexflow P2 shared navbar
// Uses nexflow-design.css variables only. No Tailwind.
// Double-render safe via DOM check + window flag.

(function () {
    'use strict';

    // ── GUARD ────────────────────────────────────────────────────
    // Check BOTH the window flag AND whether the nav already exists in DOM.
    // The window flag alone fails if the script tag appears twice because both
    // IIFEs start executing before either sets the flag.
    if (window._nexflowNavbarDone || document.getElementById('nx-navbar')) return;
    window._nexflowNavbarDone = true;

    // ── HELPERS ──────────────────────────────────────────────────
    function getCurrentPage() {
        return window.location.pathname.split('/').pop() || 'index.html';
    }

    function isActive(href) {
        const cur = getCurrentPage();
        if (href === 'index.html' && (cur === '' || cur === 'index.html')) return true;
        if (href === 'ca-report.html' && (cur === 'reports.html' || cur === 'ca-report.html')) return true;
        return cur === href;
    }

    // ── NAV LINKS ────────────────────────────────────────────────
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

    // ── BUILD HTML ───────────────────────────────────────────────
    function buildNavbar() {
        const linksHTML = NAV_LINKS.map(l => {
            const active = isActive(l.href) ? ' nx-nav-link--active' : '';
            return `<a href="${l.href}" class="nx-nav-link${active}" data-en="${l.en}" data-mr="${l.mr}">${l.en}</a>`;
        }).join('');

        const mobileLinksHTML = NAV_LINKS.map(l => {
            const active = isActive(l.href) ? ' nx-nav-link--active' : '';
            return `<a href="${l.href}" class="nx-nav-link nx-nav-mobile-link${active}" data-en="${l.en}" data-mr="${l.mr}">${l.en}</a>`;
        }).join('');

        return `
<nav id="nx-navbar" class="nx-nav">
  <div class="nx-nav-inner">

    <!-- Logo -->
    <a href="index.html" class="nx-nav-logo">
      NEXFLOW <span>P2</span>
    </a>

    <!-- Desktop links -->
    <div class="nx-nav-links" id="nx-nav-links">
      ${linksHTML}
    </div>

    <!-- Right side -->
    <div class="nx-nav-right">
      <button id="nx-lang-btn" class="nx-btn-lang">मराठी</button>
      <div id="nx-user-info" class="nx-nav-user"></div>
      <!-- Hamburger -->
      <button id="nx-hamburger" class="nx-hamburger" aria-label="Menu">
        <span></span><span></span><span></span>
      </button>
    </div>

  </div>

  <!-- Mobile drawer -->
  <div id="nx-mobile-menu" class="nx-mobile-menu" aria-hidden="true">
    <div class="nx-mobile-links">
      ${mobileLinksHTML}
    </div>
    <div class="nx-mobile-footer">
      <button id="nx-mobile-lang-btn" class="nx-btn-lang" style="width:100%;">मराठी</button>
      <div id="nx-mobile-user-info" style="margin-top:10px;"></div>
    </div>
  </div>
</nav>

<style>
/* ── NEXFLOW NAVBAR — no Tailwind, pure CSS vars ── */
.nx-nav {
  position: sticky; top: 0; z-index: 400;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  font-family: var(--font);
}
.nx-nav-inner {
  display: flex; align-items: center;
  padding: 0 20px; height: 52px;
}
.nx-nav-logo {
  font-family: var(--condensed); font-weight: 900; font-size: 18px;
  color: var(--white); text-decoration: none; letter-spacing: 0.5px;
  white-space: nowrap; flex-shrink: 0;
}
.nx-nav-logo span { color: var(--orange); }

/* Desktop links — centered */
.nx-nav-links {
  display: flex; align-items: center; gap: 2px;
  flex: 1; justify-content: center; overflow: hidden;
}
.nx-nav-link {
  font-family: var(--condensed); font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--mid); text-decoration: none;
  padding: 6px 8px; border-radius: var(--radius-sm);
  white-space: nowrap; transition: color 0.15s, background 0.15s;
}
.nx-nav-link:hover { color: var(--white); background: var(--surface2); }
.nx-nav-link--active { color: var(--orange) !important; }

/* Right side */
.nx-nav-right {
  display: flex; align-items: center; gap: 10px;
  flex-shrink: 0; margin-left: 12px;
}
.nx-nav-user {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--mid); white-space: nowrap;
}
.nx-btn-lang {
  font-family: var(--condensed); font-size: 12px; font-weight: 700;
  background: var(--surface2); border: 1px solid var(--border2);
  color: var(--white); padding: 5px 12px; border-radius: var(--radius-sm);
  cursor: pointer; white-space: nowrap; transition: border-color 0.15s;
}
.nx-btn-lang:hover { border-color: var(--orange); color: var(--orange); }

/* Plan badge — shown in user info */
.nx-plan-badge {
  font-family: var(--condensed); font-size: 10px; font-weight: 800;
  text-transform: uppercase; letter-spacing: 0.5px;
  background: var(--orange); color: #fff;
  padding: 2px 8px; border-radius: 4px;
}
.nx-plan-badge.founder { background: var(--orange); }
.nx-plan-badge.pro     { background: var(--green);  }
.nx-plan-badge.lite    { background: var(--mid);    }

/* Logout btn */
.nx-logout-btn {
  font-family: var(--condensed); font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.5px;
  background: var(--red, #ef4444); color: #fff;
  border: none; padding: 5px 12px; border-radius: var(--radius-sm);
  cursor: pointer; transition: opacity 0.15s;
}
.nx-logout-btn:hover { opacity: 0.85; }

/* Hamburger */
.nx-hamburger {
  display: none; flex-direction: column; gap: 5px;
  background: none; border: none; cursor: pointer; padding: 4px;
}
.nx-hamburger span {
  display: block; width: 20px; height: 2px;
  background: var(--white); border-radius: 2px; transition: 0.2s;
}

/* Mobile menu */
.nx-mobile-menu {
  display: none; flex-direction: column;
  background: var(--surface); border-top: 1px solid var(--border);
  padding: 12px 20px 16px;
}
.nx-mobile-menu.open { display: flex; }
.nx-mobile-links {
  display: flex; flex-direction: column; gap: 2px; margin-bottom: 14px;
}
.nx-nav-mobile-link { display: block; padding: 10px 12px; border-radius: var(--radius-sm); }
.nx-mobile-footer { border-top: 1px solid var(--border); padding-top: 12px; }

/* ── RESPONSIVE ── */
@media (max-width: 900px) {
  .nx-nav-links { display: none; }
  .nx-nav-user  { display: none; }
  .nx-btn-lang  { display: none; }
  .nx-hamburger { display: flex; }
}
</style>
        `;
    }

    // ── USER INFO ────────────────────────────────────────────────
    async function initUserInfo() {
        try {
            if (!window.supabase) return;
            const { data: { user } } = await window.supabase.auth.getUser();
            if (!user) return;

            // Fetch plan from p2_tenants
            let planLabel = '';
            try {
                const { data: tenant } = await window.supabase
                    .from('p2_tenants')
                    .select('plan')
                    .eq('id', user.id)
                    .single();
                if (tenant?.plan) {
                    const p = tenant.plan.toLowerCase();
                    planLabel = `<span class="nx-plan-badge ${p}">${p.toUpperCase()}</span>`;
                }
            } catch (_) {}

            const userHTML = `
                <span style="font-size:12px; color:var(--mid); max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${user.email}</span>
                ${planLabel}
                <button class="nx-logout-btn nx-logout-trigger" data-en="Logout" data-mr="बाहेर पडा">LOGOUT</button>
            `;
            const mobileUserHTML = `
                <div style="font-size:12px; color:var(--mid); margin-bottom:8px;">${user.email} ${planLabel}</div>
                <button class="nx-logout-btn nx-logout-trigger" style="width:100%;" data-en="Logout" data-mr="बाहेर पडा">LOGOUT</button>
            `;

            const desktopSlot = document.getElementById('nx-user-info');
            const mobileSlot  = document.getElementById('nx-mobile-user-info');
            if (desktopSlot) desktopSlot.innerHTML = userHTML;
            if (mobileSlot)  mobileSlot.innerHTML  = mobileUserHTML;

            document.querySelectorAll('.nx-logout-trigger').forEach(btn => {
                btn.addEventListener('click', async () => {
                    await window.supabase.auth.signOut();
                    localStorage.removeItem('user_role');
                    localStorage.removeItem('tenant_id');
                    localStorage.removeItem('nexflow_tenant_id');
                    window.location.href = 'login.html';
                });
            });

            // Re-apply language now that user info is injected
            const lang = localStorage.getItem('nexflow_lang') || 'en';
            if (window.applyLang) window.applyLang(lang);

        } catch (err) {
            console.error('Navbar user info error:', err);
        }
    }

    // ── LANGUAGE TOGGLE ──────────────────────────────────────────
    function initLangToggle() {
        const saved = localStorage.getItem('nexflow_lang') || 'en';

        function updateBtns(lang) {
            const label = lang === 'en' ? 'मराठी' : 'English';
            ['nx-lang-btn', 'nx-mobile-lang-btn'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = label;
            });
        }

        updateBtns(saved);

        ['nx-lang-btn', 'nx-mobile-lang-btn'].forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('click', () => {
                const cur    = localStorage.getItem('nexflow_lang') || 'en';
                const newLang = cur === 'en' ? 'mr' : 'en';
                localStorage.setItem('nexflow_lang', newLang);
                if (window.applyLang) {
                    window.applyLang(newLang);
                } else {
                    document.querySelectorAll('[data-en]').forEach(el => {
                        if (['INPUT','SELECT','TEXTAREA'].includes(el.tagName)) {
                            el.placeholder = newLang === 'mr' ? el.dataset.mr : el.dataset.en;
                        } else {
                            el.textContent = newLang === 'mr' ? el.dataset.mr : el.dataset.en;
                        }
                    });
                }
                updateBtns(newLang);
            });
        });
    }

    // ── MOBILE MENU ──────────────────────────────────────────────
    function initMobileMenu() {
        const btn  = document.getElementById('nx-hamburger');
        const menu = document.getElementById('nx-mobile-menu');
        if (!btn || !menu) return;
        btn.addEventListener('click', () => {
            const open = menu.classList.toggle('open');
            menu.setAttribute('aria-hidden', String(!open));
        });
        // Close on outside click
        document.addEventListener('click', e => {
            if (!document.getElementById('nx-navbar')?.contains(e.target)) {
                menu.classList.remove('open');
                menu.setAttribute('aria-hidden', 'true');
            }
        });
    }

    // ── MAIN INIT ────────────────────────────────────────────────
    async function initNavbar() {
        // Remove any hardcoded <nav> tags baked into old page HTML
        document.querySelectorAll('nav').forEach(el => el.remove());

        // Remove old hardcoded navbar containers used before navbar.js existed
        ['nexflow-navbar-container'].forEach(id => {
            const old = document.getElementById(id);
            if (old) old.remove();
        });

        // Find or create the container div
        let container = document.getElementById('navbar-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'navbar-container';
            document.body.insertBefore(container, document.body.firstChild);
        }

        container.innerHTML = buildNavbar();

        initLangToggle();
        initMobileMenu();
        await initUserInfo();
    }

    // ── BOOT ─────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNavbar);
    } else {
        initNavbar();
    }

    window.initNavbar = initNavbar;

})();