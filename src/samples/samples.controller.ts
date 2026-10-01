import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateSampleDto } from './dto/create-sample.dto';
import { TransitionDto } from './dto/transition.dto';
import { SamplesService } from './samples.service';

@Controller('samples')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SamplesController {
  constructor(private samplesService: SamplesService) {}

  @Post()
  @Roles('FIELD_NURSE')
  create(@Body() dto: CreateSampleDto, @Req() req: { user: AuthUser }) {
    return this.samplesService.create(dto, req.user);
  }

  @Get()
  findAll() {
    return this.samplesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.samplesService.findOne(id);
  }

  @Patch(':id/status')
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionDto,
    @Req() req: { user: AuthUser },
  ) {
    return this.samplesService.transition(id, dto, req.user);
  }
}