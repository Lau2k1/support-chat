import { describe, it, expect } from 'vitest';
import { startOfDay, endOfDay } from '../../src/utils/dateRange';

describe('startOfDay', () => {
  it('widens a date-only value to midnight', () => {
    expect(startOfDay('2024-03-05')).toBe('2024-03-05 00:00:00');
  });

  it('passes full timestamps through unchanged', () => {
    expect(startOfDay('2024-03-05 12:34:56')).toBe('2024-03-05 12:34:56');
  });

  it('returns null for empty or non-string input', () => {
    expect(startOfDay('')).toBeNull();
    expect(startOfDay(undefined)).toBeNull();
    expect(startOfDay(123)).toBeNull();
  });
});

describe('endOfDay', () => {
  it('widens a date-only value to the end of the day', () => {
    expect(endOfDay('2024-03-05')).toBe('2024-03-05 23:59:59.999');
  });

  it('passes full timestamps through unchanged', () => {
    expect(endOfDay('2024-03-05 12:34:56')).toBe('2024-03-05 12:34:56');
  });

  it('returns null for empty or non-string input', () => {
    expect(endOfDay('')).toBeNull();
    expect(endOfDay(null)).toBeNull();
  });
});
