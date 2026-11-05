import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getInvitationPreview } from '@wis/auth';
import { Alert } from '@/components/ui/alert';
import { Link } from '@/i18n/navigation';
import { getAuthContext } from '@/lib/auth';
import { getSession } from '@/lib/session';
import { InviteAccept, InviteSignIn, InviteSignUp, WrongAccount } from './invite-forms';

export default async function AcceptInvitationPage({
  params,
}: PageProps<'/[locale]/accept-invitation/[id]'>) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Auth.invite');
  const tr = await getTranslations('Roles');
  const { db } = getAuthContext();
  const preview = await getInvitationPreview(db, id);

  if (preview.state === 'not_found') {
    return (
      <State title={t('notFoundTitle')}>
        <Alert tone="error">{t('notFound')}</Alert>
      </State>
    );
  }
  if (preview.state === 'expired') {
    return (
      <State title={t('expiredTitle')}>
        <Alert tone="error">{t('expired', { org: preview.organizationName })}</Alert>
      </State>
    );
  }
  if (preview.state === 'used') {
    return (
      <State title={t('usedTitle')}>
        <p className="text-muted">{t('used', { org: preview.organizationName })}</p>
        <Link
          href="/sign-in"
          className="mt-5 inline-flex h-11 items-center rounded-lg bg-ink px-4 font-medium text-on-ink"
        >
          {t('toSignIn')}
        </Link>
      </State>
    );
  }

  const roleKey = (preview.role ?? 'employee').split(',')[0]!.trim();
  const roleLabel = tr.has(roleKey) ? tr(roleKey) : roleKey;
  const session = await getSession();

  return (
    <State
      title={t('title', { org: preview.organizationName })}
      subtitle={t('subtitle', { role: roleLabel })}
    >
      {session ? (
        session.user.email.toLowerCase() === preview.email.toLowerCase() ? (
          <InviteAccept invitationId={id} />
        ) : (
          <WrongAccount invitedEmail={preview.email} currentEmail={session.user.email} />
        )
      ) : preview.accountExists ? (
        <InviteSignIn invitationId={id} email={preview.email} />
      ) : (
        <InviteSignUp invitationId={id} email={preview.email} />
      )}
    </State>
  );
}

function State({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <h1 className="text-[1.75rem] font-bold sm:text-3xl">{title}</h1>
      {subtitle ? <p className="mt-2 text-muted">{subtitle}</p> : null}
      <div className="mt-7">{children}</div>
    </>
  );
}
