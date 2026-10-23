import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SYSTEM_GROUPS } from '@wiki/shared';
import { AppModule } from './app.module';
import { AuditService } from './audit/audit.service';
import { AuthService } from './auth/auth.service';
import { loadConfig } from './config';
import { MailService } from './mail/mail.service';
import { PrismaService } from './infra/prisma.service';

const USAGE = `Verwendung:
  node dist/cli.js create-admin --email <adresse> --name "<Anzeigename>"
      Legt einen Administrator an und gibt einen Einladungslink aus (72 Stunden gültig).
      Über den Link setzt die Person ihr Passwort und richtet die Zwei-Faktor-Anmeldung ein.
      Es gibt kein Standard-Passwort.

  node dist/cli.js mail-test [--to <adresse>] [--verify-only]
      Prüft den Mailversand mit den gültigen Einstellungen (Administration vor .env)
      und schickt eine Testmail. Ohne --to wird nur die Verbindung geprüft.`;

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function createAdmin(email: string, displayName: string) {
  const config = loadConfig();
  const ctx = await NestFactory.createApplicationContext(AppModule.forRoot(config), { logger: ['error'] });
  try {
    const prisma = ctx.get(PrismaService);
    const auth = ctx.get(AuthService);
    const audit = ctx.get(AuditService);
    const normalized = email.trim().toLowerCase();
    if (await prisma.user.findUnique({ where: { email: normalized } })) {
      throw new Error(`Es gibt bereits ein Konto mit ${normalized}.`);
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
    const url = await auth.createInvitation(user, null);
    await audit.log({ action: 'cli.admin.created', targetType: 'user', targetId: user.id, details: { email: normalized } });
    return url;
  } finally {
    await ctx.close();
  }
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

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'mail-test') {
    console.log(await mailTest(args.includes('--verify-only') ? undefined : arg(args, 'to')));
    return;
  }
  if (command !== 'create-admin') {
    console.log(USAGE);
    process.exit(command ? 1 : 0);
  }
  const email = arg(args, 'email');
  const name = arg(args, 'name');
  if (!email || !name) {
    console.log(USAGE);
    process.exit(1);
  }
  const url = await createAdmin(email, name);
  console.log(`Administrator angelegt. Einladungslink (72 Stunden gültig):\n\n  ${url}\n`);
}

if (require.main === module) {
  main().catch((err: Error) => {
    console.error(`Fehler: ${err.message}`);
    process.exit(1);
  });
}
