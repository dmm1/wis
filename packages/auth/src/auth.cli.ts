// Used only by `better-auth generate` to emit the Drizzle schema. Not imported by the app.
import { drizzle } from 'drizzle-orm/node-postgres';
import { schema } from '@wis/db';
import { createAuth } from './auth';

export const auth = createAuth({
  db: drizzle.mock({ schema }),
  secret: 'cli-only-secret-not-used-at-runtime-0000000000',
  baseURL: 'http://localhost:3000',
  rpID: 'localhost',
});
