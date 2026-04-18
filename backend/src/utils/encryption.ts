/**
 * encryption.ts
 *
 * AES-256-GCM symmetric encryption for KRA credentials.
 *
 * Design decisions:
 *  - Key is derived via scrypt (not raw env var) to prevent weak-key attacks.
 *  - A fresh 16-byte IV is generated per encryption call — IVs MUST never repeat
 *    with the same key in GCM mode, and random IVs guarantee this statistically.
 *  - The GCM auth tag (16 bytes) provides authenticated encryption, defending
 *    against ciphertext tampering.
 *  - All sensitive values are returned as hex strings for safe JSON serialisation.
 */

import crypto from 'crypto';
import { EncryptionResult } from '../types';

const ALGORITHM = 'aes-256-gcm' as const;
/** scrypt output length must equal AES-256 key length (32 bytes). */
const KEY_LENGTH = 32;
/** GCM auth tag length in bytes (maximum = 16). */
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a 32-byte AES key from the ENCRYPTION_SECRET environment variable
 * using scrypt key-stretching. Throws if the env vars are absent.
 */
function getDerivedKey(): Buffer {
    const secret = process.env.ENCRYPTION_SECRET;
    const salt = process.env.ENCRYPTION_SALT;

    if (!secret || !salt) {
        throw new Error(
            'Missing required environment variables: ENCRYPTION_SECRET and ENCRYPTION_SALT'
        );
    }

    if (secret.length < 32) {
        throw new Error('ENCRYPTION_SECRET must be at least 32 characters long');
    }

    return crypto.scryptSync(secret, salt, KEY_LENGTH);
}

/**
 * Encrypts a plaintext string with AES-256-GCM.
 *
 * @param plaintext - The raw string to encrypt (e.g. a KRA password).
 * @returns An {@link EncryptionResult} containing the hex-encoded ciphertext,
 *          IV, and GCM authentication tag.
 */
export function encrypt(plaintext: string): EncryptionResult {
    const key = getDerivedKey();
    const iv = crypto.randomBytes(16); // 128-bit IV for GCM

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });

    const encryptedBuffer = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);

    return {
        encryptedData: encryptedBuffer.toString('hex'),
        iv: iv.toString('hex'),
        authTag: cipher.getAuthTag().toString('hex'),
    };
}

/**
 * Decrypts an AES-256-GCM ciphertext produced by {@link encrypt}.
 * Throws if the auth tag verification fails (i.e. data was tampered with).
 *
 * @param encryptedData - Hex-encoded ciphertext.
 * @param ivHex         - Hex-encoded 16-byte IV.
 * @param authTagHex    - Hex-encoded 16-byte GCM auth tag.
 * @returns The original plaintext string.
 */
export function decrypt(
    encryptedData: string,
    ivHex: string,
    authTagHex: string
): string {
    const key = getDerivedKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(encryptedData, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(), // throws ERR_CRYPTO_INVALID_AUTH_TAG if tampered
    ]);

    return decrypted.toString('utf8');
}
