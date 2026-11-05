import type { MailMessage } from './mailer';

export type MailLocale = 'en' | 'de';

export function toMailLocale(value: unknown): MailLocale {
  return value === 'de' ? 'de' : 'en';
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Copy {
  subject: string;
  intro: string;
  action: string;
  ignore: string;
}

function render(to: string, copy: Copy, url: string): MailMessage {
  const text = `${copy.intro}\n\n${copy.action}: ${url}\n\n${copy.ignore}`;
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0b1220">
<p>${escapeHtml(copy.intro).replace(/\n/g, '<br>')}</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#0f766e;color:#fff;text-decoration:none">${escapeHtml(copy.action)}</a></p>
<p style="color:#5b6577;font-size:13px">${escapeHtml(copy.ignore)}</p>
</body></html>`;
  return { to, subject: copy.subject, text, html };
}

export function invitationEmail(
  locale: MailLocale,
  p: { to: string; inviterName: string; organizationName: string; url: string },
): MailMessage {
  const copy: Record<MailLocale, Copy> = {
    en: {
      subject: `You have been invited to ${p.organizationName} on WIS`,
      intro: `${p.inviterName} invited you to join ${p.organizationName} on WIS – Workforce, in sync.`,
      action: 'Accept invitation',
      ignore: 'If you did not expect this invitation, you can ignore this email.',
    },
    de: {
      subject: `Einladung zu ${p.organizationName} auf WIS`,
      intro: `${p.inviterName} hat Sie zu ${p.organizationName} auf WIS – Workforce, in sync eingeladen.`,
      action: 'Einladung annehmen',
      ignore: 'Falls Sie diese Einladung nicht erwartet haben, können Sie diese E-Mail ignorieren.',
    },
  };
  return render(p.to, copy[locale], p.url);
}

export function resetPasswordEmail(
  locale: MailLocale,
  p: { to: string; url: string },
): MailMessage {
  const copy: Record<MailLocale, Copy> = {
    en: {
      subject: 'Reset your WIS password',
      intro: 'We received a request to reset your password.',
      action: 'Reset password',
      ignore: 'If you did not request this, you can ignore this email.',
    },
    de: {
      subject: 'WIS-Passwort zurücksetzen',
      intro: 'Wir haben eine Anfrage zum Zurücksetzen Ihres Passworts erhalten.',
      action: 'Passwort zurücksetzen',
      ignore: 'Falls Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren.',
    },
  };
  return render(p.to, copy[locale], p.url);
}

export function verifyEmail(locale: MailLocale, p: { to: string; url: string }): MailMessage {
  const copy: Record<MailLocale, Copy> = {
    en: {
      subject: 'Verify your email for WIS',
      intro: 'Please confirm your email address to finish setting up your WIS account.',
      action: 'Verify email',
      ignore: 'If you did not create an account, you can ignore this email.',
    },
    de: {
      subject: 'E-Mail-Adresse für WIS bestätigen',
      intro:
        'Bitte bestätigen Sie Ihre E-Mail-Adresse, um die Einrichtung Ihres WIS-Kontos abzuschließen.',
      action: 'E-Mail bestätigen',
      ignore: 'Falls Sie kein Konto erstellt haben, können Sie diese E-Mail ignorieren.',
    },
  };
  return render(p.to, copy[locale], p.url);
}
