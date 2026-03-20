import { Resend } from "resend";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

const resendClient = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/**
 * Sends an email via Resend.
 * Silently skips if RESEND_API_KEY is not configured.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<void> {
  if (!resendClient) {
    logger.warn("Resend not configured, skipping email", { to, subject });
    return;
  }

  try {
    await resendClient.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to,
      subject,
      html,
    });
    logger.info("Email sent", { to, subject });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email error";
    logger.error("Failed to send email", { to, subject, error: message });
    throw new Error(`Email send failed: ${message}`);
  }
}
