/**
 * test-gemini.ts
 *
 * Quick connectivity test for the Gemini Vision API.
 * Sends a simple text prompt and verifies the API key / model are working.
 */

import 'dotenv/config';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-flash-latest';

async function testGemini(): Promise<void> {
    if (!GEMINI_API_KEY) {
        console.error('❌ GEMINI_API_KEY is not set in the environment.');
        process.exit(1);
    }

    console.log(`🔑 API Key: ${GEMINI_API_KEY.slice(0, 8)}...`);
    console.log(`🤖 Model:   ${GEMINI_MODEL}`);
    console.log('');

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: 'Reply with exactly: Gemini API is online' },
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
            console.error(`❌ Gemini request failed with HTTP ${response.status}`);
            console.error(errorBody);
            process.exit(1);
        }

        const payload = await response.json();
        const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

        console.log('✅ Gemini API responded successfully!');
        console.log(`📝 Response: "${rawText.trim()}"`);
    } catch (err) {
        console.error('❌ Unexpected error during Gemini API call:', err);
        process.exit(1);
    }
}

testGemini();
