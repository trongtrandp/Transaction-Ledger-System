import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ async: false })
export class IsPositiveDecimalStringConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;

    // Must match digits with optional decimal part (up to 8 places)
    if (!/^\d+(\.\d{1,8})?$/.test(value)) return false;

    // Reject leading zeros (except "0" or "0.xxx")
    if (/^0\d/.test(value)) return false;

    // Reject zero values
    if (/^0+(\.0+)?$/.test(value)) return false;

    // Enforce Decimal(20,8) bounds: max 12 integer digits + 8 decimal digits
    const [intPart] = value.split('.');
    if (intPart.length > 12) return false;

    return true;
  }

  defaultMessage(): string {
    return 'amount must be a positive decimal string (no leading zeros, up to 12 integer digits and 8 decimal places)';
  }
}

export function IsPositiveDecimalString(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsPositiveDecimalStringConstraint,
    });
  };
}
