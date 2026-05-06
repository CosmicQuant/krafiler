/**
 * captcha.ts
 *
 * OCR and mathematical expression evaluation for KRA's image-based captchas.
 * Wraps Tesseract.js and falls back to manual entry logic.
 */

import { Job } from 'bullmq';
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { FilingJob } from '../../types';
import { appendJobLog } from './job-helpers';

/**
 * Normalises an OCR text result containing basic arithmetic.
 * Deals with common hallucinated misrecognitions.
 */
function extractGeminiText(text: string): string {
    let t = text.replace(/\s+/g, '').toLowerCase();

    // Map common misrecognitions
    t = t.replace(/x/g, '*');
    t = t.replace(/[o|O]/g, '0');
    t = t.replace(/[l|I|i]/g, '1');
    t = t.replace(/[s|S]/g, '5');
    t = t.replace(/[z|Z]/g, '2');
    t = t.replace(/[b|B]/g, '8');
    t = t.replace(/[g|G]/g, '9');
    t = t.replace(/÷/g, '/');

    // Keep only numbers and operators
    t = t.replace(/[^0-9+\-*/=]/g, '');

    return t;
}

/**
 * Attempts to parse and evaluate the math expression found in the image.
 */
function evaluateArithmetic(expression: string): number | null {
    // Look for A operator B [=]
    const match = expression.match(/(\d+)\s*([+\-*/])\s*(\d+)/);
    if (!match) {
        return null;
    }

    const [, aStr, operator, bStr] = match;
    const a = parseInt(aStr, 10);
    const b = parseInt(bStr, 10);

    if (isNaN(a) || isNaN(b)) {
        return null;
    }

    switch (operator) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b !== 0 ? Math.floor(a / b) : null;
        default: return null;
    }
}

/**
 * Uses Tesseract.js (with Sharp preprocessing) to solve KRA's image captcha.
 */
export async function solveCaptchaWithTesseract(
    imageBuffer: Buffer,
    job?: Job<FilingJob>,
    progress?: number
): Promise<string> {
    const tesseractWorker = await createWorker('eng');

    try {
        // Pre-process the image with sharp to improve OCR accuracy
        const processedImageBuffer = await sharp(imageBuffer)
            .resize(300, null, { withoutEnlargement: false })
            .grayscale()
            .normalize()
            .threshold(180)
            .png()
            .toBuffer();

        const { data: { text } } = await tesseractWorker.recognize(processedImageBuffer);
        const normalizedText = extractGeminiText(text);

        if (job) {
            await appendJobLog(job, `OCR extracted text: "${text.trim()}", normalized: "${normalizedText}"`, { progress });
        }

        const result = evaluateArithmetic(normalizedText);

        if (result === null) {
            throw new Error(`Could not parse a valid arithmetic expression from: "${normalizedText}"`);
        }

        return result.toString();
    } finally {
        await tesseractWorker.terminate().catch(() => {});
    }
}

/**
 * The main entry point for solving a captcha element on the KRA portal.
 * Currently uses Tesseract, but built to allow Gemini Vision API drop-in later.
 */
export async function solveCaptcha(
    page: any,
    captchaSelector: string,
    inputSelector: string,
    job?: Job<FilingJob>,
    progress?: number
): Promise<void> {
    try {
        const captchaElement = await page.locator(captchaSelector).first();
        const imageBuffer = await captchaElement.screenshot();
        const solution = await solveCaptchaWithTesseract(imageBuffer, job, progress);

        if (job) {
             await appendJobLog(job, `Solved captcha: ${solution}`, { progress });
        }

        await page.locator(inputSelector).fill(solution);
    } catch (error) {
        if (job) {
             await appendJobLog(job, `OCR Captcha solving failed: ${error instanceof Error ? error.message : String(error)}. Waiting 30s for manual entry.`, { level: 'info', progress });
        }
        // Fallback: wait for the user to manually enter the captcha if OCR fails
        await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
}
