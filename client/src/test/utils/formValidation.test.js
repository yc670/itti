import { describe, it, expect } from 'vitest';
import {
  checkEmail,
  checkPassword,
  checkPasswordsMatch,
  checkName,
  checkSearchQuery,
  checkReportTitle,
  checkReportDescription,
  checkReportCombinedSize,
  checkReportCategory,
  checkDonationAmount,
  runCheck,
  validateAll,
  MAX_REPORT_COMBINED_BYTES,
} from '../../utils/formValidation.js';

describe('checkEmail', () => {
  it('rejects an empty value', () => {
    expect(checkEmail('')).toBe('Email is required.');
  });

  it('rejects a value with no @', () => {
    expect(checkEmail('notanemail')).toMatch(/valid email/i);
  });

  it('rejects a value with no domain dot', () => {
    expect(checkEmail('a@b')).toMatch(/valid email/i);
  });

  it('rejects an absurdly long email', () => {
    const longEmail = `${'a'.repeat(250)}@example.com`;
    expect(checkEmail(longEmail)).toMatch(/too long/i);
  });

  it('accepts a normal email', () => {
    expect(checkEmail('person@example.com')).toBeNull();
  });
});

describe('checkPassword', () => {
  it('rejects an empty password', () => {
    expect(checkPassword('')).toBe('Password is required.');
  });

  it('rejects a password under 8 characters', () => {
    expect(checkPassword('short')).toMatch(/at least 8/i);
  });

  it('rejects a password over 128 characters', () => {
    expect(checkPassword('a'.repeat(129))).toMatch(/under 128/i);
  });

  it('accepts a password in the valid range', () => {
    expect(checkPassword('password123')).toBeNull();
  });
});

describe('checkPasswordsMatch', () => {
  it('rejects mismatched passwords', () => {
    expect(checkPasswordsMatch('abc123', 'abc124')).toMatch(/do not match/i);
  });

  it('accepts matching passwords', () => {
    expect(checkPasswordsMatch('abc123', 'abc123')).toBeNull();
  });
});

describe('checkName', () => {
  it('rejects an empty name', () => {
    expect(checkName('')).toMatch(/cannot be empty/i);
  });

  it('rejects a name that is only whitespace', () => {
    expect(checkName('   ')).toMatch(/cannot be empty/i);
  });

  it('rejects an overly long name', () => {
    expect(checkName('a'.repeat(101))).toMatch(/under 100/i);
  });

  it('accepts a normal name', () => {
    expect(checkName('Jane Doe')).toBeNull();
  });
});

describe('checkSearchQuery', () => {
  it('allows an empty query (means "no filter", not an error)', () => {
    expect(checkSearchQuery('')).toBeNull();
    expect(checkSearchQuery(null)).toBeNull();
  });

  it('rejects a query with disallowed characters', () => {
    expect(checkSearchQuery('<script>alert(1)</script>')).not.toBeNull();
  });

  it('rejects control characters', () => {
    expect(checkSearchQuery('abc\x00def')).toMatch(/aren't allowed/i);
  });

  it('accepts a normal place-name-style query', () => {
    expect(checkSearchQuery("Cote d'Ivoire")).toBeNull();
  });

  it('accepts letters, numbers, and basic punctuation', () => {
    expect(checkSearchQuery('Region 5 (North), Sub-area')).toBeNull();
  });
});

describe('checkReportTitle', () => {
  it('rejects an empty title', () => {
    expect(checkReportTitle('')).toMatch(/required/i);
  });

  it('rejects an overly long title', () => {
    expect(checkReportTitle('a'.repeat(201))).toMatch(/under 200/i);
  });

  it('accepts a normal title', () => {
    expect(checkReportTitle('A Study on Regional Trauma Patterns')).toBeNull();
  });
});

describe('checkReportDescription', () => {
  it('rejects an empty description', () => {
    expect(checkReportDescription('')).toMatch(/required/i);
  });

  it('rejects an overly long description', () => {
    expect(checkReportDescription('a'.repeat(201))).toMatch(/under 200/i);
  });
});

describe('checkReportCombinedSize', () => {
  it('accepts a small file with no image', () => {
    const file = { size: 1000 };
    expect(checkReportCombinedSize(file, null)).toBeNull();
  });

  it('rejects when file + image together exceed the limit', () => {
    const file = { size: MAX_REPORT_COMBINED_BYTES };
    const image = { size: 1000 };
    expect(checkReportCombinedSize(file, image)).toMatch(/must be under/i);
  });

  it('handles missing file/image gracefully', () => {
    expect(checkReportCombinedSize(null, null)).toBeNull();
  });
});

describe('checkReportCategory', () => {
  it('rejects an empty category', () => {
    expect(checkReportCategory('')).toMatch(/required/i);
  });

  it('rejects a category not in REPORT_CATEGORIES', () => {
    expect(checkReportCategory('Not A Real Category')).toMatch(/not a recognized/i);
  });

  it('accepts a real category', () => {
    expect(checkReportCategory('Research Publication')).toBeNull();
  });
});

describe('checkDonationAmount', () => {
  it('rejects null/NaN', () => {
    expect(checkDonationAmount(null)).toMatch(/choose an amount/i);
    expect(checkDonationAmount(NaN)).toMatch(/choose an amount/i);
  });

  it('rejects an amount below the minimum', () => {
    expect(checkDonationAmount(0.5)).toMatch(/minimum donation/i);
  });

  it('rejects an amount above the maximum', () => {
    expect(checkDonationAmount(200000)).toMatch(/aren't supported online/i);
  });

  it('accepts a normal donation amount', () => {
    expect(checkDonationAmount(50)).toBeNull();
  });
});

describe('runCheck', () => {
  it('dispatches to the right check by name', () => {
    expect(runCheck('email', 'bad')).not.toBeNull();
    expect(runCheck('email', 'good@example.com')).toBeNull();
  });

  it('throws for an unknown check name', () => {
    expect(() => runCheck('notARealCheck', 'value')).toThrow();
  });
});

describe('validateAll', () => {
  it('returns the first error encountered', () => {
    const error = validateAll([
      ['email', 'not-an-email'],
      ['password', 'short'],
    ]);
    expect(error).toMatch(/valid email/i);
  });

  it('returns null when every field passes', () => {
    const error = validateAll([
      ['email', 'good@example.com'],
      ['password', 'password123'],
    ]);
    expect(error).toBeNull();
  });

  it('checks fields in order - a later field is only reached if earlier ones pass', () => {
    const error = validateAll([
      ['email', 'good@example.com'],
      ['password', 'short'],
    ]);
    expect(error).toMatch(/at least 8/i);
  });
});
