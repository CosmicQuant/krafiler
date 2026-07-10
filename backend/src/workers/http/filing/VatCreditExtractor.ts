import { appendJobLog } from '../../utils/job-helpers';
import { parseFormFields, parsePortalErrors, loadHtml } from '../parsers';
import { KraHttpSession } from '../session/KraHttpSession';

/**
 * HTTP-based extraction of VAT credit brought forward and withholding tax
 * from the KRA iTax portal.
 *
 * Credit brought forward flow:
 *   1. POST eReturns.htm?actionCode=viewEReturns → load View Filed Returns page
 *   2. POST eReturns.htm?actionCode=viewReturnData with taxType=9 (VAT), isConsult=Y
 *   3. Parse the filed returns table for the most recent VAT filing's trpId
 *   4. GET eReturnsView.htm?ACTION_TYPE=viewForm&trpId=...&obligationId=9
 *   5. Parse "Net VAT Payable / Credit Carried Forward" from the filing detail page
 *
 * Withholding tax flow:
 *   1. POST complianceMonitoring.htm?actionCode=showReprintVATWhtCerti → load form
 *   2. POST complianceMonitoring.htm?actionCode=saveAndReprintWHT with month/year
 *   3. Parse "Total VAT Withholding Amount" from the results page
 */
export class VatCreditExtractor {
    private session: KraHttpSession;
    private job: any;

    constructor(session: KraHttpSession, job: any) {
        this.session = session;
        this.job = job;
    }

    async extractCreditBroughtForward(): Promise<number> {
        try {
            await appendJobLog(this.job, 'Extracting VAT credit brought forward via HTTP...', { progress: 46 });

            // Step 1: Load View Filed Returns page
            const viewPage = await this.session.post(
                'eReturns.htm?actionCode=viewEReturns',
                {
                    operation: '',
                    actionCode: 'viewEReturns',
                    flag: '',
                    token_key: this.session.requireToken(),
                },
                { timeout: 30_000 }
            );

            // Step 2: Submit Consult with VAT selected
            const fields = parseFormFields(viewPage, 'form[name="viewRtnForm"], form#viewRtnForm, form');
            const consultResponse = await this.session.post(
                'eReturns.htm?actionCode=viewReturnData',
                {
                    ...fields,
                    token_key: this.session.requireToken(),
                    isConsult: 'Y',
                    taxType: '9',
                    typeReturn: '',
                    entityType: '',
                    branchName: '',
                },
                { timeout: 30_000 }
            );

            // Step 3: Parse filed returns table for trpId of most recent VAT filing
            const trpId = this.parseLatestTrpId(consultResponse);
            if (!trpId) {
                await appendJobLog(this.job, 'No previous VAT filings found; credit brought forward = 0', { progress: 46 });
                return 0;
            }

            await appendJobLog(this.job, `Found most recent VAT filing (trpId: ${trpId})`, { progress: 46 });

            // Step 4: GET the filing detail page
            const detailResponse = await this.session.get(
                `eReturnsView.htm?ACTION_TYPE=viewForm&trpId=${trpId}&obligationId=9`,
                { timeout: 30_000 }
            );

            // Step 5: Parse credit from the detail page
            const credit = this.parseCreditFromDetail(detailResponse);
            await appendJobLog(this.job, `Extracted credit carried forward: KES ${credit}`, { progress: 46 });
            return credit;
        } catch (err: any) {
            await appendJobLog(this.job, `Credit extraction failed: ${err.message}, defaulting to 0`, { progress: 46, level: 'warn' });
            return 0;
        }
    }

