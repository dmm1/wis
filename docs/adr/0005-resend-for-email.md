# ADR-0005: Resend for transactional e-mail

- Status: accepted
- Date: 2026-11-05

## Context

Invitations, e-mail verification and password reset need reliable delivery. GDPR requires EU-aware processing.

## Decision

- Use **Resend** through its HTTP API with plain `fetch` (`createResendMailer`, `packages/auth/src/mailer.ts`): no extra SDK dependency, 10 s timeout, errors never contain recipients, links or the key.
- Application code depends on the `Mailer` interface only, so the provider can be swapped.
- Templates (`templates.ts`) exist in `en` and `de`; locale comes from the user's `locale` (constrained to `en|de`), for invitations from the tenant's `metadata.locale` or the inviter. HTML is escaped; a plain-text part is always sent.
- Local development without `RESEND_API_KEY` uses the console mailer. With `APP_ENV=production`, `RESEND_API_KEY` and `MAIL_FROM` are mandatory (validated at startup) and `createAuth` refuses the console mailer.
- Setup: create a Resend account, add and verify the sending domain (SPF/DKIM/DMARC), pick the EU region for the domain, create an API key restricted to sending, put `RESEND_API_KEY` and `MAIL_FROM` in `.env`.

## Consequences

- E-mail content (names, invitation links) is processed by Resend: list it as a sub-processor and sign their DPA.
- Delivery failures after tenant provisioning are surfaced (`emailSent: false`) and can be retried by resending the invitation.
