import { describe, expect, it } from 'vitest';
import { registry } from './index';

describe('deployment registry', () => {
  it('contains work-schedule with its permissions and navigation', () => {
    expect(registry.ids()).toContain('work-schedule');
    expect(registry.permissionStatements()['work-schedule']).toEqual([
      'read',
      'write',
      'publish',
      'approve',
    ]);
    expect(registry.navigationFor(['work-schedule'])[0]?.path).toBe('/schedule');
  });

  it('gives employees read-only access to the schedule', () => {
    expect(registry.grantsForRole('employee')).toEqual({ 'work-schedule': ['read'] });
  });
});
