import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionType } from '../../generated/prisma/client';
import { IsPositiveDecimalString } from '../../common/validators/is-positive-decimal-string.validator';

export class CreateTransactionDto {
  @ApiProperty({ enum: TransactionType })
  @IsEnum(TransactionType)
  type!: TransactionType;

  @ApiProperty({ example: '100.50', description: 'Positive decimal string, max 12 integer + 8 decimal digits' })
  @IsNotEmpty()
  @IsString()
  @IsPositiveDecimalString()
  amount!: string;

  @ApiProperty({ example: 'USD', maxLength: 10 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  currency!: string;

  @ApiPropertyOptional({ example: 'ACC-001' })
  @ValidateIf((o) => o.type === TransactionType.TRANSFER || o.type === TransactionType.WITHDRAWAL)
  @IsNotEmpty({ message: 'fromAccount is required for TRANSFER and WITHDRAWAL' })
  @IsString()
  @MaxLength(255)
  fromAccount?: string;

  @ApiPropertyOptional({ example: 'ACC-002' })
  @ValidateIf((o) => o.type === TransactionType.TRANSFER || o.type === TransactionType.DEPOSIT)
  @IsNotEmpty({ message: 'toAccount is required for TRANSFER and DEPOSIT' })
  @IsString()
  @MaxLength(255)
  toAccount?: string;

  @ApiPropertyOptional({ example: { note: 'Monthly transfer' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
