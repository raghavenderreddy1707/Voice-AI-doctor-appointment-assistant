import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type {
  Appointment,
  DoctorWithSlots,
  SchedulePayload,
  TimeSlot,
} from '../types.ts';

const DB_PATH = path.resolve(
  process.cwd(),
  process.env.CLINIC_DB_PATH || 'data/clinic.db'
);

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    specialty TEXT NOT NULL,
    room TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    is_booked INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
    doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    caller_phone TEXT NOT NULL,
    caller_phone_formatted TEXT NOT NULL,
    caller_name TEXT,
    status TEXT NOT NULL DEFAULT 'confirmed',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_slots_doctor_date ON slots(doctor_id, date);
  CREATE INDEX IF NOT EXISTS idx_appointments_phone_status ON appointments(caller_phone, status);
`);

export function getLocalDateString(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTime12h(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr || '0');
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
}

export function formatPhone(raw: string): string {
  const digits = normalizePhone(raw);
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 7) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  return digits || raw.trim();
}

export function parseTimeTo24h(input?: string | null): string | null {
  if (!input) return null;
  const cleaned = input.trim().toLowerCase().replace(/\./g, '');
  const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  const meridiem = match[3];
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function resolveDateInput(input?: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (trimmed === 'today') return getLocalDateString(0);
  if (trimmed === 'tomorrow') return getLocalDateString(1);
  if (trimmed.includes('day after')) return getLocalDateString(2);

  // Check weekday names over the next 7 days
  const weekdays = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  const dayIdx = weekdays.findIndex((d) => trimmed.includes(d));
  if (dayIdx !== -1) {
    const now = new Date();
    for (let offset = 0; offset < 7; offset++) {
      const candidate = new Date(now);
      candidate.setDate(now.getDate() + offset);
      if (candidate.getDay() === dayIdx) {
        return getLocalDateString(offset);
      }
    }
  }
  return null;
}

interface SeedDoctor {
  name: string;
  specialty: string;
  room: string;
  timesByDayOffset: Record<number, string[]>;
}

function getSeedDoctors(): SeedDoctor[] {
  return [
    {
      name: 'Dr. Maya Lin',
      specialty: 'Cardiology',
      room: 'Suite 204',
      timesByDayOffset: {
        0: ['09:30', '11:00', '14:30', '16:00'],
        1: ['09:00', '10:30', '14:00'],
        2: ['10:00', '13:30', '15:30'],
      },
    },
    {
      name: 'Dr. Arjun Patel',
      specialty: 'Dermatology',
      room: 'Suite 112',
      timesByDayOffset: {
        0: ['10:00', '11:30', '15:00'],
        1: ['09:30', '13:00', '15:30'],
        2: ['09:00', '11:00', '14:30'],
      },
    },
    {
      name: 'Dr. Elena Rostova',
      specialty: 'Internal Medicine',
      room: 'Suite 301',
      timesByDayOffset: {
        0: ['09:00', '10:30', '13:30', '16:30'],
        1: ['10:00', '11:30', '14:30'],
        2: ['09:30', '13:00', '16:00'],
      },
    },
    {
      name: 'Dr. David Okafor',
      specialty: 'Orthopedics',
      room: 'Suite 218',
      timesByDayOffset: {
        0: ['11:00', '14:00', '15:30'],
        1: ['09:00', '11:00', '15:00'],
        2: ['10:30', '14:00'],
      },
    },
    {
      name: 'Dr. Clara Hayes',
      specialty: 'Pediatrics',
      room: 'Suite 105',
      timesByDayOffset: {
        0: ['09:30', '13:00', '15:00'],
        1: ['09:30', '11:00', '14:00', '16:00'],
        2: ['09:00', '11:30', '15:00'],
      },
    },
  ];
}

export function seedIfEmpty(): void {
  const row = db.prepare('SELECT COUNT(*) as count FROM doctors').get() as {
    count: number;
  };
  if (row.count > 0) return;
  resetDatabase();
}

export function resetDatabase(): SchedulePayload {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM appointments').run();
    db.prepare('DELETE FROM slots').run();
    db.prepare('DELETE FROM doctors').run();

    const insertDoc = db.prepare(
      'INSERT INTO doctors (name, specialty, room) VALUES (?, ?, ?)'
    );
    const insertSlot = db.prepare(
      'INSERT INTO slots (doctor_id, date, time, is_booked) VALUES (?, ?, ?, 0)'
    );

    const doctorIds: Record<string, number> = {};
    for (const doc of getSeedDoctors()) {
      const info = insertDoc.run(doc.name, doc.specialty, doc.room);
      const docId = Number(info.lastInsertRowid);
      doctorIds[doc.name] = docId;

      for (const [offsetStr, times] of Object.entries(doc.timesByDayOffset)) {
        const dateStr = getLocalDateString(Number(offsetStr));
        for (const time of times) {
          insertSlot.run(docId, dateStr, time);
        }
      }
    }

    // Pre-seed two realistic appointments so cancellation can be tested right away
    const nowIso = new Date().toISOString();
    const today = getLocalDateString(0);
    const tomorrow = getLocalDateString(1);

    const seedBookings = [
      {
        doctorName: 'Dr. Maya Lin',
        date: today,
        time: '11:00',
        phone: '5550148821',
        callerName: 'Hannah Brooks',
      },
      {
        doctorName: 'Dr. Arjun Patel',
        date: tomorrow,
        time: '09:30',
        phone: '5550193304',
        callerName: 'Marcus Reed',
      },
    ];

    for (const item of seedBookings) {
      const docId = doctorIds[item.doctorName];
      const slot = db
        .prepare(
          'SELECT id FROM slots WHERE doctor_id = ? AND date = ? AND time = ? LIMIT 1'
        )
        .get(docId, item.date, item.time) as { id: number } | undefined;

      if (slot) {
        db.prepare('UPDATE slots SET is_booked = 1 WHERE id = ?').run(slot.id);
        db.prepare(
          `INSERT INTO appointments
            (slot_id, doctor_id, caller_phone, caller_phone_formatted, caller_name, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?)`
        ).run(
          slot.id,
          docId,
          normalizePhone(item.phone),
          formatPhone(item.phone),
          item.callerName,
          nowIso,
          nowIso
        );
      }
    }
  });

  tx();
  return getSchedule();
}

export function getSchedule(): SchedulePayload {
  const doctorRows = db
    .prepare('SELECT id, name, specialty, room FROM doctors ORDER BY id ASC')
    .all() as Array<{ id: number; name: string; specialty: string; room: string }>;

  const slotRows = db
    .prepare(
      'SELECT id, doctor_id, date, time, is_booked FROM slots ORDER BY date ASC, time ASC'
    )
    .all() as Array<{
    id: number;
    doctor_id: number;
    date: string;
    time: string;
    is_booked: number;
  }>;

  const slotsByDoctor = new Map<number, TimeSlot[]>();
  for (const s of slotRows) {
    const arr = slotsByDoctor.get(s.doctor_id) ?? [];
    arr.push({
      id: s.id,
      doctorId: s.doctor_id,
      date: s.date,
      time: s.time,
      displayTime: formatTime12h(s.time),
      isBooked: s.is_booked === 1,
    });
    slotsByDoctor.set(s.doctor_id, arr);
  }

  const doctors: DoctorWithSlots[] = doctorRows.map((d) => ({
    id: d.id,
    name: d.name,
    specialty: d.specialty,
    room: d.room,
    slots: slotsByDoctor.get(d.id) ?? [],
  }));

  const appointmentRows = db
    .prepare(
      `SELECT
        a.id,
        a.slot_id,
        a.doctor_id,
        d.name AS doctor_name,
        d.specialty AS specialty,
        s.date AS date,
        s.time AS time,
        a.caller_phone,
        a.caller_phone_formatted,
        a.caller_name,
        a.status,
        a.created_at,
        a.updated_at
       FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
       JOIN slots s ON s.id = a.slot_id
       ORDER BY
         CASE WHEN a.status = 'confirmed' THEN 0 ELSE 1 END ASC,
         a.updated_at DESC`
    )
    .all() as Array<{
    id: number;
    slot_id: number;
    doctor_id: number;
    doctor_name: string;
    specialty: string;
    date: string;
    time: string;
    caller_phone: string;
    caller_phone_formatted: string;
    caller_name: string | null;
    status: 'confirmed' | 'cancelled';
    created_at: string;
    updated_at: string;
  }>;

  const appointments: Appointment[] = appointmentRows.map((a) => ({
    id: a.id,
    slotId: a.slot_id,
    doctorId: a.doctor_id,
    doctorName: a.doctor_name,
    specialty: a.specialty,
    date: a.date,
    time: a.time,
    displayTime: formatTime12h(a.time),
    callerPhone: a.caller_phone,
    callerPhoneFormatted: a.caller_phone_formatted,
    callerName: a.caller_name,
    status: a.status,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  }));

  return {
    doctors,
    appointments,
    today: getLocalDateString(0),
  };
}

export interface AvailabilityQuery {
  doctor_name?: string;
  specialty?: string;
  date?: string;
}

export function checkDoctorAvailability(query: AvailabilityQuery) {
  const resolvedDate = resolveDateInput(query.date);
  const doctorFilter = (query.doctor_name || '').trim().toLowerCase();
  const specialtyFilter = (query.specialty || '').trim().toLowerCase();

  const { doctors } = getSchedule();

  const matchedDoctors = doctors.filter((doc) => {
    const docNameLower = doc.name.toLowerCase();
    const specLower = doc.specialty.toLowerCase();
    const docOk =
      !doctorFilter ||
      docNameLower.includes(doctorFilter) ||
      doctorFilter.includes(docNameLower.replace('dr. ', '')) ||
      specLower.includes(doctorFilter);
    const specOk =
      !specialtyFilter ||
      specLower.includes(specialtyFilter) ||
      docNameLower.includes(specialtyFilter);
    return docOk && specOk;
  });

  const results = matchedDoctors.map((doc) => {
    const openSlots = doc.slots.filter((slot) => {
      if (slot.isBooked) return false;
      if (resolvedDate && slot.date !== resolvedDate) return false;
      return true;
    });
    return {
      doctor_id: doc.id,
      doctor_name: doc.name,
      specialty: doc.specialty,
      room: doc.room,
      available_slots: openSlots.map((s) => ({
        slot_id: s.id,
        date: s.date,
        time: s.time,
        display_time: s.displayTime,
      })),
    };
  });

  return {
    today: getLocalDateString(0),
    tomorrow: getLocalDateString(1),
    filter_date: resolvedDate,
    doctors: results,
    total_open_slots: results.reduce(
      (sum, d) => sum + d.available_slots.length,
      0
    ),
  };
}

export interface BookAppointmentInput {
  doctor_name?: string;
  date?: string;
  time?: string;
  slot_id?: number;
  caller_phone: string;
  caller_name?: string;
}

export function bookAppointment(input: BookAppointmentInput): {
  success: boolean;
  error?: string;
  appointment?: Appointment;
} {
  const normalizedPhone = normalizePhone(input.caller_phone || '');
  if (normalizedPhone.length < 7) {
    return {
      success: false,
      error:
        'A valid phone number with at least 7 digits is required to book an appointment.',
    };
  }

  const formattedPhone = formatPhone(normalizedPhone);
  const resolvedDate = resolveDateInput(input.date);
  const parsedTime = parseTimeTo24h(input.time);

  const tx = db.transaction(() => {
    let targetSlot:
      | {
          id: number;
          doctor_id: number;
          date: string;
          time: string;
          is_booked: number;
          doctor_name: string;
          specialty: string;
        }
      | undefined;

    if (input.slot_id) {
      targetSlot = db
        .prepare(
          `SELECT s.id, s.doctor_id, s.date, s.time, s.is_booked, d.name AS doctor_name, d.specialty
           FROM slots s JOIN doctors d ON d.id = s.doctor_id
           WHERE s.id = ?`
        )
        .get(input.slot_id) as typeof targetSlot;
    } else {
      const doctorQuery = (input.doctor_name || '').trim().toLowerCase();
      const allDoctors = db
        .prepare('SELECT id, name, specialty FROM doctors')
        .all() as Array<{ id: number; name: string; specialty: string }>;

      const matchedDoc = allDoctors.find((d) => {
        const lower = d.name.toLowerCase();
        const lastName = lower.split(' ').pop() || '';
        return (
          lower.includes(doctorQuery) ||
          doctorQuery.includes(lastName) ||
          d.specialty.toLowerCase().includes(doctorQuery)
        );
      });

      if (!matchedDoc) {
        return {
          success: false as const,
          error: `Could not find a doctor matching "${input.doctor_name || ''}".`,
        };
      }

      const candidates = db
        .prepare(
          `SELECT s.id, s.doctor_id, s.date, s.time, s.is_booked, d.name AS doctor_name, d.specialty
           FROM slots s JOIN doctors d ON d.id = s.doctor_id
           WHERE s.doctor_id = ? AND s.is_booked = 0
           ORDER BY s.date ASC, s.time ASC`
        )
        .all(matchedDoc.id) as Array<NonNullable<typeof targetSlot>>;

      targetSlot = candidates.find((c) => {
        const dateMatch = !resolvedDate || c.date === resolvedDate;
        const timeMatch = !parsedTime || c.time === parsedTime;
        return dateMatch && timeMatch;
      });
    }

    if (!targetSlot) {
      return {
        success: false as const,
        error:
          'That time slot is not available. Please check available slots again.',
      };
    }

    if (targetSlot.is_booked === 1) {
      return {
        success: false as const,
        error:
          'That slot was just booked by someone else. Please pick another open time.',
      };
    }

    const nowIso = new Date().toISOString();
    db.prepare('UPDATE slots SET is_booked = 1 WHERE id = ?').run(targetSlot.id);
    const insertRes = db
      .prepare(
        `INSERT INTO appointments
          (slot_id, doctor_id, caller_phone, caller_phone_formatted, caller_name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?)`
      )
      .run(
        targetSlot.id,
        targetSlot.doctor_id,
        normalizedPhone,
        formattedPhone,
        input.caller_name?.trim() || null,
        nowIso,
        nowIso
      );

    const appointment: Appointment = {
      id: Number(insertRes.lastInsertRowid),
      slotId: targetSlot.id,
      doctorId: targetSlot.doctor_id,
      doctorName: targetSlot.doctor_name,
      specialty: targetSlot.specialty,
      date: targetSlot.date,
      time: targetSlot.time,
      displayTime: formatTime12h(targetSlot.time),
      callerPhone: normalizedPhone,
      callerPhoneFormatted: formattedPhone,
      callerName: input.caller_name?.trim() || null,
      status: 'confirmed',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    return { success: true as const, appointment };
  });

  return tx();
}

export interface CancelAppointmentInput {
  caller_phone: string;
  doctor_name?: string;
  date?: string;
}

export function cancelAppointment(input: CancelAppointmentInput): {
  success: boolean;
  error?: string;
  appointment?: Appointment;
} {
  const normalizedPhone = normalizePhone(input.caller_phone || '');
  if (normalizedPhone.length < 7) {
    return {
      success: false,
      error:
        'A valid phone number with at least 7 digits is required to find and cancel an appointment.',
    };
  }

  const resolvedDate = resolveDateInput(input.date);
  const doctorFilter = (input.doctor_name || '').trim().toLowerCase();

  const tx = db.transaction(() => {
    const activeRows = db
      .prepare(
        `SELECT
          a.id,
          a.slot_id,
          a.doctor_id,
          d.name AS doctor_name,
          d.specialty AS specialty,
          s.date AS date,
          s.time AS time,
          a.caller_phone,
          a.caller_phone_formatted,
          a.caller_name,
          a.status,
          a.created_at,
          a.updated_at
         FROM appointments a
         JOIN doctors d ON d.id = a.doctor_id
         JOIN slots s ON s.id = a.slot_id
         WHERE a.caller_phone = ? AND a.status = 'confirmed'
         ORDER BY s.date ASC, s.time ASC`
      )
      .all(normalizedPhone) as Array<{
      id: number;
      slot_id: number;
      doctor_id: number;
      doctor_name: string;
      specialty: string;
      date: string;
      time: string;
      caller_phone: string;
      caller_phone_formatted: string;
      caller_name: string | null;
      status: 'confirmed' | 'cancelled';
      created_at: string;
      updated_at: string;
    }>;

    if (activeRows.length === 0) {
      return {
        success: false as const,
        error: `No active appointment was found for phone number ${formatPhone(normalizedPhone)}.`,
      };
    }

    const match =
      activeRows.find((row) => {
        const docMatch =
          !doctorFilter ||
          row.doctor_name.toLowerCase().includes(doctorFilter) ||
          row.specialty.toLowerCase().includes(doctorFilter);
        const dateMatch = !resolvedDate || row.date === resolvedDate;
        return docMatch && dateMatch;
      }) ?? activeRows[0];

    const nowIso = new Date().toISOString();
    db.prepare(
      `UPDATE appointments SET status = 'cancelled', updated_at = ? WHERE id = ?`
    ).run(nowIso, match.id);
    db.prepare('UPDATE slots SET is_booked = 0 WHERE id = ?').run(match.slot_id);

    const appointment: Appointment = {
      id: match.id,
      slotId: match.slot_id,
      doctorId: match.doctor_id,
      doctorName: match.doctor_name,
      specialty: match.specialty,
      date: match.date,
      time: match.time,
      displayTime: formatTime12h(match.time),
      callerPhone: match.caller_phone,
      callerPhoneFormatted: match.caller_phone_formatted,
      callerName: match.caller_name,
      status: 'cancelled',
      createdAt: match.created_at,
      updatedAt: nowIso,
    };

    return { success: true as const, appointment };
  });

  return tx();
}

// Initialize database on import
seedIfEmpty();
