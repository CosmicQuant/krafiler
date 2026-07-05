import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    parseTokenKey,
    parseCaptchaImageUrl,
    parseLoginOutcome,
    parseObligationOptions,
    findObligationValue,
    parsePortalErrors,
    parseSubmissionResult,
} from './index';

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
