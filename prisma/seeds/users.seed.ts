import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole } from '@prisma/client';

function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

// Raw seed data lives HERE in prisma/seeds/ — matches POS/credentials.md §2.
// TEST SEEDS ONLY, never prod secrets.
function getUsersSeedData(): Array<{
  email: string;
  password: string;
  pin: string;
  name: string;
  role: UserRole;
}> {
  return [
    {
      email: envOr('ADMIN_SEED_EMAIL', 'admin@example.com').toLowerCase(),
      password: envOr('ADMIN_SEED_PASSWORD', 'Admin1234!'),
      pin: envOr('ADMIN_SEED_PIN', ''),
      name: 'System Admin',
      role: UserRole.ADMIN,
    },
    {
      email: envOr('MANAGER_SEED_EMAIL', 'manager01@example.com').toLowerCase(),
      password: envOr('MANAGER_SEED_PASSWORD', 'Manager1234!'),
      pin: envOr('MANAGER_SEED_PIN', '9999'),
      name: 'Store Manager',
      role: UserRole.MANAGER,
    },
    {
      email: envOr('CASHIER1_SEED_EMAIL', 'cashier01@example.com').toLowerCase(),
      password: envOr('CASHIER1_SEED_PASSWORD', 'Cashier1234!'),
      pin: envOr('CASHIER1_SEED_PIN', '1234'),
      name: 'Maria',
      role: UserRole.CASHIER,
    },
    {
      email: envOr('CASHIER2_SEED_EMAIL', 'cashier02@example.com').toLowerCase(),
      password: envOr('CASHIER2_SEED_PASSWORD', 'Cashier1234!'),
      pin: envOr('CASHIER2_SEED_PIN', '2345'),
      name: 'Jose',
      role: UserRole.CASHIER,
    },
  ];
}

export async function seedUsers(prisma: PrismaClient): Promise<void> {
  const users = getUsersSeedData();

  for (const u of users) {
    const rounds = parseInt(envOr('BCRYPT_SALT_ROUNDS', '4'), 10);
    const passwordHash = await bcrypt.hash(u.password, rounds);
    const pinHash = u.pin ? await bcrypt.hash(u.pin, rounds) : null;
    await prisma.user.upsert({
      where: { email: u.email },
      update: { role: u.role, isActive: true, passwordHash, pinHash, name: u.name },
      create: {
        email: u.email,
        passwordHash,
        pinHash,
        name: u.name,
        role: u.role,
      },
    });
    process.stdout.write(`Seeded user: ${u.email} (${u.role})\n`);
  }
}
