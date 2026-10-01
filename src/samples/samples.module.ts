import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { ESCALATION_QUEUE, EscalationProcessor } from './escalation.processor';
import { SamplesController } from './samples.controller';
import { SamplesService } from './samples.service';

@Module({
  imports: [BullModule.registerQueue({ name: ESCALATION_QUEUE })],
  controllers: [SamplesController, AlertsController],
  providers: [SamplesService, EscalationProcessor],
})
export class SamplesModule {}