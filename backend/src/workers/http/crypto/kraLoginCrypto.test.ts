import { describe, it } from 'node:test';
import assert from 'node:assert';
import { loadKraLoginCrypto } from './kraLoginCrypto';

const SKIP_NETWORK_TESTS = process.env.SKIP_NETWORK_TESTS === 'true' || process.env.CI === 'true';

describe('KRA login crypto', () => {
    it('loads and runs the KRA encryption functions', async () => {
        if (SKIP_NETWORK_TESTS) {
            console.log('Skipping network-dependent KRA login crypto test (SKIP_NETWORK_TESTS/CI set)');
            return;
        }

        const crypto = await loadKraLoginCrypto();

        const sha1 = crypto.hexSha1('test');
        assert.strictEqual(sha1.toUpperCase(), 'A94A8FE5CCB19BA61C4C0873D391E987982FBBD3');

        const secret = crypto.generateSecretNoClient();
        assert.ok(Number.isFinite(secret));

        const rcpntIntrmKey = crypto.createRecipientInterimKey('37871', '1544437', '1251474');
        assert.ok(Number.isFinite(rcpntIntrmKey));

        const sharedSecret = crypto.createSharedSecretKey('1251474', secret, '1544437');
        assert.ok(Number.isFinite(sharedSecret));

        const encrypted = crypto.aesEncryptCtr('Quriah1!', String(sharedSecret), 256);
        assert.ok(encrypted.length > 0);
        assert.ok(/^[A-Za-z0-9+/=]+$/.test(encrypted));
    });
});
