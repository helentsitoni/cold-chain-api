import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../prisma/prisma.service';

@ApiBearerAuth()
@Controller('alerts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AlertsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @Roles('COMPLIANCE_AUDITOR')
  findAll() {
    return this.prisma.alert.findMany({
      orderBy: { createdAt: 'desc' },
      include: { sample: { select: { code: true, status: true } } },
    });
  }
}