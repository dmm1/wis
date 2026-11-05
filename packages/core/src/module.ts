import { z } from 'zod';

const slug = z.string().regex(/^[a-z][a-z0-9-]*$/, 'lowercase kebab-case');
const permission = z.string().regex(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/, '<module>:<action>');

/** Entry a module contributes to the app navigation (shown only when the tenant has the module). */
const navigationEntry = z.object({
  /** Path inside the app, without locale, e.g. "/schedule". */
  path: z.string().regex(/^\/[a-z0-9\-/]*$/),
  /** Message key under the module's i18n namespace, e.g. "nav.title". */
  labelKey: z.string().min(1),
  /** lucide icon name in kebab-case, e.g. "calendar-days". Mapped to a component in the web app. */
  icon: z.string().regex(/^[a-z][a-z0-9-]*$/),
});

/** Static description of a WIS module. Modules interact via events and public services only. */
export const moduleManifestSchema = z
  .object({
    id: slug,
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    permissions: z.array(permission).default([]),
    /**
     * Default grants for the system roles: role name → actions (without the "<module>:" prefix).
     * Tenants can still clone and adjust roles; this is only the starting point.
     */
    defaultRoleGrants: z.record(z.string(), z.array(slug)).default({}),
    navigation: z.array(navigationEntry).default([]),
    i18nNamespaces: z.array(slug).default([]),
    /** Entities of this module that accept per-tenant custom fields. */
    extensibleEntities: z.array(slug).default([]),
    emits: z.array(z.string()).default([]),
    consumes: z.array(z.string()).default([]),
  })
  .superRefine((m, ctx) => {
    m.permissions.forEach((p, i) => {
      if (!p.startsWith(`${m.id}:`)) {
        ctx.addIssue({
          code: 'custom',
          path: ['permissions', i],
          message: `permission "${p}" must be prefixed with "${m.id}:"`,
        });
      }
    });
    const actions = new Set(m.permissions.map((p) => p.slice(m.id.length + 1)));
    for (const [role, granted] of Object.entries(m.defaultRoleGrants)) {
      for (const action of granted) {
        if (!actions.has(action)) {
          ctx.addIssue({
            code: 'custom',
            path: ['defaultRoleGrants', role],
            message: `role "${role}" is granted unknown action "${action}"`,
          });
        }
      }
    }
  });

export type ModuleManifest = z.output<typeof moduleManifestSchema>;
export type ModuleManifestInput = z.input<typeof moduleManifestSchema>;

export function defineModule(input: ModuleManifestInput): ModuleManifest {
  return moduleManifestSchema.parse(input);
}
