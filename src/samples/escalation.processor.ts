import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

export const ESCALATION_QUEUE = 'escalation';

@Processor(ESCALATION_QUEUE)
export class EscalationProcessor extends WorkerHost {
  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job<{ sampleId: string }>) {
    const sample = await this.prisma.sample.findUnique({
      where: { id: job.data.sampleId },
    });

    if (!sample || sample.status !== 'IN_TRANSIT') {
      return { escalated: false };
    }

    await this.prisma.alert.create({
      data: {
        sampleId: sample.id,
        message: `Sample ${sample.code} has been IN_TRANSIT longer than allowed`,
      },
    });
    return { escalated: true };
  }
}