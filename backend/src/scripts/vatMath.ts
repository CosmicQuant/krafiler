/**
 * vatMath.ts
 *
 * Pure VAT return math (no I/O, no side effects). Extracted from
 * prepareVatReturnArtifacts in vat-return-generator.ts so the exact
 * rounding order of the KRA return figures is unit-testable — the
 * generator and the tests share the same formulas.
 */

export function roundTo(value: number, decimals = 2): number {
    const multiplier = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

export interface VatSummaryMathInput {
    /** Raw (unrounded) VAT totals per sales section: B/C general, other-rated, D zero-rated, E exempt. */
    salesVat: {
        general: number;
        other: number;
        zeroRated: number;
        exempt: number;
    };
    /** Raw (unrounded) VAT totals per purchase section, in order F, G, H, I, J. */
    purchaseVat: [number, number, number, number, number] | number[];
    /** Credit brought forward from the previous return period. */
    previousCredit: number;
    /** Withholding VAT already remitted (defaults to 0). */
    withholdingAmount?: number;
}

export interface VatSummaryMathResult {
    /** Total output VAT (all sales sections), rounded to 2dp. */
    outputVat: number;
    /** Total input VAT (all purchase sections), rounded to 2dp. */
    inputVat: number;
    /** Output VAT − input VAT — the tax payable for the period. */
    payableVat: number;
    /** payableVat − previousCredit − withholdingAmount. */
    netVatBalance: number;
    /** Withholding amount normalized to 2dp. */
    withholdingAmount: number;
}

/**
 * Computes the VAT return headline figures in the exact rounding order used by
 * the generator (rounding is NOT associative, so the order matters):
 *
 *   outputVat      = round(sum of sales section VAT)
 *   inputVat       = round(sum of purchase section VAT)
 *   payableVat     = round(outputVat − inputVat)
 *   withholding    = round(withholdingAmount ?? 0)
 *   netVatBalance  = round(payableVat − previousCredit − withholding)
 */
export function computeVatSummaryMath(input: VatSummaryMathInput): VatSummaryMathResult {
    const totalSalesVat = roundTo(
        input.salesVat.general + input.salesVat.other + input.salesVat.zeroRated + input.salesVat.exempt,
        2
    );
    const inputVat = roundTo(
        input.purchaseVat.reduce((sum, value) => sum + value, 0),
        2
    );
    const payableVat = roundTo(totalSalesVat - inputVat, 2);
    const withholdingAmount = roundTo(input.withholdingAmount ?? 0, 2);
    const netVatBalance = roundTo(payableVat - input.previousCredit - withholdingAmount, 2);

    return {
        outputVat: roundTo(totalSalesVat, 2),
        inputVat,
        payableVat,
        netVatBalance,
        withholdingAmount,
    };
}
