import { PrismaClient, PricingType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// helper: rupees -> paise
const p = (rupees: number) => Math.round(rupees * 100);

async function main() {
  console.log('Seeding database...');

  await prisma.subService.deleteMany();
  await prisma.service.deleteMany();
  await prisma.serviceCategory.deleteMany();

  // Categories
  const cleaning = await prisma.serviceCategory.create({ data: { name: 'Cleaning', displayOrder: 1 } });
  const repairs = await prisma.serviceCategory.create({ data: { name: 'Repairs', displayOrder: 2 } });
  const homeCare = await prisma.serviceCategory.create({ data: { name: 'Home Care', displayOrder: 3 } });

  // 1. Plumber (Repairs) — packages + on-site quote capability
  const plumber = await prisma.service.create({
    data: {
      categoryId: repairs.id, name: 'Plumber', slug: 'plumber',
      description: 'Expert plumbers for leaks, fittings, taps & blockages.',
      longDescription: 'Certified, background-verified plumbers for every fix — from a dripping tap to complete bathroom fittings. Upfront pricing, quality spares and clean, tidy work.',
      imageUrl: '/images/plumber.webp', imageAlt: 'Uniformed Indian plumber fixing a tap in a modern home',
      hasSubServices: true, startingPrice: p(199), displayOrder: 1,
    },
  });
  await prisma.subService.createMany({ data: [
    { serviceId: plumber.id, name: 'Tap / Faucet Repair', description: 'Fix leaking or loose taps and mixers.', pricingType: PricingType.FIXED, basePrice: p(199), durationLabel: '30–45 min', imageUrl: '/images/plumber.webp', imageAlt: 'Plumber repairing a tap', displayOrder: 1 },
    { serviceId: plumber.id, name: 'Drain / Blockage Clearing', description: 'Unclog sinks, washbasins and floor drains.', pricingType: PricingType.FIXED, basePrice: p(349), durationLabel: '45–60 min', imageUrl: '/images/plumber.webp', imageAlt: 'Plumber clearing a blocked drain', displayOrder: 2 },
    { serviceId: plumber.id, name: 'Fitting Installation', description: 'Install taps, showers, health faucets & more.', pricingType: PricingType.FIXED, basePrice: p(449), originalPrice: p(549), durationLabel: '1–2 hrs', imageUrl: '/images/plumber.webp', imageAlt: 'Plumber installing a bathroom fitting', displayOrder: 3 },
  ]});

  // 2. Electrician (Repairs)
  const electrician = await prisma.service.create({
    data: {
      categoryId: repairs.id, name: 'Electrician', slug: 'electrician',
      description: 'Certified electricians for wiring, switches & repairs.',
      longDescription: 'Trained electricians for safe, reliable electrical work — switches, wiring, fans, lights and appliance installation, with genuine parts and neat finishing.',
      imageUrl: '/images/electrician.webp', imageAlt: 'Indian electrician working on a switchboard',
      hasSubServices: true, startingPrice: p(199), displayOrder: 2,
    },
  });
  await prisma.subService.createMany({ data: [
    { serviceId: electrician.id, name: 'Switch / Socket Repair', description: 'Repair or replace faulty switches & sockets.', pricingType: PricingType.FIXED, basePrice: p(199), durationLabel: '30–45 min', imageUrl: '/images/electrician.webp', imageAlt: 'Electrician repairing a switchboard', displayOrder: 1 },
    { serviceId: electrician.id, name: 'Fan Installation / Repair', description: 'Install or fix ceiling, wall & exhaust fans.', pricingType: PricingType.FIXED, basePrice: p(249), durationLabel: '45 min', imageUrl: '/images/electrician.webp', imageAlt: 'Electrician installing a fan', displayOrder: 2 },
    { serviceId: electrician.id, name: 'Wiring & Fault Inspection', description: 'Diagnose and fix wiring faults safely.', pricingType: PricingType.FIXED, basePrice: p(399), durationLabel: '1–2 hrs', imageUrl: '/images/electrician.webp', imageAlt: 'Electrician inspecting wiring', displayOrder: 3 },
  ]});

  // 3. Maid (Home Care) — hourly packages
  const maid = await prisma.service.create({
    data: {
      categoryId: homeCare.id, name: 'Maid', slug: 'maid',
      description: 'Reliable maids for daily cleaning & household help.',
      longDescription: 'Trusted, verified maids for daily household chores — sweeping, mopping, dusting, dishes and more. Flexible, punctual and background-checked.',
      imageUrl: '/images/maid.webp', imageAlt: 'Indian maid cleaning a modern living room',
      hasSubServices: true, startingPrice: p(299), displayOrder: 3,
    },
  });
  await prisma.subService.createMany({ data: [
    { serviceId: maid.id, name: 'Daily Help — 1 BHK', description: 'Sweeping, mopping, dusting & dishes for a 1 BHK.', pricingType: PricingType.FIXED, basePrice: p(299), durationLabel: '1 hr / visit', imageUrl: '/images/maid.webp', imageAlt: 'Maid cleaning a 1 BHK home', displayOrder: 1 },
    { serviceId: maid.id, name: 'Daily Help — 2 BHK', description: 'Full daily cleaning routine for a 2 BHK home.', pricingType: PricingType.FIXED, basePrice: p(449), durationLabel: '1.5 hr / visit', imageUrl: '/images/maid.webp', imageAlt: 'Maid cleaning a 2 BHK home', displayOrder: 2 },
    { serviceId: maid.id, name: 'Daily Help — 3 BHK', description: 'Comprehensive daily help for a 3 BHK home.', pricingType: PricingType.FIXED, basePrice: p(599), durationLabel: '2 hr / visit', imageUrl: '/images/maid.webp', imageAlt: 'Maid cleaning a 3 BHK home', displayOrder: 3 },
  ]});

  // 4. Deep Cleaning (Cleaning)
  const deep = await prisma.service.create({
    data: {
      categoryId: cleaning.id, name: 'Deep Cleaning', slug: 'deep-cleaning',
      description: 'Thorough deep cleaning for a spotless, fresh home.',
      longDescription: 'A top-to-bottom deep clean for your entire home using professional-grade equipment and safe, hygienic products. Choose the package that fits your home size.',
      imageUrl: '/images/deep-cleaning.webp', imageAlt: 'Professional team performing deep cleaning in a home',
      hasSubServices: true, startingPrice: p(1499), displayOrder: 4,
    },
  });
  await prisma.subService.createMany({ data: [
    { serviceId: deep.id, name: '1 BHK Full Home Cleaning', description: 'Complete deep clean of a 1 BHK — every room & corner.', pricingType: PricingType.FIXED, basePrice: p(1499), originalPrice: p(1799), durationLabel: '3–4 hrs', imageUrl: '/images/deep-cleaning.webp', imageAlt: 'Deep cleaning a 1 BHK home', displayOrder: 1 },
    { serviceId: deep.id, name: '2 BHK Full Home Cleaning', description: 'Thorough deep clean of a 2 BHK home end-to-end.', pricingType: PricingType.FIXED, basePrice: p(2199), originalPrice: p(2599), durationLabel: '4–5 hrs', imageUrl: '/images/deep-cleaning.webp', imageAlt: 'Deep cleaning a 2 BHK home', displayOrder: 2 },
    { serviceId: deep.id, name: '3 BHK Full Home Cleaning', description: 'Full deep clean of a spacious 3 BHK home.', pricingType: PricingType.FIXED, basePrice: p(2999), originalPrice: p(3499), durationLabel: '5–6 hrs', imageUrl: '/images/deep-cleaning.webp', imageAlt: 'Deep cleaning a 3 BHK home', displayOrder: 3 },
    { serviceId: deep.id, name: 'Bathroom Deep Cleaning (1 Bathroom)', description: 'Intensive scrub & sanitisation for one bathroom.', pricingType: PricingType.FIXED, basePrice: p(449), durationLabel: '45–60 min', imageUrl: '/images/bathroom-cleaning.webp', imageAlt: 'Deep cleaning one bathroom', displayOrder: 4 },
    { serviceId: deep.id, name: 'Bathroom Deep Cleaning (2 Bathrooms)', description: 'Deep clean & sanitise two bathrooms.', pricingType: PricingType.FIXED, basePrice: p(799), durationLabel: '1.5 hrs', imageUrl: '/images/bathroom-cleaning.webp', imageAlt: 'Deep cleaning two bathrooms', displayOrder: 5 },
  ]});

  // 5. AC Service (Repairs)
  const ac = await prisma.service.create({
    data: {
      categoryId: repairs.id, name: 'AC Service', slug: 'ac-service',
      description: 'Servicing, gas refill & repair for all AC types.',
      longDescription: 'Keep your AC cooling efficiently with expert servicing, gas top-up and repairs for split, window and cassette units — handled by trained technicians.',
      imageUrl: '/images/ac-service.webp', imageAlt: 'Indian technician servicing a split air conditioner',
      hasSubServices: true, startingPrice: p(499), displayOrder: 5,
    },
  });
  await prisma.subService.createMany({ data: [
    { serviceId: ac.id, name: 'AC Basic Service', description: 'Filter cleaning, coil wash & performance check.', pricingType: PricingType.FIXED, basePrice: p(499), durationLabel: '45–60 min', imageUrl: '/images/ac-service.webp', imageAlt: 'Technician performing basic AC service', displayOrder: 1 },
    { serviceId: ac.id, name: 'AC Deep Jet Service', description: 'High-pressure jet cleaning for maximum cooling.', pricingType: PricingType.FIXED, basePrice: p(699), originalPrice: p(849), durationLabel: '1 hr', imageUrl: '/images/ac-service.webp', imageAlt: 'Technician deep-cleaning an AC unit', displayOrder: 2 },
    { serviceId: ac.id, name: 'AC Gas Refill', description: 'Refrigerant top-up with leak check (all types).', pricingType: PricingType.FIXED, basePrice: p(1999), durationLabel: '1–2 hrs', imageUrl: '/images/ac-service.webp', imageAlt: 'Technician refilling AC gas', displayOrder: 3 },
  ]});

  // 6. Bathroom Cleaning (Cleaning) — directly bookable, no sub-services
  await prisma.service.create({
    data: {
      categoryId: cleaning.id, name: 'Bathroom Cleaning', slug: 'bathroom-cleaning',
      description: 'Deep scrub for sparkling tiles, fittings & sanitaryware.',
      longDescription: 'A single, no-fuss bathroom deep-clean at a flat price — descaling, sanitising and polishing of tiles, fittings and sanitaryware. Directly bookable, no packages to choose.',
      imageUrl: '/images/bathroom-cleaning.webp', imageAlt: 'Indian professional deep-cleaning a modern bathroom',
      hasSubServices: false, pricingType: PricingType.FIXED, basePrice: p(449), durationLabel: '45–60 min',
      startingPrice: p(449), displayOrder: 6,
    },
  });

  // 7. Sofa Cleaning (Cleaning)
  const sofa = await prisma.service.create({
    data: {
      categoryId: cleaning.id, name: 'Sofa Cleaning', slug: 'sofa-cleaning',
      description: 'Shampoo & steam cleaning for fresh, hygienic upholstery.',
      longDescription: 'Professional shampoo and steam cleaning for your upholstery. Pick the package by number of seats.',
      imageUrl: '/images/sofa-cleaning.webp', imageAlt: 'Indian professional shampooing a fabric sofa',
      hasSubServices: true, startingPrice: p(399), displayOrder: 7,
    },
  });
  await prisma.subService.createMany({ data: [
    { serviceId: sofa.id, name: 'Sofa Cleaning — 3 Seater', description: 'Shampoo & steam clean for a 3-seater sofa.', pricingType: PricingType.FIXED, basePrice: p(399), durationLabel: '45 min', imageUrl: '/images/sofa-cleaning.webp', imageAlt: 'Cleaning a 3 seater sofa', displayOrder: 1 },
    { serviceId: sofa.id, name: 'Sofa Cleaning — 5 Seater', description: 'Deep clean for a 5-seater sofa set.', pricingType: PricingType.FIXED, basePrice: p(649), originalPrice: p(799), durationLabel: '1 hr', imageUrl: '/images/sofa-cleaning.webp', imageAlt: 'Cleaning a 5 seater sofa', displayOrder: 2 },
    { serviceId: sofa.id, name: 'Sofa Cleaning — 7 Seater', description: 'Complete upholstery clean for large sofa sets.', pricingType: PricingType.FIXED, basePrice: p(899), originalPrice: p(1099), durationLabel: '1.5 hrs', imageUrl: '/images/sofa-cleaning.webp', imageAlt: 'Cleaning a 7 seater sofa', displayOrder: 3 },
  ]});

  // 8. Kitchen Cleaning (Cleaning) — directly bookable
  await prisma.service.create({
    data: {
      categoryId: cleaning.id, name: 'Kitchen Cleaning', slug: 'kitchen-cleaning',
      description: 'Grease-free countertops, chimney & stove deep clean.',
      longDescription: 'A flat-price kitchen deep clean — degreasing of countertops, chimney, stove, cabinets and tiles. Directly bookable with no packages to pick.',
      imageUrl: '/images/kitchen-cleaning.webp', imageAlt: 'Indian professional deep-cleaning a modern kitchen',
      hasSubServices: false, pricingType: PricingType.FIXED, basePrice: p(599), durationLabel: '1.5–2 hrs',
      startingPrice: p(599), displayOrder: 8,
    },
  });

  // Serviceable pincodes (launch area around Jawahar Nagar, Hyderabad)
  await prisma.serviceablePincode.deleteMany();
  await prisma.serviceablePincode.createMany({
    data: [
      { pincode: '500087', areaName: 'Jawahar Nagar / BJR Nagar', city: 'Hyderabad' },
      { pincode: '500062', areaName: 'Kapra', city: 'Hyderabad' },
      { pincode: '500047', areaName: 'Nacharam', city: 'Hyderabad' },
      { pincode: '500094', areaName: 'AS Rao Nagar', city: 'Hyderabad' },
    ],
  });

  // --- Seed a test admin (staff use password login) ---
  const adminEmail = 'admin@easybreezy.test';
  const adminPasswordHash = await bcrypt.hash('Admin@123', 10);
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
  console.log(`Seeded admin: ${adminEmail} / Admin@123`);
  console.log('Seeding complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
