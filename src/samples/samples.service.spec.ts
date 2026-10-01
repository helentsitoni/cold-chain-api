import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { SamplesService } from './samples.service';

const nurse = { sub: 'nurse-1', role: 'FIELD_NURSE' as const };
const lab = { sub: 'lab-1', role: 'LAB_ANALYST' as const };

const sample = (status: string) => ({
  id: 's1',
  code: 'S-001',
  status,
  minTemp: 2,
  maxTemp: 8,
  createdAt: new Date(),
  events: [],
  readings: [],
});

describe('SamplesService', () => {
  let service: SamplesService;
  let queue: { add: jest.Mock };
  let prisma: {
    sample: { findUnique: jest.Mock; update: jest.Mock; create: jest.Mock };
    custodyEvent: { create: jest.Mock };
    temperatureReading: { create: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    queue = { add: jest.fn() };
    prisma = {
      sample: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
      custodyEvent: { create: jest.fn() },
      temperatureReading: { create: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SamplesService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken('escalation'), useValue: queue },
      ],
    }).compile();

    service = moduleRef.get(SamplesService);
  });

  describe('transition', () => {
    it('lets a nurse move COLLECTED to IN_TRANSIT, writes an event and schedules escalation', async () => {
      prisma.sample.findUnique.mockResolvedValue(sample('COLLECTED'));
      prisma.sample.update.mockResolvedValue(sample('IN_TRANSIT'));

      const result = await service.transition('s1', { toStatus: 'IN_TRANSIT' }, nurse);

      expect(result.status).toBe('IN_TRANSIT');
      expect(prisma.custodyEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fromStatus: 'COLLECTED',
          toStatus: 'IN_TRANSIT',
          actorId: 'nurse-1',
        }),
      });
      expect(queue.add).toHaveBeenCalledWith(
        'check-transit',
        { sampleId: 's1' },
        expect.objectContaining({ jobId: 'transit-s1' }),
      );
    });

    it('does not schedule escalation for other transitions', async () => {
      prisma.sample.findUnique.mockResolvedValue(sample('IN_TRANSIT'));
      prisma.sample.update.mockResolvedValue(sample('LAB_RECEIVED'));

      await service.transition('s1', { toStatus: 'LAB_RECEIVED' }, lab);

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('rejects skipping a step with 409', async () => {
      prisma.sample.findUnique.mockResolvedValue(sample('COLLECTED'));

      await expect(
        service.transition('s1', { toStatus: 'LAB_RECEIVED' }, nurse),
      ).rejects.toThrow(ConflictException);
      expect(prisma.sample.update).not.toHaveBeenCalled();
    });

    it('rejects the wrong role with 403', async () => {
      prisma.sample.findUnique.mockResolvedValue(sample('COLLECTED'));

      await expect(
        service.transition('s1', { toStatus: 'IN_TRANSIT' }, lab),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.sample.update).not.toHaveBeenCalled();
    });

    it('rejects any move out of COMPROMISED', async () => {
      prisma.sample.findUnique.mockResolvedValue(sample('COMPROMISED'));

      await expect(
        service.transition('s1', { toStatus: 'LAB_RECEIVED' }, lab),
      ).rejects.toThrow(ConflictException);
    });

    it('returns 404 when the sample does not exist', async () => {
      prisma.sample.findUnique.mockResolvedValue(null);

      await expect(
        service.transition('missing', { toStatus: 'IN_TRANSIT' }, nurse),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('addReading', () => {
    it('keeps the sample IN_TRANSIT for 6.4 °C', async () => {
      prisma.sample.findUnique.mockResolvedValue(sample('IN_TRANSIT'));
      prisma.temperatureReading.create.mockResolvedValue({ id: 'r1', value: 6.4 });

      const result = await service.addReading('s1', { value: 6.4 });

      expect(result.status).toBe('IN_TRANSIT');
      expect(prisma.sample.update).not.toHaveBeenCalled();
    });

    it('accepts exactly 8 °C as within range', async () => {
      prisma.sample.findUnique.mockResolvedValue(sample('IN_TRANSIT'));
      prisma.temperatureReading.create.mockResolvedValue({ id: 'r1', value: 8 });

      const result = await service.addReading('s1', { value: 8 });

      expect(result.status).toBe('IN_TRANSIT');
    });

    it('marks the sample COMPROMISED for 9.1 °C', async () => {
      prisma.sample.findUnique.mockResolvedValue(sample('IN_TRANSIT'));
      prisma.temperatureReading.create.mockResolvedValue({ id: 'r1', value: 9.1 });

      const result = await service.addReading('s1', { value: 9.1 });

      expect(result.status).toBe('COMPROMISED');
      expect(prisma.sample.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { status: 'COMPROMISED' },
      });
      expect(prisma.custodyEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          toStatus: 'COMPROMISED',
          note: expect.stringContaining('9.1'),
        }),
      });
    });

    it('marks the sample COMPROMISED for 1.5 °C (below minimum)', async () => {
      prisma.sample.findUnique.mockResolvedValue(sample('IN_TRANSIT'));
      prisma.temperatureReading.create.mockResolvedValue({ id: 'r1', value: 1.5 });

      const result = await service.addReading('s1', { value: 1.5 });

      expect(result.status).toBe('COMPROMISED');
    });

    it('rejects readings when the sample is not IN_TRANSIT', async () => {
      prisma.sample.findUnique.mockResolvedValue(sample('COLLECTED'));

      await expect(service.addReading('s1', { value: 5 })).rejects.toThrow(
        ConflictException,
      );
    });
  });
});