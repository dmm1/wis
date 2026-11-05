import { createAuthClient } from 'better-auth/react';
import { adminClient, organizationClient, twoFactorClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';
import { ac, tenantRoles } from './permissions';

export function createWisAuthClient(baseURL?: string) {
  return createAuthClient({
    ...(baseURL ? { baseURL } : {}),
    plugins: [
      adminClient(),
      organizationClient({
        ac,
        roles: tenantRoles,
        teams: { enabled: true },
        dynamicAccessControl: { enabled: true },
      }),
      twoFactorClient(),
      passkeyClient(),
    ],
  });
}
