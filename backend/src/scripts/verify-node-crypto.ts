import { loadKraLoginCrypto } from '../workers/http/crypto/kraLoginCrypto';

async function main() {
    const crypto = await loadKraLoginCrypto();

    const generator = '388354';
    const modulus = '540769';
    const senderIntrmKey = '412161';
    const password = 'Quriah1!';
    const loginId = 'P051699440T';

    // Force the same secret the browser used so we can compare every output.
    const secretNoClient = 1016658;

    const rcpntIntrmKey = crypto.createRecipientInterimKey(generator, modulus, senderIntrmKey);
    const sharedSecretKey = crypto.createSharedSecretKey(senderIntrmKey, secretNoClient, modulus);
    const encryptedPwd = crypto.aesEncryptCtr(password, String(sharedSecretKey), 256);
    const cryptpwd = crypto.hexSha1(password + loginId);

    console.log('Node crypto:', JSON.stringify({
        rcpntIntrmKey,
        sharedSecretKey,
        encryptedPwd,
        cryptpwd,
    }, null, 2));

    console.log('Expected from browser:', JSON.stringify({
        rcpntIntrmKey: 494122,
        sharedSecretKey: 514825,
        encryptedPwd: '7iZKal1dXV32x0RMuc6TTg==',
        cryptpwd: '380D3D59D683620C7D0A01E057A7E1F119A7B2D5',
    }, null, 2));
}

main().catch((e) => console.error(e));
