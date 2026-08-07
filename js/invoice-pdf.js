/**
 * invoice-pdf.js — browser-side client Invoice PDF builder.
 *
 * Sibling to js/challan-pdf.js, not an extension of it — that file's own
 * header comment warns against adding a fourth challan-layout implementation,
 * and an invoice is a different document (rate/amount columns, GST rows,
 * amount-in-words, bank details, no signature block). Same reason this lives
 * in the browser and not the agent-query Edge Function: jsPDF costs ~221ms of
 * CPU on module instantiation alone under Deno, which blows the Edge
 * Function's CPU budget and triggers EarlyDrop.
 *
 * Consumed by:
 *   - invoice.html → "Download Invoice (PDF)", public page, no login required
 *
 * No modules, no build step: everything is attached to window, matching
 * js/challan-pdf.js and the rest of the codebase.
 */

(function () {
    'use strict';

    const JSPDF_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

    // A4 portrait, millimetres.
    const PAGE_W = 210;
    const PAGE_H = 297;
    const M      = 12;
    const CW     = PAGE_W - M * 2;   // 186

    const LINE_H     = 4.6;
    const FOOTER_TOP = PAGE_H - M - 8;

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

    /** Load jsPDF on first use, memoised for the rest of the session. */
    function loadPdfLibs() {
        if (libsPromise) return libsPromise;
        libsPromise = (window.jspdf?.jsPDF ? Promise.resolve() : injectScript(JSPDF_SRC))
            .then(() => {
                if (!window.jspdf?.jsPDF) throw new Error('jsPDF unavailable after load');
            }).catch((err) => {
                libsPromise = null;
                throw err;
            });
        return libsPromise;
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /** Same WinAnsi-strip rationale as challan-pdf.js's sanitize(). */
    function sanitize(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/₹/g, 'Rs.')
            .replace(/[‘’]/g, "'")
            .replace(/[“”]/g, '"')
            .replace(/[–—]/g, '-')
            .replace(/…/g, '...')
            .replace(/[^\x09\x0A\x20-\xFF]/g, '?');
    }

    function fmtAmount(n) {
        const v = Number(n) || 0;
        return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // ── amount in words (Indian lakh/crore grouping) ────────────────────────

    const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
        'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    function twoDigitWords(n) {
        if (n < 20) return ONES[n];
        const t = Math.floor(n / 10), o = n % 10;
        return TENS[t] + (o ? ' ' + ONES[o] : '');
    }

    function threeDigitWords(n) {
        const h = Math.floor(n / 100), rest = n % 100;
        let s = '';
        if (h) s += ONES[h] + ' Hundred';
        if (rest) s += (s ? ' ' : '') + twoDigitWords(rest);
        return s;
    }

    function numberToWordsIndian(num) {
        num = Math.max(0, Math.round(num));
        if (num === 0) return 'Zero';
        const crore = Math.floor(num / 10000000); num %= 10000000;
        const lakh  = Math.floor(num / 100000);    num %= 100000;
        const thousand = Math.floor(num / 1000);   num %= 1000;
        const hundred = num;
        const parts = [];
        if (crore) parts.push(threeDigitWords(crore) + ' Crore');
        if (lakh) parts.push(threeDigitWords(lakh) + ' Lakh');
        if (thousand) parts.push(threeDigitWords(thousand) + ' Thousand');
        if (hundred) parts.push(threeDigitWords(hundred));
        return parts.join(' ');
    }

    /** "Rupees One Lakh Twenty Three Thousand and Fifty Paise Only" */
    function amountInWords(total) {
        const value  = Math.max(0, Number(total) || 0);
        const rupees = Math.floor(value);
        const paise  = Math.round((value - rupees) * 100);
        let words = 'Rupees ' + numberToWordsIndian(rupees);
        if (paise > 0) words += ' and ' + numberToWordsIndian(paise) + ' Paise';
        return words + ' Only';
    }

    // ── column layout (mode-aware) ───────────────────────────────────────────

    function getColumns(mode) {
        if (mode === 'consolidated') {
            const fixed = { sr: 10, challan: 24, date: 18, qty: 14, unit: 12, sac: 16, rate: 22, amount: 26 };
            const desc = CW - Object.values(fixed).reduce((a, b) => a + b, 0);
            return [
                { key: 'sr',      label: 'SR',          w: fixed.sr,      align: 'center' },
                { key: 'challan', label: 'CHALLAN NO',  w: fixed.challan, align: 'left' },
                { key: 'date',    label: 'DATE',        w: fixed.date,    align: 'center' },
                { key: 'desc',    label: 'DESCRIPTION', w: desc,          align: 'left' },
                { key: 'qty',     label: 'QTY',         w: fixed.qty,     align: 'right' },
                { key: 'unit',    label: 'UNIT',        w: fixed.unit,    align: 'center' },
                { key: 'sac',     label: 'SAC CODE',    w: fixed.sac,     align: 'center' },
                { key: 'rate',    label: 'RATE',        w: fixed.rate,    align: 'right' },
                { key: 'amount',  label: 'AMOUNT',      w: fixed.amount,  align: 'right' },
            ];
        }
        const fixed = { sr: 10, qty: 18, unit: 16, sac: 16, rate: 24, amount: 28 };
        const desc = CW - Object.values(fixed).reduce((a, b) => a + b, 0);
        return [
            { key: 'sr',     label: 'SR',          w: fixed.sr,     align: 'center' },
            { key: 'desc',   label: 'DESCRIPTION', w: desc,         align: 'left' },
            { key: 'qty',    label: 'QTY',         w: fixed.qty,    align: 'right' },
            { key: 'unit',   label: 'UNIT',        w: fixed.unit,   align: 'center' },
            { key: 'sac',    label: 'SAC CODE',    w: fixed.sac,    align: 'center' },
            { key: 'rate',   label: 'RATE',        w: fixed.rate,   align: 'right' },
            { key: 'amount', label: 'AMOUNT',      w: fixed.amount, align: 'right' },
        ];
    }

    function colX(columns, key) {
        let x = M;
        for (const c of columns) {
            if (c.key === key) return x;
            x += c.w;
        }
        return x;
    }

    // ── drawing ──────────────────────────────────────────────────────────────

    function drawPageFrame(doc, pageNo) {
        doc.setDrawColor(0);
        doc.setLineWidth(0.5);
        doc.rect(M, M, CW, FOOTER_TOP - M);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(120);
        doc.text(`Powered by Nexflow Automations · Page ${pageNo}`, PAGE_W / 2, PAGE_H - M, { align: 'center' });
        doc.setTextColor(0);
    }

    function drawItemsHeader(doc, y, columns) {
        const h = 8;
        doc.setFillColor(229, 231, 235);   // #e5e7eb, matching challan-pdf.js
        doc.rect(M, y, CW, h, 'F');
        doc.setDrawColor(0);
        doc.setLineWidth(0.3);
        doc.rect(M, y, CW, h);

        let x = M;
        columns.forEach((c) => {
            x += c.w;
            if (x < M + CW - 0.01) doc.line(x, y, x, y + h);
        });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        columns.forEach((c) => {
            const cx = colX(columns, c.key);
            const tx = c.align === 'center' ? cx + c.w / 2
                     : c.align === 'right'  ? cx + c.w - 2.5
                     : cx + 2.5;
            doc.text(c.label, tx, y + 5.4, { align: c.align === 'left' ? 'left' : c.align });
        });

        return y + h;
    }

    /** Diagonal, low-opacity red stamp on every page — mirrors invoice.html's
     *  #cancelledWatermark. jsPDF 2.5.1's GState opacity API, no new dependency. */
    function drawCancelledStamp(doc) {
        const totalPages = doc.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.saveGraphicsState();
            doc.setGState(new doc.GState({ opacity: 0.25 }));
            doc.setTextColor(220, 38, 38);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(70);
            doc.text('CANCELLED', PAGE_W / 2, PAGE_H / 2, { align: 'center', angle: 45 });
            doc.restoreGraphicsState();
            doc.setTextColor(0);
        }
    }

    // ── public builder ───────────────────────────────────────────────────────

    /**
     * Build the invoice PDF.
     *
     * @param {Object} p
     * @param {string} p.companyName
     * @param {string} [p.addressLine1]
     * @param {string} [p.addressLine2]
     * @param {string} [p.mobile]
     * @param {string} [p.gstin]
     * @param {string} p.invoiceNumber
     * @param {string} p.invoiceDateFormatted   DD/MM/YYYY
     * @param {string} [p.invoiceMode]           'single' | 'consolidated'
     * @param {string} [p.periodFromFormatted]   DD/MM/YYYY, consolidated only
     * @param {string} [p.periodToFormatted]     DD/MM/YYYY, consolidated only
     * @param {string} p.clientName
     * @param {string} [p.clientAddress]
     * @param {string} [p.clientGstin]
     * @param {Array<{challanNumber?:string, dispatchDateFormatted?:string, description:string, qty:(string|number), unit:string, rate:(string|number), amount:(string|number)}>} p.items
     * @param {string} p.gstType                 'cgst_sgst' | 'igst' | 'none'
     * @param {number} p.amountSubtotal
     * @param {number} p.amountGst
     * @param {number} p.amountTotal
     * @param {string} [p.bankName]
     * @param {string} [p.bankAccount]
     * @param {string} [p.bankIfsc]
     * @param {boolean} [p.isCancelled]
     * @param {string} [p.sacCode]           SAC code for all line items
     * @param {string} [p.placeOfSupply]     derived from client address
     * @returns {Promise<string>} base64 PDF, no data-URI prefix
     */
    async function buildInvoicePdf(p) {
        await loadPdfLibs();

        const items = Array.isArray(p.items) ? p.items : [];
        const mode = p.invoiceMode === 'consolidated' ? 'consolidated' : 'single';
        const columns = getColumns(mode);

        const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        let pageNo = 1;
        drawPageFrame(doc, pageNo);

        let y = M;

        // 1 ── company band
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text(sanitize(p.companyName || ''), PAGE_W / 2, y + 6.5, { align: 'center' });
        let cy = y + 6.5;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        const addressLine = [p.addressLine1, p.addressLine2].filter(Boolean).join(', ');
        const contactLine = [
            p.mobile ? 'Mobile: ' + p.mobile : null,
            p.gstin  ? 'GSTIN: '  + p.gstin  : null,
        ].filter(Boolean).join(' · ');
        [addressLine, contactLine].filter(Boolean).forEach((line) => {
            cy += LINE_H;
            doc.text(sanitize(line), PAGE_W / 2, cy, { align: 'center' });
        });
        y = cy + 4;
        doc.setLineWidth(0.5);
        doc.line(M, y, M + CW, y);

        // 2 ── title band
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.text('TAX INVOICE', PAGE_W / 2, y + 8, { align: 'center' });
        y += 11;
        // copy labels — right-aligned, small
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.text('Original for Recipient', M + CW, y - 7, { align: 'right' });
        doc.text('Duplicate for Supplier / Transporter', M + CW, y - 3.5, { align: 'right' });
        doc.text('Triplicate for Supplier', M + CW, y, { align: 'right' });
        // reverse charge
        doc.setFontSize(8);
        doc.text('Reverse Charge: No', M + 4, y);
        y += 3;
        doc.setLineWidth(0.5);
        doc.line(M, y, M + CW, y);

        // 3 ── invoice no / date / period
        let iy = y + 6;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text('Invoice No:', M + 4, iy);
        doc.setFont('helvetica', 'normal');
        doc.text(sanitize(p.invoiceNumber || ''), M + 28, iy);

        doc.setFont('helvetica', 'bold');
        doc.text('Date:', M + CW / 2 + 4, iy);
        doc.setFont('helvetica', 'normal');
        doc.text(sanitize(p.invoiceDateFormatted || ''), M + CW / 2 + 18, iy);

        if (mode === 'consolidated' && p.periodFromFormatted && p.periodToFormatted) {
            iy += LINE_H + 0.8;
            doc.setFont('helvetica', 'bold');
            doc.text('Period:', M + 4, iy);
            doc.setFont('helvetica', 'normal');
            doc.text(`${sanitize(p.periodFromFormatted)} – ${sanitize(p.periodToFormatted)}`, M + 28, iy);
        }
        y = iy + 5;
        doc.setLineWidth(0.5);
        doc.line(M, y, M + CW, y);
        y += 1;

        // 4 ── receiver / consignee (two columns) + place of supply
        const halfW = CW / 2 - 4;
        let by = y + 5;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text('Details of Receiver', M + 4, by);
        doc.text('Details of Consignee', M + CW / 2 + 4, by);
        by += LINE_H;
        doc.setFontSize(9.5);
        doc.text(sanitize(p.clientName || 'N/A'), M + 4, by);
        doc.text(sanitize(p.clientName || 'N/A'), M + CW / 2 + 4, by);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        let byLeft = by, byRight = by;
        if (p.clientAddress) {
            const leftLines = doc.splitTextToSize(sanitize(p.clientAddress), halfW);
            leftLines.forEach((line) => { byLeft += LINE_H; doc.text(line, M + 4, byLeft); });
            const rightLines = doc.splitTextToSize(sanitize(p.clientAddress), halfW);
            rightLines.forEach((line) => { byRight += LINE_H; doc.text(line, M + CW / 2 + 4, byRight); });
        }
        if (p.clientGstin) {
            byLeft += LINE_H;
            doc.text('GSTIN: ' + sanitize(p.clientGstin), M + 4, byLeft);
            byRight += LINE_H;
            doc.text('GSTIN: ' + sanitize(p.clientGstin), M + CW / 2 + 4, byRight);
        }
        by = Math.max(byLeft, byRight);
        if (p.placeOfSupply) {
            by += LINE_H;
            doc.setFontSize(8);
            doc.text('Place of Supply: ' + sanitize(p.placeOfSupply), M + 4, by);
        }
        y = by + 4;
        doc.setLineWidth(0.5);
        doc.line(M, y, M + CW, y);

        // 5 ── items table
        y = drawItemsHeader(doc, y, columns);
        const rowsBottom = FOOTER_TOP - 6;

        items.forEach((item, i) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8.5);
            const descCol = columns.find((c) => c.key === 'desc');
            const descLines = doc.splitTextToSize(sanitize(item.description || ''), descCol.w - 5);
            const rowH = Math.max(7, descLines.length * LINE_H + 2.6);

            if (y + rowH > rowsBottom) {
                pageNo += 1;
                doc.addPage();
                drawPageFrame(doc, pageNo);
                y = drawItemsHeader(doc, M, columns);
            }

            doc.setDrawColor(0);
            doc.setLineWidth(0.3);
            doc.rect(M, y, CW, rowH);
            let x = M;
            columns.forEach((c) => {
                x += c.w;
                if (x < M + CW - 0.01) doc.line(x, y, x, y + rowH);
            });

            const textY = y + 4.8;
            const values = {
                sr: String(i + 1),
                challan: item.challanNumber || '—',
                date: item.dispatchDateFormatted || '—',
                qty: sanitize(item.qty),
                unit: sanitize(item.unit),
                sac: sanitize(p.sacCode || ''),
                rate: 'Rs. ' + fmtAmount(item.rate),
                amount: 'Rs. ' + fmtAmount(item.amount),
            };
            columns.forEach((c) => {
                if (c.key === 'desc') return;
                const cx = colX(columns, c.key);
                const tx = c.align === 'center' ? cx + c.w / 2 : c.align === 'right' ? cx + c.w - 2.5 : cx + 2.5;
                doc.text(sanitize(values[c.key]), tx, textY, { align: c.align === 'left' ? 'left' : c.align });
            });
            const descX = colX(columns, 'desc') + 2.5;
            descLines.forEach((line, li) => doc.text(line, descX, textY + li * LINE_H));

            y += rowH;
        });

        // 6 ── subtotal / GST / total
        const summaryRows = [['Subtotal', p.amountSubtotal]];
        if (p.gstType === 'cgst_sgst') {
            const half = (Number(p.amountGst) || 0) / 2;
            summaryRows.push(['CGST @ 9%', half], ['SGST @ 9%', half]);
        } else if (p.gstType === 'igst') {
            summaryRows.push(['IGST @ 18%', p.amountGst]);
        }

        const summaryLabelW = 40;
        const summaryValueW = 32;
        const summaryX = M + CW - summaryLabelW - summaryValueW;

        summaryRows.forEach(([label, value]) => {
            const rowH = 6.5;
            if (y + rowH > rowsBottom) {
                pageNo += 1;
                doc.addPage();
                drawPageFrame(doc, pageNo);
                y = M;
            }
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.text(label, summaryX, y + 4.6);
            doc.text('Rs. ' + fmtAmount(value), M + CW - 3, y + 4.6, { align: 'right' });
            y += rowH;
        });

        const totalBoxH = 9;
        if (y + totalBoxH > rowsBottom) {
            pageNo += 1;
            doc.addPage();
            drawPageFrame(doc, pageNo);
            y = M;
        }
        doc.setFillColor(229, 231, 235);
        doc.rect(summaryX, y, M + CW - summaryX, totalBoxH, 'F');
        doc.setDrawColor(0);
        doc.setLineWidth(0.4);
        doc.line(summaryX, y, M + CW, y);
        y += totalBoxH - 2.5;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12.5);
        doc.text('TOTAL', summaryX + 2, y);
        doc.text('Rs. ' + fmtAmount(p.amountTotal), M + CW - 3, y, { align: 'right' });
        y += 6.5;

        // 7 ── amount in words
        // Tracks whether this or the bank-details section below needed their
        // own page break — the sig block below uses this to tell "genuinely
        // full page" apart from "only the sig block itself doesn't fit".
        let bottomSectionsOverflowed = false;
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8.5);
        const wordsLines = doc.splitTextToSize('Amount in Words: ' + amountInWords(p.amountTotal), CW - 8);
        if (y + wordsLines.length * LINE_H > rowsBottom) {
            bottomSectionsOverflowed = true;
            pageNo += 1;
            doc.addPage();
            drawPageFrame(doc, pageNo);
            y = M + 4;
        }
        wordsLines.forEach((line) => {
            y += LINE_H;
            doc.text(line, M + 4, y);
        });
        y += 3;

        // 8 ── bank details
        const bankLines = [
            p.bankName    ? 'Bank Name: '    + p.bankName    : null,
            p.bankAccount ? 'Account No: '   + p.bankAccount : null,
            p.bankIfsc    ? 'IFSC Code: '    + p.bankIfsc    : null,
        ].filter(Boolean);
        if (bankLines.length) {
            if (y + (bankLines.length + 1) * LINE_H > rowsBottom) {
                bottomSectionsOverflowed = true;
                pageNo += 1;
                doc.addPage();
                drawPageFrame(doc, pageNo);
                y = M + 4;
            }
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8.5);
            y += LINE_H;
            doc.text('Bank Details', M + 4, y);
            doc.setFont('helvetica', 'normal');
            bankLines.forEach((line) => {
                y += LINE_H;
                doc.text(sanitize(line), M + 4, y);
            });
            y += 3;
        }

        // 8.5 ── signature block
        const sigBlockH = 26;
        const sigLineW = 55;
        let sigY = y;
        let sigPinned = false;
        if (y + sigBlockH > rowsBottom) {
            if (bottomSectionsOverflowed) {
                // Amount-in-words or bank details already forced their own
                // break — the page is genuinely full, not just short by the
                // sig block's own height. Hard break, same as before.
                pageNo += 1;
                doc.addPage();
                drawPageFrame(doc, pageNo);
                y = M;
                sigY = y;
            } else {
                // Common case: everything else fit, only the sig block
                // doesn't. Pin it to the bottom margin instead of forcing a
                // near-empty page 2 — keeps low-item invoices on one page.
                sigY = rowsBottom - 10 - (sigBlockH - 6);
                sigPinned = true;
            }
        }
        const sigLineY = sigY + sigBlockH - 6;

        doc.setDrawColor(0);
        doc.setLineWidth(0.3);
        doc.line(M + 4, sigLineY, M + 4 + sigLineW, sigLineY);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.text("Receiver's Signature", M + 4, sigLineY + 4);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text('For', M + CW - 4, sigY + 4, { align: 'right' });
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.text(sanitize(p.companyName || ''), M + CW - 4, sigY + 8.5, { align: 'right' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.line(M + CW - 4 - sigLineW, sigLineY, M + CW - 4, sigLineY);
        doc.text('Authorised Signatory', M + CW - 4, sigLineY + 4, { align: 'right' });

        y = sigPinned ? sigLineY + 4 : sigY + sigBlockH;

        // 9 ── footer note
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7.5);
        doc.setTextColor(100);
        if (y + LINE_H > rowsBottom) {
            pageNo += 1;
            doc.addPage();
            drawPageFrame(doc, pageNo);
            y = M + 4;
        }
        y += LINE_H;
        doc.text('This is a computer-generated invoice.', PAGE_W / 2, y, { align: 'center' });
        doc.setTextColor(0);

        if (p.isCancelled) {
            drawCancelledStamp(doc);
        }

        const uri = doc.output('datauristring');
        return uri.substring(uri.indexOf('base64,') + 7);
    }

    /** Server-safe filename: Invoice_INV-202607-001.pdf */
    function invoicePdfFilename(invoiceNumber) {
        const safeNo = String(invoiceNumber || 'invoice').replace(/[^A-Za-z0-9_-]/g, '');
        return `Invoice_${safeNo}.pdf`;
    }

    /** Trigger a browser download of a base64 PDF. */
    function downloadInvoicePdf(base64, filename) {
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

    window.loadInvoicePdfLibs   = loadPdfLibs;
    window.buildInvoicePdf      = buildInvoicePdf;
    window.invoicePdfFilename   = invoicePdfFilename;
    window.downloadInvoicePdf   = downloadInvoicePdf;
    // Synchronous, no jsPDF dependency — safe for invoice.html to call
    // immediately on page render, without triggering the lazy PDF library load.
    window.invoiceAmountInWords = amountInWords;
})();
