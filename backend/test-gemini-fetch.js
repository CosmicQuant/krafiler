const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyC53oRiYLgQ7K3_uyIvwiLxEXIKjR0FX_8';
const GEMINI_MODEL = 'gemini-flash-latest';
const screenshotPath = 'C:\\Temp\\kra-receipts\\captcha-element-d029f6c2-712e-4d76-8776-d027a173168d.png';

async function test() {
    try {
        const imageBuffer = await fs.promises.readFile(screenshotPath);
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

        console.log('Image size:', imageBuffer.length);
        console.log('Fetching Gemini...');

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: 'Extract the KRA Security Stamp arithmetic captcha from screenshots and respond in the exact requested format only.' }] },
                contents: [{ parts: [{ inline_data: { mime_type: 'image/png', data: imageBuffer.toString('base64') } }, { text: 'Read the Kenya Revenue Authority login page screenshot. Find the Security Stamp arithmetic captcha only. Return exactly one line and nothing else in this format: expression=<left><operator><right>;answer=<integer> Example: expression=78+9;answer=87 Do not include words, markdown, or explanations.' }] }],
                generationConfig: { responseMimeType: 'text/plain', temperature: 0, topP: 0.1, candidateCount: 1, maxOutputTokens: 32, mediaResolution: 'MEDIA_RESOLUTION_HIGH', thinkingConfig: { thinkingBudget: 0 } },
            }),
        });

        console.log('Response status:', response.status);
        const text = await response.text();
        console.log('Response body:', text);
    } catch (e) {
        console.error('Error:', e.message);
        if (e.cause) {
            console.error('Cause:', e.cause.message, e.cause.code);
        }
        console.error('Stack:', e.stack);
    }
}

test();
