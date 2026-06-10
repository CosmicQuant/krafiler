/**
 * test-gemma4.ts
 *
 * Quick connectivity test for the Gemma 4 Vision API.
 * Sends a simple text prompt and verifies the API key / model are working.
 */

import 'dotenv/config';

const GEMMA4_API_KEY = process.env.GEMMA4_API_KEY;
const GEMMA4_MODEL = process.env.GEMMA4_MODEL ?? 'gemma-4-31b-it';

async function testGemma4(): Promise<void> {
    if (!GEMMA4_API_KEY) {
        console.error('❌ GEMMA4_API_KEY is not set in the environment.');
        process.exit(1);
    }

    console.log(`🔑 API Key: ${GEMMA4_API_KEY.slice(0, 8)}...`);
    console.log(`🤖 Model:   ${GEMMA4_MODEL}`);
    console.log('');

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMMA4_MODEL)}:generateContent?key=${encodeURIComponent(GEMMA4_API_KEY)}`;

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: 'Reply with exactly: Gemma 4 API is online' },
                        ],
                    },
                ],
                generationConfig: {
                    temperature: 0,
                    maxOutputTokens: 32,
                },
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`❌ Gemma 4 request failed with HTTP ${response.status}`);
            console.error(errorBody);
            process.exit(1);
        }

        const payload = await response.json();
        const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

        console.log('✅ Gemma 4 API responded successfully!');
        console.log(`📝 Response: "${rawText.trim()}"`);
    } catch (err) {
        console.error('❌ Unexpected error during Gemma 4 API call:', err);
        process.exit(1);
    }
}

testGemma4();
