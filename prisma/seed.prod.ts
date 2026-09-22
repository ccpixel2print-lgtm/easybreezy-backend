import { PrismaClient, PricingType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const p = (rupees: number) => Math.round(rupees * 100);

async function main() {
  console.log('Seeding PRODUCTION database...');

  // Destructive reset only when explicitly asked (never by accident on a live DB).
  if (process.env.SEED_RESET === 'true') {
    console.log('SEED_RESET=true -> clearing catalog tables');
    await prisma.subService.deleteMany();
    await prisma.service.deleteMany();
    await prisma.serviceCategory.deleteMany();
    await prisma.serviceablePincode.deleteMany();
  }

  // ---- categories, services, sub-services, pincodes ----
  // (identical to prisma/seed.ts — copy that block here verbatim)
  //  ... Plumber, Electrician, Maid, Deep Cleaning, AC Service,
  //      Bathroom Cleaning, Sofa Cleaning, Kitchen Cleaning, pincodes ...

  // ---- real admin from env (no hardcoded credentials) ----
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD before seeding.');
  }
  const adminPasswordHash = await bcrypt.hash(adminPassword, 10);
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash: adminPasswordHash, role: 'ADMIN', status: 'active' },
    create: {
      email: adminEmail,
      fullName: 'Easy Breezy Admin',
      role: 'ADMIN',
      passwordHash: adminPasswordHash,
      status: 'active',
    },
  });
  console.log(`Seeded admin: ${adminEmail} (password taken from env, not logged)`);
  console.log('Production seeding complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
