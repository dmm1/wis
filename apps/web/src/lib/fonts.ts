import { Bricolage_Grotesque, IBM_Plex_Sans } from 'next/font/google';

// Self-hosted at build time by next/font: no requests to Google at runtime (GDPR).
export const display = Bricolage_Grotesque({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-bricolage',
  display: 'swap',
});

export const sans = IBM_Plex_Sans({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600'],
  variable: '--font-plex',
  display: 'swap',
});
