// Barrel — all seed data + seed functions live under prisma/seeds/.
// prisma/seed.ts (the `db:seed` entry) imports from here, so no seed data
// lives outside this folder.
export { seedUsers } from './users.seed';
export { seedCustomers, customersSeedData } from './customers.seed';
export { seedStore, storeSeedData } from './store.seed';
export { seedCatalog, categorySeedData, productsSeedData } from './catalog.seed';
