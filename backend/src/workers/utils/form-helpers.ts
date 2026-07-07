/**
 * form-helpers.ts
 *
 * Form filling logic, date parsing, and form specific selectors
 */

export async function selectOptionByTextPatterns(
    page: any,
    selector: string,
    patterns: RegExp[]
): Promise<string> {
    const options = await page.locator(`${selector} option`).evaluateAll((opts: HTMLOptionElement[]) =>
        opts.map((opt) => ({
            value: opt.value,
            text: opt.textContent?.trim() ?? '',
            disabled: opt.disabled,
        }))
    );

    const match = options.find((opt: any) =>
        !opt.disabled && opt.value !== '' && patterns.some((pattern) => pattern.test(opt.text))
    );

    if (!match) {
        throw new Error(`Failed to find an option matching patterns [${patterns.map(p => p.source).join(', ')}] in dropdown ${selector}`);
    }

    await page.selectOption(selector, match.value);
    return match.text;
}

function formatPortalDate(isoDate: string): string {
    const [year, month, day] = isoDate.split('-');
    if (!year || !month || !day) {
        throw new Error(`Invalid ISO date provided: "${isoDate}"`);
    }
    return `${day}/${month}/${year}`;
}

/**
 * Fills a KRA portal date field.
 * Handles readonly/disabled fields and converts ISO dates (YYYY-MM-DD)
 * to the portal format (DD/MM/YYYY).
 *
 * Overload 1: (page, selector, isoDate)
 * Overload 2: (locator, isoDate, label)
 */
export async function setPortalDateField(
    pageOrLocator: any,
    selectorOrIsoDate: string,
    isoDateOrLabel: string
): Promise<void> {
    let locator: any;
    let isoDate: string;
    let label: string;

    // Detect overload: Playwright Page has .goto(); Locator has .fill() but no .goto().
    // A Locator also exposes .locator(), so we must not use that as the discriminator.
    if (typeof pageOrLocator.goto === 'function') {
        locator = pageOrLocator.locator(selectorOrIsoDate).first();
        isoDate = isoDateOrLabel;
        label = selectorOrIsoDate;
    } else {
        locator = pageOrLocator;
        isoDate = selectorOrIsoDate;
        label = isoDateOrLabel;
    }

    const portalDate = formatPortalDate(isoDate);
    const fieldState = await locator.evaluate((input: HTMLInputElement) => ({
        value: String(input.value ?? '').trim(),
        readOnly: Boolean(input.readOnly),
        disabled: Boolean(input.disabled),
    }));

    if (fieldState.disabled) {
        throw new Error(`${label} field is disabled on the KRA form`);
    }

    // Already correct — nothing to do
    if (fieldState.value === portalDate || fieldState.value === isoDate) {
        return;
    }

    if (fieldState.readOnly) {
        await locator.evaluate((input: HTMLInputElement, value: string) => {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
        }, portalDate);
        return;
    }

    await locator.fill(portalDate);
    await locator.evaluate((input: HTMLInputElement) => {
        input.dispatchEvent(new Event('blur', { bubbles: true }));
    });
}

export async function selectRentalPropertyAnswer(
    page: any,
    questionLabelPattern: RegExp,
    answer: 'Yes' | 'No'
): Promise<void> {
    const questionContainer = await page.locator('tr').filter({ hasText: questionLabelPattern }).first();
    if (await questionContainer.count() === 0) {
        throw new Error(`Could not find rental property question matching ${questionLabelPattern.source}`);
    }
    const radioSelector = `input[type="radio"][value="${answer}"]`;
    await questionContainer.locator(radioSelector).click();
}
