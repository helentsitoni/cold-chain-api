import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateSampleDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsNumber()
  minTemp: number;

  @IsNumber()
  maxTemp: number;
}