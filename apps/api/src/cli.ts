import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SYSTEM_GROUPS } from '@wiki/shared';
import { AppModule } from './app.module';
import { AuditService } from './audit/audit.service';
import { AuthService } from './auth/auth.service';
import { loadConfig } from './config';
import { MailService } from './mail/mail.service';
import { OfficeService } from './office/office.service';
import { PrismaService } from './infra/prisma.service';

const USAGE = `Verwendung:
  node dist/cli.js create-admin --email <adresse> --name "<Anzeigename>" [--invite]
      Legt einen Administrator an und zeigt ein zufälliges Startpasswort in der Shell an.
      Funktioniert ohne Mailversand. Nach der ersten Anmeldung müssen das Passwort
      geändert und die Zwei-Faktor-Anmeldung eingerichtet werden.
      Mit --invite stattdessen per Einladungslink (72 Stunden gültig, auch per Mail).

  node dist/cli.js reset-password --email <adresse>
      Setzt für ein bestehendes Konto ein neues Startpasswort und zeigt es an, z. B. wenn
      der Mailversand nicht funktioniert. Beendet alle Sitzungen; die 2FA bleibt bestehen.
      Ein noch eingeladenes Konto wird dabei aktiviert.

  node dist/cli.js mail-test [--to <adresse>] [--verify-only]
      Prüft den Mailversand mit den gültigen Einstellungen (Administration vor .env)
      und schickt eine Testmail. Ohne --to wird nur die Verbindung geprüft.

  node dist/cli.js office-check
      Prüft den Office-Editor von Ende zu Ende: Erreichbarkeit, JWT-Geheimnis und
      Dateiaustausch zwischen API und Editor-Server im internen Netz.`;

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

export interface CreatedAdmin {
  loginUrl: string;
  /** Startpasswort (ohne --invite) */
  password?: string;
  /** Einladungslink (mit --invite) */
  inviteUrl?: string;
}

export async function createAdmin(email: string, displayName: string, opts: { invite?: boolean } = {}): Promise<CreatedAdmin> {
  const config = loadConfig();
  const ctx = await NestFactory.createApplicationContext(AppModule.forRoot(config), { logger: ['error'] });
  try {
    const prisma = ctx.get(PrismaService);
    const auth = ctx.get(AuthService);
    const audit = ctx.get(AuditService);
    const normalized = email.trim().toLowerCase();
    if (await prisma.user.findUnique({ where: { email: normalized } })) {
      throw new Error(`Es gibt bereits ein Konto mit ${normalized}. Neues Passwort mit: reset-password --email ${normalized}`);
    }
    const adminGroup = await prisma.group.findUniqueOrThrow({ where: { name: SYSTEM_GROUPS.ADMINS } });
    const user = await prisma.user.create({
      data: {
        email: normalized,
        displayName: displayName.trim(),
        status: 'invited',
        groups: { create: [{ groupId: adminGroup.id }] },
      },
    });
    await audit.log({ action: 'cli.admin.created', targetType: 'user', targetId: user.id, details: { email: normalized } });
    const loginUrl = `${config.APP_ORIGIN}/login`;
    if (opts.invite) return { loginUrl, inviteUrl: await auth.createInvitation(user, null) };
    return { loginUrl, password: await auth.issueStartPassword(user.id) };
  } finally {
    await ctx.close();
  }
}

export async function resetPassword(email: string): Promise<CreatedAdmin> {
  const config = loadConfig();
  const ctx = await NestFactory.createApplicationContext(AppModule.forRoot(config), { logger: ['error'] });
  try {
    const prisma = ctx.get(PrismaService);
    const normalized = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalized } });
    if (!user) throw new Error(`Es gibt kein Konto mit ${normalized}.`);
    const password = await ctx.get(AuthService).issueStartPassword(user.id);
    return { loginUrl: `${config.APP_ORIGIN}/login`, password };
  } finally {
    await ctx.close();
  }
}

function printStartPassword(title: string, email: string, result: CreatedAdmin) {
  console.log(`${title}

  Anmeldung: ${result.loginUrl}
  E-Mail:    ${email}
  Passwort:  ${result.password}

Das Passwort wird nur jetzt angezeigt. Bei der Anmeldung wird, falls noch nicht geschehen,
die Zwei-Faktor-Anmeldung eingerichtet; danach muss das Passwort geändert werden.
`);
}

/** Gibt eine Beschreibung des geprüften Zugangs zurück; wirft bei Fehlern mit verständlicher Meldung */
export async function mailTest(to: string | undefined): Promise<string> {
  const config = loadConfig();
  const ctx = await NestFactory.createApplicationContext(AppModule.forRoot(config), { logger: ['error'] });
  try {
    const mail = ctx.get(MailService);
    const settings = mail.settings();
    if (!settings) throw new Error('Es ist kein Mailserver eingerichtet (SMTP_URL in .env ist leer).');
    const { source } = mail.describe();
    const where = `${settings.host}:${settings.port} (${settings.security}, ${source === 'admin' ? 'aus der Administration' : 'aus .env'})`;
    await mail.verify(settings);
    if (to) {
      await mail.sendNow({
        to,
        subject: 'Testmail von wikifordummys',
        text: 'Hallo,\n\ndiese Testmail kommt von der Kommandozeile des Wikis. Der Mailversand funktioniert.\n',
      });
      return `Verbindung zu ${where} in Ordnung, Testmail an ${to} verschickt.`;
    }
    return `Verbindung und Anmeldung bei ${where} in Ordnung.`;
  } finally {
    await ctx.close();
  }
}

export async function officeCheck(): Promise<string> {
  const ctx = await NestFactory.createApplicationContext(AppModule.forRoot(loadConfig()), { logger: ['error'] });
  try {
    return await ctx.get(OfficeService).selfCheck();
  } finally {
    await ctx.close();
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'office-check') {
    console.log(await officeCheck());
    return;
  }
  if (command === 'mail-test') {
    console.log(await mailTest(args.includes('--verify-only') ? undefined : arg(args, 'to')));
    return;
  }
  const email = arg(args, 'email')?.trim().toLowerCase();
  if (command === 'reset-password' && email) {
    printStartPassword('Neues Startpasswort gesetzt.', email, await resetPassword(email));
    return;
  }
  const name = arg(args, 'name');
  if (command !== 'create-admin' || !email || !name) {
    console.log(USAGE);
    process.exit(command ? 1 : 0);
  }
  const result = await createAdmin(email, name, { invite: args.includes('--invite') });
  if (result.inviteUrl) {
    console.log(`Administrator angelegt. Einladungslink (72 Stunden gültig):\n\n  ${result.inviteUrl}\n`);
  } else {
    printStartPassword('Administrator angelegt.', email, result);
  }
}

if (require.main === module) {
  main().catch((err: Error) => {
    console.error(`Fehler: ${err.message}`);
    process.exit(1);
  });
}
