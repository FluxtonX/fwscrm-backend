import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding baseline CRM data on Neon PostgreSQL...');

  // 1. Default Organization
  const org = await prisma.organization.upsert({
    where: { slug: 'default-org' },
    update: {},
    create: {
      name: 'Primary Organization',
      slug: 'default-org',
    },
  });
  console.log(`Organization ready: ${org.name} (${org.id})`);

  // 2. Default Admin User (seed placeholder for dev)
  const adminUser = await prisma.user.upsert({
    where: {
      organizationId_email: {
        organizationId: org.id,
        email: 'admin@fwscrm.com',
      },
    },
    update: {},
    create: {
      organizationId: org.id,
      email: 'admin@fwscrm.com',
      // In Phase 2, this will be hashed with argon2/bcrypt
      passwordHash: '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyUIXe/CeWvKgmvEGyfGzX4u7nNkmk6G',
      firstName: 'CRM',
      lastName: 'Administrator',
      role: Role.SUPER_ADMIN,
    },
  });
  console.log(`Default admin user ready: ${adminUser.email}`);

  // 3. Lead Statuses
  const statuses = [
    { name: 'New', color: '#0284C7', order: 1, isDefault: true },
    { name: 'Contacted', color: '#EAB308', order: 2, isDefault: false },
    { name: 'Qualified', color: '#0D9488', order: 3, isDefault: false },
    { name: 'Proposal Sent', color: '#8B5CF6', order: 4, isDefault: false },
    { name: 'Customer', color: '#10B981', order: 5, isDefault: false },
    { name: 'Lost', color: '#EF4444', order: 6, isDefault: false },
  ];

  for (const s of statuses) {
    await prisma.leadStatus.upsert({
      where: {
        organizationId_name: {
          organizationId: org.id,
          name: s.name,
        },
      },
      update: { color: s.color, order: s.order, isDefault: s.isDefault },
      create: {
        organizationId: org.id,
        name: s.name,
        color: s.color,
        order: s.order,
        isDefault: s.isDefault,
      },
    });
  }
  console.log(`Default lead statuses provisioned.`);

  // 4. Default Lead Sources (including S6 from sample CSV)
  const sources = ['S6', 'Website', 'Referral', 'LinkedIn', 'Cold Call', 'Google Ads'];
  for (const name of sources) {
    await prisma.leadSource.upsert({
      where: {
        organizationId_name: {
          organizationId: org.id,
          name,
        },
      },
      update: {},
      create: {
        organizationId: org.id,
        name,
      },
    });
  }
  console.log(`Default lead sources provisioned.`);

  // 5. Default Countries (including Canada from sample CSV)
  const countries = [
    { name: 'Canada', isoCode: 'CA' },
    { name: 'United States', isoCode: 'US' },
    { name: 'United Kingdom', isoCode: 'GB' },
    { name: 'Australia', isoCode: 'AU' },
    { name: 'Germany', isoCode: 'DE' },
  ];

  for (const c of countries) {
    await prisma.country.upsert({
      where: { name: c.name },
      update: { isoCode: c.isoCode },
      create: {
        name: c.name,
        isoCode: c.isoCode,
      },
    });
  }
  console.log(`Default countries provisioned.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('Seed completed successfully.');
  })
  .catch(async (e) => {
    console.error('Seed error:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
