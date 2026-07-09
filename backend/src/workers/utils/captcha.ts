/**
 * captcha.ts
 *
 * OCR and mathematical expression evaluation for KRA's image-based captchas.
 * Wraps Tesseract.js and falls back to manual entry logic.
 */

import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { JobContext } from '../../types';
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
    job?: JobContext,
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
 * Solves a KRA arithmetic captcha image using OpenCode Go Kimi K2.7 Code Vision,
 * with Gemma/Gemini fallback and Tesseract OCR as the final fallback.
 * Accepts a raw image Buffer (e.g. downloaded from the CAPTCHA endpoint)
 * instead of reading a screenshot from disk.
 */
export async function solveCaptchaWithGemma4Buffer(
    imageBuffer: Buffer,
    options: {
        apiKey?: string;
        model?: string;
        job?: JobContext;
        progress?: number;
    } = {}
): Promise<string> {
    const openCodeApiKey = process.env.OPENCODE_API_KEY ?? '';
    const openCodeEnabled = process.env.OPENCODE_ENABLED === 'true';
    const openCodeModel = process.env.OPENCODE_MODEL ?? 'opencode-go/kimi-k2.7-code';
    const gemmaApiKey = options.apiKey ?? process.env.GEMMA4_API_KEY ?? '';
    const gemmaPrimaryModel = options.model ?? process.env.GEMMA4_MODEL ?? 'gemma-4-31b-it';
    const gemmaFallbackModel = 'gemini-3.5-flash';

    // Try OpenCode first, but only when explicitly enabled — the default endpoint
    // (api.opencode.co) has been unreliable (TLS handshake failures), so we don't
    // want to waste retry budget on it unless the operator opts in.
    if (openCodeApiKey && openCodeEnabled) {
        const answer = await solveCaptchaWithOpenCode(imageBuffer, openCodeApiKey, openCodeModel, options);
        if (answer) return answer;
    }

    // Fall back to Gemma/Gemini.
    if (gemmaApiKey) {
        const answer = await solveCaptchaWithGemini(imageBuffer, gemmaApiKey, gemmaPrimaryModel, gemmaFallbackModel, options);
        if (answer) return answer;
    }

    // Final fallback to local OCR.
    if (options.job) {
        await appendJobLog(options.job, 'Vision LLM captcha solvers exhausted; falling back to Tesseract OCR', {
            progress: options.progress,
            level: 'warn',
        });
    }
    return solveCaptchaWithTesseract(imageBuffer, options.job, options.progress);
}

async function solveCaptchaWithOpenCode(
    imageBuffer: Buffer,
    apiKey: string,
    model: string,
    options: {
        job?: JobContext;
        progress?: number;
    }
): Promise<string | undefined> {
    const endpoint = 'https://api.opencode.co/v1/chat/completions';
    const maxRetries = 3;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        if (attempt > 0) {
            const delayMs = 1000 * Math.pow(2, attempt - 1);
            if (options.job) {
                await appendJobLog(options.job, `OpenCode captcha request failed, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`, {
                    progress: options.progress,
                    level: 'info',
                });
            }
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'text',
                                    text: 'You solve math captchas. Look at the image and return ONLY the final numeric answer to the arithmetic problem shown in the Security Stamp or captcha area. Do not explain.',
                                },
                                {
                                    type: 'image_url',
                                    image_url: {
                                        url: `data:image/png;base64,${imageBuffer.toString('base64')}`,
                                    },
                                },
                            ],
                        },
                    ],
                    max_tokens: 128,
                    temperature: 0,
                }),
            });

            if (response.ok) {
                const payload = await response.json();
                const answer = extractOpenCodeCaptchaAnswer(payload);
                if (answer) return answer;
                throw new Error(`OpenCode returned an unexpected captcha format: ${JSON.stringify(payload.choices?.[0]?.message ?? {})}`);
            }

            const errorText = await response.text();
            lastError = new Error(`OpenCode request failed (${response.status}): ${errorText}`);
            if (response.status < 500 && response.status !== 429) {
                break;
            }
        } catch (err: any) {
            lastError = err;
            if (err.message && err.message.includes('fetch failed')) {
                continue;
            }
            if (attempt === maxRetries - 1) break;
        }
    }

    if (lastError && options.job) {
        await appendJobLog(options.job, `OpenCode captcha solver failed: ${lastError.message}`, {
            progress: options.progress,
            level: 'warn',
        });
    }
    return undefined;
}

