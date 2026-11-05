import { z } from 'zod';

/**
 * Every active human is exactly one of these (architecture §4.3), so nobody is counted twice.
 */
export const billingCategories = ['employee_with_login', 'employee_no_login', 'user_only'] as const;
export type BillingCategory = (typeof billingCategories)[number];

export const billingPresets = {
  per_user: ['employee_with_login', 'user_only'],
  per_employee: ['employee_with_login', 'employee_no_login'],
  both: ['employee_with_login', 'employee_no_login', 'user_only'],
} as const satisfies Record<string, readonly BillingCategory[]>;

export const billingConfigSchema = z.object({
  preset: z.enum(['per_user', 'per_employee', 'both']).default('per_user'),
  /** Price per person and month, in cents, per category. Missing category = not priced. */
  unitPriceCents: z
    .partialRecord(z.enum(billingCategories), z.number().int().nonnegative())
    .default({}),
  currency: z.string().length(3).default('EUR'),
  /** Which count the invoice is based on. */
  chargeBasis: z.enum(['period_end', 'peak', 'daily_average']).default('period_end'),
});

export type BillingConfig = z.output<typeof billingConfigSchema>;
export type BillingConfigInput = z.input<typeof billingConfigSchema>;

export function billableCategories(
  config: Pick<BillingConfig, 'preset'>,
): readonly BillingCategory[] {
  return billingPresets[config.preset];
}

/** Sum of billable people for the given per-category counts. */
export function countBillable(
  config: Pick<BillingConfig, 'preset'>,
  counts: Partial<Record<BillingCategory, number>>,
): number {
  return billableCategories(config).reduce((sum, c) => sum + (counts[c] ?? 0), 0);
}
