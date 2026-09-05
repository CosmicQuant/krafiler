import { JobContext } from '../../../types';
import { appendJobLog, setJobStep } from '../../utils/job-helpers';
import { KraHttpSession } from '../session/KraHttpSession';
import { parseCaptchaImageUrl, parseLoginOutcome, parsePortalErrors, parseLoginFormFields } from '../parsers';
import { solveCaptchaWithGemma4Buffer } from '../../utils/captcha';
import { KraError, KraErrorCode, mapPortalMessage } from '../errors';
import { loadKraLoginCrypto } from '../crypto/kraLoginCrypto';

export interface HttpLoginResult {
    success: boolean;
    passwordExpired?: boolean;
    mobileVerificationRequired?: boolean;
    message?: string;
}

export class HttpLoginService {
    private session: KraHttpSession;
    private job: JobContext;

    constructor(session: KraHttpSession, job: JobContext) {
        this.session = session;
        this.job = job;
    }

    async execute(kraPin: string, kraPassword: string, otpCode?: string): Promise<HttpLoginResult> {
        await setJobStep(this.job, 10, 'Navigating to KRA portal (HTTP)');

        // The login form lives on the base portal page; direct /login.htm returns invalidAccess.
        const basePage = await this.session.get('', { timeout: 60_000 });
        await appendJobLog(this.job, 'Fetched KRA portal base page via HTTP', { progress: 15 });

        // Gemma occasionally mis-solves the arithmetic CAPTCHA. A single wrong
        // answer re-renders the login form with a fresh CAPTCHA and crypto
        // fields — so retry with the fresh page instead of failing the job.
        const MAX_CAPTCHA_ATTEMPTS = 3;
        let loginPage = basePage;

        for (let attempt = 1; attempt <= MAX_CAPTCHA_ATTEMPTS; attempt++) {
            const formFields = parseLoginFormFields(loginPage);
            if (!formFields) {
                throw new KraError(
                    KraErrorCode.VALIDATION_ERROR,
                    'Could not locate the KRA login form on the portal base page',
                    { rawResponse: loginPage.slice(0, 2000) }
                );
            }

            if (attempt === 1) {
                await appendJobLog(this.job, `Login form parsed: passwordName=${formFields.passwordInputName}`, { progress: 16 });
            }

            let captchaUrl = parseCaptchaImageUrl(loginPage, this.session.client.getBaseUrl());

            // The base page uses a placeholder rand value; the browser refreshes it with a random number.
            if (captchaUrl && captchaUrl.includes('rand=')) {
                captchaUrl = captchaUrl.replace(/rand=[^&]+/, `rand=${Math.floor(Math.random() * 1001)}`);
            }

            if (!captchaUrl) {
                throw new KraError(
                    KraErrorCode.VALIDATION_ERROR,
                    'Could not locate the CAPTCHA image URL on the KRA login page',
                    { rawResponse: loginPage.slice(0, 2000) }
                );
            }

            await setJobStep(this.job, 20, 'Solving KRA CAPTCHA (HTTP)');
            const captchaBuffer = await this.session.getBuffer(captchaUrl, { timeout: 15_000 });
            const captchaAnswer = await solveCaptchaWithGemma4Buffer(captchaBuffer, { job: this.job, progress: 25 });
            await appendJobLog(this.job, `CAPTCHA attempt ${attempt}/${MAX_CAPTCHA_ATTEMPTS} solved via Gemma 4: ${captchaAnswer}`, { progress: 25 });

            const loginId = kraPin.toUpperCase();

            await setJobStep(this.job, 28, 'Notifying KRA login gateway (HTTP)');
            await this.runDwrPreamble(loginId);
            await appendJobLog(this.job, 'KRA login gateway check completed', { progress: 29 });

            await setJobStep(this.job, 30, 'Encrypting KRA credentials (HTTP)');
            const crypto = await loadKraLoginCrypto();

            const secretNoClient = crypto.generateSecretNoClient();
            const rcpntIntrmKey = crypto.createRecipientInterimKey(
                formFields.generator,
                formFields.modulus,
                formFields.senderIntrmKey
            );
            const sharedSecretKey = crypto.createSharedSecretKey(
                formFields.senderIntrmKey,
                secretNoClient,
                formFields.modulus
            );
            const encryptedPassword = crypto.aesEncryptCtr(kraPassword, String(sharedSecretKey), 256);
            const passwordSha1WithPin = crypto.hexSha1(kraPassword + loginId);
            const emptyPwdSha1 = crypto.hexSha1('');

            await appendJobLog(this.job, 'KRA login credentials encrypted with portal JS crypto', { progress: 32 });

            await setJobStep(this.job, 35, 'Submitting KRA login (HTTP)');

            // Replicate the exact field order and duplicate keys observed in the browser.
            // URLSearchParams preserves insertion order and supports interleaved duplicate keys.
            const loginBody = new URLSearchParams();
            const append = (key: string, value: string) => loginBody.append(key, value);

            append('captchaResult_', '');
            append('pwd', emptyPwdSha1);
            append('actionCode', formFields.actionCode || 'loginUser');
            append('operation', '');
            append('loginType', '');
            append('regType', '');
            append('keyImgChk', formFields.keyImgChk || 'false');
            append('generator', formFields.generator);
            append('modulus', formFields.modulus);
            append('senderIntrmKey', formFields.senderIntrmKey);
            append('rcpntIntrmKey', String(rcpntIntrmKey));
            append('encryptPassword', encryptedPassword);
            append('fieldsToSkip', 'encryptPassword');
            append('PKCS7SignedData', '');
            append('fieldsToSkip', 'PKCS7SignedData');
            append('switchInput', '1');
            append('logid', loginId);
            append('logid', '');
            append('userName', loginId);
            append(formFields.passwordInputName, passwordSha1WithPin);
            append(formFields.captchaInputName, captchaAnswer);

            if (formFields.captchaResultName) {
                append(formFields.captchaResultName, captchaAnswer);
            }

            const loginResponse = await this.session.post('login.htm', loginBody, {
                timeout: 60_000,
                headers: {
                    Referer: 'https://itax.kra.go.ke/KRA-Portal/',
                },
            });

            const outcome = parseLoginOutcome(loginResponse);
            await appendJobLog(this.job, `Parsed login outcome: ${outcome.type}`, { progress: 36 });

            if (outcome.type === 'password-change') {
                await appendJobLog(this.job, 'KRA requires a password change before filing', { progress: 40 });
                return { success: false, passwordExpired: true, message: 'Password expired' };
            }

            if (outcome.type === 'mobile-verification') {
                await appendJobLog(this.job, 'KRA requires mobile number verification', { progress: 40 });
                if (!otpCode) {
                    throw new KraError(
                        KraErrorCode.MOBILE_VERIFICATION_REQUIRED,
                        'KRA requested mobile verification but no OTP was provided',
                        { retryable: false }
                    );
                }
                await this.completeMobileVerification(otpCode);
                return { success: true, mobileVerificationRequired: false };
            }

            if (outcome.type === 'success') {
                await appendJobLog(this.job, 'KRA login successful via HTTP', { progress: 40 });
                return { success: true };
            }

            // Failure: if KRA stated a concrete reason (wrong password, locked
            // account, portal error) fail immediately with the mapped error.
            const errors = parsePortalErrors(loginResponse);
            const combined = [outcome.message, ...errors].filter(Boolean).join(' | ');
            const mapped = mapPortalMessage(combined);
            if (mapped) {
                throw mapped;
            }

            // No concrete error — the login form was simply re-rendered, which
            // almost always means the CAPTCHA answer was wrong. Retry using the
            // fresh login page (it carries new crypto fields and a new CAPTCHA).
            loginPage = loginResponse;
            if (attempt < MAX_CAPTCHA_ATTEMPTS) {
                await appendJobLog(
                    this.job,
                    `Login attempt ${attempt} returned the login page without a specific error (CAPTCHA likely mis-solved). Retrying with a fresh CAPTCHA.`,
                    { progress: 30, level: 'warn' }
                );
                continue;
            }
        }

        throw new KraError(
            KraErrorCode.CAPTCHA_INCORRECT,
            `KRA login failed after ${MAX_CAPTCHA_ATTEMPTS} attempts — the CAPTCHA was likely mis-solved each time. Please retry.`,
            { retryable: true }
        );
    }

