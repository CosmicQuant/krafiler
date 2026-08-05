import { KraError, KraErrorCode } from '../errors';

export interface LiabilityRow {
    taxTypeName: string;
    taxPeriod: string;
    amountPayable: string;
    amountPaid: string;
    obligationId: string;
    hdrId: string;
    fromDate: string;
    toDate: string;
    obligationType: string;
}

export interface SelectedLiabilityPayload {
    actualLiabilityAmount: string;
    taxObligationTableEncoded: string;
    amountPaid: string;
    totalAmountToBePaid: string;
    obligationId: string;
    hdrId: string;
}

/**
 * Parse the DWR response from FetchTotalLiabilityDetailsWeb.
 * KRA returns a JS callback whose third argument is an array of paymentdetailDTO
 * objects, one per liability period.
 */
export function parseLiabilityDwrResponse(response: string): LiabilityRow[] {
    const callbackMatch = response.match(/dwr\.engine\.remote\.handleCallback\("\d+","\d+",([\s\S]+?)\);\s*$/m);
    if (!callbackMatch) {
        return [];
    }

    const payload = callbackMatch[1].trim();

    // The payload should be an array like [{...},{...}]. Split it into top-level
    // object literals by tracking brace depth.
    const objectTexts: string[] = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < payload.length; i++) {
        const ch = payload[i];
        if (ch === '{') {
            if (depth === 0) {
                start = i;
            }
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0 && start !== -1) {
                objectTexts.push(payload.slice(start, i + 1));
                start = -1;
            }
        }
    }

    const rows: LiabilityRow[] = [];
    for (const objText of objectTexts) {
        const row = parseObjectLiteral(objText);
        // A valid liability row has a hdrId and a non-zero actualLiabilityAmount.
        if (row.hdrId && row.amountPayable && row.amountPayable !== '0' && row.amountPayable !== '0.0') {
            rows.push(row);
        }
    }

    return rows;
}

function parseObjectLiteral(text: string): LiabilityRow {
    const extract = (name: string): string => {
        // Match quoted strings OR unquoted primitive values (numbers / null).
        // KRA field names are camelCase; do not use case-insensitive matching
        // because nested DTOs use PascalCase variants that are null.
        const re = new RegExp(`${name}\\s*:\\s*(?:"([^"]*)"|([0-9.]+|null|null:[^,\\\]\\]]*))`);
        const m = text.match(re);
        if (!m) return '';
        const value = m[1] ?? m[2] ?? '';
        return value === 'null' ? '' : value;
    };

    const taxTypeName = extract('taxTypeName');
    const fromDate = extract('fromDate');
    const toDate = extract('toDate');

    return {
        taxTypeName,
        // KRA returns taxPeriod as null; derive a label from the date range.
        taxPeriod: deriveTaxPeriodLabel(fromDate, toDate),
        // KRA stores the total payable in actualLiabilityAmount.
        amountPayable: extract('actualLiabilityAmount') || extract('amountPayable'),
        amountPaid: extract('actualPaymentAmount') || extract('amountPaid'),
        obligationId: extract('obligationId'),
        // The PRN submission uses hdrId; KRA returns it as taxLiabilityhdrId.
        hdrId: extract('taxLiabilityhdrId') || extract('hdrId'),
        fromDate,
        toDate,
        obligationType: extract('obligationType'),
    };
}

function deriveTaxPeriodLabel(fromDate: string, toDate: string): string {
    if (!fromDate) return '';
    const d = parseDdMmYyyy(fromDate);
    if (!d) return '';
    return `${d.toLocaleString('default', { month: 'long' })} ${d.getFullYear()}`;
}

