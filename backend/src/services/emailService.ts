import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) return null;
    if (!resendClient) {
        resendClient = new Resend(apiKey);
    }
    return resendClient;
}

let smtpTransporter: Transporter | null = null;

function getSmtpTransporter(): Transporter | null {
    const host = process.env.SMTP_HOST?.trim();
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS?.trim();

    if (!host || !user || !pass) return null;

    if (!smtpTransporter) {
        const port = parseInt(process.env.SMTP_PORT || '587', 10);
        smtpTransporter = nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            auth: { user, pass },
        });
    }
    return smtpTransporter;
}

function getFromAddress(): string {
    return process.env.RESEND_FROM_EMAIL?.trim()
        || process.env.EMAIL_FROM?.trim()
        || 'payroll@krafiler.com';
}

function payslipHtml(employeeName: string, companyName: string, period: string): string {
    return `
<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#1e293b;">Payslip — ${period}</h2>
<p>Dear <strong>${employeeName}</strong>,</p>
<p>Your payslip for the period of <strong>${period}</strong> from <strong>${companyName}</strong> is attached.</p>
<p>You can also view your payslip by logging into the employee portal.</p>
<br/>
<p style="color:#666;font-size:12px;">This is an automated message from KRAFILER. Please do not reply.</p>
</body></html>`;
}

function p9Html(employeeName: string, companyName: string, taxYear: string): string {
    return `
<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#1e293b;">P9 Annual Tax Deduction Card — ${taxYear}</h2>
<p>Dear <strong>${employeeName}</strong>,</p>
<p>Your P9 Annual Tax Deduction Card for the tax year <strong>${taxYear}</strong> from <strong>${companyName}</strong> is attached.</p>
<p>Please keep this document for your records.</p>
<br/>
<p style="color:#666;font-size:12px;">This is an automated message from KRAFILER. Please do not reply.</p>
</body></html>`;
}

export interface EmailTags {
    emailHistoryId?: string;
    clientId?: string;
    documentType?: string;
    [key: string]: string | undefined;
}

export interface EmailResult {
    success: boolean;
    messageId?: string;
    provider?: 'resend' | 'smtp';
    error?: string;
}

function buildTags(tags?: EmailTags): { name: string; value: string }[] | undefined {
    if (!tags) return undefined;
    const entries = Object.entries(tags).filter(([, value]) => value !== undefined && value !== '');
    if (entries.length === 0) return undefined;
    return entries.map(([name, value]) => ({ name, value: value as string }));
}

async function sendWithResend(options: {
    to: string;
    subject: string;
    html: string;
    attachments?: { filename: string; content: Buffer; contentType?: string }[];
    tags?: EmailTags;
}): Promise<EmailResult> {
    const client = getResendClient();
    if (!client) {
        return { success: false, error: 'RESEND_API_KEY not configured' };
    }

    try {
        const { data, error } = await client.emails.send({
            from: getFromAddress(),
            to: options.to,
            subject: options.subject,
            html: options.html,
            attachments: options.attachments?.map((a) => ({
                filename: a.filename,
                content: a.content,
            })),
            tags: buildTags(options.tags),
        });

        if (error || !data?.id) {
            return { success: false, provider: 'resend', error: error?.message || 'Resend returned no message id' };
        }

        return { success: true, provider: 'resend', messageId: data.id };
    } catch (err: any) {
        return { success: false, provider: 'resend', error: err?.message || 'Unknown Resend error' };
    }
}

async function sendWithSmtp(options: {
    to: string;
    subject: string;
    html: string;
    attachments?: { filename: string; content: Buffer; contentType?: string }[];
}): Promise<EmailResult> {
    const transport = getSmtpTransporter();
    if (!transport) {
        return { success: false, error: 'No email provider configured (set RESEND_API_KEY or SMTP_*)' };
    }

    try {
        const info = await transport.sendMail({
            from: getFromAddress(),
            to: options.to,
            subject: options.subject,
            html: options.html,
            attachments: options.attachments?.map((a) => ({
                filename: a.filename,
                content: a.content,
                contentType: a.contentType || 'application/octet-stream',
            })),
        });
        return { success: true, provider: 'smtp', messageId: info.messageId };
    } catch (err: any) {
        return { success: false, provider: 'smtp', error: err?.message || 'Unknown SMTP error' };
    }
}

async function sendEmail(options: {
    to: string;
    subject: string;
    html: string;
    attachments?: { filename: string; content: Buffer; contentType?: string }[];
    tags?: EmailTags;
}): Promise<EmailResult> {
    const resendResult = await sendWithResend(options);
    if (resendResult.success) return resendResult;

    // If Resend isn't configured, fall back to SMTP so existing dev setups keep working.
    if (resendResult.error?.includes('RESEND_API_KEY not configured')) {
        return sendWithSmtp(options);
    }

    return resendResult;
}

export async function sendPayslipEmail(
    to: string,
    employeeName: string,
    companyName: string,
    period: string,
    pdfBuffer: Buffer,
    filename: string,
    tags?: EmailTags,
): Promise<EmailResult> {
    return sendEmail({
        to,
        subject: `Payslip — ${companyName} — ${period}`,
        html: payslipHtml(employeeName, companyName, period),
        attachments: [{ filename, content: pdfBuffer, contentType: 'application/pdf' }],
        tags,
    });
}

export async function sendP9Email(
    to: string,
    employeeName: string,
    companyName: string,
    taxYear: string,
    pdfBuffer: Buffer,
    filename: string,
    tags?: EmailTags,
): Promise<EmailResult> {
    return sendEmail({
        to,
        subject: `P9 Tax Card — ${companyName} — ${taxYear}`,
        html: p9Html(employeeName, companyName, taxYear),
        attachments: [{ filename, content: pdfBuffer, contentType: 'application/pdf' }],
        tags,
    });
}

export async function sendBulkEmail(
    to: string,
    subject: string,
    html: string,
    attachments?: { filename: string; content: Buffer; contentType?: string }[],
    tags?: EmailTags,
): Promise<EmailResult> {
    return sendEmail({
        to,
        subject,
        html,
        attachments,
        tags,
    });
}

export async function verifyConnection(): Promise<boolean> {
    if (getResendClient()) return true;
    const transport = getSmtpTransporter();
    if (!transport) return false;
    try {
        await transport.verify();
        return true;
    } catch {
        return false;
    }
}
