// Subscription periods sold online.
//
// A month is billed as 30 days and a year as 365: twelve 30-day months would
// expire five days early, and the yearly plan is sold as "a year", not
// "360 days". Periods that are not in this table still work (months × 30),
// but the catalog only seeds 1 / 3 / 12.

const PERIOD_DAYS: Record<number, number> = { 1: 30, 3: 90, 12: 365 };

/** Days added to the subscription for a period in months. */
export function periodDays(months: number): number {
  return PERIOD_DAYS[months] ?? months * 30;
}

const MONTH_WORDS = ['месяц', 'месяца', 'месяцев'] as const;

function plural(n: number, words: readonly [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return words[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return words[1];
  return words[2];
}

/** «1 месяц», «3 месяца», «1 год» — invoice lines and owner notifications. */
export function periodLabel(months: number): string {
  if (months === 12) return '1 год';
  return `${months} ${plural(months, MONTH_WORDS)}`;
}
