export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Development mailer: prints to the console instead of sending. Never use in production. */
export const consoleMailer: Mailer = {
  async send({ to, subject, text }) {
    console.log(`[mail] to=${to} subject="${subject}"\n${text}`);
  },
};

export interface ResendMailerOptions {
  apiKey: string;
  /** Verified sender, e.g. "WIS <no-reply@mail.example.com>". */
  from: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Sends through the Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export function createResendMailer(options: ResendMailerOptions): Mailer {
  if (!options.apiKey) throw new Error('Resend API key is required');
  if (!options.from) throw new Error('Resend sender (from) is required');
  const doFetch = options.fetch ?? fetch;

  return {
    async send({ to, subject, text, html }) {
      const res = await doFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: options.from,
          to: [to],
          subject,
          text,
          ...(html ? { html } : {}),
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
      if (!res.ok) {
        // Never include the request (recipient, links) or the key in the error.
        throw new Error(`Resend request failed with status ${res.status}`);
      }
    },
  };
}
