import { describe, expect, it } from 'vitest';
import { defineModule } from './module';
import { ModuleRegistry } from './registry';

const schedule = defineModule({
  id: 'work-schedule',
  version: '0.1.0',
  permissions: ['work-schedule:read', 'work-schedule:write', 'work-schedule:approve'],
  defaultRoleGrants: { planner: ['read', 'write'], 'team-lead': ['read', 'approve'] },
  navigation: [{ path: '/schedule', labelKey: 'nav.title', icon: 'calendar-days' }],
  emits: ['work-schedule.shift.published.v1'],
});
const absences = defineModule({
  id: 'absences',
  version: '0.1.0',
  permissions: ['absences:read'],
  consumes: ['work-schedule.shift.published.v1'],
});

describe('ModuleRegistry', () => {
  const registry = new ModuleRegistry([schedule, absences]);

  it('derives permission statements per module', () => {
    expect(registry.permissionStatements()).toEqual({
      'work-schedule': ['read', 'write', 'approve'],
      absences: ['read'],
    });
  });

  it('derives role grants from manifests', () => {
    expect(registry.grantsForRole('planner')).toEqual({ 'work-schedule': ['read', 'write'] });
    expect(registry.grantsForRole('employee')).toEqual({});
  });

  it('only exposes navigation for enabled modules and ignores unknown ids', () => {
    expect(registry.navigationFor([])).toEqual([]);
    expect(registry.navigationFor(['work-schedule', 'ghost'])).toEqual([
      {
        moduleId: 'work-schedule',
        path: '/schedule',
        labelKey: 'nav.title',
        icon: 'calendar-days',
      },
    ]);
  });

  it('rejects duplicates and unknown providers', () => {
    expect(() => new ModuleRegistry([schedule, schedule])).toThrow(/Duplicate/);
    expect(() => new ModuleRegistry([absences])).toThrow(/not registered/);
  });
});

describe('manifest validation', () => {
  it('rejects role grants for unknown actions and bad navigation', () => {
    expect(() =>
      defineModule({
        id: 'x',
        version: '0.1.0',
        permissions: ['x:read'],
        defaultRoleGrants: { planner: ['delete'] },
      }),
    ).toThrow(/unknown action/);
    expect(() =>
      defineModule({
        id: 'x',
        version: '0.1.0',
        navigation: [{ path: 'no-slash', labelKey: 'a', icon: 'b' }],
      }),
    ).toThrow();
  });
});
