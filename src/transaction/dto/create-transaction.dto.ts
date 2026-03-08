import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionType } from '../../generated/prisma/client';

export class CreateTransactionDto {
  @ApiProperty({ enum: TransactionType })
  @IsEnum(TransactionType)
  type!: TransactionType;

  @ApiProperty({ example: '100.50', description: 'Decimal string, max 8 decimal places' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d+(\.\d{1,8})?$/, { message: 'amount must be a positive decimal string with up to 8 decimal places' })
  amount!: string;

  @ApiProperty({ example: 'USD', maxLength: 10 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  currency!: string;

  @ApiPropertyOptional({ example: 'ACC-001' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fromAccount?: string;

  @ApiPropertyOptional({ example: 'ACC-002' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  toAccount?: string;

  @ApiPropertyOptional({ example: { note: 'Monthly transfer' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
