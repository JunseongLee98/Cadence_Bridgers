export function formatDateToLocalISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Format a stored due date for UI without UTC date-only parsing shifts. */
export function formatLocalDateForDisplay(date: Date, locale: string): string {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return local.toLocaleDateString(locale);
}

/** Parse `YYYY-MM-DD` as local midnight (avoids UTC-only parsing from `new Date(iso)`). */
export function parseLocalDateInput(isoDate: string): Date {
  const parts = isoDate.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Last instant of the task due calendar day in local time (23:59:59.999). */
export function endOfLocalCalendarDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

