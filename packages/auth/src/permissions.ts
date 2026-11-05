import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, ownerAc } from 'better-auth/plugins/organization/access';
import { registry } from '@wis/modules';

/**
 * Permission statements available to tenant roles.
 *
 * Base statements come from better-auth (organization, member, invitation, team, ac) plus the
 * core `employee` record. Every module contributes its own resource (the module id) from its
 * manifest, so adding a module never requires editing this file.
 */
const base = {
  ...defaultStatements,
  employee: ['read', 'create', 'update', 'delete', 'read-sensitive'],
} as const;

/**
 * Runtime statements include every module's resource (needed to validate tenant-defined roles).
 * The static type only knows the base resources, which keeps better-auth's role-name inference
 * intact; module resources are looked up by string at runtime.
 */
export const statements = { ...base, ...registry.permissionStatements() } as unknown as typeof base;

export const ac = createAccessControl(statements);

type Grants = Record<string, readonly string[]>;

/** Core (non-module) permissions per system role. Module permissions come from the manifests. */
const coreGrants: Record<string, Grants> = {
  'customer-admin': {
    ...(ownerAc.statements as Grants),
    employee: ['read', 'create', 'update', 'delete', 'read-sensitive'],
  },
  planner: { employee: ['read'] },
  'team-lead': { employee: ['read'], team: ['update'] },
  'hr-payroll': { employee: ['read', 'create', 'update', 'read-sensitive'] },
  employee: {},
  auditor: { employee: ['read'] },
};

function buildRole(name: string) {
  return ac.newRole({ ...(coreGrants[name] ?? {}), ...registry.grantsForRole(name) } as never);
}

/**
 * System roles for tenants. Row-level scoping (own team, own location) is applied in the
 * service layer using better-auth teams; these permissions only say *what* a role may do.
 */
export const tenantRoles = {
  'customer-admin': buildRole('customer-admin'),
  planner: buildRole('planner'),
  'team-lead': buildRole('team-lead'),
  'hr-payroll': buildRole('hr-payroll'),
  employee: buildRole('employee'),
  auditor: buildRole('auditor'),
};

export type TenantRoleName = keyof typeof tenantRoles;
export const tenantRoleNames = Object.keys(tenantRoles) as TenantRoleName[];
/** The role given to the first user of a tenant. */
export const CREATOR_ROLE: TenantRoleName = 'customer-admin';
