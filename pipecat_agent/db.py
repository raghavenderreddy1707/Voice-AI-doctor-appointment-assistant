"""Shared SQLite appointment store for the Pipecat voice agent.

Reads and writes the exact same SQLite database (`data/clinic.db`) used by
the Meridian Clinic web dashboard so bookings and cancellations stay in sync.
"""

from __future__ import annotations

import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "clinic.db"


def get_db_path() -> Path:
    env_path = os.getenv("CLINIC_DB_PATH")
    if env_path:
        p = Path(env_path)
        return p if p.is_absolute() else (Path(__file__).resolve().parent.parent / p)
    return DEFAULT_DB_PATH


def get_connection() -> sqlite3.Connection:
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def local_date_str(offset_days: int = 0) -> str:
    return (datetime.now() + timedelta(days=offset_days)).strftime("%Y-%m-%d")


def format_time_12h(hhmm: str) -> str:
    h, m = [int(x) for x in hhmm.split(":")]
    period = "PM" if h >= 12 else "AM"
    h12 = 12 if h % 12 == 0 else h % 12
    return f"{h12}:{m:02d} {period}"


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 11 and digits.startswith("1"):
        return digits[1:]
    return digits


def format_phone(raw: str) -> str:
    digits = normalize_phone(raw)
    if len(digits) == 10:
        return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
    if len(digits) == 7:
        return f"{digits[:3]}-{digits[3:]}"
    return digits or (raw or "").strip()


def parse_time_24h(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    cleaned = value.strip().lower().replace(".", "")
    m = re.match(r"^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$", cleaned)
    if not m:
        return None
    hour = int(m.group(1))
    minute = int(m.group(2) or "0")
    meridiem = m.group(3)
    if meridiem == "pm" and hour < 12:
        hour += 12
    elif meridiem == "am" and hour == 12:
        hour = 0
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return f"{hour:02d}:{minute:02d}"


def resolve_date_input(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    cleaned = value.strip().lower()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", cleaned):
        return cleaned
    if cleaned == "today":
        return local_date_str(0)
    if cleaned == "tomorrow":
        return local_date_str(1)
    if "day after" in cleaned:
        return local_date_str(2)

    weekdays = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
    ]
    for idx, day_name in enumerate(weekdays):
        if day_name in cleaned:
            now = datetime.now()
            for offset in range(7):
                candidate = now + timedelta(days=offset)
                if candidate.weekday() == idx:
                    return candidate.strftime("%Y-%m-%d")
    return None


def list_doctors_summary() -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, name, specialty, room FROM doctors ORDER BY id ASC"
        ).fetchall()
        return [dict(r) for r in rows]


def check_doctor_availability(
    doctor_name: Optional[str] = None,
    specialty: Optional[str] = None,
    date: Optional[str] = None,
) -> dict[str, Any]:
    resolved_date = resolve_date_input(date)
    doc_filter = (doctor_name or "").strip().lower()
    spec_filter = (specialty or "").strip().lower()

    with get_connection() as conn:
        doctors = conn.execute(
            "SELECT id, name, specialty, room FROM doctors ORDER BY id ASC"
        ).fetchall()

        results = []
        total_open = 0
        for doc in doctors:
            name_lower = doc["name"].lower()
            spec_lower = doc["specialty"].lower()
            if doc_filter and not (
                doc_filter in name_lower
                or name_lower.replace("dr. ", "") in doc_filter
                or doc_filter in spec_lower
            ):
                continue
            if spec_filter and not (
                spec_filter in spec_lower or spec_filter in name_lower
            ):
                continue

            if resolved_date:
                slots = conn.execute(
                    """SELECT id, date, time FROM slots
                       WHERE doctor_id = ? AND is_booked = 0 AND date = ?
                       ORDER BY date ASC, time ASC""",
                    (doc["id"], resolved_date),
                ).fetchall()
            else:
                slots = conn.execute(
                    """SELECT id, date, time FROM slots
                       WHERE doctor_id = ? AND is_booked = 0
                       ORDER BY date ASC, time ASC""",
                    (doc["id"],),
                ).fetchall()

            available = [
                {
                    "slot_id": s["id"],
                    "date": s["date"],
                    "time": s["time"],
                    "display_time": format_time_12h(s["time"]),
                }
                for s in slots
            ]
            total_open += len(available)
            results.append(
                {
                    "doctor_id": doc["id"],
                    "doctor_name": doc["name"],
                    "specialty": doc["specialty"],
                    "room": doc["room"],
                    "available_slots": available,
                }
            )

    return {
        "today": local_date_str(0),
        "tomorrow": local_date_str(1),
        "filter_date": resolved_date,
        "doctors": results,
        "total_open_slots": total_open,
    }


