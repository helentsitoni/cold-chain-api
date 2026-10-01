import { SampleStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class TransitionDto {
  @IsEnum(SampleStatus)
  toStatus: SampleStatus;

  @IsOptional()
  @IsString()
  note?: string;
}