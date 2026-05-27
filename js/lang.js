// Language toggle utility for Nexflow Automations

export function initLang() {
    const langToggle = document.getElementById('lang-toggle');
    const savedLang = localStorage.getItem('nexflow_lang') || 'en';

    // Function to apply language
    function applyLanguage(lang) {
        const elements = document.querySelectorAll('[data-en][data-mr]');
        elements.forEach(el => {
            el.textContent = el.getAttribute(`data-${lang}`);
        });

        // Update toggle button text
        langToggle.textContent = lang === 'en' ? 'मराठी' : 'English';

        // Save language preference
        localStorage.setItem('nexflow_lang', lang);
    }

    // Initial language application
    applyLanguage(savedLang);

    // Toggle click handler
    langToggle.addEventListener('click', () => {
        const currentLang = localStorage.getItem('nexflow_lang') || 'en';
        const newLang = currentLang === 'en' ? 'mr' : 'en';
        applyLanguage(newLang);
    });
}

// Automatically initialize language on page load
document.addEventListener('DOMContentLoaded', initLang);