# KRA Tax Head & Tax Sub Head Reference

This file documents all known KRA iTax obligation IDs, tax head values,
and tax sub head labels used by the HTTP PRN generation flow.

## Tax Heads (cmbTaxHead)

| Value     | Label            |
|-----------|------------------|
| `IT`      | Income Tax       |
| `VAT`     | VAT              |
| `EXCISE`  | Excise           |
| `OTHER`   | Other            |
| `AGENCY_R`| Agency Revenue   |
| `PPP`     | Payment for Payment Plan |
| `IPA`     | iTax Prior Assessment |

## Income Tax Sub-Heads (itObligationsMapList)

These are the obligation IDs returned by the `FetchTaxPayerDetail` DWR call
inside `itObligationsMapList`. Each entry is `{value:"label",key:"obligationId"}`.
The `key` is the value used for `cmbTaxSubHead` and the DWR `subHeadId` parameter.

| key  | code  | label                                    |
|------|-------|------------------------------------------|
| 2    | 0101  | Income Tax - Resident Individual         |
| 3    | 0102  | Income Tax - Non-Resident Individual     |
| 33   | 0111  | Income Tax - Rent Income (MRI)           |
| 6    | 0105  | Income Tax - Withholding                 |
| 14   | 0109  | Income Tax - Transmission of Messages    |
| 32   | 0110  | Capital Gain Tax (CGT)                   |
| 34   | 0112  | Income Tax - Amnesty                     |
| 40   | 0120  | Foreign Amnesty                          |
| 13   | 0108  | Income Tax Shipping Tax                   |
| 8    | 0107  | Income Tax - Turnover Tax (ToT)           |
| 36   | 0501  | Advance Tax                              |
| 37   | 0145  | Digital Asset Tax (DAT)                  |
| 44   | 0153  | Domestic Minimum Top Up Tax (DMTT)       |
| 5    | —     | Income Tax - Company                     |
| 7    | —     | Income Tax - PAYE                        |
| 4    | —     | Income Tax - PAYE (alt)                  |
| 29   | —     | (unknown)                                |

摸Notes:
- `8` = ToT (confirmed from HAR: `cmbTaxSubHead=8`)
- `33` = MRI Rent Income (confirmed from DWR response + successful PRN generation)
- `9` and `10` are **VAT** sub-heads, NOT Income Tax (common misconception)
- The obligation ID set varies per taxpayer based on what obligations they are registered for.
  Our code resolves dynamically from `itObligationsMapList` in the DWR response.

## Obligation ID to Tax Head Mapping

From KRA's inline JavaScript in the Payment Registration Tax Form:

### Income Tax (IT)
`2, 3, 4, 5, 6, 7, 8, 12, 13, 14, 22, 29, 32, 33, 34, 35, 36, 37, 44, 40`

### VAT
`9, 10`

### Excise
`18, 11, 106`

## DWR Flow for PRN Generation

1. **FetchTaxpayerDetailWithoutValidation** — returns `taxPayerId` (internal numeric ID)
2. **FetchTaxPayerDetail** — returns taxpayer name/email/address/mobile AND `itObligationsMapList` (obligation ID → label mapping for Income Tax sub-heads)
3. **GetObligationRollOutDateDtls** `(subHeadId, taxPayerId)` — returns rollout date info
4. **FetchTaxPeriod** `(subHeadId, taxPayerId, returnType, 0, paymentType)` — returns tax periods
5. **FetchTotalLiabilityDetailsWeb** `(taxPayerId, subHeadId, 0, paymentType, 0)` — returns liability rows (one per period with `actualLiabilityAmount`, `taxLiabilityhdrId`, `fromDate`, `toDate`)
6. **FetchObligationDetail** `(taxPayerId, subHeadId, periodFrom, periodTo, null)` — the "Add" button call
7. **GetObligationRollOutDateDtls** (repeat) — browser re-fetches after obligation detail
8. **GetSelectedMonthOfSelectedYearWeb** `(date, "", false, subHeadId)` — month/year validation

## Tax Type Config (our code)

| taxObligationType        | headValue | subHeadLabelRegex | obligationType | defaultTaxTypeLabel                      |
|--------------------------|-----------|--------------------|----|------------------------------------------|
| turnover_tax             | IT        | /Turnover Tax/     | IT| (0107) Income Tax - Turnover Tax          |
| monthly_rental_income    | IT        | /Rent Income/      | IT| (0111) Income Tax - Rent Income           |

## Additional Tax Types (Playwright labels, not yet HTTP-configured)

| taxObligationType | headLabel    | subHeadLabel                        |
|-------------------|--------------|-------------------------------------|
| vat               | VAT          | (0201) Value Added Tax (VAT)        |
| paye              | Income Tax   |PAYE                                |
| nita              | Agency Revenue| NITA Levy                         |
| affordable_housing| Agency Revenue| Housing Levy                      |

## Payment Types (cmbPaymentType)

| Value | Label            |
|-------|------------------|
| SAT  | Self Assessment   |

## How Sub-Head Resolution Works

1. **Primary:** `resolveSubHeadFromDwrResponse()` parses `itObligationsMapList` from the `FetchTaxPayerDetail` DWR response and matches the label against `config.subHeadLabelRegex`. This is the correct dynamic approach.
2. **Fallback:** `resolveSubHeadValue()` reads the `cmbTaxSubHead` `<select>` options from the HTML (if pre-rendered), then falls back to hardcoded values:
   - ToT → `8`
   - MRI → `33`