    async extractWithholding(periodFrom: string): Promise<number> {
        try {
            const periodDate = new Date(periodFrom);
            const month = String(periodDate.getMonth() + 1);
            const year = String(periodDate.getFullYear());

            await appendJobLog(this.job, `Checking VAT withholding for ${month}/${year} via HTTP...`, { progress: 46 });

            // Step 1: Load the withholding form page
            const whtFormPage = await this.session.post(
                'complianceMonitoring.htm?actionCode=showReprintVATWhtCerti',
                {
                    operation: '',
                    actionCode: '',
                    flag: '',
                    token_key: 'null',
                },
                { timeout: 30_000 }
            );

            const whtFields = parseFormFields(whtFormPage, 'form');

            // Step 2: Submit Consult with month/year
            const whtResults = await this.session.post(
                'complianceMonitoring.htm?actionCode=saveAndReprintWHT',
                {
                    ...whtFields,
                    token_key: this.session.requireToken(),
                    strCurrentPage: '1',
                    PageSize: '0',
                    withholdingType: 'vatWithholding',
                    'whtCertiHdrDTO.camWhtCertiNo': '',
                    'whtCertiHdrDTO.withholderPin': '',
                    'whtCertiHdrDTO.whtCertiDtStr': '',
                    'whtCertiHdrDTO.withholdeePin': '',
                    'whtCertiHdrDTO.invoiceNo': '',
                    'whtCertiHdrDTO.month': month,
                    'whtCertiHdrDTO.year': year,
                    'whtCertiHdrDTO.prn': '',
                },
                { timeout: 30_000 }
            );

            // Step 3: Parse withholding amount
            const $ = loadHtml(whtResults);
            const pageText = $('body').text() || '';

            if (pageText.includes('Records Not Found') || pageText.includes('No Records')) {
                await appendJobLog(this.job, `No withholding records found for ${month}/${year}`, { progress: 46 });
                return 0;
            }

            const totalMatch = pageText.match(/Total VAT Withholding Amount\s*[:\-]?\s*([\d,]+\.?\d*)/i);
            if (totalMatch) {
                const amount = parseFloat(totalMatch[1].replace(/,/g, ''));
                await appendJobLog(this.job, `Total VAT Withholding Amount: KES ${amount}`, { progress: 46 });
                return amount;
            }

            await appendJobLog(this.job, 'Could not extract withholding amount, defaulting to 0', { progress: 46 });
            return 0;
        } catch (err: any) {
            await appendJobLog(this.job, `Withholding extraction failed: ${err.message}, defaulting to 0`, { progress: 46, level: 'warn' });
            return 0;
        }
    }

    private parseLatestTrpId(html: string): string | null {
        // Look for viewForm('trpId','obligationId') calls in the table rows.
        // KRA uses quoted string arguments: viewForm('121040862','9')
        const $ = loadHtml(html);
        const viewFormCalls = $('a[onclick*="viewForm"], input[onclick*="viewForm"]').toArray();

        for (const el of viewFormCalls) {
            const onclick = $(el).attr('onclick') ?? '';
            const match = onclick.match(/viewForm\(\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/);
            if (match && match[2] === '9') {
                return match[1];
            }
        }

        // Fallback: scan raw HTML for viewForm calls with obligationId=9 (with or without quotes)
        const regex = /viewForm\(\s*['"]?(\d+)['"]?\s*,\s*['"]?9['"]?\s*\)/g;
        const match = regex.exec(html);
        if (match) {
            return match[1];
        }

        return null;
    }

    private parseCreditFromDetail(html: string): number {
        const $ = loadHtml(html);

        // Look for "Net VAT Payable / Credit Carried Forward" row
        const rows = $('tr').toArray();
        for (const row of rows) {
            const rowText = $(row).text() ?? '';
            if (rowText.includes('Net VAT Payable') || rowText.includes('Credit Carried Forward')) {
                const cells = $(row).find('td').toArray();
                if (cells.length > 0) {
                    const lastCell = $(cells[cells.length - 1]).text() ?? '';
                    const match = lastCell.match(/-?\d{1,3}(,\d{3})*(\.\d+)?/);
                    if (match) {
                        const value = parseFloat(match[0].replace(/,/g, ''));
                        // Only use negative values as credit (positive means payable)
                        return value < 0 ? Math.abs(value) : 0;
                    }
                }
            }
        }

        return 0;
    }
}
