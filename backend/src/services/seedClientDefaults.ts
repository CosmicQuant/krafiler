import { adminDb } from '../lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';

const WORK_SCHEDULES_COLLECTION = 'workSchedules';
const HOLIDAYS_COLLECTION = 'holidays';
const LEAVE_TYPES_COLLECTION = 'leaveTypes';

function generateEasterDate(year: number, type: 'fri' | 'mon'): string {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    const easterDate = new Date(year, month - 1, day);
    if (type === 'fri') easterDate.setDate(easterDate.getDate() - 2);
    if (type === 'mon') easterDate.setDate(easterDate.getDate() + 1);
    return easterDate.toISOString().split('T')[0];
}

function generateEidAlFitr(year: number): string {
    const eidDates: Record<number, string> = {
        2024: '2024-04-10', 2025: '2025-03-30', 2026: '2026-03-19',
        2027: '2027-03-08', 2028: '2028-02-26', 2029: '2029-02-15',
        2030: '2030-02-04',
    };
    return eidDates[year] || `${year}-03-15`;
}

/**
 * Auto-creates default work schedules for a client if none exist.
 * Returns true if any were created.
 */
export async function ensureDefaultWorkSchedules(uid: string, clientId: string): Promise<boolean> {
    const existing = await adminDb
        .collection(WORK_SCHEDULES_COLLECTION)
        .where('ownerUid', '==', uid)
        .where('clientId', '==', clientId)
        .limit(1)
        .get();

    if (!existing.empty) return false;

    const now = Timestamp.now();
    const defaults = [
        { name: 'Standard 5-Day (Mon-Fri)', config: JSON.stringify({ Mon: 8, Tue: 8, Wed: 8, Thu: 8, Fri: 8, Sat: 0, Sun: 0 }), standardCheckIn: '08:00', standardCheckOut: '17:00' },
        { name: 'Standard 6-Day (Mon-Sat Full)', config: JSON.stringify({ Mon: 8, Tue: 8, Wed: 8, Thu: 8, Fri: 8, Sat: 8, Sun: 0 }), standardCheckIn: '08:00', standardCheckOut: '17:00' },
        { name: 'Standard 6-Day (Mon-Sat Half)', config: JSON.stringify({ Mon: 8, Tue: 8, Wed: 8, Thu: 8, Fri: 8, Sat: 4, Sun: 0 }), standardCheckIn: '08:00', standardCheckOut: '17:00', saturdayCheckOut: '13:00' },
        { name: '6-Day Week (Sun-Fri)', config: JSON.stringify({ Mon: 8, Tue: 8, Wed: 8, Thu: 8, Fri: 8, Sat: 0, Sun: 8 }), standardCheckIn: '08:00', standardCheckOut: '17:00' },
        { name: '4-Day Week (Mon-Thu)', config: JSON.stringify({ Mon: 10, Tue: 10, Wed: 10, Thu: 10, Fri: 0, Sat: 0, Sun: 0 }), standardCheckIn: '08:00', standardCheckOut: '18:00' },
    ];

    for (const d of defaults) {
        await adminDb.collection(WORK_SCHEDULES_COLLECTION).add({
            ownerUid: uid,
            clientId,
            ...d,
            createdAt: now,
            updatedAt: now,
        });
    }
    return true;
}

/**
 * Auto-creates default holidays for a client if none exist.
 * Returns true if any were created.
 */
export async function ensureDefaultHolidays(uid: string, clientId: string): Promise<boolean> {
    const existing = await adminDb
        .collection(HOLIDAYS_COLLECTION)
        .where('ownerUid', '==', uid)
        .where('clientId', '==', clientId)
        .limit(1)
        .get();

    if (!existing.empty) return false;

    const year = new Date().getFullYear().toString();
    const y = parseInt(year, 10);
    const now = Timestamp.now();

    const defaults = [
        { name: "New Year's Day", date: `${year}-01-01`, isRecurring: true, holidayType: 'public' },
        { name: 'Labour Day', date: `${year}-05-01`, isRecurring: true, holidayType: 'public' },
        { name: 'Madaraka Day', date: `${year}-06-01`, isRecurring: true, holidayType: 'public' },
        { name: 'Huduma Day', date: `${year}-10-10`, isRecurring: true, holidayType: 'public' },
        { name: 'Mashujaa Day', date: `${year}-10-20`, isRecurring: true, holidayType: 'public' },
        { name: 'Jamhuri Day', date: `${year}-12-12`, isRecurring: true, holidayType: 'public' },
        { name: 'Christmas Day', date: `${year}-12-25`, isRecurring: true, holidayType: 'public' },
        { name: 'Boxing Day', date: `${year}-12-26`, isRecurring: true, holidayType: 'public' },
        { name: 'Good Friday', date: generateEasterDate(y, 'fri'), isRecurring: false, holidayType: 'public' },
        { name: 'Easter Monday', date: generateEasterDate(y, 'mon'), isRecurring: false, holidayType: 'public' },
        { name: 'Eid al-Fitr', date: generateEidAlFitr(y), isRecurring: false, holidayType: 'public' },
    ];

    for (const h of defaults) {
        await adminDb.collection(HOLIDAYS_COLLECTION).add({
            ownerUid: uid,
            clientId,
            name: h.name,
            date: h.date,
            isRecurring: h.isRecurring,
            holidayType: h.holidayType,
            createdAt: now,
            updatedAt: now,
        });
    }
    return true;
}

/**
 * Auto-creates default leave types for a client if none exist.
 * Returns true if any were created.
 */
export async function ensureDefaultLeaveTypes(uid: string, clientId: string): Promise<boolean> {
    const existing = await adminDb
        .collection(LEAVE_TYPES_COLLECTION)
        .where('ownerUid', '==', uid)
        .where('clientId', '==', clientId)
        .limit(1)
        .get();

    if (!existing.empty) return false;

    const now = Timestamp.now();
    const defaults = [
        { name: 'Annual Leave', maxDays: 21, isPaid: true },
        { name: 'Sick Leave', maxDays: 10, isPaid: true },
        { name: 'Maternity Leave', maxDays: 90, isPaid: true },
        { name: 'Paternity Leave', maxDays: 14, isPaid: true },
        { name: 'Compassionate Leave', maxDays: 5, isPaid: true },
        { name: 'Unpaid Leave', maxDays: 30, isPaid: false },
    ];

    for (const d of defaults) {
        await adminDb.collection(LEAVE_TYPES_COLLECTION).add({
            ownerUid: uid,
            clientId,
            name: d.name,
            maxDays: d.maxDays,
            isPaid: d.isPaid,
            createdAt: now,
            updatedAt: now,
        });
    }
    return true;
}

/**
 * Ensures all default data (work schedules, holidays, leave types) exists for a client.
 * Called lazily from GET endpoints.
 */
export async function ensureAllClientDefaults(uid: string, clientId: string): Promise<void> {
    await Promise.all([
        ensureDefaultWorkSchedules(uid, clientId),
        ensureDefaultHolidays(uid, clientId),
        ensureDefaultLeaveTypes(uid, clientId),
    ]);
}
