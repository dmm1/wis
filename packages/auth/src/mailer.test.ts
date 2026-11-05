import { describe, expect, it, vi } from 'vitest';
import { createResendMailer } from './mailer';
import { invitationEmail, toMailLocale } from './templates';

describe('createResendMailer', () => {
  it('posts to the Resend API with bearer auth', async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":"1"}', { status: 200 }));
    const mailer = createResendMailer({
      apiKey: 'k',
      from: 'WIS <a@b.test>',
      fetch: fetchMock as never,
    });
    await mailer.send({ to: 'x@y.test', subject: 's', text: 't', html: '<p>t</p>' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
    expect(JSON.parse(init.body as string)).toMatchObject({
      from: 'WIS <a@b.test>',
      to: ['x@y.test'],
      subject: 's',
    });
  });

  it('throws without leaking recipient or key on failure', async () => {
    const fetchMock = vi.fn(async () => new Response('{"message":"bad"}', { status: 422 }));
    const mailer = createResendMailer({
      apiKey: 'secret-key',
      from: 'a@b.test',
      fetch: fetchMock as never,
    });
    const err = await mailer
      .send({ to: 'x@y.test', subject: 's', text: 't' })
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Resend request failed with status 422');
    expect((err as Error).message).not.toContain('secret-key');
    expect((err as Error).message).not.toContain('x@y.test');
  });

  it('requires key and sender', () => {
    expect(() => createResendMailer({ apiKey: '', from: 'a@b.test' })).toThrow();
    expect(() => createResendMailer({ apiKey: 'k', from: '' })).toThrow();
  });
});

describe('templates', () => {
  it('renders German and falls back to English', () => {
    const p = {
      to: 'a@b.test',
      inviterName: 'Anna',
      organizationName: 'Acme',
      url: 'https://x.test/i/1',
    };
    expect(invitationEmail('de', p).subject).toContain('Einladung');
    expect(invitationEmail(toMailLocale('fr'), p).subject).toContain('invited');
  });

  it('escapes HTML in names and urls', () => {
    const m = invitationEmail('en', {
      to: 'a@b.test',
      inviterName: '<script>alert(1)</script>',
      organizationName: 'A&B',
      url: 'https://x.test/?a="b"',
    });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('A&amp;B');
    expect(m.html).toContain('&quot;b&quot;');
  });
});