    private async runDwrPreamble(loginId: string): Promise<void> {
        // Load the DWR JS files in the same order as the browser.
        await this.session.get('dwr/engine.js', { timeout: 15_000 });
        await this.session.get('dwr/util.js', { timeout: 15_000 });
        await this.session.get('dwr/interface/CheckLoginPin.js', { timeout: 15_000 });
        await this.session.get('dwr/interface/findPinByIdno.js', { timeout: 15_000 });

        const windowName = `DWR-${Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('').toUpperCase()}`;

        // __System.pageLoaded call made by DWR on page load.
        // The server returns the scriptSessionId that must be used for subsequent DWR calls.
        const pageLoadedResponse = await this.postDwr(
            '__System.pageLoaded',
            [
                'callCount=1',
                `windowName=${windowName}`,
                'c0-scriptName=__System',
                'c0-methodName=pageLoaded',
                'c0-id=0',
                'batchId=0',
                'page=/KRA-Portal/',
                'httpSessionId=',
                'scriptSessionId=',
                '',
            ].join('\n')
        );

        const scriptSessionId = this.extractDwrScriptSessionId(pageLoadedResponse);

        // CheckLoginPin.checkLoginPin call made when user clicks Continue.
        await this.postDwr(
            'CheckLoginPin.checkLoginPin',
            [
                'callCount=1',
                `windowName=${windowName}`,
                'c0-scriptName=CheckLoginPin',
                'c0-methodName=checkLoginPin',
                'c0-id=0',
                `c0-param0=string:${loginId}`,
                'batchId=1',
                'page=/KRA-Portal/',
                'httpSessionId=',
                `scriptSessionId=${scriptSessionId}`,
                '',
            ].join('\n')
        );
    }

    private async postDwr(methodPath: string, rawBody: string): Promise<string> {
        return this.session.client.postRaw(`dwr/call/plaincall/${methodPath}.dwr`, rawBody, {
            timeout: 15_000,
            headers: {
                'Content-Type': 'text/plain; charset=UTF-8',
                Referer: 'https://itax.kra.go.ke/KRA-Portal/',
            },
        });
    }

    private extractDwrScriptSessionId(response: string): string {
        const match = response.match(/handleNewScriptSession\(['"]([^'"]+)['"]\)/);
        return match?.[1] ?? '';
    }

    private async completeMobileVerification(otpCode: string): Promise<void> {
        await setJobStep(this.job, 41, 'Completing KRA mobile number verification (HTTP)');

        const response = await this.session.post('login.htm?actionCode=verifyMobile', {
            otpCode,
            token_key: this.session.requireToken(),
        });

        const outcome = parseLoginOutcome(response);
        if (outcome.type === 'failure') {
            throw new KraError(
                KraErrorCode.MOBILE_VERIFICATION_REQUIRED,
                `Mobile verification failed: ${outcome.message}`,
                { rawResponse: response.slice(0, 2000) }
            );
        }

        await appendJobLog(this.job, 'Mobile verification completed via HTTP', { progress: 42 });
    }
}
