import { ModuleRegistry } from '@wis/core';
import { workSchedule } from '@wis/module-work-schedule';

/** Every module compiled into this deployment. Add new modules here. */
export const registry = new ModuleRegistry([workSchedule]);

export { workSchedule };
