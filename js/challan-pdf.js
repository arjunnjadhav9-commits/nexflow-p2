/**
 * challan-pdf.js — the single browser-side Delivery Challan PDF builder.
 *
 * Why this lives in the browser and not in the agent-query Edge Function:
 * jsPDF costs ~221ms of CPU on module instantiation alone under Deno, which
 * blows the Edge Function's CPU budget and triggers EarlyDrop. The browser has
 * no such budget.
 *
 * Consumed by:
 *   - receive.html → "Download Challan (PDF)", for the recipient who arrived
 *     via a QR scan or the link in the challan email. That page's PDF omits
 *     the QR by default (the recipient already scanned one), but its "Show
 *     QR" toggle can opt back in via p.forceShowQr — independent of the
 *     sender's plan, since dispatchToken is already public in that page's
 *     own URL.
 *
 * Deliberately NOT used by the agent or challan.html: send_challan emails the
 * Excel workbook in a single Edge Function call, and SS Engineering prints
 * challan.html directly. Do not reintroduce a PDF into either path.
 *
 * The challan layout already exists in three divergent implementations
 * (buildChallanWorkbook() in the Edge Function, and downloadExcel() in both
 * challan.html and receive.html). Do not add a fourth — extend this one.
 *
 * No modules, no build step: everything is attached to window, matching
 * js/utils.js and the rest of the codebase.
 */

