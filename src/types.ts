export interface TimeSlot {
  id: number;
  doctorId: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM (24h)
  displayTime: string; // e.g. 09:30 AM
  isBooked: boolean;
}

export interface DoctorWithSlots {
  id: number;
  name: string;
  specialty: string;
  room: string;
  slots: TimeSlot[];
}

export interface Appointment {
  id: number;
  slotId: number;
  doctorId: number;
  doctorName: string;
  specialty: string;
  date: string;
  time: string;
  displayTime: string;
  callerPhone: string;
  callerPhoneFormatted: string;
  callerName: string | null;
  status: 'confirmed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

export interface SchedulePayload {
  doctors: DoctorWithSlots[];
  appointments: Appointment[];
  today: string;
}

export interface TranscriptEntry {
  id: string;
  speaker: 'caller' | 'agent';
  text: string;
  timestamp: string;
}

export interface ActionCardPayload {
  id: string;
  type: 'booked' | 'cancelled';
  doctorName: string;
  specialty: string;
  date: string;
  displayTime: string;
  callerPhoneFormatted: string;
  appointmentId: number;
}

export type CallState = 'idle' | 'ringing' | 'connected' | 'ended';

export interface HighlightEvent {
  appointmentId: number;
  action: 'booked' | 'cancelled';
}
