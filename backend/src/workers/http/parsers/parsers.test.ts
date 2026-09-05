import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    parseTokenKey,
    parseCaptchaImageUrl,
    parseLoginOutcome,
    parseObligationOptions,
    findObligationValue,
    parsePortalErrors,
    parseReturnsSummaryErrors,
    parseSubmissionResult,
} from './index';
import { mapPortalMessage, KraErrorCode } from '../errors';
import { computeVatSummaryMath, roundTo } from '../../../scripts/vatMath';

describe('KRA HTTP parsers', () => {
    it('extracts token_key from hidden input', () => {
        const html = `
            <html><body>
                <form>
                    <input type="hidden" name="token_key" value="abc123">
                    <input name="logid">
                </form>
            </body></html>
        `;
        assert.strictEqual(parseTokenKey(html), 'abc123');
    });

    it('resolves CAPTCHA image URL', () => {
        const html = `
            <html><body>
                <img id="loginCaptcha" src="/KRA-Portal/GenerateCaptcha.jpg?ts=123">
                <input name="captcahText">
            </body></html>
        `;
        const url = parseCaptchaImageUrl(html, 'https://itax.kra.go.ke/KRA-Portal/');
        assert.strictEqual(url, 'https://itax.kra.go.ke/KRA-Portal/GenerateCaptcha.jpg?ts=123');
    });

    it('detects login success', () => {
        const html = '<html><body><a href="logout.htm">Logout</a><a href="eReturns.htm">Returns</a></body></html>';
        const outcome = parseLoginOutcome(html);
        assert.strictEqual(outcome.type, 'success');
    });

    it('detects login failure', () => {
        const html = '<html><body><div id="errorDiv">The password you entered is incorrect</div></body></html>';
        const outcome = parseLoginOutcome(html);
        assert.strictEqual(outcome.type, 'failure');
        assert.match(outcome.message ?? '', /incorrect/i);
    });

    it('detects password change prompt', () => {
        const html = '<html><body><h1>YOUR PASSWORD HAS EXPIRED!</h1></body></html>';
        const outcome = parseLoginOutcome(html);
        assert.strictEqual(outcome.type, 'password-change');
    });

    it('detects mobile verification prompt', () => {
        const html = '<html><body><h1>Mobile Number Verification</h1></body></html>';
        const outcome = parseLoginOutcome(html);
        assert.strictEqual(outcome.type, 'mobile-verification');
    });

    it('parses obligation options', () => {
        const html = `
            <html><body>
                <select name="obligationId">
                    <option value="">--Select--</option>
                    <option value="VAT">Value Added Tax (VAT)</option>
                    <option value="TOT">Turnover Tax</option>
                </select>
            </body></html>
        `;
        const options = parseObligationOptions(html, 'obligationId');
        assert.strictEqual(options.length, 2);
        assert.deepStrictEqual(options[0], { value: 'VAT', text: 'Value Added Tax (VAT)' });
    });

    it('finds obligation value by pattern', () => {
        const html = `
            <select id="regType">
                <option value="VAT">Value Added Tax (VAT)</option>
                <option value="TOT">Turnover Tax</option>
            </select>
        `;
        const match = findObligationValue(html, [/^turnover\s*tax$/i], 'regType');
        assert.strictEqual(match?.value, 'TOT');
    });

    it('extracts portal errors', () => {
        const html = '<html><body><div class="error-message">Invalid period</div></body></html>';
        const errors = parsePortalErrors(html);
        assert.deepStrictEqual(errors, ['Invalid period']);
    });

    it('parses successful submission result', () => {
        const html = `
            <html><body>
                <h1>Return Submitted successfully</h1>
                <p>Receipt Number: KRA-2026-001</p>
                <a onclick="downloadReturnsReceipt()">Download Returns Receipt</a>
            </body></html>
        `;
        const result = parseSubmissionResult(html);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.receiptNumber, 'KRA-2026-001');
        assert.strictEqual(result.downloadUrl, 'downloadReturnsReceipt()');
    });

    it('extracts noticeId from receipt download function', () => {
        const html = `
            <html><body>
                <h1>Return Receipt Generated</h1>
                <p>Return submitted Successfully with Acknowledgement Number: KRA2026123045657</p>
                <a href="javascript:downloadReturnsReceipt()">Download Returns Receipt</a>
                <script>
                    function downloadReturnsReceipt(){
                        window.open("/KRA-Portal/eCerificate.htm?actionCode=loadReceipt&noticeId=403460310","new");
                    }
                </script>
            </body></html>
        `;
        const result = parseSubmissionResult(html);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.receiptNumber, 'KRA2026123045657');
        assert.strictEqual(result.noticeId, '403460310');
        assert.strictEqual(result.downloadUrl, '/KRA-Portal/eCerificate.htm?actionCode=loadReceipt&noticeId=403460310');
    });

    it('rejects generic placeholder receipt numbers', () => {
        const html = `
            <html><body>
                <h1>Return Receipt Generated</h1>
                <p>Receipt Number: Receipt</p>
                <a onclick="downloadReturnsReceipt()">Download Returns Receipt</a>
            </body></html>
        `;
        const result = parseSubmissionResult(html);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.receiptNumber, null);
    });

    it('detects already-filed informational page as failure', () => {
        const html = `
            <html><body>
                <div class="ui-messages-info">
                    <span class="ui-messages-info-summary">Informational</span>
                    <span class="ui-messages-info-detail">Return already filed for the selected period.</span>
                </div>
            </body></html>
        `;
        const result = parseSubmissionResult(html);
        assert.strictEqual(result.success, false);
        assert.match(result.message ?? '', /already\s+filed/i);
    });

    it('detects invalid period as failure', () => {
        const html = `
            <html><body>
                <div id="errorDiv">Invalid period. The selected return period is not allowed.</div>
            </body></html>
        `;
        const result = parseSubmissionResult(html);
        assert.strictEqual(result.success, false);
        assert.match(result.message ?? '', /invalid\s+period/i);
    });
});

