import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Skip API, Next internals, the service worker route and static files.
  matcher: ['/((?!api|serwist|_next|_vercel|.*\\..*).*)'],
};
