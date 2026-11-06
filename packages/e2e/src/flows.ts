import { createHmac } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { PASSWORD, type SeedData } from './seed';

export interface FlowOptions {
  baseURL: string;
  seed: SeedData;
  /** Directory for screenshots. */
  artifacts: string;
  /** Run only these flows (e.g. ['A', 'C']). */
  only?: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function base32(s: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits), enough to answer the app's own challenge. */
function totp(secret: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', base32(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  const code =
    (((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1_000_000;
  return String(code).padStart(6, '0');
}

export async function runFlows(
  opts: FlowOptions,
): Promise<{ passed: number; failed: number; errors: string[] }> {
  const { baseURL: B, seed, artifacts } = opts;
  const browser: Browser = await chromium.launch();
  const results: { ok: boolean; name: string }[] = [];
  const consoleErrors: string[] = [];

  const ok = (name: string, cond: boolean, extra = '') => {
    results.push({ ok: cond, name });
    console.log(cond ? 'PASS' : 'FAIL', name, cond ? '' : extra);
  };
  const open = async (contextOptions: Parameters<Browser['newContext']>[0] = {}) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ...contextOptions,
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => consoleErrors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
        consoleErrors.push(m.text());
    });
    return { context, page };
  };
  const shot = async (p: Page, name: string, fullPage = false) => {
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${artifacts}/${name}.png`, fullPage });
  };
  const text = async (p: Page) => (await p.locator('body').innerText()).replace(/\s+/g, ' ');

  async function signIn(p: Page, email: string) {
    await p.goto(`${B}/en/sign-in`);
    await p.getByLabel('Email').fill(email);
    await p.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  async function signOut(p: Page) {
    await p.getByRole('button', { name: 'Account menu' }).first().click();
    await p.getByRole('menuitem', { name: 'Sign out' }).click();
    await p.waitForURL(/sign-in/);
  }
  /** People with several workspaces may land on the chooser; pick one when it shows. */
  async function enterWorkspace(p: Page, name = 'Café Sonnenschein') {
    await p.waitForLoadState('networkidle');
    const chooser = p.getByRole('heading', { name: 'Choose a workspace' });
    if (await chooser.isVisible().catch(() => false)) {
      await p.getByRole('button', { name }).click();
      await p.waitForFunction(() => !document.body.innerText.includes('Choose a workspace'));
    }
  }
  const wants = (flow: string) => !opts.only || opts.only.includes(flow);
  const overflowX = (p: Page) =>
    p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

  try {
    // A: an existing person joins two workspaces through the UI
    if (wants('A')) {
      const { context, page: p } = await open();
      await signIn(p, seed.adminEmail);
      await p.waitForURL(`${B}/en`);
      let t = await text(p);
      ok(
        'A1 no-workspace screen lists the open invitations',
        t.includes("You've been invited") &&
          t.includes('Join Café Sonnenschein') &&
          t.includes('Join Bäckerei Vogl'),
      );
      await shot(p, 'a1-invited');
      await p.getByRole('link', { name: 'Join Café Sonnenschein' }).click();
      await p.getByRole('button', { name: 'Join workspace' }).click();
      await p.waitForURL(`${B}/en`);
      t = await text(p);
      ok(
        'A2 after joining: greeting, role and workspace',
        t.includes('Hello, Anna') &&
          t.includes('Customer admin') &&
          t.includes('Café Sonnenschein'),
      );
      ok(
        'A3 seat usage, module and navigation entry',
        t.includes('1 of 12 seats in use') && t.includes('Work schedule'),
      );
      await shot(p, 'a2-home');
      await p.getByRole('link', { name: 'Work schedule' }).first().click();
      await p.waitForURL(/schedule/);
      ok(
        'A4 schedule page reachable from navigation',
        (await text(p)).includes('Schedules will appear here'),
      );
      await p.goto(`${B}/en/accept-invitation/${seed.y.invitationId}`);
      await p.getByRole('button', { name: 'Join workspace' }).click();
      await p.waitForURL(`${B}/en`);
      t = await text(p);
      ok(
        'A5 second workspace active, without the schedule module',
        t.includes('Bäckerei Vogl') && !t.includes('Work schedule'),
      );
      await p.getByRole('button', { name: 'Switch workspace' }).click();
      await shot(p, 'a3-switcher');
      ok(
        'A6 switcher lists both workspaces',
        await p.getByRole('menuitem', { name: 'Café Sonnenschein' }).isVisible(),
      );
      await p.getByRole('menuitem', { name: 'Café Sonnenschein' }).click();
      await p.waitForFunction(() => document.body.innerText.includes('Work schedule'));
      ok('A7 switching workspace updates navigation immediately', true);
      await p.getByRole('button', { name: 'Account menu' }).first().click();
      await p.getByRole('menuitem', { name: 'Deutsch' }).click();
      await p.waitForURL(`${B}/de`);
      t = await text(p);
      ok(
        'A8 language switch to German (path and content)',
        t.includes('Hallo, Anna') && t.includes('Dienstplan') && t.includes('Plätze'),
      );
      await shot(p, 'a4-home-de');
      await context.close();
      await sleep(11000);
    }

    // F: custom fields and employees (step 4)
    if (wants('F')) {
      const { context, page: p } = await open();
      await signIn(p, seed.adminEmail);
      await p.waitForURL(`${B}/en`);
      await enterWorkspace(p);
      let t = await text(p);
      const railLinks = (await p.locator('aside nav a').allInnerTexts()).map((x) => x.trim());
      ok(
        'F1 customer admin sees Employees and Custom fields in the navigation',
        railLinks.includes('Employees') && railLinks.includes('Custom fields'),
        `rail: ${railLinks.join(' | ')}`,
      );
      ok(
        'F2 home still shows 1 of 12 seats before any employee exists',
        t.includes('1 of 12 seats in use'),
      );

      // define fields
      await p.goto(`${B}/en/settings/fields`);
      ok(
        'F3 empty state invites to add the first field',
        (await text(p)).includes('No custom fields yet'),
      );
      await shot(p, 'f1-fields-empty');
      const addField = async (fill: () => Promise<void>) => {
        await p.getByRole('button', { name: 'Add field' }).first().click();
        await fill();
        await p.locator('form').getByRole('button', { name: 'Add field' }).click();
        await p.waitForTimeout(900);
      };
      await addField(async () => {
        await p.getByLabel('Name in English').fill('Licence');
        await p.getByLabel('Name in German').fill('Führerschein');
        await p.getByLabel('Required').check();
        await p.getByLabel('Maximum length').fill('12');
      });
      await addField(async () => {
        await p.getByLabel('Name in English').fill('Shoe size');
        await p.getByLabel('Name in German').fill('Schuhgröße');
        await p.getByLabel('Type').selectOption('number');
        await p.getByLabel('Minimum').fill('30');
        await p.getByLabel('Maximum', { exact: true }).fill('55');
        await p.getByLabel('Whole numbers only').check();
      });
      await addField(async () => {
        await p.getByLabel('Name in English').fill('Preferred role');
        await p.getByLabel('Name in German').fill('Bevorzugte Rolle');
        await p.getByLabel('Type').selectOption('select');
        await p.getByLabel('Choices').fill('Bar | Bar\nKitchen | Küche');
      });
      await addField(async () => {
        await p.getByLabel('Name in English').fill('IBAN');
        await p.getByLabel('Name in German').fill('IBAN');
        await p.getByLabel('Sensitive').check();
      });
      t = await text(p);
      ok(
        'F4 four fields listed with their keys and badges',
        ['licence', 'shoe_size', 'preferred_role', 'iban'].every((k) => t.includes(k)) &&
          t.includes('Required') &&
          t.includes('Sensitive'),
      );
      await shot(p, 'f2-fields', true);

      // add an employee through the generated form
      await p.goto(`${B}/en/employees`);
      ok('F5 employee list starts empty', (await text(p)).includes('No employees yet'));
      await p.getByRole('link', { name: 'Add employee' }).first().click();
      await p.getByLabel('First name').fill('Berta');
      await p.getByLabel('Last name').fill('Bauer');
      await p.getByRole('button', { name: 'Add employee' }).click();
      await p.waitForTimeout(1000);
      ok(
        'F6 required fields are checked before sending, with a clear message',
        (await text(p)).includes('Check the highlighted fields') &&
          (await text(p)).includes('This field is required.'),
      );
      await p.getByLabel(/^Licence/).fill('AB-12');
      await p.getByLabel('Shoe size').fill('99');
      await p.getByRole('button', { name: 'Add employee' }).click();
      await p.waitForTimeout(1000);
      ok(
        'F7 out-of-range value is refused with a translated message',
        (await text(p)).includes('Enter 55 or less.'),
      );
      await p.getByLabel('Shoe size').fill('40');
      ok(
        'F7b the error disappears as soon as the value is corrected',
        !(await text(p)).includes('Enter 55 or less.'),
      );
      await p.getByLabel('Preferred role').selectOption({ label: 'Kitchen' });
      await p.getByLabel('IBAN').fill('DE89370400440532013000');
      await shot(p, 'f3-employee-form', true);
      await p.getByRole('button', { name: 'Add employee' }).click();
      await p.waitForURL(`${B}/en/employees`);
      t = await text(p);
      ok('F8 employee created and listed', t.includes('Bauer, Berta') && t.includes('1 employee'));
      await shot(p, 'f4-employee-list');

      // edit
      await p.getByRole('link', { name: /Bauer, Berta/ }).click();
      await p.waitForURL(/employees\/[0-9a-f-]{36}/);
      ok(
        'F9 edit form is prefilled from the stored data',
        (await p.getByLabel('Shoe size').inputValue()) === '40' &&
          (await p.getByLabel(/^Licence/).inputValue()) === 'AB-12',
      );
      await p.getByLabel('Shoe size').fill('41');
      await p.getByRole('button', { name: 'Save employee' }).click();
      await p.getByText('Saved.').waitFor();
      await p.reload();
      ok('F10 change persisted', (await p.getByLabel('Shoe size').inputValue()) === '41');
      const employeeUrl = p.url();

      // archive a field: it disappears from the form, its value is kept
      await p.goto(`${B}/en/settings/fields`);
      await p
        .locator('li', { hasText: 'preferred_role' })
        .getByRole('button', { name: 'Archive' })
        .click();
      await p.waitForTimeout(1200);
      await p.goto(employeeUrl);
      ok(
        'F11 archived field is gone from the employee form',
        (await p.getByLabel('Preferred role').count()) === 0,
      );
      await p.goto(`${B}/en/settings/fields`);
      await p
        .locator('li', { hasText: 'preferred_role' })
        .getByRole('button', { name: 'Restore' })
        .click();
      await p.waitForTimeout(1200);
      await p.goto(employeeUrl);
      ok(
        'F12 restoring brings the stored value back',
        (await p.getByLabel('Preferred role').inputValue()) === 'kitchen',
      );

      // linking a login: one person, counted once
      await p.locator('#login-select').selectOption({ index: 1 });
      await p.getByRole('button', { name: 'Link account' }).click();
      await p.getByText(/Linked to Anna Admin/).waitFor({ timeout: 15000 });
      ok('F13 employee linked to an account', true);
      await shot(p, 'f5-linked', true);
      await p.goto(`${B}/en`);
      ok(
        'F14 a person with a login is counted once (still 1 of 12 seats)',
        (await text(p)).includes('1 of 12 seats in use'),
      );
      await p.goto(`${B}/en/employees?status=all`);
      ok('F15 list shows the login badge', (await text(p)).includes('Has login'));

      // German labels from the same definitions
      await p.goto(`${B}/de/employees/new`);
      t = await text(p);
      ok(
        'F16 field labels follow the UI language',
        t.includes('Führerschein') && t.includes('Schuhgröße') && t.includes('Bevorzugte Rolle'),
      );
      await shot(p, 'f6-form-de', true);
      ok('F17 no horizontal scroll on the employee form', !(await overflowX(p)));
      await p.getByRole('button', { name: 'Mitarbeiter hinzufügen' }).click();
      await p.waitForTimeout(500);
      ok(
        'F18 validation messages are German in the German UI',
        (await text(p)).includes('Dieses Feld ist erforderlich.'),
      );
      await context.close();
      await sleep(11000);
    }

    // B: a new person signs up from an invitation
    if (wants('B')) {
      const { context, page: p } = await open();
      await p.goto(`${B}/en/accept-invitation/${seed.z.invitationId}`);
      await shot(p, 'b0-invite');
      await p.getByLabel('Your name').fill('Nora Neu');
      await p.getByLabel('Choose a password').fill('short');
      await p.getByRole('button', { name: 'Create account and join' }).click();
      await p.waitForTimeout(1200);
      ok(
        'B1 short password rejected with a clear message',
        (await text(p)).includes('at least 12 characters'),
      );
      await p.getByLabel('Choose a password').fill(PASSWORD);
      await p.getByRole('button', { name: 'Create account and join' }).click();
      await p.waitForURL(/settings\/security/, { timeout: 20000 });
      ok(
        'B2 account created, joined, lands on security with a welcome',
        (await text(p)).includes('Welcome to Gasthaus Alm'),
      );
      await p.goto(`${B}/en`);
      const home = await text(p);
      ok(
        'B3 shown as customer admin on home',
        home.includes('Hello, Nora') && home.includes('Customer admin'),
      );
      ok(
        'B4 admin without 2FA sees the nudge banner',
        home.includes('Protect this account with two-step verification'),
      );
      await context.close();
      await sleep(11000);
    }

    // C: passkey + two-step verification
    if (wants('C')) {
      const { context, page: p } = await open();
      const cdp = await context.newCDPSession(p);
      await cdp.send('WebAuthn.enable');
      const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      });
      await signIn(p, seed.adminEmail);
      await p.waitForURL(`${B}/en`);
      await p.goto(`${B}/en/settings/security`);
      await p.getByLabel('Name').fill('Test laptop');
      await p.getByRole('button', { name: 'Add passkey' }).click();
      await p.getByText('Test laptop').waitFor({ timeout: 15000 });
      ok('C1 passkey registered and listed', true);
      await p.getByRole('button', { name: 'Set up two-step verification' }).click();
      await p.getByLabel('Your password').fill(PASSWORD);
      await p.getByRole('button', { name: 'Continue' }).click();
      await p.getByRole('img', { name: /QR code/ }).waitFor();
      await shot(p, 'c1-2fa-scan', true);
      const secret = await p.locator('code').first().innerText();
      ok('C2 QR code and manual key shown', secret.length >= 16, secret);
      await p.getByLabel('6-digit code').fill('000000');
      await p.getByRole('button', { name: 'Verify and turn on' }).click();
      await p.waitForTimeout(1200);
      ok('C3 wrong code rejected with guidance', (await text(p)).includes("isn't right"));
      await p.getByLabel('6-digit code').fill(totp(secret));
      await p.getByRole('button', { name: 'Verify and turn on' }).click();
      await p.getByText('Save your backup codes').waitFor({ timeout: 15000 });
      const codes = await p.locator('ul.font-mono li').allInnerTexts();
      ok(
        'C4 correct code enables 2FA and shows backup codes',
        codes.length >= 8,
        String(codes.length),
      );
      await p.getByRole('button', { name: "I've saved them" }).click();
      await p.waitForTimeout(1500);
      ok('C5 panel shows 2FA is on', await p.getByRole('button', { name: 'Turn off' }).isVisible());
      // a real browser asks the person to pick a passkey; the virtual one would sign in by itself
      await cdp.send('WebAuthn.setAutomaticPresenceSimulation', {
        authenticatorId,
        enabled: false,
      });
      await signOut(p);
      await sleep(11000); // sign-in rate limit: 3 per 10 s
      await signIn(p, seed.adminEmail);
      await p.waitForURL(/two-factor/);
      ok(
        'C6 password sign-in asks for the 6-digit code',
        (await text(p)).includes('Two-step verification'),
      );
      await p.getByLabel('Code').fill('123456');
      await p.getByRole('button', { name: 'Verify' }).click();
      await p.waitForTimeout(1200);
      ok(
        'C7 wrong code refused on sign-in',
        (await text(p)).includes("isn't right") && /two-factor/.test(p.url()),
      );
      await p.getByRole('button', { name: 'Use a backup code' }).click();
      await p.getByLabel('Backup code').fill(codes[0]!);
      await p.getByRole('button', { name: 'Verify' }).click();
      await p.waitForURL(`${B}/en`, { timeout: 15000 });
      await enterWorkspace(p);
      ok('C8 backup code signs in', (await text(p)).includes('Hello, Anna'));
      await signOut(p);
      await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: true });
      await p.getByRole('button', { name: 'Sign in with a passkey' }).click();
      await p.waitForURL(`${B}/en`, { timeout: 20000 });
      await enterWorkspace(p);
      ok('C9 passkey sign-in works without a 2FA prompt', (await text(p)).includes('Hello, Anna'));
      await context.close();
      await sleep(11000);
    }

    // D: the platform admin creates and manages a customer
    if (wants('D')) {
      const { context, page: p } = await open();
      await signIn(p, seed.platformEmail);
      await p.waitForURL(`${B}/en`);
      await p.getByRole('link', { name: 'Customers' }).first().click();
      await p.waitForURL(/platform/);
      await shot(p, 'd1-list');
      await p.getByRole('link', { name: 'New customer' }).click();
      await p.getByLabel('Company name').fill('Hotel Edelweiß');
      ok(
        'D1 short name suggested from the company name',
        (await p.getByLabel('Short name').inputValue()) === 'hotel-edelweiss',
      );
      await p.getByLabel('Admin email').fill(`edelweiss-${Date.now()}@wis.test`);
      await p.getByLabel('Seats').fill('8');
      await p.getByRole('checkbox', { name: 'Work schedule' }).check();
      await shot(p, 'd2-new', true);
      await p.getByRole('button', { name: 'Create customer' }).click();
      await p.waitForURL(/\/platform\/(?!new)[^/?]+/, { timeout: 20000 });
      let t = await text(p);
      ok(
        'D2 customer created: trial status and open invitation',
        t.includes('Hotel Edelweiß') && t.includes('Trial') && t.includes('Open invitations'),
      );
      await p.getByLabel('Seat limit').fill('0');
      ok(
        'D3 seat input refuses values below the seats in use',
        await p
          .getByLabel('Seat limit')
          .evaluate((el) => (el as HTMLInputElement).validity.rangeUnderflow),
      );
      await p.getByLabel('Seat limit').fill('20');
      await p.getByRole('button', { name: 'Save seats' }).click();
      await p.getByText('Seat limit saved.').waitFor();
      ok('D4 seat limit saved', true);
      await p.getByRole('checkbox', { name: 'Work schedule' }).uncheck();
      await p.getByRole('button', { name: 'Save modules' }).click();
      await p.getByText('Modules saved.').waitFor();
      ok('D5 module switched off', true);
      await p.getByRole('button', { name: 'Resend invitation' }).click();
      await p.getByText('Sent again.').waitFor();
      ok('D6 invitation resent', true);
      await p.getByRole('button', { name: 'Suspend' }).click();
      ok(
        'D7 suspending needs confirmation',
        await p.getByRole('group', { name: 'Confirm status change' }).isVisible(),
      );
      await p
        .getByRole('group', { name: 'Confirm status change' })
        .getByRole('button', { name: 'Suspend' })
        .click();
      await p.getByText('Suspended').first().waitFor();
      await p.waitForTimeout(800);
      t = await text(p);
      ok(
        'D8 status Suspended and the activity log shows the history',
        t.includes('Seat limit changed from 8 to 20') &&
          /Status changed from Trial to Suspended/.test(t),
      );
      await shot(p, 'd3-detail', true);
      await context.close();
      await sleep(11000);
    }

    // E: mobile layout and dark mode
    if (wants('E')) {
      const m = await open({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });
      await m.page.goto(`${B}/en/sign-in`);
      await shot(m.page, 'e1-m-sign-in');
      ok('E1 no horizontal scroll on mobile sign-in', !(await overflowX(m.page)));
      await signIn(m.page, seed.platformEmail);
      await m.page.waitForURL(`${B}/en`);
      await m.page.goto(`${B}/en/platform`);
      await shot(m.page, 'e2-m-platform');
      ok('E2 no horizontal scroll on mobile platform list', !(await overflowX(m.page)));
      await m.page.goto(`${B}/en/platform/${seed.x.tenantId}`);
      await shot(m.page, 'e3-m-detail', true);
      ok('E3 no horizontal scroll on mobile customer detail', !(await overflowX(m.page)));
      await m.context.close();
      await sleep(11000);
      const d = await open({ colorScheme: 'dark' });
      await d.page.goto(`${B}/en/sign-in`);
      await shot(d.page, 'e4-dark-sign-in');
      await signIn(d.page, seed.platformEmail);
      await d.page.waitForURL(`${B}/en`);
      await d.page.goto(`${B}/en/platform`);
      await shot(d.page, 'e5-dark-platform');
      await d.context.close();
    }
  } catch (e) {
    ok(
      'SCRIPT ERROR',
      false,
      String((e as Error).message)
        .split('\n')
        .slice(0, 6)
        .join(' | '),
    );
  }
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  return { passed: results.length - failed, failed, errors: [...new Set(consoleErrors)] };
}

export type { BrowserContext };