describe('parseReturnsSummaryErrors — KRA Returns Summary error tables', () => {
    it('parses the "System Error Occured" row KRA returns instead of a ZIP', () => {
        // Structure taken from a captured KRA response: the download POST
        // returned this "Returns Summary" page with a system-error row instead
        // of the ZIP archive.
        const html = `
            <html><body>
                <form id="command" name="returnsSummary" action="/KRA-Portal/eReturns.htm?actionCode=downloadTimsInvoices" method="POST">
                    <table>
                        <tr><td>Sr. No</td><td>File Section</td><td>Error Description</td></tr>
                        <tr><td>1</td><td>\`</td><td><label class="contentLabel" style="color: red;">System Error Occured.Please contact System Administrator.</label></td></tr>
                    </table>
                </form>
            </body></html>
        `;
        const errors = parseReturnsSummaryErrors(html);
        assert.strictEqual(errors.length, 1);
        assert.match(errors[0].description, /system\s+error\s+occured/i);
        assert.match(errors[0].description, /contact\s+system\s+administrator/i);
    });

    it('parses per-section upload validation rows', () => {
        const html = `
            <html><body>
                <form name="returnsSummary">
                    <table>
                        <tr><td>Sr. No</td><td>File Section</td><td>Error Description</td></tr>
                        <tr><td>1</td><td>A_Basic_Info</td><td>The Type of Return does not match with the Type of Return in the form you are trying to upload.</td></tr>
                    </table>
                </form>
            </body></html>
        `;
        const errors = parseReturnsSummaryErrors(html);
        assert.strictEqual(errors.length, 1);
        assert.strictEqual(errors[0].section, 'A_Basic_Info');
        assert.match(errors[0].description, /type of return does not match/i);
    });

    it('returns no errors for a page without an error table', () => {
        const html = '<html><body><h1>Return Submitted successfully</h1></body></html>';
        const errors = parseReturnsSummaryErrors(html);
        assert.strictEqual(errors.length, 0);
    });
});

