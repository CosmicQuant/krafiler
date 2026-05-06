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

export async function setPortalDateField(
    page: any,
    selector: string,
    dateString: string // Expects format like "01/10/2023"
): Promise<void> {
    await page.locator(selector).fill('');
    await page.locator(selector).fill(dateString);
    await page.keyboard.press('Tab'); // Trigger any attached blur/change handlers
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
