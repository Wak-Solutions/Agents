/**
 * Booking slot utilities.
 */

import type { WorkHours } from '../routes/settings.routes';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseHourStr(t: string): number {
  if (t === '00:00') return 24;
  return parseInt(t.split(':')[0], 10);
}

/**
 * Return bookable hour slots for a given day using company work hours.
 *
 * Returns an empty array when the day is not a working day.
 * "00:00" slot represents midnight (h=24 in UTC conversion math).
 */
export function getSlotsForDay(ksaDayOfWeek: number, workHours?: WorkHours): string[] {
  const dayName = DAY_NAMES[ksaDayOfWeek];

  if (workHours) {
    if (!workHours.days.includes(dayName)) return [];
    const startH = parseHourStr(workHours.start);
    const endH   = parseHourStr(workHours.end);
    const slots: string[] = [];
    for (let h = startH; h < endH; h++) {
      slots.push(h === 24 ? '00:00' : `${String(h).padStart(2, '0')}:00`);
    }
    // Allow midnight slot if end is exactly 00:00 (interpreted as 24:00)
    return slots;
  }

  // Legacy fallback: pre-work-hours behaviour (Friday short day, all others 07:00–00:00)
  const start = ksaDayOfWeek === 5 ? 17 : 7; // 5 = Friday
  const slots: string[] = [];
  for (let h = start; h <= 23; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
  }
  slots.push('00:00');
  return slots;
}

/**
 * Check whether a KSA date+time slot falls within the given work hours.
 *
 * ksaDate: 'YYYY-MM-DD' in the company's local date
 * ksaTime: 'HH:00' in the company's local time
 */
export function isWithinWorkHours(ksaDate: string, ksaTime: string, wh: WorkHours): boolean {
  const d = new Date(ksaDate + 'T00:00:00Z');
  const dayName = DAY_NAMES[d.getUTCDay()];
  if (!wh.days.includes(dayName)) return false;

  const slotH  = ksaTime === '00:00' ? 24 : parseInt(ksaTime.split(':')[0], 10);
  const startH = parseHourStr(wh.start);
  const endH   = parseHourStr(wh.end);

  return slotH >= startH && slotH < endH;
}
