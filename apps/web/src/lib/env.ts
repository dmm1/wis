import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.url(),
  /** Resend (https://resend.com). Required when APP_ENV=production; optional locally (console mailer). */
  RESEND_API_KEY: z.string().min(1).optional(),
  /** Verified sender, e.g. "WIS <no-reply@mail.example.com>". */
  MAIL_FROM: z.string().min(3).optional(),
  /** 'console' forces the console mailer (never sends real e-mail), e.g. for end-to-end tests. */
  MAIL_TRANSPORT: z.enum(['resend', 'console']).optional(),
  /** 'production' enables secure cookies, e-mail verification and requires a real mailer. */
  APP_ENV: z.enum(['local', 'production']).default('local'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const refined = schema.superRefine((env, ctx) => {
  if (env.APP_ENV === 'production') {
    for (const key of ['RESEND_API_KEY', 'MAIL_FROM'] as const) {
      if (!env[key])
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when APP_ENV=production`,
        });
    }
  }
  if (env.RESEND_API_KEY && !env.MAIL_FROM) {
    ctx.addIssue({
      code: 'custom',
      path: ['MAIL_FROM'],
      message: 'MAIL_FROM is required when RESEND_API_KEY is set',
    });
  }
});

let cached: z.infer<typeof refined> | undefined;

/** Validated server environment. Throws a readable error on first use if misconfigured. */
export function serverEnv() {
  cached ??= refined.parse(process.env);
  return cached;
}
