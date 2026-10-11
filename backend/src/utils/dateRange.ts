// Date-range helpers for the chat filters.
//
// The UI sends date-only strings ("YYYY-MM-DD") from the date pickers. SQL
// `created_at <= 'YYYY-MM-DD'` compares against midnight, so chats created
// later that same day were silently dropped ("нет инфы за сегодня"). These
// helpers widen a date-only bound to the corresponding edge of the day.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Date-only → start of that day; full timestamps pass through unchanged. */
export function startOfDay(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  return DATE_ONLY.test(value) ? `${value} 00:00:00` : value;
}

/** Date-only → end of that day (23:59:59.999); timestamps pass through. */
export function endOfDay(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  return DATE_ONLY.test(value) ? `${value} 23:59:59.999` : value;
}
