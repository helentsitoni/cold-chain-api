import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSampleDto } from './dto/create-sample.dto';
import { TransitionDto } from './dto/transition.dto';
import { TRANSITIONS } from './state-machine';
import { CreateReadingDto } from './dto/create-reading.dto';.0

@Injectable()
export class SamplesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateSampleDto, user: AuthUser) {
    const existing = await this.prisma.sample.findUnique({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException('Sample code already exists');
    }

    return this.prisma.sample.create({
      data: {
        code: dto.code,
        minTemp: dto.minTemp,
        maxTemp: dto.maxTemp,
        events: { create: { toStatus: 'COLLECTED', actorId: user.sub } },
      },
      include: { events: true },
    });
  }

  findAll() {
    return this.prisma.sample.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const sample = await this.prisma.sample.findUnique({
      where: { id },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        readings: true,
      },
    });
    if (!sample) {
      throw new NotFoundException('Sample not found');
    }
    return sample;
  }

  async transition(id: string, dto: TransitionDto, user: AuthUser) {
    const sample = await this.findOne(id);

    const rule = TRANSITIONS.find(
      (r) => r.from === sample.status && r.to === dto.toStatus,
    );
    if (!rule) {
      throw new ConflictException(
        `Cannot move from ${sample.status} to ${dto.toStatus}`,
      );
    }
    if (!rule.roles.includes(user.role)) {
      throw new ForbiddenException(
        `Role ${user.role} cannot perform this transition`,
      );
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.sample.update({
        where: { id },
        data: { status: dto.toStatus },
      }),
      this.prisma.custodyEvent.create({
        data: {
          sampleId: id,
          fromStatus: sample.status,
          toStatus: dto.toStatus,
          actorId: user.sub,
          note: dto.note,
        },
      }),
    ]);
    return updated;
  }
    async addReading(id: string, dto: CreateReadingDto) {
    const sample = await this.findOne(id);
    if (sample.status !== 'IN_TRANSIT') {
      throw new ConflictException(
        'Readings are only accepted while IN_TRANSIT',
      );
    }

    const outOfRange =
      dto.value < sample.minTemp || dto.value > sample.maxTemp;

    if (!outOfRange) {
      const reading = await this.prisma.temperatureReading.create({
        data: { sampleId: id, value: dto.value },
      });
      return { reading, status: sample.status };
    }

    const [reading] = await this.prisma.$transaction([
      this.prisma.temperatureReading.create({
        data: { sampleId: id, value: dto.value },
      }),
      this.prisma.sample.update({
        where: { id },
        data: { status: 'COMPROMISED' },
      }),
      this.prisma.custodyEvent.create({
        data: {
          sampleId: id,
          fromStatus: 'IN_TRANSIT',
          toStatus: 'COMPROMISED',
          note: `Temperature ${dto.value}°C outside ${sample.minTemp}-${sample.maxTemp}°C`,
        },
      }),
    ]);
    return { reading, status: 'COMPROMISED' };
  }
}