// Consistent navbar component for all pages
// This creates a complete navbar with:
// - Company name on the left
// - Navigation links in the middle
// - Language toggle + user info + logout on the right
// - Mobile hamburger menu
// - Active link highlighting

(function() {
    'use strict';

    // Get current page filename
    function getCurrentPage() {
        const path = window.location.pathname;
        const page = path.split('/').pop() || 'index.html';
        return page;
    }

    // Check if link should be active
    function isActivePage(href) {
        const currentPage = getCurrentPage();
        if (href === 'index.html' && (currentPage === '' || currentPage === 'index.html')) return true;
        if (href === 'ca-report.html' && (currentPage === 'reports.html' || currentPage === 'ca-report.html')) return true;
        return currentPage === href;
    }

    // Create navbar HTML
    function createNavbarHTML() {
        const navLinks = [
            { href: 'index.html', labelEn: 'Dashboard', labelMr: 'डॅशबोर्ड' },
            { href: 'grn.html', labelEn: 'GRN', labelMr: 'GRN' },
            { href: 'dispatch.html', labelEn: 'Dispatch', labelMr: 'डिस्पॅच' },
            { href: 'products.html', labelEn: 'Products', labelMr: 'उत्पादने' },
            { href: 'reports.html', labelEn: 'Reports', labelMr: 'अहवाल' },
            { href: 'scanner.html', labelEn: '📷 Scanner', labelMr: '📷 स्कॅनर' },
            { href: 'settings.html', labelEn: 'Settings', labelMr: 'सेटिंग्ज' }
        ];

        const linksHTML = navLinks.map(link => {
            const activeClass = isActivePage(link.href) ? 'text-nexflow-green font-bold' : 'text-white hover:text-gray-200';
            return `<a href="${link.href}" class="${activeClass}" data-en="${link.labelEn}" data-mr="${link.labelMr}">${link.labelEn}</a>`;
        }).join('');

        return `
            <nav class="bg-nexflow-teal p-4 flex justify-between items-center flex-wrap" id="main-navbar">
                <div class="flex items-center">
                    <span class="text-xl font-bold text-white" data-en="Nexflow Automations" data-mr="नेक्सफ्लो ऑटोमेशन्स">Nexflow Automations</span>
                </div>

                <!-- Mobile hamburger -->
                <button id="mobile-menu-btn" class="lg:hidden text-white text-2xl">
                    ☰
                </button>

                <!-- Desktop nav links -->
                <div id="nav-links" class="hidden lg:flex items-center space-x-4">
                    ${linksHTML}
                </div>

                <!-- Right side: Language toggle + User info -->
                <div class="hidden lg:flex items-center space-x-4">
                    <button id="lang-toggle" class="bg-white text-nexflow-teal px-3 py-2 rounded text-sm font-medium hover:bg-gray-100">
                        मराठी
                    </button>
                    <div id="navbar-user-info"></div>
                </div>

                <!-- Mobile menu (hidden by default) -->
                <div id="mobile-menu" class="hidden w-full lg:hidden mt-4">
                    <div class="flex flex-col space-y-2">
                        ${navLinks.map(link => {
                            const activeClass = isActivePage(link.href) ? 'text-nexflow-green font-bold' : 'text-white hover:text-gray-200';
                            return `<a href="${link.href}" class="${activeClass} block py-2" data-en="${link.labelEn}" data-mr="${link.labelMr}">${link.labelEn}</a>`;
                        }).join('')}
                        <div class="pt-2 border-t border-white/30">
                            <button id="mobile-lang-toggle" class="bg-white text-nexflow-teal px-3 py-2 rounded text-sm font-medium w-full">
                                मराठी
                            </button>
                        </div>
                        <div id="mobile-navbar-user-info" class="pt-2"></div>
                    </div>
                </div>
            </nav>
        `;
    }

    // Initialize user info and logout functionality
    async function initUserInfo() {
        const navbarUserInfo = document.getElementById('navbar-user-info');
        const mobileNavbarUserInfo = document.getElementById('mobile-navbar-user-info');

        try {
            // Check if supabase is available
            if (!window.supabase && window.sb) {
                window.supabase = window.sb;
            }

            if (!window.supabase) {
                console.warn('Supabase not initialized');
                return;
            }

            const { data: { user } } = await window.supabase.auth.getUser();
            if (!user) return;

            const userEmail = user.email;

            const userHTML = `
                <span class="text-white text-sm mr-3" id="navbar-username">${userEmail}</span>
                <button id="logout-btn"
                    class="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700 transition"
                    data-en="Logout"
                    data-mr="बाहेर पडा">
                    Logout
                </button>
            `;

            if (navbarUserInfo) navbarUserInfo.innerHTML = userHTML;
            if (mobileNavbarUserInfo) mobileNavbarUserInfo.innerHTML = userHTML;

            // Add logout listeners
            document.querySelectorAll('#logout-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const { error } = await window.supabase.auth.signOut();
                    if (error) {
                        console.error('Error logging out:', error);
                    } else {
                        localStorage.removeItem('user_role');
                        localStorage.removeItem('tenant_id');
                        localStorage.removeItem('nexflow_tenant_id');
                        window.location.href = 'login.html';
                    }
                });
            });

            // Re-apply language
            const lang = localStorage.getItem('nexflow_lang') || 'en';
            if (window.applyLang) {
                window.applyLang(lang);
            } else {
                // Fallback: apply lang directly
                document.querySelectorAll('[data-en]').forEach(el => {
                    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' ||
                        el.tagName === 'TEXTAREA') {
                        el.placeholder = lang === 'mr' ? el.dataset.mr : el.dataset.en;
                    } else {
                        el.textContent = lang === 'mr' ? el.dataset.mr : el.dataset.en;
                    }
                });
            }
        } catch (error) {
            console.error('Error initializing user info:', error);
        }
    }

    // Initialize language toggle
    function initLanguageToggle() {
        const langToggle = document.getElementById('lang-toggle');
        const mobileLangToggle = document.getElementById('mobile-lang-toggle');
        const saved = localStorage.getItem('nexflow_lang') || 'en';

        function updateToggleButtons(lang) {
            const text = lang === 'en' ? 'मराठी' : 'English';
            if (langToggle) langToggle.textContent = text;
            if (mobileLangToggle) mobileLangToggle.textContent = text;
        }

        updateToggleButtons(saved);

        [langToggle, mobileLangToggle].forEach(btn => {
            if (btn) {
                btn.addEventListener('click', () => {
                    const currentLang = localStorage.getItem('nexflow_lang') || 'en';
                    const newLang = currentLang === 'en' ? 'mr' : 'en';
                    localStorage.setItem('nexflow_lang', newLang);

                    if (window.applyLang) {
                        window.applyLang(newLang);
                    } else {
                        // Fallback: apply lang directly
                        document.querySelectorAll('[data-en]').forEach(el => {
                            if (el.tagName === 'INPUT' || el.tagName === 'SELECT' ||
                                el.tagName === 'TEXTAREA') {
                                el.placeholder = newLang === 'mr' ? el.dataset.mr : el.dataset.en;
                            } else {
                                el.textContent = newLang === 'mr' ? el.dataset.mr : el.dataset.en;
                            }
                        });
                    }

                    updateToggleButtons(newLang);
                });
            }
        });
    }

    // Initialize mobile menu toggle
    function initMobileMenu() {
        const menuBtn = document.getElementById('mobile-menu-btn');
        const mobileMenu = document.getElementById('mobile-menu');

        if (menuBtn && mobileMenu) {
            menuBtn.addEventListener('click', () => {
                mobileMenu.classList.toggle('hidden');
            });
        }
    }

    // Main initialization
    async function initNavbar() {
        // Check if navbar placeholder exists
        let navbarContainer = document.getElementById('navbar-container') || document.getElementById('nexflow-navbar-container');

        // If not, insert at the beginning of body
        if (!navbarContainer) {
            navbarContainer = document.createElement('div');
            navbarContainer.id = 'nexflow-navbar-container';
            document.body.insertBefore(navbarContainer, document.body.firstChild);
        }

        // Insert navbar HTML
        navbarContainer.innerHTML = createNavbarHTML();

        // Initialize components
        initLanguageToggle();
        initMobileMenu();
        await initUserInfo();
    }

    // Auto-initialize on DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNavbar);
    } else {
        initNavbar();
    }

    // Export for manual init if needed
    window.initNavbar = initNavbar;
})();
