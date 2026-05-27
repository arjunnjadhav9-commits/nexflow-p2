// Utility functions for Nexflow P2

/**
 * Format ISO date string to DD/MM/YYYY
 * @param {string} dateString - ISO date string
 * @returns {string} - Formatted date DD/MM/YYYY
 */
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

/**
 * Format numeric value to maximum 2 decimal places, removing trailing zeros
 * @param {number|string} value - Numeric value
 * @returns {string} - Formatted number (50.0000 -> 50, 2.5000 -> 2.5)
 */
function formatNumber(value) {
    if (value === null || value === undefined || value === '') return '0';
    const num = parseFloat(value);
    if (isNaN(num)) return '0';

    // Round to 2 decimal places and remove trailing zeros
    const rounded = Math.round(num * 100) / 100;
    return rounded.toString().replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

/**
 * Show a status message with auto-hide and close button
 * @param {string} elementId - ID of the status message container
 * @param {string} message - Message to display
 * @param {number} timeout - Auto-hide timeout in ms (default 8000)
 */
function showStatusMessage(elementId, message, timeout = 8000) {
    const el = document.getElementById(elementId);
    if (!el) return;

    // Find or create message text element
    let textEl = el.querySelector('.status-text');
    if (!textEl) {
        textEl = el.querySelector('p') || el;
    }
    textEl.textContent = message;

    // Add close button if not exists
    let closeBtn = el.querySelector('.status-close-btn');
    if (!closeBtn) {
        closeBtn = document.createElement('button');
        closeBtn.className = 'status-close-btn absolute top-2 right-2 text-white hover:text-gray-300 text-2xl font-bold leading-none';
        closeBtn.innerHTML = '&times;';
        closeBtn.setAttribute('data-en', '×');
        closeBtn.setAttribute('data-mr', '×');
        closeBtn.onclick = () => el.classList.add('hidden');
        el.style.position = 'relative';
        el.appendChild(closeBtn);
    }

    el.classList.remove('hidden');

    // Auto-hide after timeout
    setTimeout(() => el.classList.add('hidden'), timeout);
}

/**
 * Initialize number input sanitization on all number/quantity inputs
 * Strips non-numeric characters except one decimal point
 * Sets min="0" attribute
 */
function initNumberInputSanitization() {
    // Select all number inputs and quantity inputs
    const numberInputs = document.querySelectorAll(
        'input[type="number"], input[id*="quantity" i], input[id*="qty" i], input[name*="quantity" i], input[name*="qty" i]'
    );

    numberInputs.forEach(input => {
        // Set min="0" if not already set
        if (!input.hasAttribute('min')) {
            input.setAttribute('min', '0');
        }

        // Add input event listener for sanitization
        input.addEventListener('input', function(e) {
            let value = this.value;

            // Allow only numbers and one decimal point
            value = value.replace(/[^\d.]/g, '');

            // Allow only one decimal point
            const parts = value.split('.');
            if (parts.length > 2) {
                value = parts[0] + '.' + parts.slice(1).join('');
            }

            this.value = value;
        });

        // Validate on form submission
        const form = input.closest('form');
        if (form) {
            form.addEventListener('submit', function(e) {
                numberInputs.forEach(inp => {
                    if (inp.hasAttribute('required')) {
                        const val = parseFloat(inp.value);
                        if (isNaN(val) || val <= 0 || inp.value.trim() === '') {
                            e.preventDefault();
                            const lang = localStorage.getItem('nexflow_lang') || 'en';
                            const fieldName = inp.getAttribute('data-en') || inp.getAttribute('placeholder') || 'This field';
                            alert(lang === 'mr'
                                ? `कृपया ${fieldName} साठी वैध क्रमांक प्रविष्ट करा`
                                : `Please enter a valid number for ${fieldName}`);
                            inp.focus();
                            return false;
                        }
                    }
                });
            }, { once: false });
        }
    });
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.formatDate = formatDate;
    window.formatNumber = formatNumber;
    window.showStatusMessage = showStatusMessage;
    window.initNumberInputSanitization = initNumberInputSanitization;

    // Auto-init number sanitization on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNumberInputSanitization);
    } else {
        initNumberInputSanitization();
    }
}