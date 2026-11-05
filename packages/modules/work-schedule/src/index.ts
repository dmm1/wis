import { defineModule } from '@wis/core';

/**
 * Work schedule: planning shifts, publishing schedules, approving swaps.
 * The manifest is the module's contract with the platform; the domain logic follows in step 6.
 */
export const workSchedule = defineModule({
  id: 'work-schedule',
  version: '0.1.0',
  permissions: [
    'work-schedule:read',
    'work-schedule:write',
    'work-schedule:publish',
    'work-schedule:approve',
  ],
  defaultRoleGrants: {
    'customer-admin': ['read', 'write', 'publish', 'approve'],
    planner: ['read', 'write', 'publish'],
    'team-lead': ['read', 'approve'],
    'hr-payroll': ['read'],
    employee: ['read'],
    auditor: ['read'],
  },
  navigation: [{ path: '/schedule', labelKey: 'nav.title', icon: 'calendar-days' }],
  i18nNamespaces: ['work-schedule'],
  extensibleEntities: ['shift', 'schedule'],
  emits: ['work-schedule.shift.published.v1'],
});
