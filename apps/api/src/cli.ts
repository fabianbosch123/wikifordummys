import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SYSTEM_GROUPS } from '@wiki/shared';
import { AppModule } from './app.module';
import { AuditService } from './audit/audit.service';
import { AuthService } from './auth/auth.service';
import { loadConfig } from './config';
import { PrismaService } from './infra/prisma.service';

const USAGE = `Verwendung:
  node dist/cli.js create-admin --email <adresse> --name "<Anzeigename>"

Legt einen Administrator an und gibt einen Einladungslink aus (72 Stunden gültig).
Über den Link setzt die Person ihr Passwort und richtet die Zwei-Faktor-Anmeldung ein.
Es gibt kein Standard-Passwort.`;

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

async function main() {
  const [command, ...args] = process.argv.slice(2);
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
