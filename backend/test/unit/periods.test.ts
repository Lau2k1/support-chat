import { describe, it, expect } from 'vitest';
import { periodDays, periodLabel } from '../../src/utils/periods';

describe('periodDays', () => {
  it('bills a month as 30 days and a quarter as 90', () => {
    expect(periodDays(1)).toBe(30);
    expect(periodDays(3)).toBe(90);
  });

  it('bills a year as 365 days, not as twelve 30-day months', () => {
    expect(periodDays(12)).toBe(365);
  });

  it('falls back to months × 30 for periods outside the catalog', () => {
    expect(periodDays(6)).toBe(180);
  });
});

describe('periodLabel', () => {
  it('uses the right Russian form for months', () => {
    expect(periodLabel(1)).toBe('1 месяц');
    expect(periodLabel(3)).toBe('3 месяца');
    expect(periodLabel(6)).toBe('6 месяцев');
  });

  it('calls a twelve-month period a year', () => {
    expect(periodLabel(12)).toBe('1 год');
  });
});
