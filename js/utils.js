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
 * Show a toast notification (auto-dismissing, non-blocking).
 * Uses the .nx-toast / .nx-toast-wrap classes already defined in
 * nexflow-design.css. Creates the wrap container if the page doesn't
 * already have one, so this works on any page without extra markup.
 *
 * @param {string} message - Message to display
 * @param {string} type - 'ok' | 'error' | 'warn' (default 'ok')
 * @param {number} duration - Auto-dismiss time in ms (default 3500)
 */
function toast(message, type = 'ok', duration = 3500) {
    let wrap = document.getElementById('toastWrap') || document.querySelector('.nx-toast-wrap');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'nx-toast-wrap';
        wrap.id = 'toastWrap';
        document.body.appendChild(wrap);
    }

    // Accept both naming conventions used across the codebase:
    // 'ok'/'error'/'warn' (utils.js convention) and
    // 'success'/'error'/'info' (settings.html's original convention).
    const isError = type === 'error';
    const isWarn  = type === 'warn' || type === 'info';
    const typeClass = isError ? 'error' : isWarn ? 'warn' : '';

    const el = document.createElement('div');
    el.className = `nx-toast${typeClass ? ' ' + typeClass : ''}`;
    el.textContent = message;
    wrap.appendChild(el);

    setTimeout(() => {
        el.style.transition = 'opacity 0.2s ease';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 200);
    }, duration);
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
                            toast(lang === 'mr'
                                ? `कृपया ${fieldName} साठी वैध क्रमांक प्रविष्ट करा`
                                : `Please enter a valid number for ${fieldName}`, 'error');
                            inp.focus();
                            return false;
                        }
                    }
                });
            }, { once: false });
        }
    });
}

/**
 * Get the next challan number for any dispatch type.
 * Reads challan_mode from p2_tenant_settings, then calls the
 * get_next_challan_number RPC which handles both unified and split modes.
 *
 * @param {object} supabase  - Supabase client instance
 * @param {string} tenantId  - Current tenant UUID
 * @param {string} type      - 'product' | 'raw_material' | 'bom_issue'
 * @returns {string}         - Challan number e.g. "1001" or "RM-1001"
 */
async function getNextChallanNumber(supabase, tenantId, type) {
    const { data: settings, error: settingsErr } = await supabase
        .from('p2_tenant_settings')
        .select('challan_mode')
        .eq('tenant_id', tenantId)
        .single();

    if (settingsErr) {
        console.warn('getNextChallanNumber: could not fetch challan_mode, defaulting to split', settingsErr);
    }

    const mode = settings?.challan_mode ?? 'split';

    const { data, error } = await supabase.rpc('get_next_challan_number', {
        p_tenant_id: tenantId,
        p_type:      type,
        p_mode:      mode
    });

    if (error) throw new Error('Failed to generate challan number: ' + error.message);
    return String(data);
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.formatDate = formatDate;
    window.formatNumber = formatNumber;
    window.showStatusMessage = showStatusMessage;
    window.initNumberInputSanitization = initNumberInputSanitization;
    window.toast = toast;
    window.getNextChallanNumber = getNextChallanNumber;

    // ── DEMO MODE ──────────────────────────────────────────────
    // True when the logged-in user is the read-only demo account.
    // Set by checkAuth() in auth.js after login.
    window.isDemo = sessionStorage.getItem('nexflow_is_demo') === 'true';

    /**
     * Apply demo-mode guard to a button element.
     * In demo mode: disables the button and shows a tooltip.
     * In normal mode: attaches the click handler as usual.
     *
     * @param {HTMLElement} btn - The button element
     * @param {Function} onClickFn - The handler to attach when NOT demo
     */
    window.demoGuard = function(btn, onClickFn) {
        if (!btn) return;
        if (window.isDemo) {
            btn.disabled = true;
            btn.style.opacity = '0.4';
            btn.style.cursor = 'not-allowed';
            btn.title = 'Demo mode — read only. Contact Arjun: arjunjadhav29052006@gmail.com';
            // Remove any existing onclick attributes
            btn.removeAttribute('onclick');
        } else {
            if (onClickFn) btn.addEventListener('click', onClickFn);
        }
    };

    /**
     * Disable all write forms in demo mode.
     * Call once per page after DOM is ready.
     * Disables every <form> submit and hides its submit buttons.
     */
    window.applyDemoModeToForms = function() {
        if (!window.isDemo) return;
        document.querySelectorAll('form').forEach(form => {
            form.addEventListener('submit', e => {
                e.preventDefault();
                e.stopImmediatePropagation();
                toast('Demo mode — read only. Contact Arjun to get started: arjunjadhav29052006@gmail.com', 'warn', 5000);
            }, true); // capture phase — fires before any other submit handler
        });
        // Dim all submit/save/add/delete buttons
        document.querySelectorAll(
            'button[type="submit"], button[id*="save"], button[id*="Save"], ' +
            'button[id*="add"], button[id*="Add"], button[id*="delete"], ' +
            'button[id*="confirm"], button[id*="import"], button[id*="Import"], ' +
            'button[onclick*="submit"], button[onclick*="import"]'
        ).forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.4';
            btn.style.cursor = 'not-allowed';
            btn.title = 'Demo mode — read only. Contact Arjun: arjunjadhav29052006@gmail.com';
            btn.removeAttribute('onclick');
        });
    };
    // ───────────────────────────────────────────────────────────

    // Auto-init number sanitization on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNumberInputSanitization);
    } else {
        initNumberInputSanitization();
    }
}