describe('mapPortalMessage — transient KRA system errors', () => {
    it('maps "System Error Occured" (KRA spelling) to retryable PORTAL_UNAVAILABLE', () => {
        const mapped = mapPortalMessage('System Error Occured.Please contact System Administrator.');
        assert.ok(mapped);
        assert.strictEqual((mapped as any).code, KraErrorCode.PORTAL_UNAVAILABLE);
        assert.strictEqual((mapped as any).retryable, true);
    });

    it('maps the correctly spelled "System Error Occurred" too', () => {
        const mapped = mapPortalMessage('A System Error Occurred while processing your request.');
        assert.ok(mapped);
        assert.strictEqual((mapped as any).code, KraErrorCode.PORTAL_UNAVAILABLE);
        assert.strictEqual((mapped as any).retryable, true);
    });

    it('maps "Error has occurred" error pages to retryable PORTAL_UNAVAILABLE', () => {
        const mapped = mapPortalMessage('An Error has occurred. Your Error Reference No. is : 1788068627786');
        assert.ok(mapped);
        assert.strictEqual((mapped as any).code, KraErrorCode.PORTAL_UNAVAILABLE);
        assert.strictEqual((mapped as any).retryable, true);
    });

    it('does not map unrelated text', () => {
        const mapped = mapPortalMessage('Return Submitted successfully');
        assert.strictEqual(mapped, null);
    });
});

describe('computeVatSummaryMath — VAT return headline figures', () => {
    it('computes output/input VAT, payable VAT and net balance with credit brought forward', () => {
        const result = computeVatSummaryMath({
            salesVat: { general: 120_000, other: 5_000, zeroRated: 0, exempt: 0 },
            purchaseVat: [40_000, 2_500, 0, 0, 1_500],
            previousCredit: 10_000,
            withholdingAmount: 1_137,
        });
        // outputVat = 125,000; inputVat = 44,000; payable = 81,000;
        // net = 81,000 − 10,000 − 1,137 = 69,863
        assert.strictEqual(result.outputVat, 125_000);
        assert.strictEqual(result.inputVat, 44_000);
        assert.strictEqual(result.payableVat, 81_000);
        assert.strictEqual(result.netVatBalance, 69_863);
        assert.strictEqual(result.withholdingAmount, 1_137);
    });

    it('defaults withholding to 0 when omitted', () => {
        const result = computeVatSummaryMath({
            salesVat: { general: 16_000, other: 0, zeroRated: 0, exempt: 0 },
            purchaseVat: [4_000, 0, 0, 0, 0],
            previousCredit: 0,
        });
        assert.strictEqual(result.withholdingAmount, 0);
        assert.strictEqual(result.payableVat, 12_000);
        assert.strictEqual(result.netVatBalance, 12_000);
    });

    it('rounds each stage to 2dp in the generator order (rounding is not associative)', () => {
        const result = computeVatSummaryMath({
            // Raw section sums with sub-cent precision: sales 10.004 + 5.004
            // → 15.01 after rounding the TOTAL (not per-section).
            salesVat: { general: 10.004, other: 5.004, zeroRated: 0, exempt: 0 },
            // Purchases 3.333 + 3.333 + 3.334 = 10.0 exactly — inputVat 10.00.
            purchaseVat: [3.333, 3.333, 3.334, 0, 0],
            previousCredit: 0.005,
        });
        assert.strictEqual(result.outputVat, 15.01);
        assert.strictEqual(result.inputVat, 10.0);
        assert.strictEqual(result.payableVat, 5.01);
        // net = round(5.01 − 0.005) — the shared roundTo helper pins the exact order.
        assert.strictEqual(result.netVatBalance, roundTo(5.01 - 0.005, 2));
    });

    it('handles a fully zero return', () => {
        const result = computeVatSummaryMath({
            salesVat: { general: 0, other: 0, zeroRated: 0, exempt: 0 },
            purchaseVat: [0, 0, 0, 0, 0],
            previousCredit: 0,
        });
        assert.deepStrictEqual(result, {
            outputVat: 0,
            inputVat: 0,
            payableVat: 0,
            netVatBalance: 0,
            withholdingAmount: 0,
        });
    });
});
