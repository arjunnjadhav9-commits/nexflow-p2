/*!
 * Dispatch tutorial config — T1, English only.
 * Correction B (session T1 plan review): step bundles deliberately OMIT the
 * `mr` key entirely. tr()'s fallback (`bundle[lang] != null ? ... : bundle.en`)
 * only skips a key that is genuinely absent — an empty string 'mr': '' would
 * be returned literally and render a blank tooltip the first time a Marathi
 * session hits this page. Marathi content is T2 scope (tutorial-engine.md §9.2)
 * and will be authored, reviewed and read-aloud tested per §8.5 before it is
 * added here — never machine-translated, never added as an empty placeholder.
 *
 * Same 3 return-movement purposes dispatch.html's own RETURN_PURPOSES constant
 * uses (dispatch.html:604) — duplicated here rather than shared, matching this
 * codebase's no-module-system convention (every shared value is duplicated per
 * file, not imported).
 */
(function () {
    'use strict';

    var RETURN_PURPOSES = ['job_work_return', 'unused_material_return', 'scrap_return'];

    function currentPurpose() {
        var el = document.getElementById('movementPurpose');
        return el ? el.value : '';
    }

    NexflowTutorial.register('dispatch', {
        version: 1,
        roles: ['owner', 'supervisor', 'operator'],
        title: { en: 'Sending goods out' },
        intro: { en: "We'll do a real dispatch together. At the end this prints a real challan and reduces your stock." },
        completionText: { en: 'Done — challan {challan_number} is created.' },
        steps: [
            {
                id: 'intro',
                kind: 'card',
                title: { en: 'Sending goods out' },
                text: { en: "We'll send goods to a customer and print a challan together. About 9 steps." },
                why: { en: 'This creates a real challan and reduces your stock.' },
                advanceOn: { type: 'manual' }
            },
            {
                id: 'client-name',
                target: 'dispatch-client-name',
                title: { en: 'Client name' },
                text: { en: "Type who you're sending the goods to. If you've sent to them before, pick them from the list." },
                why: { en: 'This name is printed on the challan and is who the invoice is raised against.' },
                advanceOn: { type: 'input', minLength: 1 }
            },
            {
                id: 'client-address',
                target: 'dispatch-client-address',
                title: { en: 'Client address' },
                text: { en: "Check the address. If this client is saved, it filled in by itself — read it before moving on." },
                why: { en: "A wrong address on a challan is a problem at the customer's gate, not yours." },
                advanceOn: { type: 'input', minLength: 1 }
            },
            {
                id: 'po-number',
                target: 'dispatch-po-number',
                optional: true,
                title: { en: 'PO number' },
                text: { en: 'If the customer gave you a PO number, put it here.' },
                why: { en: "Their store matches your challan against this number. No PO, no gate entry, at most factories." },
                advanceOn: { type: 'manual' }
            },
            {
                id: 'date-transport',
                target: 'dispatch-date',
                title: { en: 'Dispatch date' },
                text: { en: "Today's date is already filled. Change it only if the truck actually left on a different day." },
                why: { en: 'The date decides which month this challan is counted in for GST.' },
                advanceOn: { type: 'manual' }
            },
            {
                id: 'purpose',
                target: 'dispatch-purpose',
                title: { en: 'Purpose' },
                text: { en: 'Choose why this material is going out.' },
                why: { en: 'This is the most important box on this page. "Sale" means you can raise an invoice. Job-work purposes mean you cannot — Nexflow will stop you, to keep your GSTR-1 correct.' },
                advanceOn: { type: 'change' },
                when: function () { return (typeof isJobWorker === 'function' && isJobWorker()) || (typeof isPrincipal === 'function' && isPrincipal()); }
            },
            {
                id: 'pool',
                target: 'dispatch-pool',
                title: { en: 'Deduct stock from' },
                text: { en: 'Choose whose stock this comes out of — your own, or your principal’s.' },
                why: { en: "Deducting from the wrong pool breaks your ITC-04 and the principal's s.143 position." },
                advanceOn: { type: 'change' },
                when: function () {
                    return typeof isJobWorker === 'function' && isJobWorker() &&
                        typeof isSeparatePoolDeduction === 'function' && isSeparatePoolDeduction();
                }
            },
            {
                id: 'product-search',
                target: 'dispatch-product-search',
                title: { en: 'Pick the product' },
                text: { en: 'Type the product name or its code, then tap it in the list.' },
                why: { en: 'Picking from the list links the dispatch to the right BOM, so the right raw materials come out of stock.' },
                advanceOn: { type: 'input', minLength: 1 }
            },
            {
                id: 'qty',
                target: 'dispatch-qty',
                title: { en: 'Quantity' },
                text: { en: 'How many are you sending?' },
                why: { en: 'Nexflow will deduct raw material for exactly this many.' },
                advanceOn: { type: 'input', minLength: 1 }
            },
            {
                id: 'add-product',
                target: 'dispatch-add-product',
                title: { en: 'Add it to the list' },
                text: { en: 'Press "Add Product" to add this product to the challan.' },
                onError: { en: 'Nothing was added — pick a product from the list first, then enter a quantity.' },
                why: { en: 'Adding it to the list is what puts it on the challan. Nothing is sent until it is in this list.' },
                advanceOn: { type: 'dom', selector: '#productsTableBody tr', condition: 'countAtLeast', value: 1 }
            },
            {
                id: 'items-table',
                target: 'dispatch-items-table',
                title: { en: 'Your challan list' },
                text: { en: "Here's your challan list. You can set a PO per line, or remove a line with ✕. Add more products the same way." },
                why: { en: 'Everything in this list goes on one challan with one challan number.' },
                advanceOn: { type: 'manual' }
            },
            {
                id: 'challan-links',
                target: 'dispatch-challan-links',
                optional: true,
                title: { en: 'Link to original challan' },
                text: { en: "Link this return to the original challan it came in on. If the original isn't in the list, leave it — it means the material came from outside Nexflow." },
                why: { en: 'Without this link, your ITC-04 cannot show which outward challan this return settles.' },
                advanceOn: { type: 'manual' },
                when: function () { return RETURN_PURPOSES.indexOf(currentPurpose()) !== -1; }
            },
            {
                id: 'confirm-btn',
                target: 'dispatch-confirm',
                title: { en: 'Confirm the dispatch' },
                text: { en: 'Press "Confirm Dispatch".' },
                why: { en: 'Nothing has been saved yet — this opens a check screen first.' },
                advanceOn: { type: 'dom', selector: '#confirmModal', condition: 'visible' }
            },
            {
                id: 'confirm-modal',
                target: 'dispatch-confirm-modal-confirm',
                // Spotlight the whole modal card (client + items list + warning +
                // buttons), not just the Confirm button — the button alone left the
                // items list sitting in the dimmed area, and the bubble (sized to
                // the button's own tiny rect) rendered on top of the items list.
                // The Confirm button stays the actual advanceOn target — this only
                // widens what's highlighted and what the bubble avoids overlapping.
                spotlightTarget: 'dispatch-confirm-modal',
                title: { en: 'Last check' },
                text: { en: "Read the list once. If it's right, press \"Confirm\"." },
                why: { en: 'This is the last stop. After this, stock is deducted and the challan number is used up — it cannot be undone.' },
                advanceOn: { type: 'event', name: 'dispatch:confirmed' }
            },
            {
                id: 'consumption',
                target: 'dispatch-consumption-print',
                title: { en: 'Print the challan' },
                text: { en: 'This shows what came out of stock, and warns you if anything dropped below its minimum. Press "Print Challan".' },
                why: { en: 'This is your proof of what left the factory. Print it before the truck goes.' },
                advanceOn: { type: 'manual' }
            }
        ]
    });
})();
