import 'dotenv/config';
import { PrismaClient, SampleStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const PASSWORD = 'Demo1234!';

const FLOW: SampleStatus[] = [
  'COLLECTED',
  'IN_TRANSIT',
  'LAB_RECEIVED',
  'ANALYSIS_COMPLETE',
  'STORED',
];

async function main() {
  await prisma.alert.deleteMany();  
  await prisma.custodyEvent.deleteMany();
  await prisma.temperatureReading.deleteMany();
  await prisma.sample.deleteMany();
  await prisma.user.deleteMany();

  const hash = await bcrypt.hash(PASSWORD, 10);
  const nurse = await prisma.user.create({
    data: { email: 'nurse@demo.com', password: hash, role: 'FIELD_NURSE' },
  });
  const lab = await prisma.user.create({
    data: { email: 'lab@demo.com', password: hash, role: 'LAB_ANALYST' },
  });
  await prisma.user.create({
    data: { email: 'auditor@demo.com', password: hash, role: 'COMPLIANCE_AUDITOR' },
  });

  const actorFor = (to: SampleStatus) =>
    to === 'COLLECTED' || to === 'IN_TRANSIT' ? nurse.id : lab.id;

  async function seedSample(code: string, finalStatus: SampleStatus, readings: number[]) {
    const steps = FLOW.slice(0, FLOW.indexOf(finalStatus) + 1);
    const sample = await prisma.sample.create({
      data: { code, minTemp: 2, maxTemp: 8, status: finalStatus },
    });

    let from: SampleStatus | null = null;
    for (const to of steps) {
      await prisma.custodyEvent.create({
        data: { sampleId: sample.id, fromStatus: from, toStatus: to, actorId: actorFor(to) },
      });
      from = to;
    }

    for (const value of readings) {
      await prisma.temperatureReading.create({ data: { sampleId: sample.id, value } });
    }
  }

  await seedSample('DEMO-001', 'STORED', [4.1, 5.0, 4.6]);
  await seedSample('DEMO-002', 'ANALYSIS_COMPLETE', [3.9, 4.4]);
  await seedSample('DEMO-003', 'LAB_RECEIVED', [5.2, 6.1]);
  await seedSample('DEMO-004', 'IN_TRANSIT', [3.8, 4.5]);
  await seedSample('DEMO-005', 'COLLECTED', []);

  const bad = await prisma.sample.create({
    data: { code: 'DEMO-006', minTemp: 2, maxTemp: 8, status: 'COMPROMISED' },
  });
  await prisma.custodyEvent.createMany({
    data: [
      { sampleId: bad.id, fromStatus: null, toStatus: 'COLLECTED', actorId: nurse.id },
      { sampleId: bad.id, fromStatus: 'COLLECTED', toStatus: 'IN_TRANSIT', actorId: nurse.id },
      {
        sampleId: bad.id,
        fromStatus: 'IN_TRANSIT',
        toStatus: 'COMPROMISED',
        note: 'Temperature 8.7°C outside 2-8°C',
      },
    ],
  });
  await prisma.temperatureReading.createMany({
    data: [
      { sampleId: bad.id, value: 6.9 },
      { sampleId: bad.id, value: 8.7 },
    ],
  });

  console.log('Seeded 3 users and 6 samples. Password for all users:', PASSWORD);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());