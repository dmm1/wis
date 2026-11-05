import { z } from 'zod';

const slug = z.string().regex(/^[a-z][a-z0-9-]*$/, 'lowercase kebab-case');
const permission = z.string().regex(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/, '<module>:<action>');

/** Static description of a WIS module. Modules interact via events and public services only. */
export const moduleManifestSchema = z
  .object({
    id: slug,
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    permissions: z.array(permission).default([]),
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
  });

export type ModuleManifest = z.output<typeof moduleManifestSchema>;
export type ModuleManifestInput = z.input<typeof moduleManifestSchema>;

export function defineModule(input: ModuleManifestInput): ModuleManifest {
  return moduleManifestSchema.parse(input);
}
