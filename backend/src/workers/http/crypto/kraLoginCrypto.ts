import { Script, createContext } from 'vm';
import got from 'got';

const KRA_LOGIN_MERGED_JS_URL = 'https://itax.kra.go.ke/KRA-Portal/scripts/common/login_merged.js';

export interface KraLoginCrypto {
    hexSha1(msg: string): string;
    generateSecretNoClient(): number;
    createRecipientInterimKey(generator: string, modulus: string, senderIntrmKey: string): number;
    createSharedSecretKey(senderIntrmKey: string, secretNoClient: number, modulus: string): number;
    aesEncryptCtr(plaintext: string, password: string, nBits: 128 | 192 | 256): string;
}

let cachedCrypto: KraLoginCrypto | null = null;

export async function loadKraLoginCrypto(
    jsSourceOrUrl?: string
): Promise<KraLoginCrypto> {
    if (cachedCrypto) {
        return cachedCrypto;
    }

    let source = jsSourceOrUrl
        ? jsSourceOrUrl.startsWith('http')
            ? (await got(jsSourceOrUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })).body
            : jsSourceOrUrl
        : (await got(KRA_LOGIN_MERGED_JS_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } })).body;

    // The KRA JS extends String.prototype with encodeBase64/encodeUTF8. In Node's vm sandbox,
    // primitive strings do not pick up those extensions. Patch the source to use a sandbox helper.
    source = source.replace(
        /ciphertext\.encodeBase64\(\)/g,
        '_kraBase64Encode(ciphertext)'
    );

    // The KRA JS uses a recursive modular exponentiation that overflows Node's smaller call stack
    // for large exponents. Replace it with an iterative implementation that produces the same result.
    const xpowStart = source.indexOf('function  xpowYmodN(x,y,N)');
    if (xpowStart !== -1) {
        let braceDepth = 0;
        let xpowEnd = -1;
        for (let i = xpowStart; i < source.length; i++) {
            if (source[i] === '{') braceDepth++;
            else if (source[i] === '}') {
                braceDepth--;
                if (braceDepth === 0) {
                    xpowEnd = i + 1;
                    break;
                }
            }
        }
        if (xpowEnd !== -1) {
            source =
                source.slice(0, xpowStart) +
                'function xpowYmodN(x,y,N){var result=1;x=x%N;while(y>0){if((y&1)==1){result=(result*x)%N;}x=(x*x)%N;y=y>>1;}return result;}' +
                source.slice(xpowEnd);
        }
    }

    const sandbox: any = {
        Math,
        Date,
        String,
        Array,
        Number,
        parseInt,
        isNaN,
        document: { oncontextmenu: null },
        window: {},
        _kraBase64Encode: (str: string) => Buffer.from(str, 'binary').toString('base64'),
    };

    const context = createContext(sandbox);
    const script = new Script(source);
    script.runInContext(context);

    cachedCrypto = {
        hexSha1: (msg: string) => sandbox.hex_sha1(msg),
        generateSecretNoClient: () => sandbox.generateSecretNoClient(),
        createRecipientInterimKey: (generator: string, modulus: string, senderIntrmKey: string) =>
            sandbox.createRecipientInterimKey(generator, modulus, senderIntrmKey),
        createSharedSecretKey: (senderIntrmKey: string, secretNoClient: number, modulus: string) =>
            sandbox.createSharedSecretKey(senderIntrmKey, secretNoClient, modulus),
        aesEncryptCtr: (plaintext: string, password: string, nBits: 128 | 192 | 256) =>
            sandbox.AESEncryptCtr(plaintext, password, nBits),
    };

    return cachedCrypto;
}

export function clearCryptoCache(): void {
    cachedCrypto = null;
}
