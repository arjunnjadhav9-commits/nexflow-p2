/*!
 * Nexflow Tutorial Engine (T1 — English only, desktop-first).
 * Bare global, no module system, no build step — matches every other shared
 * script in this codebase (js/navbar.js, js/notifications.js, ...).
 * See _ai/tutorial-engine.md for the full design. This file implements the
 * ADRs in that document; deviations are called out in comments below.
 *
 * The tutorial can never break the page. Every entry point is wrapped —
 * a throw anywhere calls exit('error') and leaves the host page untouched.
 */
(function () {
    'use strict';

    var FALLBACK_LANG = 'en';
    var Z_DIM = 9000, Z_BUBBLE = 9001;
    var RESOLVE_DEFAULT_TIMEOUT_MS = 5000;
    var ADVANCE_BEAT_MS = 350;
    var INPUT_DEBOUNCE_MS = 250;
    var AUTOSTART_SETTLE_MS = 600;
    var RESUME_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

    var registry = {}; // moduleId -> config

    // Single run state. One tutorial runs at a time by construction.
    var run = {
        active: false,
        moduleId: null,
        config: null,
        steps: [],        // applicable steps for this run (filtered by when())
        index: -1,
        demoMode: false,
        tenantId: null,
        userId: null,
        teardownFns: [],  // emptied every step transition AND on exit — single registry (ADR-5)
        repositionQueued: false,
        entryValue: null, // captured value of the current step's target at step-entry, for 'change' type
        lastSignal: null, // most recent nexflow:tutorial-signal {name, meta}, used to personalize the completion card
        // Bug found in manual verification: opening the confirm modal fires
        // several separate DOM mutations (client name text, N item <li>
        // appends, then style.display) — the body-level MutationObserver
        // backing a 'dom' advanceOn step re-ran its check on EACH one and
        // scheduled a fresh beat(advance) every time, so step 12 advanced
        // multiple times off one click and skipped straight past steps 13
        // and 14 to complete(). stepAdvanced is the single-fire guard: reset
        // once per enterStep(), checked/set by the one requestAdvance() choke
        // point every advanceOn handler and the manual Next/Skip buttons now
        // go through — see requestAdvance() below.
        stepAdvanced: false
    };

    var dom = { styleEl: null, overlayEl: null, bubbleEl: null, blockerEls: [] };

    // ── language ─────────────────────────────────────────────────────────
    function getLang() {
        try { return localStorage.getItem('nexflow_lang') || 'en'; } catch (e) { return 'en'; }
    }

    // Correction B: never treat an empty-string bundle value as "present" —
    // only fall back on a key that is genuinely absent (undefined/null).
    // Step configs must OMIT the `mr` key entirely in T1, not set it to ''.
    function tr(bundle) {
        if (bundle == null) return '';
        if (typeof bundle === 'string') return bundle;
        var lang = getLang();
        if (bundle[lang] != null) return bundle[lang];
        if (bundle[FALLBACK_LANG] != null) return bundle[FALLBACK_LANG];
        var keys = Object.keys(bundle);
        return keys.length ? bundle[keys[0]] : '';
    }

    var UI_STRINGS = {
        next: { en: 'Next' },
        back: { en: 'Back' },
        skipThis: { en: 'Skip this' },
        exit: { en: 'Exit' },
        stepOf: { en: 'Step {i} of {n}' },
        optionalChip: { en: 'Optional' },
        continueFrom: { en: 'Continue from where you left off?' },
        startOver: { en: 'Start from the beginning' },
        demoChip: { en: 'Demo — nothing will be saved.' },
        scrollToIt: { en: '↓ Scroll to it' },
        done: { en: 'Done' },
        close: { en: 'Close' }
    };

    // ── safety wrapper ───────────────────────────────────────────────────
    // Every public/lifecycle entry point is wrapped. A throw anywhere exits
    // cleanly instead of leaving the host page in a broken state.
    //
    // Bug found while building the deliberate-deletion skip test harness:
    // exit() is itself safe()-wrapped. If exit()'s OWN body throws (found via
    // a harness gap that left window.supabase undefined, but the same class
    // of throw could come from any future bug inside exit()), the catch
    // block below calls exit('error') again — which re-enters exit()'s body,
    // throws again for the same reason, and the catch calls exit('error')
    // again, unbounded, all synchronously on one call stack, until it either
    // hangs the tab or blows the stack. `unwinding` breaks the cycle: the
    // first catch sets it before attempting recovery; any catch that fires
    // while it's already true (i.e. we're already mid-recovery-attempt) just
    // gives up cleanly instead of recursing. Reset after, so a later,
    // unrelated error is still handled normally.
    var unwinding = false;
    function safe(fn, label) {
        return function () {
            try {
                return fn.apply(null, arguments);
            } catch (err) {
                console.warn('[tutorial] error in ' + (label || 'unknown') + ' — exiting', err);
                if (unwinding) return; // already mid-recovery — never recurse
                unwinding = true;
                try { exit('error'); } catch (e2) { /* nothing more we can do */ }
                unwinding = false;
            }
        };
    }

    // ── registry ─────────────────────────────────────────────────────────
    function register(moduleId, config) {
        if (!moduleId || !config || !config.steps) {
            console.warn('[tutorial] register() called with invalid config for', moduleId);
            return;
        }
        registry[moduleId] = config;
    }

    // ── tenant/user resolution + accessors on window (optional deps) ───────
    function getTutorialModeSafe() {
        try {
            if (typeof window.getTutorialMode === 'function') return window.getTutorialMode() || 'auto';
        } catch (e) { /* fall through */ }
        return 'auto';
    }
    function getUserRoleSafe() {
        try { return typeof window.getUserRole === 'function' ? window.getUserRole() : null; }
        catch (e) { return null; }
    }
    function isDemoSafe() {
        try { return window.isDemo === true; } catch (e) { return false; }
    }

    function resolveTenantAndUser() {
        return window.supabase.auth.getUser().then(function (res) {
            var user = res && res.data && res.data.user;
            if (!user) return null;
            return {
                userId: user.id,
                tenantId: (user.user_metadata && user.user_metadata.tenant_id) || user.id
            };
        }).catch(function () { return null; });
    }

    // ── localStorage in-flight position (per tenant+user+module) ───────────
    function posKey(tenantId, userId, moduleId) {
        return 'nexflow_tutorial_pos_' + moduleId + '_' + tenantId + '_' + userId;
    }
    function readLocalPosition(tenantId, userId, moduleId) {
        try {
            var raw = localStorage.getItem(posKey(tenantId, userId, moduleId));
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!parsed || !parsed.stepId || !parsed.ts) return null;
            return parsed;
        } catch (e) { return null; }
    }
    function writeLocalPosition(stepId) {
        if (run.demoMode || !run.tenantId || !run.userId || !run.moduleId) return;
        try {
            localStorage.setItem(posKey(run.tenantId, run.userId, run.moduleId),
                JSON.stringify({ stepId: stepId, ts: Date.now() }));
        } catch (e) { /* ignore quota errors etc. */ }
    }
    function clearLocalPosition() {
        if (!run.tenantId || !run.userId || !run.moduleId) return;
        try { localStorage.removeItem(posKey(run.tenantId, run.userId, run.moduleId)); } catch (e) { /* ignore */ }
    }

    // ── p2_tutorial_progress (fire-and-forget writes; swallow all errors) ──
    function fetchProgressRow(tenantId, userId, moduleId) {
        return window.supabase.from('p2_tutorial_progress')
            .select('status, last_step_id, times_completed')
            .eq('tenant_id', tenantId).eq('user_id', userId).eq('module_id', moduleId)
            .maybeSingle()
            .then(function (res) { return (res && res.data) || null; })
            .catch(function () { return null; });
    }
    function writeProgress(patch) {
        if (run.demoMode || !run.tenantId || !run.userId || !run.moduleId) return;
        var payload = Object.assign({
            tenant_id: run.tenantId, user_id: run.userId, module_id: run.moduleId,
            updated_at: new Date().toISOString()
        }, patch);
        window.supabase.from('p2_tutorial_progress')
            .upsert(payload, { onConflict: 'tenant_id,user_id,module_id' })
            .then(function () {}).catch(function (err) {
                console.warn('[tutorial] progress write failed (swallowed):', err);
            });
    }

    // ── CSS injection (once) — ADR-8: inherit design tokens, no new stylesheet ──
    function injectStyleOnce() {
        if (dom.styleEl) return;
        var css = ''
            + '.nxt-overlay{position:fixed;pointer-events:none;border-radius:8px;'
            + 'box-shadow:0 0 0 100vmax rgba(0,0,0,0.62);transition:top .18s ease,left .18s ease,'
            + 'width .18s ease,height .18s ease;z-index:' + Z_DIM + ';}'
            + 'body.nxt-active.nxt-reduced-motion .nxt-overlay{transition:none;}'
            + '@media (prefers-reduced-motion: reduce){.nxt-overlay{transition:none;}}'
            + '.nxt-blocker{position:fixed;pointer-events:auto;background:transparent;z-index:' + Z_DIM + ';}'
            + '.nxt-bubble{position:fixed;z-index:' + Z_BUBBLE + ';max-width:320px;background:var(--surface);'
            + 'border:1px solid var(--border2);border-radius:var(--radius-lg);box-shadow:var(--shadow-md);'
            + 'padding:16px;font-family:var(--font);color:var(--text);font-size:13px;line-height:1.45;}'
            + '.nxt-bubble-card{max-width:380px;}'
            + '.nxt-bubble-title{font-family:var(--condensed);font-weight:800;font-size:15px;'
            + 'color:var(--white);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:8px;}'
            + '.nxt-bubble-text{margin-bottom:8px;}'
            + '.nxt-bubble-why{color:var(--mid);font-size:12px;margin-bottom:12px;}'
            + '.nxt-bubble-progress{font-size:11px;color:var(--mid);margin-bottom:10px;'
            + 'text-transform:uppercase;letter-spacing:0.5px;font-family:var(--condensed);}'
            + '.nxt-bubble-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}'
            + '.nxt-btn{font-family:var(--font);font-size:12px;font-weight:600;border-radius:var(--radius-sm);'
            + 'padding:7px 14px;cursor:pointer;border:1px solid var(--border2);background:var(--surface3);'
            + 'color:var(--text);}'
            + '.nxt-btn-primary{background:var(--orange);border-color:var(--orange);color:#fff;}'
            + '.nxt-btn-primary:disabled{opacity:0.45;cursor:not-allowed;}'
            + '.nxt-btn-ghost{background:transparent;}'
            + '.nxt-chip{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;'
            + 'letter-spacing:0.4px;padding:2px 7px;border-radius:3px;margin-left:6px;vertical-align:middle;'
            + 'background:rgba(255,92,26,0.12);color:var(--orange);border:1px solid rgba(255,92,26,0.3);}'
            + '.nxt-tick{color:#22c55e;font-weight:700;margin-left:4px;}'
            + '.nxt-exit-x{position:absolute;top:8px;right:10px;cursor:pointer;color:var(--mid);'
            + 'font-size:16px;line-height:1;background:none;border:none;padding:4px;}'
            + '.nxt-exit-x:hover{color:var(--white);}'
            + 'body.nxt-active .nx-toast-wrap,body.nxt-active #toastWrap{z-index:9500 !important;}'
            + '@media (max-width:600px){'
            + '  .nxt-bubble{left:12px !important;right:12px !important;width:auto !important;'
            + '    max-width:none;bottom:12px !important;top:auto !important;max-height:45vh;overflow-y:auto;'
            + '    border-radius:var(--radius-lg) var(--radius-lg) 10px 10px;}'
            + '  .nxt-btn{min-height:44px;flex:1;text-align:center;}'
            + '}'
            + '.nxt-launch-btn{white-space:nowrap;}';
        var style = document.createElement('style');
        style.setAttribute('data-nxt', '1');
        style.textContent = css;
        document.head.appendChild(style);
        dom.styleEl = style;
    }

    function buildDom() {
        if (dom.overlayEl) return;
        var overlay = document.createElement('div');
        overlay.className = 'nxt-overlay';
        overlay.style.display = 'none';
        document.body.appendChild(overlay);

        var bubble = document.createElement('div');
        bubble.className = 'nxt-bubble';
        bubble.style.display = 'none';
        document.body.appendChild(bubble);

        dom.overlayEl = overlay;
        dom.bubbleEl = bubble;
    }

    function removeDom() {
        if (dom.overlayEl && dom.overlayEl.parentNode) dom.overlayEl.parentNode.removeChild(dom.overlayEl);
        if (dom.bubbleEl && dom.bubbleEl.parentNode) dom.bubbleEl.parentNode.removeChild(dom.bubbleEl);
        clearBlockers();
        dom.overlayEl = null;
        dom.bubbleEl = null;
    }

    function clearBlockers() {
        dom.blockerEls.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
        dom.blockerEls = [];
    }

    // ── teardown registry (ADR-5) — single place, emptied every transition ──
    function addTeardown(fn) { run.teardownFns.push(fn); }
    function teardownStep() {
        run.teardownFns.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
        run.teardownFns = [];
        clearBlockers();
    }

    // ── 9999-tier modal detection (ADR-11) ──────────────────────────────────
    function isBlockingModalOpen() {
        var overlays = document.querySelectorAll('.nx-modal-overlay');
        for (var i = 0; i < overlays.length; i++) {
            var el = overlays[i];
            var cs = window.getComputedStyle(el);
            if (cs.display === 'none') continue;
            var z = parseInt(cs.zIndex, 10) || 0;
            if (z >= 9999) return true;
        }
        return false;
    }

    // ── target resolution (§4.4) ─────────────────────────────────────────
    function resolveTarget(step) {
        if (!step.target) return null;
        var el = document.querySelector('[data-tutorial-target="' + step.target + '"]');
        if (!el) return null;
        var r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return null; // present but hidden
        return el;
    }

    function waitForTarget(step, cb) {
        var budget = (step.waitFor && step.waitFor.timeoutMs) || RESOLVE_DEFAULT_TIMEOUT_MS;
        var start = Date.now();
        var cancelled = false;
        addTeardown(function () { cancelled = true; });

        function tick() {
            if (cancelled) return;
            var el = resolveTarget(step);
            if (el) { cb(el); return; }
            if (Date.now() - start > budget) {
                console.warn('[tutorial] step "' + step.id + '" target "' + step.target + '" not found — skipping');
                cb(null);
                return;
            }
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    // ── reposition loop (coalesced) ──────────────────────────────────────
    function queueReposition() {
        if (run.repositionQueued) return;
        run.repositionQueued = true;
        requestAnimationFrame(function () {
            run.repositionQueued = false;
            if (!run.active) return;
            if (isBlockingModalOpen()) { exit('blocked'); return; }
            positionSpotlight();
        });
    }

    function currentStep() { return run.steps[run.index]; }
    function currentTargetEl() {
        var step = currentStep();
        return step && step.target ? resolveTarget(step) : null;
    }

    // Bug found in manual verification: dispatch-product-search's own results
    // dropdown (.mat-dropdown.open, a sibling of the input inside its
    // .mat-search-wrap) rendered outside the spotlight — only the input was
    // highlighted, the dropdown sat in the dimmed area. Generic fix, not
    // special-cased to this one field: any target inside a .mat-search-wrap
    // unions its rect with that wrap's currently-open .mat-dropdown before
    // the spotlight/bubble are positioned. Re-evaluated on every reposition
    // tick (queueReposition, already wired to the body MutationObserver), so
    // it tracks the dropdown opening/closing as the user types.
    function unionRect(a, b) {
        var left = Math.min(a.left, b.left), top = Math.min(a.top, b.top);
        var right = Math.max(a.right, b.right), bottom = Math.max(a.bottom, b.bottom);
        return { top: top, left: left, right: right, bottom: bottom, width: right - left, height: bottom - top };
    }
    function expandRectForOpenDropdown(el, r) {
        var wrap = el.closest && el.closest('.mat-search-wrap');
        if (!wrap) return r;
        var dd = wrap.querySelector('.mat-dropdown.open');
        if (!dd) return r;
        var ddRect = dd.getBoundingClientRect();
        if (ddRect.width === 0 && ddRect.height === 0) return r;
        return unionRect(r, ddRect);
    }

    // A step's interactive `target` (what advanceOn watches, what gets
    // scrolled to, what fires click/input/change) is sometimes smaller than
    // what actually needs highlighting — e.g. dispatch-confirm-modal-confirm
    // is one button, but the step is really "read the whole modal, then
    // press this." `spotlightTarget` names a SEPARATE data-tutorial-target
    // used only for the overlay/bubble rect; the primary `target` is
    // untouched for every other purpose. Re-resolved fresh every tick, same
    // as the primary target (ADR-5) — never cached.
    function resolveSpotlightRect(step, el) {
        var base = el.getBoundingClientRect();
        if (!step.spotlightTarget) return base;
        var wide = document.querySelector('[data-tutorial-target="' + step.spotlightTarget + '"]');
        if (!wide) return base; // spotlightTarget not found — fall back to the primary target, not nothing
        var wr = wide.getBoundingClientRect();
        if (wr.width === 0 && wr.height === 0) return base; // present but hidden
        return wr;
    }

    function positionSpotlight() {
        var step = currentStep();
        if (!step || step.kind === 'card') { positionCard(); return; }
        var el = currentTargetEl();
        if (!el) return; // element temporarily gone mid-transition; next tick will retry
        var pad = (step.padding != null) ? step.padding : 6;
        var r = expandRectForOpenDropdown(el, resolveSpotlightRect(step, el));

        dom.overlayEl.style.display = 'block';
        dom.overlayEl.style.top = (r.top - pad) + 'px';
        dom.overlayEl.style.left = (r.left - pad) + 'px';
        dom.overlayEl.style.width = (r.width + pad * 2) + 'px';
        dom.overlayEl.style.height = (r.height + pad * 2) + 'px';

        positionBubble(r, el);

        if (step.blockOutside) renderBlockers(r, pad);
    }

    function positionCard() {
        dom.overlayEl.style.display = 'none';
        clearBlockers();
        var vw = window.innerWidth, vh = window.innerHeight;
        var bw = Math.min(380, vw - 24);
        dom.bubbleEl.className = 'nxt-bubble nxt-bubble-card';
        dom.bubbleEl.style.width = bw + 'px';
        dom.bubbleEl.style.left = ((vw - bw) / 2) + 'px';
        dom.bubbleEl.style.top = (vh * 0.28) + 'px';
    }

    // Bug found in manual verification (step 7, product search): the old
    // 4-direction picker required EVERY axis to fit simultaneously, and its
    // fallback clamp could pull `top` back up into the target's own vertical
    // band when nothing fit cleanly — the bubble then rendered directly over
    // the input, on top of it in z-order too (9001 vs the page), blocking
    // typing. Fixed by constructing non-overlap directly instead of picking
    // from a fixed set of candidates: try the preferred side first, fall back
    // to the other side, then dock to whichever edge has more room — and,
    // regardless of which branch ran, a final hard guard refuses to return
    // any `top` whose [top, top+bh] band intersects the target's [top,
    // bottom] band. Horizontal placement is independent of this (different
    // axis — clamping `left` can never cause a vertical overlap), so it's
    // just clamped into the viewport. position:fixed + getBoundingClientRect()
    // are both viewport-relative already — no scrollY term belongs here.
    //
    // Second bug, same step: "below" is also where dispatch-product-search's
    // own results dropdown (.mat-dropdown, z-index:300) renders — a bubble
    // placed below the input sat on top of the dropdown instead of the input
    // itself. A target can opt into `data-tutorial-bubble-prefer="above"` to
    // flip the try-order; set on the product-search input in dispatch.html's
    // buildMatTypeahead() alongside its data-tutorial-target. Below stays the
    // default for every other step (plain inputs/selects with no dropdown of
    // their own).
    function positionBubble(targetRect, el) {
        dom.bubbleEl.className = 'nxt-bubble';
        if (window.innerWidth <= 600) {
            // Bottom sheet — CSS media query owns left/right/width/bottom/top.
            return;
        }
        var bubble = dom.bubbleEl;
        var bw = bubble.offsetWidth || 320;
        var bh = bubble.offsetHeight || 140;
        var gap = 12;
        var vw = window.innerWidth, vh = window.innerHeight;
        var navbarEl = document.getElementById('navbar-container');
        var navH = navbarEl ? navbarEl.getBoundingClientRect().height : 64;
        var minTop = navH + 8;
        var maxBottom = vh - 8;

        var spaceBelow = maxBottom - (targetRect.bottom + gap);
        var spaceAbove = (targetRect.top - gap) - minTop;
        var preferAbove = !!(el && el.dataset && el.dataset.tutorialBubblePrefer === 'above');

        var fitsBelow = spaceBelow >= bh;
        var fitsAbove = spaceAbove >= bh;

        var top;
        if (preferAbove ? fitsAbove : fitsBelow) {
            top = preferAbove ? (targetRect.top - gap - bh) : (targetRect.bottom + gap);
        } else if (preferAbove ? fitsBelow : fitsAbove) {
            top = preferAbove ? (targetRect.bottom + gap) : (targetRect.top - gap - bh);
        } else if (spaceBelow >= spaceAbove) {
            top = maxBottom - bh; // neither fits fully — dock to the roomier edge
        } else {
            top = minTop;
        }

        // Hard guarantee, independent of every branch above: never overlap
        // the target vertically. Only reachable on a viewport too short for
        // the bubble at all — pushes it below the target even past the
        // viewport edge (scrollable/clipped) rather than ever covering it.
        if (top < targetRect.bottom + gap && top + bh > targetRect.top - gap) {
            top = targetRect.bottom + gap;
        }

        var left = Math.max(8, Math.min(targetRect.left, vw - bw - 8));

        bubble.style.top = top + 'px';
        bubble.style.left = left + 'px';
        bubble.style.width = '';
    }

    function renderBlockers(targetRect, pad) {
        clearBlockers();
        var r = { top: targetRect.top - pad, left: targetRect.left - pad,
                  right: targetRect.right + pad, bottom: targetRect.bottom + pad };
        var vw = window.innerWidth, vh = window.innerHeight;
        var rects = [
            { top: 0, left: 0, width: vw, height: Math.max(0, r.top) },
            { top: r.bottom, left: 0, width: vw, height: Math.max(0, vh - r.bottom) },
            { top: r.top, left: 0, width: Math.max(0, r.left), height: r.bottom - r.top },
            { top: r.top, left: r.right, width: Math.max(0, vw - r.right), height: r.bottom - r.top }
        ];
        rects.forEach(function (rc) {
            if (rc.width <= 0 || rc.height <= 0) return;
            var b = document.createElement('div');
            b.className = 'nxt-blocker';
            b.style.top = rc.top + 'px'; b.style.left = rc.left + 'px';
            b.style.width = rc.width + 'px'; b.style.height = rc.height + 'px';
            document.body.appendChild(b);
            dom.blockerEls.push(b);
        });
    }

    // ── advanceOn wiring ──────────────────────────────────────────────────
    function armAdvanceWatchers(step, el) {
        var type = run.demoMode ? 'manual' : ((step.advanceOn && step.advanceOn.type) || 'manual');

        if (type === 'manual' || !el) {
            setNextEnabled(true);
            return;
        }
        if (type === 'input') {
            setNextEnabled(false);
            var minLen = step.advanceOn.minLength || 1;
            var timer = null;
            function check() {
                var ok = (el.value || '').length >= minLen;
                setNextEnabled(ok);
                if (ok) showTick(true);
            }
            function onInput() {
                if (timer) clearTimeout(timer);
                timer = setTimeout(check, INPUT_DEBOUNCE_MS);
            }
            el.addEventListener('input', onInput);
            el.addEventListener('change', onInput);
            addTeardown(function () { el.removeEventListener('input', onInput); el.removeEventListener('change', onInput); if (timer) clearTimeout(timer); });
            check();
            return;
        }
        if (type === 'change') {
            // Correction: Next stays enabled regardless — a programmatic default
            // (e.g. updatePoolDefault()) never fires a native 'change' event, and
            // the user must not be trapped by a value that's already correct.
            setNextEnabled(true);
            run.entryValue = el.value;
            var onChange = function () {
                if (el.value !== run.entryValue) requestAdvance(false);
            };
            el.addEventListener('change', onChange);
            addTeardown(function () { el.removeEventListener('change', onChange); });
            return;
        }
        if (type === 'click') {
            setNextEnabled(true);
            var onClick = function () { requestAdvance(false); };
            el.addEventListener('click', onClick);
            addTeardown(function () { el.removeEventListener('click', onClick); });
            return;
        }
        if (type === 'dom') {
            setNextEnabled(false);
            var checkDom = function () {
                // Guard belongs here too, not just inside requestAdvance: once
                // matched, stop calling setNextEnabled/checkDomCondition on every
                // further mutation for the rest of this step's lifetime.
                if (run.stepAdvanced) return;
                if (checkDomCondition(step.advanceOn)) { setNextEnabled(true); requestAdvance(false); }
            };
            var mo = new MutationObserver(checkDom);
            mo.observe(document.body, { childList: true, subtree: true, attributes: true });
            addTeardown(function () { mo.disconnect(); });
            checkDom();
            return;
        }
        if (type === 'event') {
            setNextEnabled(false);
            var onSignal = function (e) {
                if (run.stepAdvanced) return;
                if (e.detail && e.detail.name === step.advanceOn.name) {
                    run.lastSignal = { name: e.detail.name, meta: e.detail.meta || {} };
                    requestAdvance(true);
                }
            };
            document.addEventListener('nexflow:tutorial-signal', onSignal);
            addTeardown(function () { document.removeEventListener('nexflow:tutorial-signal', onSignal); });
            return;
        }
        setNextEnabled(true);
    }

    function checkDomCondition(advanceOn) {
        var els = document.querySelectorAll(advanceOn.selector);
        if (advanceOn.condition === 'countAtLeast') return els.length >= (advanceOn.value || 1);
        if (advanceOn.condition === 'exists') return els.length > 0;
        if (advanceOn.condition === 'visible') {
            for (var i = 0; i < els.length; i++) {
                var cs = window.getComputedStyle(els[i]);
                if (cs.display !== 'none' && cs.visibility !== 'hidden') return true;
            }
            return false;
        }
        return false;
    }

    // Single choke point for every advance trigger (auto-watchers AND the
    // manual Next/Skip buttons in renderBubble()). Guards against the bug
    // above: whichever trigger fires FIRST for the current step wins;
    // everything else — a duplicate mutation match, a stray double-click, a
    // manual Next racing an auto-advance — becomes a no-op. `immediate`
    // mirrors §4.6: click/dom/change get the 350ms beat, event/manual fire
    // right away. The timer itself is cancelled on the next teardownStep()
    // (addTeardown below), so a step-12 timer can never fire once step 13
    // has already started.
    function requestAdvance(immediate) {
        if (run.stepAdvanced) return;
        run.stepAdvanced = true;
        if (immediate) {
            advance();
        } else {
            var t = setTimeout(advance, ADVANCE_BEAT_MS);
            addTeardown(function () { clearTimeout(t); });
        }
    }

    var nextBtnRef = null;
    function setNextEnabled(v) { if (nextBtnRef) nextBtnRef.disabled = !v; }
    function showTick(v) {
        var tick = dom.bubbleEl.querySelector('.nxt-tick');
        if (tick) tick.style.display = v ? 'inline' : 'none';
    }

    // ── bubble rendering ──────────────────────────────────────────────────
    function renderBubble(step) {
        var b = dom.bubbleEl;
        b.style.display = 'block';
        b.innerHTML = '';

        var exitBtn = document.createElement('button');
        exitBtn.type = 'button'; exitBtn.className = 'nxt-exit-x'; exitBtn.textContent = '×';
        exitBtn.title = tr(UI_STRINGS.exit);
        exitBtn.addEventListener('click', function () { exit('user'); });
        b.appendChild(exitBtn);

        if (step.kind !== 'card') {
            var visibleIdx = 0, visibleTotal = 0;
            for (var i = 0; i < run.steps.length; i++) {
                if (run.steps[i].kind === 'card') continue;
                if (i < run.index) visibleIdx++;
                visibleTotal++;
            }
            var progress = document.createElement('div');
            progress.className = 'nxt-bubble-progress';
            progress.textContent = tr(UI_STRINGS.stepOf).replace('{i}', String(visibleIdx + 1)).replace('{n}', String(visibleTotal));
            b.appendChild(progress);
        }

        if (step.title) {
            var titleEl = document.createElement('div');
            titleEl.className = 'nxt-bubble-title';
            titleEl.textContent = tr(step.title);
            if (step.optional) {
                var chip = document.createElement('span');
                chip.className = 'nxt-chip'; chip.textContent = tr(UI_STRINGS.optionalChip);
                titleEl.appendChild(chip);
            }
            b.appendChild(titleEl);
        }

        if (run.demoMode) {
            var demoChip = document.createElement('div');
            demoChip.className = 'nxt-chip'; demoChip.style.marginBottom = '8px'; demoChip.style.marginLeft = '0';
            demoChip.textContent = tr(UI_STRINGS.demoChip);
            b.appendChild(demoChip);
        }

        var textEl = document.createElement('div');
        textEl.className = 'nxt-bubble-text';
        var textStr = run.demoMode && step.demoText ? tr(step.demoText) : tr(step.text);
        textEl.textContent = textStr;
        var tick = document.createElement('span');
        tick.className = 'nxt-tick'; tick.textContent = '✓'; tick.style.display = 'none';
        textEl.appendChild(tick);
        b.appendChild(textEl);

        if (step.why) {
            var whyEl = document.createElement('div');
            whyEl.className = 'nxt-bubble-why';
            whyEl.textContent = tr(step.why);
            b.appendChild(whyEl);
        }

        var actions = document.createElement('div');
        actions.className = 'nxt-bubble-actions';

        if (run.index > 0) {
            var backBtn = document.createElement('button');
            backBtn.type = 'button'; backBtn.className = 'nxt-btn nxt-btn-ghost';
            backBtn.textContent = tr(UI_STRINGS.back);
            backBtn.addEventListener('click', function () { enterStep(run.index - 1); });
            actions.appendChild(backBtn);
        }

        if (step.optional && step.kind !== 'card') {
            var skipBtn = document.createElement('button');
            skipBtn.type = 'button'; skipBtn.className = 'nxt-btn nxt-btn-ghost';
            skipBtn.textContent = tr(UI_STRINGS.skipThis);
            skipBtn.addEventListener('click', function () { requestAdvance(true); });
            actions.appendChild(skipBtn);
        }

        var isLastStep = (run.index === run.steps.length - 1);
        var nextBtn = document.createElement('button');
        nextBtn.type = 'button'; nextBtn.className = 'nxt-btn nxt-btn-primary';
        nextBtn.textContent = isLastStep ? tr(UI_STRINGS.done) : tr(UI_STRINGS.next);
        nextBtn.addEventListener('click', function () {
            if (nextBtn.disabled) return;
            requestAdvance(true);
        });
        actions.appendChild(nextBtn);
        nextBtnRef = nextBtn;

        b.appendChild(actions);
    }

    // ── scroll target into view ──────────────────────────────────────────
    function scrollToTarget(el) {
        if (!el) return;
        try {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (e) { /* ignore */ }
    }

    // Bug found in manual verification (mobile, 390px): a target reached only
    // by scrolling — e.g. dispatch-consumption-print — could have its
    // spotlight positioned against a still-mid-animation rect, because
    // `scrollIntoView({behavior:'smooth'})` has no completion callback in the
    // spec and the very next frame's queueReposition() ran while the scroll
    // was still in flight. This polls window.scrollY/X until they stop
    // changing for two consecutive frames (scroll settled) and only THEN
    // guarantees one accurate reposition pass — on top of, not instead of,
    // the existing scroll-driven reposition calls, which still make the
    // overlay visually track the page during the animation. Bounded to 1s so
    // a target that never actually scrolls the page at all (e.g. one inside
    // a position:fixed modal, where window.scrollY never changes) still
    // proceeds on the very next couple of frames rather than waiting out a
    // timeout for nothing. Registered on the teardown registry so it can't
    // fire after the user has moved on to a different step.
    function waitForScrollSettle(cb) {
        var lastY = window.scrollY, lastX = window.scrollX, stableFrames = 0;
        var start = Date.now();
        var cancelled = false;
        addTeardown(function () { cancelled = true; });
        function poll() {
            if (cancelled) return;
            if (window.scrollY === lastY && window.scrollX === lastX) {
                stableFrames++;
            } else {
                stableFrames = 0;
                lastY = window.scrollY; lastX = window.scrollX;
            }
            if (stableFrames >= 2 || Date.now() - start > 1000) { cb(); return; }
            requestAnimationFrame(poll);
        }
        requestAnimationFrame(poll);
    }

    // ── lifecycle ─────────────────────────────────────────────────────────
    function buildApplicableSteps(config) {
        return config.steps.filter(function (step) {
            if (typeof step.when !== 'function') return true;
            try { return !!step.when(); } catch (e) { console.warn('[tutorial] when() threw for step', step.id, e); return false; }
        });
    }

    var pageReady = safe(function pageReady(moduleId) {
        var config = registry[moduleId];
        if (!config) return; // no config for this page — silent, by design

        var role = getUserRoleSafe();
        if (config.roles && config.roles.length && role && config.roles.indexOf(role) === -1) return;

        var tenantMode = getTutorialModeSafe();
        if (tenantMode === 'off') return;

        if (isBlockingModalOpen()) return;

        var sessionKey = 'nxt_started_' + moduleId;
        var alreadyStartedThisTab = false;
        try { alreadyStartedThisTab = sessionStorage.getItem(sessionKey) === '1'; } catch (e) {}
        if (alreadyStartedThisTab) return;

        resolveTenantAndUser().then(function (ids) {
            if (!ids) return;
            var demo = isDemoSafe();
            var proceed = function (progressRow) {
                if (tenantMode === 'auto' && progressRow && progressRow.status === 'completed') return;
                try { sessionStorage.setItem(sessionKey, '1'); } catch (e) {}
                setTimeout(function () {
                    if (isBlockingModalOpen()) return;
                    start(moduleId, { resume: true, _auto: true, _ids: ids, _demo: demo, _progressRow: progressRow });
                }, AUTOSTART_SETTLE_MS);
            };
            if (demo) { proceed(null); return; }
            fetchProgressRow(ids.tenantId, ids.userId, moduleId).then(proceed);
        });
    }, 'pageReady');

    var start = safe(function start(moduleId, opts) {
        opts = opts || {};
        var config = registry[moduleId];
        if (!config) { console.warn('[tutorial] start() called for unregistered module', moduleId); return; }
        if (run.active) exit('navigate'); // starting a new run always tears down any prior one

        run.active = true;
        run.moduleId = moduleId;
        run.config = config;
        run.demoMode = !!opts._demo || isDemoSafe();
        run.tenantId = opts._ids ? opts._ids.tenantId : null;
        run.userId = opts._ids ? opts._ids.userId : null;
        run.steps = buildApplicableSteps(config);
        run.index = -1;
        run.lastSignal = null;

        injectStyleOnce();
        buildDom();
        document.body.classList.add('nxt-active');

        function afterResumeDecision(startIndex) {
            if (!run.demoMode) writeProgress({ status: 'in_progress' });
            attachGlobalListeners();
            enterStep(startIndex);
        }

        if (opts.resume && run.tenantId && run.userId && !run.demoMode) {
            var local = readLocalPosition(run.tenantId, run.userId, moduleId);
            var progressRow = opts._progressRow;
            var isRecent = local && (Date.now() - local.ts) < RESUME_WINDOW_MS;
            var wasInProgress = !opts._progressRow || opts._progressRow.status === 'in_progress';
            if (local && isRecent && wasInProgress) {
                var idx = run.steps.findIndex(function (s) { return s.id === local.stepId; });
                if (idx > 0) { offerResume(idx, afterResumeDecision); return; }
            }
        }
        afterResumeDecision(0);
    }, 'start');

    function offerResume(idx, cb) {
        injectStyleOnce(); buildDom();
        dom.overlayEl.style.display = 'none';
        renderResumeCard(idx, cb);
        queueReposition();
    }

    function renderResumeCard(idx, cb) {
        var b = dom.bubbleEl;
        b.style.display = 'block';
        b.className = 'nxt-bubble nxt-bubble-card';
        b.innerHTML = '';
        var title = document.createElement('div');
        title.className = 'nxt-bubble-title'; title.textContent = tr(UI_STRINGS.continueFrom);
        b.appendChild(title);
        var actions = document.createElement('div'); actions.className = 'nxt-bubble-actions';
        var contBtn = document.createElement('button');
        contBtn.type = 'button'; contBtn.className = 'nxt-btn nxt-btn-primary';
        contBtn.textContent = tr(UI_STRINGS.continueFrom);
        contBtn.addEventListener('click', function () { cb(idx); });
        var overBtn = document.createElement('button');
        overBtn.type = 'button'; overBtn.className = 'nxt-btn nxt-btn-ghost';
        overBtn.textContent = tr(UI_STRINGS.startOver);
        overBtn.addEventListener('click', function () { cb(0); });
        actions.appendChild(contBtn); actions.appendChild(overBtn);
        b.appendChild(actions);
        positionCard();
    }

    var enterStep = safe(function enterStep(i) {
        teardownStep();
        if (i >= run.steps.length) { complete(); return; }
        run.index = i;
        run.stepAdvanced = false; // fresh guard for this step — see requestAdvance()
        var step = run.steps[i];

        if (typeof step.onEnter === 'function') { try { step.onEnter(); } catch (e) { console.warn('[tutorial] onEnter threw', e); } }

        if (step.kind === 'card' || !step.target) {
            renderBubble(step);
            positionCard();
            armAdvanceWatchers(step, null);
            writeLocalPosition(step.id);
            return;
        }

        waitForTarget(step, function (el) {
            if (!el) { enterStep(i + 1); return; }
            renderBubble(step);
            scrollToTarget(el);
            queueReposition(); // best-effort immediate pass — overlay visually tracks the scroll via its own CSS transition
            waitForScrollSettle(function () {
                console.log('[tutorial] scrolled to ' + step.target);
                queueReposition();
            }); // guaranteed accurate pass once the scroll has actually finished
            armAdvanceWatchers(step, el);
            writeLocalPosition(step.id);
        });
    }, 'enterStep');

    var advance = safe(function advance() {
        var step = currentStep();
        if (step && typeof step.onExit === 'function') { try { step.onExit(); } catch (e) {} }
        enterStep(run.index + 1);
    }, 'advance');

    var complete = safe(function complete() {
        var text;
        if (run.config.completionText) {
            text = tr(run.config.completionText);
            if (run.lastSignal && run.lastSignal.meta) {
                Object.keys(run.lastSignal.meta).forEach(function (k) {
                    text = text.split('{' + k + '}').join(String(run.lastSignal.meta[k]));
                });
            }
            // Defensive fallback, independent of the requestAdvance() fix above:
            // never show a raw unsubstituted {placeholder} — if a template still
            // has one after substitution (no signal meta carried that key, or no
            // signal fired at all), fall back to the generic Done text instead.
            if (/\{[a-zA-Z0-9_]+\}/.test(text)) text = null;
        }
        renderCompletionCard(text);
        writeProgress({ status: 'completed', last_step_id: null, completed_at: new Date().toISOString() });
        // times_completed increment done via a second upsert reading current value
        // would need a round trip; acceptable to leave at write-time value here —
        // p2_tutorial_progress.times_completed defaults to 0 and this table is not
        // read anywhere yet in T1 beyond the auto-start 'completed' gate.
        clearLocalPosition();
        detachGlobalListeners();
        run.active = false;
    }, 'complete');

    function renderCompletionCard(text) {
        dom.overlayEl.style.display = 'none';
        clearBlockers();
        var b = dom.bubbleEl;
        b.style.display = 'block';
        b.className = 'nxt-bubble nxt-bubble-card';
        b.innerHTML = '';
        var title = document.createElement('div');
        title.className = 'nxt-bubble-title'; title.textContent = tr(run.config.title) || tr(UI_STRINGS.done);
        b.appendChild(title);
        var textEl = document.createElement('div');
        textEl.className = 'nxt-bubble-text'; textEl.textContent = text || tr(UI_STRINGS.done) + '.';
        b.appendChild(textEl);
        var actions = document.createElement('div'); actions.className = 'nxt-bubble-actions';
        var closeBtn = document.createElement('button');
        closeBtn.type = 'button'; closeBtn.className = 'nxt-btn nxt-btn-primary'; closeBtn.textContent = tr(UI_STRINGS.close);
        closeBtn.addEventListener('click', teardownRunUi);
        actions.appendChild(closeBtn);
        b.appendChild(actions);
        positionCard();
    }

    function teardownRunUi() {
        teardownStep();
        removeDom();
        document.body.classList.remove('nxt-active');
    }

    var exit = safe(function exit(reason) {
        if (!run.active) { teardownRunUi(); return; }
        var step = currentStep();
        writeProgress({ status: 'exited', last_step_id: step ? step.id : null });
        // localStorage position is kept on exit — enables resume (§ ADR-7).
        detachGlobalListeners();
        teardownRunUi();
        run.active = false;
        run.moduleId = null;
    }, 'exit');

    function isActive() { return run.active; }

    function onLanguageChange(lang) {
        if (!run.active) return;
        var step = currentStep();
        if (step) renderBubble(step);
    }

    function signal(name, meta) {
        document.dispatchEvent(new CustomEvent('nexflow:tutorial-signal', { detail: { name: name, meta: meta || {} } }));
    }

    // ── global listeners (scroll/resize/mutation/beforeunload) ─────────────
    var globalHandlers = null;
    function attachGlobalListeners() {
        if (globalHandlers) return;
        var onScroll = function () { queueReposition(); };
        var onResize = function () { queueReposition(); };
        var mo = new MutationObserver(function () { queueReposition(); });
        mo.observe(document.body, { childList: true, subtree: true, attributes: true });
        var onBeforeUnload = function () { if (run.active) exit('navigate'); };
        var onLangEvent = function (e) { onLanguageChange(e && e.detail && e.detail.lang); };

        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        window.addEventListener('beforeunload', onBeforeUnload);
        document.addEventListener('nexflow:langchange', onLangEvent);

        globalHandlers = { onScroll: onScroll, onResize: onResize, mo: mo, onBeforeUnload: onBeforeUnload, onLangEvent: onLangEvent };
    }
    function detachGlobalListeners() {
        if (!globalHandlers) return;
        window.removeEventListener('scroll', globalHandlers.onScroll, true);
        window.removeEventListener('resize', globalHandlers.onResize);
        window.removeEventListener('beforeunload', globalHandlers.onBeforeUnload);
        document.removeEventListener('nexflow:langchange', globalHandlers.onLangEvent);
        globalHandlers.mo.disconnect();
        globalHandlers = null;
    }

    window.NexflowTutorial = {
        register: register,
        pageReady: pageReady,
        start: function (moduleId, opts) {
            opts = opts || {};
            if (opts._ids) { start(moduleId, opts); return; }
            resolveTenantAndUser().then(function (ids) {
                start(moduleId, Object.assign({}, opts, { _ids: ids, _demo: isDemoSafe() }));
            });
        },
        exit: exit,
        isActive: isActive,
        getLang: getLang,
        onLanguageChange: onLanguageChange,
        signal: signal
    };
})();
