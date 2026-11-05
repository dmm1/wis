import { describe, expect, it } from 'vitest';
import { billableCategories, billingConfigSchema, countBillable } from './billing';

describe('billing config', () => {
  it('defaults to per-user, EUR, period end', () => {
    const c = billingConfigSchema.parse({});
    expect(c).toMatchObject({ preset: 'per_user', currency: 'EUR', chargeBasis: 'period_end' });
  });

  it('counts each person once per preset', () => {
    const counts = { employee_with_login: 10, employee_no_login: 20, user_only: 2 };
    expect(countBillable({ preset: 'per_user' }, counts)).toBe(12);
    expect(countBillable({ preset: 'per_employee' }, counts)).toBe(30);
    expect(countBillable({ preset: 'both' }, counts)).toBe(32); // 10 counted once, not 10 + 10
  });

  it('exposes billable categories', () => {
    expect(billableCategories({ preset: 'per_user' })).not.toContain('employee_no_login');
  });

  it('rejects invalid prices and categories', () => {
    expect(() => billingConfigSchema.parse({ unitPriceCents: { user_only: -1 } })).toThrow();
    expect(() => billingConfigSchema.parse({ unitPriceCents: { nobody: 1 } })).toThrow();
    expect(() => billingConfigSchema.parse({ currency: 'EURO' })).toThrow();
  });
});
