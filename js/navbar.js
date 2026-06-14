// navbar.js — Nexflow P2 Design System v2.0
// Logic: 100% preserved from original
// HTML output: replaced with nx-nav design system classes
// Mobile: hamburger + nx-mobile-menu drawer (no Tailwind)

(function () {
    'use strict';

    // ── Current page detection ──────────────────────────────
    function getCurrentPage() {
        const path = window.location.pathname;
        return path.split('/').pop() || 'index.html';
    }

    function isActivePage(href) {
        const currentPage = getCurrentPage();
        if (href === 'index.html' && (currentPage === '' || currentPage === 'index.html')) return true;
        if (href === 'ca-report.html' && (currentPage === 'reports.html' || currentPage === 'ca-report.html')) return true;
        return currentPage === href;
    }

    // ── Nav links definition ────────────────────────────────
    const NAV_LINKS = [
        { href: 'index.html',    labelEn: 'Dashboard', labelMr: 'डॅशबोर्ड' },
        { href: 'grn.html',      labelEn: 'GRN',       labelMr: 'GRN' },
        { href: 'dispatch.html', labelEn: 'Dispatch',  labelMr: 'डिस्पॅच' },
        { href: 'products.html', labelEn: 'Products',  labelMr: 'उत्पादने' },
        { href: 'reports.html',  labelEn: 'Reports',   labelMr: 'अहवाल' },
        { href: 'scanner.html',  labelEn: '📷 Scanner',labelMr: '📷 स्कॅनर' },
        { href: 'settings.html', labelEn: 'Settings',  labelMr: 'सेटिंग्ज' }
    ];

    // ── Build navbar HTML ───────────────────────────────────
    function createNavbarHTML() {
        const desktopLinks = NAV_LINKS.map(link => {
            const active = isActivePage(link.href) ? ' nx-active' : '';
            return `<a href="${link.href}" class="${active}" data-en="${link.labelEn}" data-mr="${link.labelMr}">${link.labelEn}</a>`;
        }).join('');

        const mobileLinks = NAV_LINKS.map(link => {
            const active = isActivePage(link.href) ? ' nx-active' : '';
            return `<a href="${link.href}" class="${active}" data-en="${link.labelEn}" data-mr="${link.labelMr}">${link.labelEn}</a>`;
        }).join('');

        return `
<nav class="nx-nav" id="main-navbar">
  <!-- Logo -->
  <a href="index.html" class="nx-nav-logo">Nexflow <span>P2</span></a>

  <!-- Desktop links -->
  <div class="nx-nav-links" id="nav-links">
    ${desktopLinks}
  </div>

  <!-- Right side -->
  <div class="nx-nav-right">
    <button id="lang-toggle" class="nx-lang-pill">मराठी</button>
    <div id="navbar-user-info" class="nx-flex nx-flex-center nx-gap-sm"></div>
    <!-- Hamburger (mobile only) -->
    <button id="mobile-menu-btn" class="nx-hamburger" aria-label="Menu">☰</button>
  </div>
</nav>

<!-- Mobile drawer -->
<div class="nx-mobile-menu" id="mobile-menu">
  ${mobileLinks}
  <div class="nx-mobile-divider"></div>
  <div class="nx-mobile-bottom">
    <button id="mobile-lang-toggle" class="nx-lang-pill">मराठी</button>
    <div id="mobile-navbar-user-info" class="nx-flex nx-flex-center nx-gap-sm"></div>
  </div>
</div>`;
    }

    // ── User info + logout ──────────────────────────────────
    async function initUserInfo() {
        const navbarUserInfo       = document.getElementById('navbar-user-info');
        const mobileNavbarUserInfo = document.getElementById('mobile-navbar-user-info');

        try {
            if (!window.supabase && window.sb) window.supabase = window.sb;
            if (!window.supabase) { console.warn('Supabase not initialized'); return; }

            const { data: { user } } = await window.supabase.auth.getUser();
            if (!user) return;

            // Fetch plan from localStorage (set by checkAuth in supabase-client.js)
            const plan = localStorage.getItem('nexflow_plan') || '';
            const planTag = plan
                ? `<span class="nx-plan-tag">${plan.charAt(0).toUpperCase() + plan.slice(1)}</span>`
                : '';

            const desktopUserHTML = `
                <div class="nx-user-badge">
                    <span id="navbar-username">${user.email}</span>
                    ${planTag}
                </div>
                <button id="logout-btn" class="nx-logout-btn" data-en="Logout" data-mr="बाहेर पडा">Logout</button>`;

            const mobileUserHTML = `
                <button id="logout-btn-mobile" class="nx-logout-btn" data-en="Logout" data-mr="बाहेर पडा">Logout</button>`;

            if (navbarUserInfo)       navbarUserInfo.innerHTML       = desktopUserHTML;
            if (mobileNavbarUserInfo) mobileNavbarUserInfo.innerHTML = mobileUserHTML;

            // Logout handler — covers both desktop and mobile buttons
            async function handleLogout() {
                const { error } = await window.supabase.auth.signOut();
                if (error) {
                    console.error('Error logging out:', error);
                } else {
                    localStorage.removeItem('user_role');
                    localStorage.removeItem('tenant_id');
                    localStorage.removeItem('nexflow_tenant_id');
                    localStorage.removeItem('nexflow_plan');
                    window.location.href = 'login.html';
                }
            }

            const logoutBtn       = document.getElementById('logout-btn');
            const logoutBtnMobile = document.getElementById('logout-btn-mobile');
            if (logoutBtn)       logoutBtn.addEventListener('click', handleLogout);
            if (logoutBtnMobile) logoutBtnMobile.addEventListener('click', handleLogout);

            // Re-apply language after injecting user info
            const lang = localStorage.getItem('nexflow_lang') || 'en';
            applyLangToNav(lang);

        } catch (error) {
            console.error('Error initializing user info:', error);
        }
    }

    // ── Language toggle ─────────────────────────────────────
    function applyLangToNav(lang) {
        document.querySelectorAll('[data-en]').forEach(el => {
            if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
                el.placeholder = lang === 'mr' ? el.dataset.mr : el.dataset.en;
            } else {
                el.textContent = lang === 'mr' ? el.dataset.mr : el.dataset.en;
            }
        });
    }

    function initLanguageToggle() {
        const langToggle       = document.getElementById('lang-toggle');
        const mobileLangToggle = document.getElementById('mobile-lang-toggle');
        const saved = localStorage.getItem('nexflow_lang') || 'en';

        function updateToggleBtns(lang) {
            const text = lang === 'en' ? 'मराठी' : 'English';
            if (langToggle)       langToggle.textContent = text;
            if (mobileLangToggle) mobileLangToggle.textContent = text;
        }

        updateToggleBtns(saved);

        function onToggle() {
            const current = localStorage.getItem('nexflow_lang') || 'en';
            const next = current === 'en' ? 'mr' : 'en';
            localStorage.setItem('nexflow_lang', next);
            // Use page-level applyLang if defined, else fallback
            if (window.applyLang) {
                window.applyLang(next);
            } else {
                applyLangToNav(next);
            }
            updateToggleBtns(next);
        }

        if (langToggle)       langToggle.addEventListener('click', onToggle);
        if (mobileLangToggle) mobileLangToggle.addEventListener('click', onToggle);
    }

    // ── Mobile menu toggle ──────────────────────────────────
    function initMobileMenu() {
        const menuBtn    = document.getElementById('mobile-menu-btn');
        const mobileMenu = document.getElementById('mobile-menu');

        if (menuBtn && mobileMenu) {
            menuBtn.addEventListener('click', () => {
                mobileMenu.classList.toggle('open');
                menuBtn.textContent = mobileMenu.classList.contains('open') ? '✕' : '☰';
            });

            // Close drawer when a link is tapped
            mobileMenu.querySelectorAll('a').forEach(link => {
                link.addEventListener('click', () => {
                    mobileMenu.classList.remove('open');
                    menuBtn.textContent = '☰';
                });
            });

            // Close drawer on outside click
            document.addEventListener('click', (e) => {
                if (!mobileMenu.contains(e.target) && !menuBtn.contains(e.target)) {
                    mobileMenu.classList.remove('open');
                    menuBtn.textContent = '☰';
                }
            });
        }
    }

    // ── Main init ───────────────────────────────────────────
    async function initNavbar() {
        let container = document.getElementById('navbar-container') ||
                        document.getElementById('nexflow-navbar-container');

        if (!container) {
            container = document.createElement('div');
            container.id = 'nexflow-navbar-container';
            document.body.insertBefore(container, document.body.firstChild);
        }

        container.innerHTML = createNavbarHTML();

        initLanguageToggle();
        initMobileMenu();
        await initUserInfo();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNavbar);
    } else {
        initNavbar();
    }

    window.initNavbar = initNavbar;

})();