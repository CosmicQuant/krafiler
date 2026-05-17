import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
    if (transporter) return transporter;

    const host = process.env.SMTP_HOST || '';
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER || '';
    const pass = process.env.SMTP_PASS || '';

    if (host && user && pass) {
        transporter = nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            auth: { user, pass },
        });
    } else {
        // Fallback: streaming transport for development (writes to stdout)
        transporter = nodemailer.createTransport({ jsonTransport: true });
    }

    return transporter;
}

function getFromAddress(): string {
    return process.env.EMAIL_FROM || 'payroll@krafiler.com';
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

export interface EmailResult {
    success: boolean;
    messageId?: string;
    error?: string;
}

export async function sendPayslipEmail(
    to: string,
    employeeName: string,
    companyName: string,
    period: string,
    pdfBuffer: Buffer,
    filename: string,
): Promise<EmailResult> {
    try {
        const transport = getTransporter();
        const info = await transport.sendMail({
            from: getFromAddress(),
            to,
            subject: `Payslip — ${companyName} — ${period}`,
            html: payslipHtml(employeeName, companyName, period),
            attachments: [{ filename, content: pdfBuffer, contentType: 'application/pdf' }],
        });
        return { success: true, messageId: info.messageId };
    } catch (err: any) {
        return { success: false, error: err.message || 'Unknown error' };
    }
}

export async function sendP9Email(
    to: string,
    employeeName: string,
    companyName: string,
    taxYear: string,
    pdfBuffer: Buffer,
    filename: string,
): Promise<EmailResult> {
    try {
        const transport = getTransporter();
        const info = await transport.sendMail({
            from: getFromAddress(),
            to,
            subject: `P9 Tax Card — ${companyName} — ${taxYear}`,
            html: p9Html(employeeName, companyName, taxYear),
            attachments: [{ filename, content: pdfBuffer, contentType: 'application/pdf' }],
        });
        return { success: true, messageId: info.messageId };
    } catch (err: any) {
        return { success: false, error: err.message || 'Unknown error' };
    }
}

export async function sendBulkEmail(
    to: string,
    subject: string,
    html: string,
    attachments?: { filename: string; content: Buffer; contentType: string }[],
): Promise<EmailResult> {
    try {
        const transport = getTransporter();
        const info = await transport.sendMail({
            from: getFromAddress(),
            to,
            subject,
            html,
            attachments,
        });
        return { success: true, messageId: info.messageId };
    } catch (err: any) {
        return { success: false, error: err.message || 'Unknown error' };
    }
}

export async function verifyConnection(): Promise<boolean> {
    try {
        const transport = getTransporter();
        await transport.verify();
        return true;
    } catch {
        return false;
    }
}
