/**
 * notifications.ts
 *
 * Mock notification dispatcher.
 * Replace the body of `sendReceiptNotification` with a real email (AWS SES /
 * SendGrid) or webhook implementation before deploying to production.
 */

export interface NotificationPayload {
    userId: string;
    jobId: string;
    kraPin: string;
    receiptPath: string;
    completedAt: string;
}

/**
 * [MOCK] Sends a "receipt ready" notification to the user identified by
 * `userId` after a successful nil return filing.
 *
 * Production replacement — Webhook example:
 * ```ts
 * const sig = crypto
 *   .createHmac('sha256', process.env.WEBHOOK_SECRET!)
 *   .update(JSON.stringify(payload))
 *   .digest('hex');
 *
 * await fetch(process.env.WEBHOOK_URL!, {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'X-Signature-SHA256': sig,
 *   },
 *   body: JSON.stringify(payload),
 * });
 * ```
 *
 * Production replacement — AWS SES email example:
 * ```ts
 * import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
 * const ses = new SESv2Client({ region: process.env.AWS_REGION });
 * await ses.send(new SendEmailCommand({
 *   FromEmailAddress: process.env.SES_FROM_EMAIL,
 *   Destination: { ToAddresses: [userEmail] },
 *   Content: {
 *     Simple: {
 *       Subject: { Data: 'Your KRA Nil Return Has Been Filed' },
 *       Body: { Html: { Data: buildEmailHtml(payload) } },
 *     },
 *   },
 * }));
 * ```
 */
export async function sendReceiptNotification(
    payload: NotificationPayload
): Promise<void> {
    // Simulate notification service latency
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    console.log('[Notifications] [MOCK] Receipt notification dispatched:');
    console.log(`  Job ID      : ${payload.jobId}`);
    console.log(`  User ID     : ${payload.userId}`);
    console.log(`  KRA PIN     : ${payload.kraPin}`);
    console.log(`  Receipt Path: ${payload.receiptPath}`);
    console.log(`  Completed At: ${payload.completedAt}`);
}
