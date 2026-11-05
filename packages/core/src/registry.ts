import type { ModuleManifest } from './module';

export interface NavigationItem {
  moduleId: string;
  path: string;
  labelKey: string;
  icon: string;
}

/**
 * The set of modules compiled into this deployment. Which of them a tenant may use is decided
 * by the tenant's entitlements (`tenant_modules`), never by the registry.
 */
export class ModuleRegistry {
  private readonly byId = new Map<string, ModuleManifest>();

  constructor(manifests: readonly ModuleManifest[]) {
    for (const m of manifests) {
      if (this.byId.has(m.id)) throw new Error(`Duplicate module id "${m.id}"`);
      this.byId.set(m.id, m);
    }
    for (const m of manifests) {
      for (const dep of m.consumes) {
        const provider = dep.split('.')[0];
        if (provider && provider !== m.id && !this.byId.has(provider)) {
          throw new Error(
            `Module "${m.id}" consumes "${dep}" but module "${provider}" is not registered`,
          );
        }
      }
    }
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get(id: string): ModuleManifest | undefined {
    return this.byId.get(id);
  }

  list(): ModuleManifest[] {
    return [...this.byId.values()];
  }

  ids(): string[] {
    return [...this.byId.keys()];
  }

  /** Permission statements for access control: resource = module id, actions = permission suffixes. */
  permissionStatements(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const m of this.byId.values()) {
      if (m.permissions.length === 0) continue;
      out[m.id] = m.permissions.map((p) => p.slice(m.id.length + 1));
    }
    return out;
  }

  /** What a system role gets in every module: resource → actions. */
  grantsForRole(role: string): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const m of this.byId.values()) {
      const actions = m.defaultRoleGrants[role];
      if (actions && actions.length) out[m.id] = [...actions];
    }
    return out;
  }

  /** Navigation entries of the modules in `enabledIds`, ignoring ids unknown to this deployment. */
  navigationFor(enabledIds: readonly string[]): NavigationItem[] {
    const enabled = new Set(enabledIds);
    return this.list()
      .filter((m) => enabled.has(m.id))
      .flatMap((m) => m.navigation.map((n) => ({ moduleId: m.id, ...n })));
  }
}
