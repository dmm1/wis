import { describe, expect, it } from 'vitest';
import { defineModule } from './module';

describe('defineModule', () => {
  it('applies defaults for optional lists', () => {
    const m = defineModule({ id: 'work-schedule', version: '0.1.0' });
    expect(m.permissions).toEqual([]);
    expect(m.extensibleEntities).toEqual([]);
  });

  it('accepts permissions prefixed with the module id', () => {
    const m = defineModule({
      id: 'work-schedule',
      version: '0.1.0',
      permissions: ['work-schedule:read', 'work-schedule:publish'],
    });
    expect(m.permissions).toHaveLength(2);
  });

  it('rejects permissions of another module', () => {
    expect(() =>
      defineModule({ id: 'work-schedule', version: '0.1.0', permissions: ['absences:read'] }),
    ).toThrow();
  });

  it('rejects invalid ids', () => {
    expect(() => defineModule({ id: 'Work Schedule', version: '0.1.0' })).toThrow();
  });
});