function parseDdMmYyyy(value: string): Date | null {
    const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    const [, day, month, year] = match;
    const d = new Date(`${year}-${month}-${day}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Parse the rendered liability table HTML as a fallback.
 */
export function parseLiabilityTableHtml(html: string): LiabilityRow[] {
    const rows: LiabilityRow[] = [];
    const tableMatch = html.match(/<table[^>]*id=["\']LiablibilityTbl["\'][^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) {
        return rows;
    }

    const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch: RegExpExecArray | null;
    while ((trMatch = trPattern.exec(tableMatch[1])) !== null) {
        const trHtml = trMatch[1];
        // Skip header rows
        if (/<th\b/i.test(trHtml)) continue;

        const cells: string[] = [];
        const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let tdMatch: RegExpExecArray | null;
        while ((tdMatch = tdPattern.exec(trHtml)) !== null) {
            const text = tdMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            cells.push(text);
        }
        if (cells.length < 4) continue;

        // Expected columns: [radio/period, tax type, period, principal, fines, penalty, interest, amount payable, ...]
        const period = cells.find((c) => /\b\w+\s+\d{4}\b/.test(c)) ?? cells[2] ?? '';
        const amountPayable = cells.find((c) => /^\d+(\.\d+)?$/.test(c.replace(/,/g, ''))) ?? '';

        // Try to extract hidden inputs with the full row data.
        const hiddenMatch = trHtml.match(/value=["\']([^"\']*taxPeriod\*\*\*\*[^"\']*)["\']/i);
        if (hiddenMatch) {
            const encoded = hiddenMatch[1];
            const parsed = parseEncodedRow(encoded);
            if (parsed.hdrId) {
                rows.push(parsed);
                continue;
            }
        }

        // Partial fallback if we cannot get the encoded row.
        if (period && amountPayable) {
            rows.push({
                taxTypeName: '',
                taxPeriod: period,
                amountPayable,
                amountPaid: amountPayable,
                obligationId: '',
                hdrId: '',
                fromDate: '',
                toDate: '',
                obligationType: '',
            });
        }
    }

    return rows;
}

function parseEncodedRow(encoded: string): LiabilityRow {
    const parts = encoded.split('@@');
    const row: Partial<LiabilityRow> = {};
    for (const part of parts) {
        const separatorIndex = part.indexOf('****');
        if (separatorIndex === -1) continue;
        const key = part.slice(0, separatorIndex);
        const value = part.slice(separatorIndex + 4);
        switch (key) {
            case 'taxTypeName':
                row.taxTypeName = value;
                break;
            case 'taxPeriod':
                row.taxPeriod = value;
                break;
            case 'amountPayable':
                row.amountPayable = value;
                break;
            case 'amountPaid':
                row.amountPaid = value;
                break;
            case 'obligationId':
                row.obligationId = value;
                break;
            case 'hdrId':
                row.hdrId = value;
                break;
            case 'fromDate':
                row.fromDate = value;
                break;
            case 'toDate':
                row.toDate = value;
                break;
            case 'obligationType':
                row.obligationType = value;
                break;
        }
    }
    return row as LiabilityRow;
}

/**
 * Select the liability row that matches the requested period.
 * Period can be "June 2026", "06/2026", "2026-06", etc.
 */
export function selectLiabilityRow(rows: LiabilityRow[], targetPeriod: string): LiabilityRow {
    if (rows.length === 0) {
        throw new KraError(KraErrorCode.UNKNOWN, 'No liability rows returned by KRA for the selected period');
    }

    const normalizedTarget = normalizePeriod(targetPeriod);

    const row = rows.find((r) => normalizePeriod(r.taxPeriod) === normalizedTarget) ??
        rows.find((r) => normalizePeriod(`${r.fromDate}-${r.toDate}`) === normalizedTarget) ??
        rows[0];

    if (!row.hdrId) {
        throw new KraError(
            KraErrorCode.UNKNOWN,
            `Selected liability row for ${targetPeriod} is missing hdrId; cannot build PRN payload`,
            { context: { row } }
        );
    }

    return row;
}

function normalizePeriod(period: string): string {
    const cleaned = period.toLowerCase().replace(/[^a-z0-9]/g, '');
    // Convert "june2026" and "062026" and "202606" to a common "202606" representation.
    const monthNames: Record<string, string> = {
        january: '01',
        february: '02',
        march: '03',
        april: '04',
        may: '05',
        june: '06',
        july: '07',
        august: '08',
        september: '09',
        october: '10',
        november: '11',
        december: '12',
    };

    for (const [name, num] of Object.entries(monthNames)) {
        if (cleaned.includes(name)) {
            const yearMatch = cleaned.match(/(\d{4})/);
            if (yearMatch) {
                return `${yearMatch[1]}${num}`;
            }
        }
    }

    // "062026" or "202606"
    if (/^\d{6}$/.test(cleaned)) {
        if (cleaned.startsWith('20')) {
            return cleaned;
        }
        // Assume MMYYYY
        return cleaned.slice(2) + cleaned.slice(0, 2);
    }

    return cleaned;
}

/**
 * Build the encoded `taxObligationTable_1` value and related fields from a selected row.
 */
export function buildLiabilityPayload(
    row: LiabilityRow,
    taxTypeLabel: string,
    obligationType: string
): SelectedLiabilityPayload {
    const isZeroOrEmpty = (value: string): boolean => !value || value === '0' || value === '0.0';
    const rawAmount = isZeroOrEmpty(row.amountPaid) ? row.amountPayable : row.amountPaid;
    // amountPayable in the encoded row is formatted to two decimals (KRA expectation).
    const amountPayableFormatted = Number(rawAmount).toFixed(2);
    // amountPaid is the user-entered value, typically rounded to a whole number.
    const amountPaid = String(Math.round(Number(rawAmount)));
    // actualLiabilityAmount_0 is sent as a whole number without decimals.
    const actualLiabilityAmount = String(Math.round(Number(row.amountPayable)));

    const encoded = [
        `taxTypeName****${taxTypeLabel || row.taxTypeName}`,
        `taxPeriod****${row.taxPeriod}`,
        `amountPayable****${amountPayableFormatted}`,
        `amountPaid****${amountPaid}`,
        `obligationId****${row.obligationId}`,
        `hdrId****${row.hdrId}`,
        `fromDate****${row.fromDate}`,
        `toDate****${row.toDate}`,
        `obligationType****${obligationType || row.obligationType}`,
    ].join('@@');

    return {
        actualLiabilityAmount,
        taxObligationTableEncoded: encoded,
        amountPaid,
        // KRA expects the total amount to be the actual liability amount.
        totalAmountToBePaid: String(Math.round(Number(rawAmount))),
        obligationId: row.obligationId,
        hdrId: row.hdrId,
    };
}