(function () {
    'use strict';

    const JSPDF_SRC   = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    const QRCODE_SRC  = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';

    // A4 portrait, millimetres.
    const PAGE_W = 210;
    const PAGE_H = 297;
    const M      = 12;                    // page margin
    const CW     = PAGE_W - M * 2;        // content width = 186

    // Items table columns — SR/PO/QTY/UNIT are fixed; DESCRIPTION takes the
    // rest of CW. PO NO only appears when at least one dispatch item in the
    // payload carries a po_number (mirrors challan.html's showPoCol gate),
    // so DESCRIPTION's width is computed per-build, not here.
    const COL_SR   = 14;
    const COL_PO   = 24;   // matches challan.html's own PO NO column (90px ≈ 24mm)
    const COL_QTY  = 28;
    const COL_UNIT = 20;

    const LINE_H     = 4.6;   // baseline step for 9-10pt body text
    const FOOTER_TOP = PAGE_H - M - 8;    // outer border stops here
    const SIG_HEIGHT = 34;    // signature block reserve

    // ── library loading ──────────────────────────────────────────────────────

    let libsPromise = null;

    function injectScript(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing) {
                if (existing.dataset.loaded === '1') return resolve();
                existing.addEventListener('load', () => resolve());
                existing.addEventListener('error', () => reject(new Error('Failed to load ' + src)));
                return;
            }
            const s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.addEventListener('load', () => { s.dataset.loaded = '1'; resolve(); });
            s.addEventListener('error', () => reject(new Error('Failed to load ' + src)));
            document.head.appendChild(s);
        });
    }

    /**
     * Load jsPDF + qrcodejs on first use, memoised for the rest of the session.
     * Deliberately lazy: owners are on phones, and jsPDF is ~110KB gzipped —
     * pages that never build a PDF must not pay for it.
     * @returns {Promise<void>}
     */
    function loadPdfLibs() {
        if (libsPromise) return libsPromise;
        libsPromise = Promise.all([
            window.jspdf?.jsPDF ? Promise.resolve() : injectScript(JSPDF_SRC),
            window.QRCode       ? Promise.resolve() : injectScript(QRCODE_SRC)
        ]).then(() => {
            if (!window.jspdf?.jsPDF) throw new Error('jsPDF unavailable after load');
            if (!window.QRCode)       throw new Error('QRCode unavailable after load');
        }).catch((err) => {
            libsPromise = null;   // allow a retry on the next send
            throw err;
        });
        return libsPromise;
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /**
     * jsPDF's built-in Helvetica is a WinAnsi (Latin-1) font — anything outside
     * that range renders as garbage rather than throwing. Map the characters we
     * realistically hit and flatten the rest so a broken glyph never reaches a
     * customer's inbox. Devanagari company names would need an embedded font;
     * that is a follow-up, not something to paper over silently.
     */
    function sanitize(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/₹/g, 'Rs.')     // ₹
            .replace(/[‘’]/g, "'")
            .replace(/[“”]/g, '"')
            .replace(/[–—]/g, '-')
            .replace(/…/g, '...')
            .replace(/[^\x09\x0A\x20-\xFF]/g, '?');
    }

    /**
     * Render a QR to a PNG data URL using qrcodejs, which only draws into a DOM
     * element. The container is parked off-screen (not display:none — canvas
     * measurement is unreliable in a hidden subtree) and removed straight after.
     */
    function qrDataUrl(text) {
        return new Promise((resolve, reject) => {
            const holder = document.createElement('div');
            holder.style.cssText = 'position:absolute; left:-9999px; top:0; width:256px; height:256px;';
            document.body.appendChild(holder);

            let qr;
            try {
                qr = new window.QRCode(holder, {
                    text: text,
                    width: 256,
                    height: 256,
                    correctLevel: window.QRCode.CorrectLevel.M
                });
            } catch (err) {
                holder.remove();
                return reject(err);
            }

            // qrcodejs uses <canvas> where supported and falls back to an <img>
            // whose src it may populate a tick later — poll briefly for either.
            const started = Date.now();
            (function poll() {
                let url = null;
                try {
                    const canvas = holder.querySelector('canvas');
                    if (canvas) {
                        url = canvas.toDataURL('image/png');
                    } else {
                        const img = holder.querySelector('img');
                        if (img && img.src && img.src.indexOf('data:') === 0) url = img.src;
                    }
                } catch (err) {
                    holder.remove();
                    return reject(err);
                }

                if (url && url.length > 100) {
                    holder.remove();
                    return resolve(url);
                }
                if (Date.now() - started > 1500) {
                    holder.remove();
                    return reject(new Error('QR render timed out'));
                }
                setTimeout(poll, 40);
            })();

            void qr;
        });
    }

    function isQrEligible(plan) {
        // Mirrors renderQrSections() in challan.html — QR exchange is a Pro /
        // Founder feature, never Lite.
        return plan === 'pro' || plan === 'founder';
    }

    // ── drawing ──────────────────────────────────────────────────────────────

    function drawPageFrame(doc, pageNo) {
        doc.setDrawColor(0);
        doc.setLineWidth(0.5);
        doc.rect(M, M, CW, FOOTER_TOP - M);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(120);
        doc.text('Powered by Nexflow Automations', PAGE_W / 2, PAGE_H - M, { align: 'center' });
        doc.text('Page ' + pageNo, PAGE_W - M, PAGE_H - M, { align: 'right' });
        doc.setTextColor(0);
    }

    /**
     * @param {Object} cols {SR, PO, DESC, QTY, UNIT, showPoCol} — DESC and
     *                      showPoCol vary per build, the rest are the module
     *                      constants; kept together so header/rows/total
     *                      agree on the same layout without recomputing it.
     */
    function drawItemsHeader(doc, y, cols) {
        const h = 8;
        doc.setFillColor(229, 231, 235);   // #e5e7eb, same as the print stylesheet
        doc.rect(M, y, CW, h, 'F');
        doc.setDrawColor(0);
        doc.setLineWidth(0.3);
        doc.rect(M, y, CW, h);

        const widths = cols.showPoCol
            ? [cols.SR, cols.PO, cols.DESC, cols.QTY]
            : [cols.SR, cols.DESC, cols.QTY];
        let x = M;
        widths.forEach((w) => {
            x += w;
            doc.line(x, y, x, y + h);
        });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        let hx = M;
        doc.text('SR NO', hx + cols.SR / 2, y + 5.4, { align: 'center' });
        hx += cols.SR;
        if (cols.showPoCol) {
            doc.text('PO NO', hx + 3, y + 5.4);
            hx += cols.PO;
        }
        doc.text('DESCRIPTION', hx + 3, y + 5.4);
        hx += cols.DESC;
        doc.text('QUANTITY', hx + cols.QTY - 3, y + 5.4, { align: 'right' });
        hx += cols.QTY;
        doc.text('UNIT', hx + cols.UNIT / 2, y + 5.4, { align: 'center' });

        return y + h;
    }

    function drawSignatureBlock(doc, y, companyName) {
        const leftX  = M + 6;
        const rightX = PAGE_W - M - 6;
        const ruleY  = y + 24;

        doc.setDrawColor(0);
        doc.setLineWidth(0.3);

        doc.line(leftX, ruleY, leftX + 55, ruleY);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text("Receiver's Signature", leftX, ruleY + 4.5);

        doc.setFontSize(9);
        doc.text('For', rightX, y + 5, { align: 'right' });
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(sanitize(companyName), rightX, y + 10.5, { align: 'right' });

        doc.line(rightX - 55, ruleY, rightX, ruleY);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text('Authorized Signatory', rightX, ruleY + 4.5, { align: 'right' });
    }

    // ── public builder ───────────────────────────────────────────────────────

    /**
     * Build the challan PDF.
     *
     * @param {Object} p                       normalised payload — callers resolve
     *                                         item descriptions themselves, since the
     *                                         name-vs-code rule differs by dispatch_type.
     * @param {string} p.companyName
     * @param {string} [p.addressLine1]
     * @param {string} [p.addressLine2]
     * @param {string} [p.mobile]
     * @param {string} [p.gstin]
     * @param {string} p.clientName
     * @param {string[]} [p.clientAddressLines]
     * @param {string} p.challanNumber
     * @param {string} p.dispatchDateFormatted DD/MM/YYYY
     * @param {string} [p.poNumber]
     * @param {string} [p.vehicleNumber]
     * @param {string} [p.note]                defaults to the standard receipt line
     * @param {string} [p.footerNote]
     * @param {Array<{description:string, qty:(string|number), unit:string, po_number?:(string|null)}>} p.items
     *                                          po_number renders as-is, no formatting; PO NO
     *                                          column only appears when >=1 item has one set
     * @param {string} [p.dispatchToken]       QR target; omitted → no QR
     * @param {string} [p.plan]                'pro' | 'founder' → QR rendered
     * @param {boolean} [p.forceShowQr]         recipient-side override (receive.html) —
     *                                          show the QR regardless of plan; still
     *                                          requires p.dispatchToken to be set
     * @returns {Promise<string>} base64 PDF, no data-URI prefix
     */
    async function buildChallanPdf(p) {
        await loadPdfLibs();

        const items = Array.isArray(p.items) ? p.items : [];
        const showQr = (p.forceShowQr || isQrEligible(p.plan)) && !!p.dispatchToken;
        let qrImage = null;
        if (showQr) {
            try {
                qrImage = await qrDataUrl('https://nexflowautomations.in/receive?token=' + p.dispatchToken);
            } catch (err) {
                // A missing QR must never cost the customer their challan.
                console.warn('[challan-pdf] QR render failed, continuing without it:', err);
                qrImage = null;
            }
        }

        const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        let pageNo = 1;
        drawPageFrame(doc, pageNo);

        let y = M;

        // 1 ── title band
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.text('DELIVERY CHALLAN', PAGE_W / 2, y + 8.5, { align: 'center' });
        y += 10;
        doc.setLineWidth(0.5);
        doc.line(M, y, M + CW, y);

        // 2 ── company band
        doc.setFontSize(13);
        doc.text(sanitize(p.companyName), PAGE_W / 2, y + 5.5, { align: 'center' });
        let cy = y + 5.5;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        [p.addressLine1, p.addressLine2,
         p.mobile ? 'Mobile: ' + p.mobile : null,
         p.gstin  ? 'GSTIN: '  + p.gstin  : null
        ].filter(Boolean).forEach((line) => {
            cy += LINE_H;
            doc.text(sanitize(line), PAGE_W / 2, cy, { align: 'center' });
        });
        y = cy + 4;
        doc.setLineWidth(0.5);
        doc.line(M, y, M + CW, y);

        // 3 ── TO / meta band, split down the middle, QR top-right
        const metaTop  = y;
        const midX     = M + CW / 2;
        const leftPadX = M + 4;
        let ly = metaTop + 6;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.text('TO:', leftPadX, ly);
        ly += LINE_H + 0.6;
        doc.setFontSize(10);
        doc.text(sanitize(p.clientName || 'N/A'), leftPadX, ly);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        (p.clientAddressLines || []).forEach((line) => {
            doc.splitTextToSize(sanitize(line), CW / 2 - 8).forEach((wrapped) => {
                ly += LINE_H;
                doc.text(wrapped, leftPadX, ly);
            });
        });

        const qrSize = 24;
        const rightPadX = midX + 4;
        const metaValueX = rightPadX + 26;
        let ry = metaTop + 7;
        const metaRows = [
            ['Challan No:', p.challanNumber],
            ['Date:',       p.dispatchDateFormatted],
            ['Po No:',      p.poNumber || 'N/A']
        ];
        if (p.vehicleNumber) metaRows.push(['Transport:', p.vehicleNumber]);

        metaRows.forEach(([label, value]) => {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.text(label, rightPadX, ry);
            doc.setFont('helvetica', 'normal');
            doc.text(sanitize(value), metaValueX, ry);
            ry += LINE_H + 0.8;
        });

        if (qrImage) {
            const qrX = M + CW - qrSize - 5;
            doc.addImage(qrImage, 'PNG', qrX, metaTop + 4, qrSize, qrSize);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(6.5);
            doc.setTextColor(100);
            doc.text('Scan to verify delivery', qrX + qrSize / 2, metaTop + 4 + qrSize + 3, { align: 'center' });
            doc.setTextColor(0);
            ry = Math.max(ry, metaTop + 4 + qrSize + 6);
        }

        y = Math.max(ly, ry) + 4;
        doc.setLineWidth(0.3);
        doc.line(midX, metaTop, midX, y);
        doc.setLineWidth(0.5);
        doc.line(M, y, M + CW, y);

        // 4 ── note line
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(9);
        const noteText = sanitize(p.note || 'Please receive the following material in good condition');
        let ny = y + 5.5;
        doc.splitTextToSize(noteText, CW - 8).forEach((line) => {
            doc.text(line, leftPadX, ny);
            ny += LINE_H;
        });
        y = ny + 1.5;
        doc.setLineWidth(0.5);
        doc.line(M, y, M + CW, y);

        // 5 ── items table
        // PO NO only appears when at least one item in the payload carries a
        // po_number — same gate challan.html uses for its own PO column, so
        // a dispatch with none renders byte-identical to before this column
        // existed.
        const showPoCol = items.some((it) => it.po_number != null && it.po_number !== '');
        const descWidth = showPoCol
            ? CW - COL_SR - COL_PO - COL_QTY - COL_UNIT   // 100mm
            : CW - COL_SR - COL_QTY - COL_UNIT;           // 124mm, unchanged
        const cols = { SR: COL_SR, PO: COL_PO, DESC: descWidth, QTY: COL_QTY, UNIT: COL_UNIT, showPoCol };

        y = drawItemsHeader(doc, y, cols);

        const rowsBottom = FOOTER_TOP - 6;
        let total = 0;

        items.forEach((item, i) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            const descLines = doc.splitTextToSize(sanitize(item.description || ''), cols.DESC - 6);
            const rowH = Math.max(7.5, descLines.length * LINE_H + 3.2);

            if (y + rowH > rowsBottom) {
                pageNo += 1;
                doc.addPage();
                drawPageFrame(doc, pageNo);
                y = drawItemsHeader(doc, M, cols);
            }

            doc.setDrawColor(0);
            doc.setLineWidth(0.3);
            doc.rect(M, y, CW, rowH);
            const rowWidths = cols.showPoCol
                ? [cols.SR, cols.PO, cols.DESC, cols.QTY]
                : [cols.SR, cols.DESC, cols.QTY];
            let x = M;
            rowWidths.forEach((w) => {
                x += w;
                doc.line(x, y, x, y + rowH);
            });

            const textY = y + 5.2;
            let tx = M;
            doc.text(String(i + 1), tx + cols.SR / 2, textY, { align: 'center' });
            tx += cols.SR;
            if (cols.showPoCol) {
                doc.text(sanitize(item.po_number || ''), tx + 3, textY);
                tx += cols.PO;
            }
            descLines.forEach((line, li) => doc.text(line, tx + 3, textY + li * LINE_H));
            tx += cols.DESC;
            doc.text(sanitize(item.qty), tx + cols.QTY - 3, textY, { align: 'right' });
            tx += cols.QTY;
            doc.text(sanitize(item.unit), tx + cols.UNIT / 2, textY, { align: 'center' });

            total += parseFloat(item.qty) || 0;
            y += rowH;
        });

        // total row
        const totalH = 8;
        if (y + totalH > rowsBottom) {
            pageNo += 1;
            doc.addPage();
            drawPageFrame(doc, pageNo);
            y = drawItemsHeader(doc, M, cols);
        }
        doc.setDrawColor(0);
        doc.setLineWidth(0.3);
        doc.rect(M, y, CW, totalH);
        const leftGroupWidth = cols.showPoCol ? cols.SR + cols.PO + cols.DESC : cols.SR + cols.DESC;
        doc.line(M + leftGroupWidth, y, M + leftGroupWidth, y + totalH);
        doc.line(M + leftGroupWidth + cols.QTY, y, M + leftGroupWidth + cols.QTY, y + totalH);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.text('TOTAL', M + leftGroupWidth - 3, y + 5.4, { align: 'right' });
        const totalStr = Number.isInteger(total) ? String(total) : total.toFixed(2);
        doc.text(totalStr, M + leftGroupWidth + cols.QTY - 3, y + 5.4, { align: 'right' });
        y += totalH;

        // 6 ── footer note
        if (p.footerNote) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(85);
            let fy = y + 5;
            doc.splitTextToSize(sanitize(p.footerNote), CW - 8).forEach((line) => {
                doc.text(line, leftPadX, fy);
                fy += LINE_H - 0.6;
            });
            doc.setTextColor(0);
            y = fy;
        }

        // 7 ── signature block, always on the last page
        if (y + SIG_HEIGHT > FOOTER_TOP) {
            pageNo += 1;
            doc.addPage();
            drawPageFrame(doc, pageNo);
            y = M + 6;
        }
        drawSignatureBlock(doc, y + 4, p.companyName);

        const uri = doc.output('datauristring');
        return uri.substring(uri.indexOf('base64,') + 7);
    }

    /** Server-safe filename: Challan_1032_26072026.pdf */
    function challanPdfFilename(challanNumber, dispatchDateFormatted) {
        const datePart = String(dispatchDateFormatted || '').replace(/\//g, '');
        const safeNo   = String(challanNumber || 'challan').replace(/[^A-Za-z0-9_-]/g, '');
        return `Challan_${safeNo}${datePart ? '_' + datePart : ''}.pdf`;
    }

    /** Trigger a browser download of a base64 PDF. */
    function downloadChallanPdf(base64, filename) {
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    window.loadPdfLibs         = loadPdfLibs;
    window.buildChallanPdf     = buildChallanPdf;
    window.challanPdfFilename  = challanPdfFilename;
    window.downloadChallanPdf  = downloadChallanPdf;
})();