def book_appointment(
    caller_phone: str,
    doctor_name: Optional[str] = None,
    date: Optional[str] = None,
    time: Optional[str] = None,
    slot_id: Optional[int] = None,
    caller_name: Optional[str] = None,
) -> dict[str, Any]:
    normalized = normalize_phone(caller_phone)
    if len(normalized) < 7:
        return {
            "success": False,
            "error": "A valid phone number with at least 7 digits is required.",
        }

    formatted = format_phone(normalized)
    resolved_date = resolve_date_input(date)
    parsed_time = parse_time_24h(time)
    now_iso = datetime.now(timezone.utc).isoformat()

    with get_connection() as conn:
        target = None
        if slot_id is not None:
            target = conn.execute(
                """SELECT s.id, s.doctor_id, s.date, s.time, s.is_booked,
                          d.name AS doctor_name, d.specialty
                   FROM slots s JOIN doctors d ON d.id = s.doctor_id
                   WHERE s.id = ?""",
                (slot_id,),
            ).fetchone()
        else:
            query = (doctor_name or "").strip().lower()
            docs = conn.execute("SELECT id, name, specialty FROM doctors").fetchall()
            matched_doc = next(
                (
                    d
                    for d in docs
                    if query in d["name"].lower()
                    or d["name"].lower().split()[-1] in query
                    or query in d["specialty"].lower()
                ),
                None,
            )
            if not matched_doc:
                return {
                    "success": False,
                    "error": f'Could not find a doctor matching "{doctor_name or ""}".',
                }

            candidates = conn.execute(
                """SELECT s.id, s.doctor_id, s.date, s.time, s.is_booked,
                          d.name AS doctor_name, d.specialty
                   FROM slots s JOIN doctors d ON d.id = s.doctor_id
                   WHERE s.doctor_id = ? AND s.is_booked = 0
                   ORDER BY s.date ASC, s.time ASC""",
                (matched_doc["id"],),
            ).fetchall()

            for c in candidates:
                date_ok = not resolved_date or c["date"] == resolved_date
                time_ok = not parsed_time or c["time"] == parsed_time
                if date_ok and time_ok:
                    target = c
                    break

        if not target:
            return {
                "success": False,
                "error": "That time slot is not available. Please check availability again.",
            }
        if target["is_booked"] == 1:
            return {
                "success": False,
                "error": "That slot was just booked. Please select another open time.",
            }

        conn.execute("UPDATE slots SET is_booked = 1 WHERE id = ?", (target["id"],))
        cur = conn.execute(
            """INSERT INTO appointments
               (slot_id, doctor_id, caller_phone, caller_phone_formatted, caller_name, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?)""",
            (
                target["id"],
                target["doctor_id"],
                normalized,
                formatted,
                caller_name.strip() if caller_name else None,
                now_iso,
                now_iso,
            ),
        )
        appt_id = int(cur.lastrowid)
        conn.commit()

    return {
        "success": True,
        "appointment": {
            "id": appt_id,
            "slotId": target["id"],
            "doctorId": target["doctor_id"],
            "doctorName": target["doctor_name"],
            "specialty": target["specialty"],
            "date": target["date"],
            "time": target["time"],
            "displayTime": format_time_12h(target["time"]),
            "callerPhone": normalized,
            "callerPhoneFormatted": formatted,
            "callerName": caller_name.strip() if caller_name else None,
            "status": "confirmed",
        },
    }


def cancel_appointment(
    caller_phone: str,
    doctor_name: Optional[str] = None,
    date: Optional[str] = None,
) -> dict[str, Any]:
    normalized = normalize_phone(caller_phone)
    if len(normalized) < 7:
        return {
            "success": False,
            "error": "A valid phone number with at least 7 digits is required.",
        }

    resolved_date = resolve_date_input(date)
    doc_filter = (doctor_name or "").strip().lower()
    now_iso = datetime.now(timezone.utc).isoformat()

    with get_connection() as conn:
        active = conn.execute(
            """SELECT a.id, a.slot_id, a.doctor_id, d.name AS doctor_name,
                      d.specialty, s.date, s.time, a.caller_phone,
                      a.caller_phone_formatted, a.caller_name
               FROM appointments a
               JOIN doctors d ON d.id = a.doctor_id
               JOIN slots s ON s.id = a.slot_id
               WHERE a.caller_phone = ? AND a.status = 'confirmed'
               ORDER BY s.date ASC, s.time ASC""",
            (normalized,),
        ).fetchall()

        if not active:
            return {
                "success": False,
                "error": f"No active appointment found for phone number {format_phone(normalized)}.",
            }

        match = next(
            (
                row
                for row in active
                if (
                    not doc_filter
                    or doc_filter in row["doctor_name"].lower()
                    or doc_filter in row["specialty"].lower()
                )
                and (not resolved_date or row["date"] == resolved_date)
            ),
            active[0],
        )

        conn.execute(
            "UPDATE appointments SET status = 'cancelled', updated_at = ? WHERE id = ?",
            (now_iso, match["id"]),
        )
        conn.execute(
            "UPDATE slots SET is_booked = 0 WHERE id = ?", (match["slot_id"],)
        )
        conn.commit()

    return {
        "success": True,
        "appointment": {
            "id": match["id"],
            "slotId": match["slot_id"],
            "doctorId": match["doctor_id"],
            "doctorName": match["doctor_name"],
            "specialty": match["specialty"],
            "date": match["date"],
            "time": match["time"],
            "displayTime": format_time_12h(match["time"]),
            "callerPhone": match["caller_phone"],
            "callerPhoneFormatted": match["caller_phone_formatted"],
            "callerName": match["caller_name"],
            "status": "cancelled",
        },
    }
