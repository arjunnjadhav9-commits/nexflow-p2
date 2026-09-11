/**
 * full-export.js — "Export All Data" (enterprise-strategy.md §3.4, v1).
 *
 * One button, one zip: every table as CSV, a manifest, a README, a Tally
 * import XML for the current financial year, and PDF copies of this FY's
 * invoices/challans. Client-side only — no Edge Function, no server-side
 * zip, matching the locked architecture decision (server-side PDF
 * generation was abandoned, see js/challan-pdf.js's own header comment).
 *
 * No modules, no build step: everything attached to window, matching
 * js/challan-pdf.js and the rest of the codebase. Small helpers
 * (normaliseInvoiceNo, the GSTIN state-code table) are duplicated here
 * rather than imported — same convention grn.html and gstr2b-reconcile.html
 * already use for normaliseInvoiceNo, since there's no shared module system.
 *
 * Consumed by: settings.html → Company Details tab → "Export All Data".
 */

(function () {
    'use strict';

    const JSZIP_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

    // ── every table this export dumps as CSV, tenant-scoped, 1000 rows/page ──
    const CSV_TABLES = [
        'p2_tenant_settings', 'p2_raw_materials', 'p2_products', 'p2_product_bom',
        'p2_suppliers', 'p2_clients', 'p2_stock_transactions', 'p2_dispatch_orders',
        'p2_dispatch_items', 'p2_challan_links', 'p2_wip_transactions', 'p2_invoices',
        'p2_payment_receipts', 'p2_supplier_advances', 'p2_material_prices',
        'p2_product_prices', 'p2_cancelled_challans', 'p2_user_roles',
        'p2_notifications', 'p2_agent_logs'
    ];

    // p2_user_roles has no `id` column anywhere in this codebase (confirmed by
    // grep — every live query selects/filters on user_id, never id; it also has
    // no CREATE TABLE in supabase/migrations/, per codebase-audit.md's "initial
    // schema" note). Every other p2_* table has a uuid `id` and paginates on it.
    const ORDER_COLUMN_OVERRIDES = { p2_user_roles: 'user_id', p2_tenant_settings: 'tenant_id' };

    // Hardcoded placeholders — p2_tally_targets.ledger_map doesn't exist yet
    // (Session 18). Purchase-side ledger names are rate-derived, not listed
    // here — see buildPurchaseVoucher().
    const LEDGERS = {
        salesTaxable: 'Job Work Charges @ 18%',
        outputCgst: 'Output CGST',
        outputSgst: 'Output SGST',
        outputIgst: 'Output IGST',
        inputCgst: 'Input CGST',
        inputSgst: 'Input SGST',
        inputIgst: 'Input IGST',
        roundOff: 'Round Off',
    };

    // Bare state name (no "(27)" suffix) — trimmed duplicate of export.html's
    // GST_STATE_CODES/getPlaceOfSupply, same duplication convention as
    // normaliseInvoiceNo below.
    const GST_STATE_CODES = {
        '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
        '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
        '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
        '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
        '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
        '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
        '24': 'Gujarat', '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli and Daman and Diu',
        '27': 'Maharashtra', '28': 'Andhra Pradesh (Old)', '29': 'Karnataka', '30': 'Goa',
        '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
        '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh',
        '38': 'Ladakh', '97': 'Other Territory'
    };

    // ── small helpers ────────────────────────────────────────────────────────

    function normaliseInvoiceNo(str) {
        return String(str || '').replace(/[\s\-\/]/g, '').toUpperCase();
    }

    function gstinStateName(gstin) {
        if (!gstin) return '';
        return GST_STATE_CODES[String(gstin).slice(0, 2)] || '';
    }

    function friendlyTableName(table) {
        return table.replace(/^p2_/, '').replace(/_/g, ' ');
    }

    function slugify(str) {
        return (String(str || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')) || 'export';
    }

    function sanitizeFilePart(str) {
        return String(str || 'file').replace(/[^A-Za-z0-9_-]/g, '_');
    }

    function xmlEscape(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function ymd(isoDate) {
        return String(isoDate || '').slice(0, 10).replace(/-/g, '');
    }

    /** Current IST wall-clock time, read via Intl so it's correct regardless of
     *  the browser's own timezone — sidesteps the UTC-offset drift bug class
     *  _ai/CLAUDE.md's agent-query notes already flag around todayIST(). */
    function nowIST() {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        }).formatToParts(new Date());
        const get = (t) => parts.find((p) => p.type === t).value;
        return {
            year: +get('year'), month: +get('month'), day: +get('day'),
            hour: (+get('hour')) % 24, minute: +get('minute'), second: +get('second')
        };
    }

    function currentFY(p) {
        const startYear = p.month >= 4 ? p.year : p.year - 1;
        const endYear = startYear + 1;
        return {
            startISO: `${startYear}-04-01`,
            endISO: `${endYear}-03-31`,
            label: `FY${startYear}-${String(endYear).slice(-2)}`
        };
    }

    function istIsoString(p) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}+05:30`;
    }

    function isoDateOnly(p) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    // ── JSZip lazy load (cdnjs) ──────────────────────────────────────────────
    // Deliberately lazy, not a static <script> tag: owners are on phones, and a
    // page that never runs an export must not pay for the library — same
    // reasoning js/challan-pdf.js already documents for jsPDF.

    let jszipPromise = null;
    function loadJSZip() {
        if (window.JSZip) return Promise.resolve();
        if (jszipPromise) return jszipPromise;
        jszipPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = JSZIP_SRC;
            s.async = true;
            s.addEventListener('load', () => resolve());
            s.addEventListener('error', () => reject(new Error('Failed to load JSZip')));
            document.head.appendChild(s);
        }).catch((err) => { jszipPromise = null; throw err; });
        return jszipPromise;
    }

    // ── paged PostgREST reads ────────────────────────────────────────────────

    /** Fetch every row of `table` for one tenant, 1000 rows per page. */
    async function fetchAllRows(table, tenantId, onCount, orderColumn) {
        const PAGE = 1000;
        const col = orderColumn || 'id';
        let from = 0, rows = [];
        while (true) {
            const { data, error } = await window.supabase.from(table).select('*')
                .eq('tenant_id', tenantId)
                .order(col, { ascending: true })
                .range(from, from + PAGE - 1);
            if (error) throw error;
            rows = rows.concat(data);
            onCount?.(rows.length);
            if (!data.length || data.length < PAGE) break;
            from += PAGE;
        }
        return rows;
    }

    /**
     * GRN rows for the Tally Purchase-voucher layer: transaction_type='grn'
     * AND owned_by IS NULL, scoped to one FY, 1000 rows per page.
     *
     * Deliberately a SEPARATE query from the unfiltered p2_stock_transactions
     * fetch the CSV layer already does (that one needs every row, every year,
     * for a complete data dump) — this hard invariant
     * (enterprise-strategy.md §3.1: "owned_by IS NOT NULL GRN rows must NEVER
     * become Purchase vouchers... assert it in the query, assert it again in
     * the builder") gets its own `.is('owned_by', null)` clause at the query
     * level, not just a JS filter over already-fetched rows. The post-fetch
     * check below is the second assertion the same sentence calls for.
     */
    async function fetchGrnRowsForTally(tenantId, fy, onCount) {
        const PAGE = 1000;
        let from = 0, rows = [];
        while (true) {
            const { data, error } = await window.supabase.from('p2_stock_transactions')
                .select('*')
                .eq('tenant_id', tenantId)
                .eq('transaction_type', 'grn')
                .is('owned_by', null)
                .gte('transaction_date', fy.startISO)
                .lte('transaction_date', fy.endISO)
                .order('id', { ascending: true })
                .range(from, from + PAGE - 1);
            if (error) throw error;
            rows = rows.concat(data);
            onCount?.(rows.length);
            if (!data.length || data.length < PAGE) break;
            from += PAGE;
        }
        const leaked = rows.filter((r) => r.owned_by !== null);
        if (leaked.length) {
            throw new Error(`${leaked.length} principal-owned GRN row(s) leaked past the owned_by filter`);
        }
        return rows;
    }

    // ── CSV ──────────────────────────────────────────────────────────────────

    function csvCell(v) {
        if (v === null || v === undefined) return '""';
        const s = (typeof v === 'object') ? JSON.stringify(v) : String(v);
        return `"${s.replace(/"/g, '""')}"`;
    }

    function buildCsv(rows) {
        if (!rows.length) return '';
        const headers = Object.keys(rows[0]);
        const lines = [headers.map((h) => csvCell(h)).join(',')];
        for (const r of rows) lines.push(headers.map((h) => csvCell(r[h])).join(','));
        return lines.join('\r\n');
    }

    // ── Tally XML ────────────────────────────────────────────────────────────

    function fnv1aHex(str) {
        let hash = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    /**
     * NOT the canonical REMOTEID the future Bridge Agent (enterprise-strategy.md
     * §3.1, Session 18+) will generate. Real SHA256 is deferred (async browser
     * crypto — see the manifest.json TODO below); this is a synchronous
     * placeholder hash, fine for a one-shot static export with no live sync
     * loop to dedup against yet. Tally's overwrite-on-matching-Remote-GUID
     * import setting depends on a REMOTEID staying stable forever, so once the
     * real Bridge Agent ships it will NOT recognise vouchers this export
     * already created, and will create duplicates rather than altering them —
     * README.txt's Bridge Agent note tells the client this explicitly.
     */
    function buildRemoteId(tenantId, doctype, sourceKey) {
        return `nexflow-${String(tenantId).slice(0, 8)}-${doctype}-${fnv1aHex(String(sourceKey)).slice(0, 8)}`;
    }

    function isBalanced(entries) {
        const sum = entries.reduce((s, e) => s + e.amount, 0);
        return Math.abs(sum) < 0.01;
    }

    function renderVoucherEntries(entries) {
        return entries.map((e) => {
            const partyTag = e.isParty ? '\n     <ISPARTYLEDGER>Yes</ISPARTYLEDGER>' : '';
            return `
    <ALLLEDGERENTRIES.LIST>
     <LEDGERNAME>${xmlEscape(e.ledger)}</LEDGERNAME>
     <ISDEEMEDPOSITIVE>${e.amount < 0 ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>${partyTag}
     <AMOUNT>${e.amount.toFixed(2)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>`;
        }).join('');
    }

    function renderVoucher(v) {
        return `
   <TALLYMESSAGE xmlns:UDF="TallyUDF">
    <VOUCHER REMOTEID="${xmlEscape(v.remoteId)}" VCHTYPE="${v.vchType}" ACTION="Create" OBJVIEW="Accounting Voucher View">
     <DATE>${v.date}</DATE>
     <EFFECTIVEDATE>${v.date}</EFFECTIVEDATE>
     <VOUCHERTYPENAME>${v.vchType}</VOUCHERTYPENAME>
     <VOUCHERNUMBER>${xmlEscape(v.voucherNumber)}</VOUCHERNUMBER>
     <REFERENCE>${xmlEscape(v.voucherNumber)}</REFERENCE>
     <REFERENCEDATE>${v.date}</REFERENCEDATE>
     <PARTYLEDGERNAME>${xmlEscape(v.partyLedgerName)}</PARTYLEDGERNAME>
     <PARTYNAME>${xmlEscape(v.partyLedgerName)}</PARTYNAME>
     <PARTYGSTIN>${xmlEscape(v.partyGstin)}</PARTYGSTIN>
     <PLACEOFSUPPLY>${xmlEscape(v.placeOfSupply)}</PLACEOFSUPPLY>
     <STATENAME>${xmlEscape(v.stateName)}</STATENAME>
     <COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>
     <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
     <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
     <NARRATION>${xmlEscape(v.narration)}</NARRATION>${renderVoucherEntries(v.entries)}
    </VOUCHER>
   </TALLYMESSAGE>`;
    }

    // Multi-voucher-per-REQUESTDATA wrapping (repeated TALLYMESSAGE blocks) is
    // Tally's standard bulk-import shape, inferred from general Tally XML
    // gateway convention — enterprise-strategy.md §3.1 only shows a single
    // voucher and explicitly flags the envelope as [UNVERIFIED — verify per
    // installation]: "create a scratch company, enter one Sales and one
    // Purchase voucher by hand, export them, and mirror that file field for
    // field" before relying on this in a real import.
    function renderEnvelope(vouchers, companyName) {
        const messages = vouchers.map((v) => renderVoucher(v)).join('');
        return `<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>${xmlEscape(companyName)}</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>${messages}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>`;
    }

    function buildSalesVouchers(invoices, tenantId) {
        const vouchers = [];
        let skipped = 0;
        for (const inv of invoices) {
            const total = Number(inv.amount_total) || 0;
            const subtotal = Number(inv.amount_subtotal) || 0;
            const gstAmt = Number(inv.amount_gst) || 0;
            const roundOff = Number(inv.round_off) || 0;

            const entries = [
                { ledger: inv.client_name || 'Unknown Party', isParty: true, amount: -total },
                { ledger: LEDGERS.salesTaxable, amount: subtotal },
            ];
            if (inv.gst_type === 'cgst_sgst') {
                entries.push({ ledger: LEDGERS.outputCgst, amount: gstAmt / 2 });
                entries.push({ ledger: LEDGERS.outputSgst, amount: gstAmt / 2 });
            } else if (inv.gst_type === 'igst') {
                entries.push({ ledger: LEDGERS.outputIgst, amount: gstAmt });
            }
            if (roundOff) entries.push({ ledger: LEDGERS.roundOff, amount: roundOff });

            const remoteId = buildRemoteId(tenantId, 'inv', inv.id);
            const dateStr = ymd(inv.invoice_date);
            const voucher = {
                remoteId, vchType: 'Sales', voucherNumber: inv.invoice_number || inv.id,
                date: dateStr,
                partyLedgerName: inv.client_name || 'Unknown Party',
                partyGstin: inv.client_gstin || '',
                placeOfSupply: (inv.gst_type === 'igst' ? gstinStateName(inv.client_gstin) : '') || 'Maharashtra',
                stateName: 'Maharashtra',
                narration: `Nexflow ${inv.invoice_number || ''} | src:${remoteId}`,
                entries,
            };
            if (isBalanced(entries)) vouchers.push(voucher); else skipped++;
        }
        return { vouchers, skipped };
    }

    function buildPurchaseVouchers(grnRows, suppliersById, materialsById, tenantId) {
        const groups = new Map();
        for (const row of grnRows) {
            const norm = normaliseInvoiceNo(row.invoice_no);
            if (!row.supplier_id || !norm) continue;
            const key = row.supplier_id + '|' + norm;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(row);
        }

        const vouchers = [];
        let skipped = 0;

        for (const [key, rows] of groups) {
            const supplier = suppliersById.get(rows[0].supplier_id) || {};
            const isInterstate = rows[0].purchase_type === 'interstate';

            // Multi-rate groups: one supplier invoice can mix materials taxed at
            // different rates (real in this data). One Purchase + tax ledger
            // pair per distinct gst_rate present, not one pair for the whole
            // voucher — enterprise-strategy.md §3.1's sample shows a single
            // pair only because its example invoice is single-rate.
            const byRate = new Map();
            for (const row of rows) {
                const material = materialsById.get(row.raw_material_id);
                const rate = Number(material?.gst_rate) || 0;
                const amount = (Number(row.quantity) || 0) * (Number(row.rate) || 0);
                byRate.set(rate, (byRate.get(rate) || 0) + amount);
            }

            const entries = [];
            let grandTotal = 0;
            for (const [rate, taxable] of byRate) {
                entries.push({ ledger: `Purchase @ ${rate}%`, amount: -taxable });
                const taxAmt = (taxable * rate) / 100;
                if (isInterstate) {
                    entries.push({ ledger: LEDGERS.inputIgst, amount: -taxAmt });
                } else {
                    entries.push({ ledger: LEDGERS.inputCgst, amount: -taxAmt / 2 });
                    entries.push({ ledger: LEDGERS.inputSgst, amount: -taxAmt / 2 });
                }
                grandTotal += taxable + taxAmt;
            }
            entries.push({ ledger: supplier.name || 'Unknown Supplier', isParty: true, amount: grandTotal });

            const earliestDate = rows.reduce((min, r) => (r.transaction_date < min ? r.transaction_date : min), rows[0].transaction_date);
            const remoteId = buildRemoteId(tenantId, 'pur', key);
            const voucher = {
                remoteId, vchType: 'Purchase', voucherNumber: rows[0].invoice_no || key,
                date: ymd(earliestDate),
                partyLedgerName: supplier.name || 'Unknown Supplier',
                partyGstin: supplier.gstin || '',
                placeOfSupply: 'Maharashtra',
                stateName: 'Maharashtra',
                narration: `Nexflow GRN ${rows[0].invoice_no || ''} | src:${remoteId}`,
                entries,
            };
            if (isBalanced(entries)) vouchers.push(voucher); else skipped++;
        }
        return { vouchers, skipped };
    }

    // ── PDFs (current FY only — see README's note to the client) ───────────

    async function buildInvoicePdfs(zip, invoices, settings, onProgress) {
        let done = 0;
        for (const inv of invoices) {
            onProgress?.(`Generating invoice PDFs... ${done + 1}/${invoices.length}`);
            const items = Array.isArray(inv.items) ? inv.items : [];
            const payload = {
                companyName: settings.company_name || '',
                addressLine1: settings.address_line1 || '',
                addressLine2: settings.address_line2 || '',
                mobile: settings.mobile || '',
                gstin: settings.gstin || '',
                invoiceNumber: inv.invoice_number || '-',
                invoiceDateFormatted: formatDate(inv.invoice_date),
                invoiceMode: inv.invoice_mode || 'single',
                periodFromFormatted: inv.date_from ? formatDate(inv.date_from) : null,
                periodToFormatted: inv.date_to ? formatDate(inv.date_to) : null,
                clientName: inv.client_name || 'N/A',
                clientAddress: inv.client_address || '',
                clientGstin: inv.client_gstin || '',
                items: items.map((item) => ({
                    challanNumber: item.challan_number || null,
                    dispatchDateFormatted: item.dispatch_date ? formatDate(item.dispatch_date) : null,
                    description: item.description || '',
                    qty: item.qty, unit: item.unit, rate: item.rate, amount: item.amount,
                    hsnSac: item.hsn_sac || '',
                })),
                gstType: inv.gst_type || 'cgst_sgst',
                amountSubtotal: inv.amount_subtotal,
                amountGst: inv.amount_gst,
                amountTotal: inv.amount_total,
                roundOff: inv.round_off || 0,
                docCategory: inv.doc_category || 'goods',
                bankName: settings.bank_name || '',
                bankAccount: settings.bank_account || '',
                bankIfsc: settings.bank_ifsc || '',
                sacCode: settings.sac_code || '',
                placeOfSupply: inv.client_address ? (inv.client_address.split(',').pop() || '').trim() : '',
                isCancelled: inv.status === 'cancelled',
            };
            try {
                const base64 = await window.buildInvoicePdf(payload);
                zip.file(`documents/invoices/${sanitizeFilePart(inv.invoice_number || inv.id)}.pdf`, base64, { base64: true });
            } catch (err) {
                console.warn('[full-export] skipped invoice PDF', inv.invoice_number, err);
            }
            done++;
        }
        return done;
    }

    async function buildChallanPdfs(zip, dispatches, itemsByOrder, productsById, settings, onProgress) {
        let done = 0;
        for (const dispatch of dispatches) {
            onProgress?.(`Generating challan PDFs... ${done + 1}/${dispatches.length}`);
            const items = itemsByOrder.get(dispatch.id) || [];
            const payload = {
                companyName: settings.company_name || '',
                addressLine1: settings.address_line1 || '',
                addressLine2: settings.address_line2 || '',
                mobile: settings.mobile || '',
                gstin: settings.gstin || '',
                clientName: dispatch.client_name || 'N/A',
                clientAddressLines: (dispatch.client_address || '').split('\n').map((l) => l.trim()).filter(Boolean),
                challanNumber: dispatch.challan_number || '-',
                dispatchDateFormatted: formatDate(dispatch.dispatch_date),
                poNumber: dispatch.po_number || null,
                vehicleNumber: dispatch.vehicle_number || undefined,
                note: dispatch.challan_note || undefined,
                footerNote: dispatch.challan_footer || undefined,
                items: items.map((item) => ({
                    // material_name is NULL at DB level for product dispatches
                    // (_ai/CLAUDE.md) — resolve via p2_products, same rule the
                    // receive-dispatch Edge Function applies server-side.
                    description: dispatch.dispatch_type === 'product'
                        ? (productsById.get(item.product_id)?.name || '')
                        : (item.material_code || item.material_name || ''),
                    qty: String(item.qty_dispatched ?? ''),
                    unit: item.unit || '',
                    po_number: item.po_number || null,
                })),
                dispatchToken: dispatch.dispatch_token || null,
                plan: settings.plan || null,
                forceShowQr: false,
            };
            try {
                const base64 = await window.buildChallanPdf(payload);
                zip.file(`documents/challans/${sanitizeFilePart(dispatch.challan_number || dispatch.id)}.pdf`, base64, { base64: true });
            } catch (err) {
                console.warn('[full-export] skipped challan PDF', dispatch.challan_number, err);
            }
            done++;
        }
        return done;
    }

    // ── README ───────────────────────────────────────────────────────────────

    function buildReadme({ companyName, nowParts, fy, skippedVouchers }) {
        const pad = (n) => String(n).padStart(2, '0');
        const dateStr = `${pad(nowParts.day)}/${pad(nowParts.month)}/${nowParts.year}`;

        const lines = [
            'NEXFLOW AUTOMATIONS — FULL DATA EXPORT',
            '========================================',
            '',
            `Company: ${companyName}`,
            `Export date: ${dateStr} (IST)`,
            'Schema version: 1.0',
            '',
            'WHAT THIS IS',
            '------------',
            'A complete, self-contained copy of your Nexflow data: every table as a CSV',
            'file (data/), a machine-readable manifest (manifest.json), your invoices and',
            `delivery challans for the current financial year (${fy.label}) as PDFs`,
            '(documents/invoices, documents/challans), and this financial year\'s sales and',
            'purchase transactions as a Tally import file (documents/tally/). Nothing here',
            'depends on Nexflow staying online — this export is yours to keep, on any drive',
            'you choose.',
            '',
            'OLDER INVOICES AND CHALLANS',
            '----------------------------',
            'PDFs in this export cover the current financial year only, to keep the export',
            'quick to generate on a phone. Invoices and challans from earlier years can be',
            'downloaded individually at any time from inside the Nexflow app.',
            '',
            'IMPORTING THE TALLY FILE',
            '-------------------------',
            '1. Open TallyPrime and load the company you want to import into.',
            '2. Gateway of Tally -> Import -> Vouchers.',
            `3. Select documents/tally/vouchers-${fy.label}.xml from this export.`,
            '',
            'Ledger names in this file are Nexflow defaults (e.g. "Purchase @ 18%",',
            '"Output CGST", "Input SGST") — update them to match your own Tally chart of',
            'accounts before importing, or the import will fail with a "ledger does not',
            'exist" error.',
            '',
            'If you plan to use the Nexflow Bridge Agent in future, treat this XML as a',
            'one-time historical import only. Do not later run the Bridge Agent\'s sync',
            'over the same financial year without checking for duplicates first — the',
            'voucher IDs in this export are not the ones the Bridge Agent will use, so it',
            'will not recognise these vouchers as already imported.',
            '',
        ];

        if (skippedVouchers > 0) {
            lines.push(
                `NOTE: ${skippedVouchers} voucher(s) were skipped from the Tally file because`,
                'their amounts did not balance to zero, and could not be safely included.',
                'Contact support before relying on this export for filing.',
                ''
            );
        }

        lines.push(
            'NEED HELP?',
            '----------',
            'WhatsApp: +91 72489 32468',
            'Web: nexflowautomations.in',
            '',
            `Generated by Nexflow Automations on ${dateStr}.`
        );

        return lines.join('\r\n');
    }

    // ── orchestrator ─────────────────────────────────────────────────────────

    /**
     * @param {Object} p
     * @param {string} p.tenantId
     * @param {(message: string) => void} [p.onProgress]
     * @returns {Promise<{ok: true, skippedVouchers: number, totalRows: number}>}
     */
    async function runFullExport({ tenantId, onProgress }) {
        let stage = 'starting the export';
        try {
            stage = 'loading export tools';
            onProgress?.('Preparing export...');
            await loadJSZip();
            const zip = new window.JSZip();

            const data = {};
            const manifestTables = [];

            stage = 'reading your data';
            for (const table of CSV_TABLES) {
                const label = friendlyTableName(table);
                onProgress?.(`Exporting ${label}...`);
                const orderColumn = ORDER_COLUMN_OVERRIDES[table];
                const rows = await fetchAllRows(table, tenantId, (count) => {
                    onProgress?.(`Exporting ${label}... ${count.toLocaleString('en-IN')} rows`);
                }, orderColumn);
                data[table] = rows;
                zip.file(`data/${table}.csv`, '﻿' + buildCsv(rows));
                manifestTables.push({ file: `data/${table}.csv`, rows: rows.length });
            }

            const settings = data.p2_tenant_settings[0] || {};
            const companyName = settings.company_name || 'Nexflow Export';
            const nowParts = nowIST();
            const fy = currentFY(nowParts);

            stage = 'building the Tally file';
            onProgress?.('Fetching purchase records for the Tally file...');
            const grnRows = await fetchGrnRowsForTally(tenantId, fy, (count) => {
                onProgress?.(`Fetching purchase records for the Tally file... ${count.toLocaleString('en-IN')} rows`);
            });

            onProgress?.('Building Tally import file...');
            const suppliersById = new Map(data.p2_suppliers.map((s) => [s.id, s]));
            const materialsById = new Map(data.p2_raw_materials.map((m) => [m.id, m]));
            const salesSource = data.p2_invoices.filter((inv) =>
                inv.status === 'sent' && inv.invoice_date >= fy.startISO && inv.invoice_date <= fy.endISO);

            const salesResult = buildSalesVouchers(salesSource, tenantId);
            const purchaseResult = buildPurchaseVouchers(grnRows, suppliersById, materialsById, tenantId);
            const allVouchers = salesResult.vouchers.concat(purchaseResult.vouchers);
            const skippedVouchers = salesResult.skipped + purchaseResult.skipped;

            const tallyXml = renderEnvelope(allVouchers, (companyName || '').toUpperCase());
            zip.file(`documents/tally/vouchers-${fy.label}.xml`, tallyXml);

            stage = 'generating PDFs';
            const productsById = new Map(data.p2_products.map((pr) => [pr.id, pr]));
            const itemsByOrder = new Map();
            for (const item of data.p2_dispatch_items) {
                if (!itemsByOrder.has(item.dispatch_order_id)) itemsByOrder.set(item.dispatch_order_id, []);
                itemsByOrder.get(item.dispatch_order_id).push(item);
            }
            const invoicesForPdf = salesSource;
            const dispatchesForPdf = data.p2_dispatch_orders.filter((d) =>
                d.status === 'confirmed' && d.dispatch_date >= fy.startISO && d.dispatch_date <= fy.endISO);

            await buildInvoicePdfs(zip, invoicesForPdf, settings, onProgress);
            await buildChallanPdfs(zip, dispatchesForPdf, itemsByOrder, productsById, settings, onProgress);

            stage = 'writing the manifest';
            onProgress?.('Writing manifest...');
            zip.file('manifest.json', JSON.stringify({
                exported_at: istIsoString(nowParts),
                company: companyName,
                schema_version: '1.0',
                // TODO v2: sha256 per file via crypto.subtle.digest — deferred
                // because SubtleCrypto is async and would require restructuring
                // this loop to await a hash per file before moving on.
                tables: manifestTables,
            }, null, 2));

            stage = 'writing the README';
            zip.file('README.txt', buildReadme({ companyName, nowParts, fy, skippedVouchers }));

            stage = 'compressing the export';
            onProgress?.('Compressing...');
            const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
                onProgress?.(`Compressing... ${Math.round(meta.percent)}%`);
            });

            stage = 'starting the download';
            const filename = `nexflow-export-${slugify(companyName)}-${isoDateOnly(nowParts)}.zip`;
            downloadBlob(blob, filename);

            return {
                ok: true,
                skippedVouchers,
                totalRows: manifestTables.reduce((s, t) => s + t.rows, 0),
            };
        } catch (err) {
            console.error('[full-export]', stage, err);
            throw new Error(`Export failed while ${stage} — please try again.`);
        }
    }

    window.runFullExport = runFullExport;
})();
