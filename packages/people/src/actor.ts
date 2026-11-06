import { PeopleError } from './errors';

/**
 * Who is acting, resolved by the caller (web layer or API) from the session and role.
 * Services only ask `can(resource, action)`: "employee"+"read", "organization"+"update", …
 * Row isolation between tenants is enforced separately by RLS.
 */
export interface Actor {
  userId: string;
  tenantId: string;
  can(resource: string, action: string): boolean;
}

export function requireCan(actor: Actor, resource: string, action: string): void {
  if (!actor.can(resource, action)) throw new PeopleError('FORBIDDEN');
}
