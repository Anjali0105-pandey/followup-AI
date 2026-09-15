import { seed } from "../lib/seed/seed";

const result = await seed();
console.log("Seeded FollowUp AI demo workspace:");
console.log(`  ${result.customers} customers`);
console.log(`  ${result.opportunities} opportunities`);
console.log(`  ${result.interactions} interactions`);
console.log(`  ${result.signals} signals`);
console.log(`  ${result.commitments} commitments`);

// The pg pool holds the process open otherwise.
process.exit(0);
