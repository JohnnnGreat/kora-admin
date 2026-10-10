import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { hash } from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { PLATFORM_PERMISSIONS } from '../src/platform-access/platform-permissions';

for (const file of [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env']) {
  if (existsSync(file)) loadEnvFile(file);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main() {
  const databaseUrl = required('DATABASE_URL');
  const email = required('PLATFORM_ADMIN_EMAIL').toLowerCase();
  const name = required('PLATFORM_ADMIN_NAME');
  const password = required('PLATFORM_ADMIN_PASSWORD');
  if (password.length < 12) {
    throw new Error(
      'PLATFORM_ADMIN_PASSWORD must contain at least 12 characters.',
    );
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    application_name: 'kora-admin-bootstrap',
  });
  const database = new PrismaClient({
    adapter: new PrismaPg(pool, { disposeExternalPool: true }),
  });

  try {
    const passwordHash = await hash(password, 12);
    await database.$transaction(async (transaction) => {
      const role = await transaction.platformRole.upsert({
        where: { key: 'platform_owner' },
        update: {
          name: 'Platform owner',
          description:
            'Full access to the Kora platform administration service.',
          permissions: [...PLATFORM_PERMISSIONS],
          isSystem: true,
        },
        create: {
          key: 'platform_owner',
          name: 'Platform owner',
          description:
            'Full access to the Kora platform administration service.',
          permissions: [...PLATFORM_PERMISSIONS],
          isSystem: true,
        },
      });
      const admin = await transaction.platformAdmin.upsert({
        where: { email },
        update: {
          name,
          passwordHash,
          status: 'active',
          passwordSetAt: new Date(),
        },
        create: { email, name, passwordHash },
      });
      await transaction.platformAdminRole.upsert({
        where: { adminId_roleId: { adminId: admin.id, roleId: role.id } },
        update: {},
        create: { adminId: admin.id, roleId: role.id },
      });
    });
    process.stdout.write(`Platform administrator ready: ${email}\n`);
  } finally {
    await database.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  process.stderr.write(`Unable to create platform administrator: ${message}\n`);
  process.exitCode = 1;
});
