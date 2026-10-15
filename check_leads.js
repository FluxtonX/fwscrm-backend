const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.lead.count();
  console.log('Total leads:', count);
  const leads = await prisma.lead.findMany({
    select: { id: true, createdAt: true, organizationId: true, ownerId: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  console.log('Sample leads createdAt:');
  leads.forEach(l => console.log(l.id, l.createdAt.toISOString(), 'org:', l.organizationId, 'owner:', l.ownerId));
  
  const orgs = await prisma.organization.findMany();
  console.log('Orgs:', orgs);
}

main().catch(console.error).finally(() => prisma.$disconnect());
