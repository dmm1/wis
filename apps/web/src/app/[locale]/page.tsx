import { getTranslations, setRequestLocale } from 'next-intl/server';

export default async function HomePage({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Home');

  return (
    <main>
      <h1>{t('title')}</h1>
      <p>{t('tagline')}</p>
      <p className="muted">{t('status')}</p>
    </main>
  );
}
