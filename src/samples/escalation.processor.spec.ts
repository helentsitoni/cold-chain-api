import { Test } from '@nestjs/testing';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { EscalationProcessor } from './escalation.processor';

describe('EscalationProcessor', () => {
  let processor: EscalationProcessor;
  let prisma: {
    sample: { findUnique: jest.Mock };
    alert: { create: jest.Mock };
  };
  const job = { data: { sampleId: 's1' } } as Job<{ sampleId: string }>;

  beforeEach(async () => {
    prisma = {
      sample: { findUnique: jest.fn() },
      alert: { create: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [EscalationProcessor, { provide: PrismaService, useValue: prisma }],
    }).compile();

    processor = moduleRef.get(EscalationProcessor);
  });

  it('creates an alert if the sample is still IN_TRANSIT', async () => {
    prisma.sample.findUnique.mockResolvedValue({ id: 's1', code: 'S-001', status: 'IN_TRANSIT' });

    const result = await processor.process(job);

    expect(result).toEqual({ escalated: true });
    expect(prisma.alert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sampleId: 's1',
        message: expect.stringContaining('S-001'),
      }),
    });
  });

  it('does nothing if the sample has already moved on', async () => {
    prisma.sample.findUnique.mockResolvedValue({ id: 's1', code: 'S-001', status: 'LAB_RECEIVED' });

    const result = await processor.process(job);

    expect(result).toEqual({ escalated: false });
    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  it('does nothing if the sample no longer exists', async () => {
    prisma.sample.findUnique.mockResolvedValue(null);

    const result = await processor.process(job);

    expect(result).toEqual({ escalated: false });
    expect(prisma.alert.create).not.toHaveBeenCalled();
  });
});