async function solveCaptchaWithGemini(
    imageBuffer: Buffer,
    apiKey: string,
    primaryModel: string,
    fallbackModel: string,
    options: {
        job?: JobContext;
        progress?: number;
    }
): Promise<string | undefined> {
    const models = [primaryModel];
    if (primaryModel !== fallbackModel) {
        models.push(fallbackModel);
    }

    let lastError: Error | undefined;

    for (const model of models) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const maxRetries = 3;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            if (attempt > 0 || model !== primaryModel) {
                const delayMs = 1000 * Math.pow(2, attempt - 1);
                const message =
                    model === primaryModel
                        ? `Gemma 4 captcha request failed, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`
                        : `Falling back to ${model} captcha solver`;
                if (options.job) {
                    await appendJobLog(options.job, message, {
                        progress: options.progress,
                        level: 'info',
                    });
                }
                if (attempt > 0) {
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                }
            }

            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: 'You solve math captchas. Look at the image and return ONLY the final numeric answer to the arithmetic problem shown in the Security Stamp or captcha area. Do not explain.' },
                                {
                                    inline_data: {
                                        mime_type: 'image/png',
                                        data: imageBuffer.toString('base64'),
                                    },
                                },
                            ],
                        }],
                        generationConfig: {
                            maxOutputTokens: 128,
                            temperature: 0,
                        },
                    }),
                });

                if (response.ok) {
                    const payload = await response.json();
                    const answer = extractGemma4CaptchaAnswer(payload);
                    if (answer) return answer;
                    throw new Error(`Gemma 4 returned an unexpected captcha format: ${JSON.stringify(payload.candidates?.[0]?.content?.parts ?? [])}`);
                }

                const errorText = await response.text();
                lastError = new Error(`Gemma 4 request failed (${response.status}): ${errorText}`);
                if (response.status < 500 && response.status !== 429) {
                    break;
                }
            } catch (err: any) {
                lastError = err;
                if (err.message && err.message.includes('fetch failed')) {
                    continue;
                }
                if (attempt === maxRetries - 1) break;
            }
        }
    }

    if (lastError && options.job) {
        await appendJobLog(options.job, `Gemma/Gemini captcha solver failed: ${lastError.message}`, {
            progress: options.progress,
            level: 'warn',
        });
    }
    return undefined;
}

function extractOpenCodeCaptchaAnswer(payload: any): string | null {
    const rawText = payload.choices?.[0]?.message?.content ?? '';
    const cleaned = String(rawText).replace(/\D/g, '');
    if (cleaned) {
        return cleaned;
    }

    const fallbackNumbers = String(rawText).match(/\b\d+\b/g);
    if (fallbackNumbers && fallbackNumbers.length > 0) {
        return fallbackNumbers[fallbackNumbers.length - 1];
    }

    return null;
}

function extractGemma4CaptchaAnswer(payload: any): string | null {
    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    const answerParts = parts.filter((p: any) => !p.thought && typeof p.text === 'string');
    const rawText = answerParts.length > 0 ? answerParts[answerParts.length - 1].text : '';

    const cleaned = rawText.replace(/\D/g, '');
    if (cleaned) {
        return cleaned;
    }

    const allPartsText = parts.map((p: any) => p.text).join('\n');
    const fallbackNumbers = allPartsText.match(/\b\d+\b/g);
    if (fallbackNumbers && fallbackNumbers.length > 0) {
        return fallbackNumbers[fallbackNumbers.length - 1];
    }

    return null;
}

/**
 * The main entry point for solving a captcha element on the KRA portal.
 * Currently uses Tesseract, but built to allow Gemini Vision API drop-in later.
 */
export async function solveCaptcha(
    page: any,
    captchaSelector: string,
    inputSelector: string,
    job?: JobContext,
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
