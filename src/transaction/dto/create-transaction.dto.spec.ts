import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateTransactionDto } from './create-transaction.dto';
import { TransactionType } from '../../generated/prisma/client';

function toDto(plain: Record<string, unknown>): CreateTransactionDto {
  return plainToInstance(CreateTransactionDto, plain);
}

async function expectValid(plain: Record<string, unknown>) {
  const errors = await validate(toDto(plain));
  expect(errors).toHaveLength(0);
}

async function expectInvalid(plain: Record<string, unknown>, property: string) {
  const errors = await validate(toDto(plain));
  const props = errors.map((e) => e.property);
  expect(props).toContain(property);
}

describe('CreateTransactionDto', () => {
  const validTransfer = {
    type: TransactionType.TRANSFER,
    amount: '100.50',
    currency: 'USD',
    fromAccount: 'ACC-001',
    toAccount: 'ACC-002',
  };

  describe('valid payloads', () => {
    it('should accept valid TRANSFER', async () => {
      await expectValid(validTransfer);
    });

    it('should accept valid DEPOSIT (toAccount only)', async () => {
      await expectValid({
        type: TransactionType.DEPOSIT,
        amount: '50',
        currency: 'USD',
        toAccount: 'ACC-001',
      });
    });

    it('should accept valid WITHDRAWAL (fromAccount only)', async () => {
      await expectValid({
        type: TransactionType.WITHDRAWAL,
        amount: '25.12345678',
        currency: 'EUR',
        fromAccount: 'ACC-001',
      });
    });
  });

  describe('conditional account validation', () => {
    it('should reject TRANSFER without fromAccount', async () => {
      await expectInvalid({ ...validTransfer, fromAccount: undefined }, 'fromAccount');
    });

    it('should reject TRANSFER without toAccount', async () => {
      await expectInvalid({ ...validTransfer, toAccount: undefined }, 'toAccount');
    });

    it('should reject DEPOSIT without toAccount', async () => {
      await expectInvalid({
        type: TransactionType.DEPOSIT,
        amount: '10',
        currency: 'USD',
      }, 'toAccount');
    });

    it('should reject WITHDRAWAL without fromAccount', async () => {
      await expectInvalid({
        type: TransactionType.WITHDRAWAL,
        amount: '10',
        currency: 'USD',
      }, 'fromAccount');
    });
  });

  describe('IsPositiveDecimalString', () => {
    it('should reject zero amount', async () => {
      await expectInvalid({ ...validTransfer, amount: '0' }, 'amount');
    });

    it('should reject leading zeros', async () => {
      await expectInvalid({ ...validTransfer, amount: '01.5' }, 'amount');
    });

    it('should reject negative-like string', async () => {
      await expectInvalid({ ...validTransfer, amount: '-10' }, 'amount');
    });

    it('should reject too many decimal places', async () => {
      await expectInvalid({ ...validTransfer, amount: '1.123456789' }, 'amount');
    });

    it('should reject more than 12 integer digits', async () => {
      await expectInvalid({ ...validTransfer, amount: '1234567890123' }, 'amount');
    });

    it('should accept max precision amount', async () => {
      await expectValid({ ...validTransfer, amount: '999999999999.12345678' });
    });
  });
});
