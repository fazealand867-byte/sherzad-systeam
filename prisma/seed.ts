import { ensureSystemSeeded } from '../src/lib/services/seed.service';
import prisma from '../src/lib/prisma';

async function main() {
  console.log('Seeding Sherzad Enterprise ERP & Double-Entry Accounting Database...');
  const result = await ensureSystemSeeded();
  if (result.alreadySeeded) {
    console.log('Database already seeded.');
  } else {
    console.log('Database seeded successfully with balanced Double-Entry records!');
  }
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
