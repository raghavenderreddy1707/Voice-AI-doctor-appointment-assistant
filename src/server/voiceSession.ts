import { GoogleGenAI, Modality, Type } from '@google/genai';
import type { FunctionDeclaration, LiveServerMessage } from '@google/genai';
import type WebSocket from 'ws';
import type { ActionCardPayload, HighlightEvent } from '../types.ts';
import {
  bookAppointment,
  cancelAppointment,
  checkDoctorAvailability,
  getLocalDateString,
  getSchedule,
} from './db.ts';

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please check Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const checkDoctorAvailabilityTool: FunctionDeclaration = {
  name: 'check_doctor_availability',
  description:
    'Checks available appointment slots for a specific doctor, medical specialty, or date. Always call this before quoting available times to the caller.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      doctor_name: {
        type: Type.STRING,
        description:
          'Doctor name or last name, e.g. "Dr. Maya Lin", "Patel", or leave empty to list all doctors.',
      },
      specialty: {
        type: Type.STRING,
        description:
          'Medical specialty, e.g. "Cardiology", "Dermatology", "Internal Medicine", "Orthopedics", or "Pediatrics".',
      },
      date: {
        type: Type.STRING,
        description:
          'Requested date in YYYY-MM-DD format, or "today" / "tomorrow". Leave empty to see all upcoming days.',
      },
    },
  },
};

const bookAppointmentTool: FunctionDeclaration = {
  name: 'book_appointment',
  description:
    'Books an available appointment slot using the phone number the caller spoke aloud. Only call this AFTER reading the phone number back to the caller and receiving their confirmation.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      doctor_name: {
        type: Type.STRING,
        description: 'Full name of the doctor, e.g. "Dr. Maya Lin".',
      },
      date: {
        type: Type.STRING,
        description: 'Appointment date in YYYY-MM-DD format.',
      },
      time: {
        type: Type.STRING,
        description: 'Appointment start time, e.g. "10:30" or "2:30 PM".',
      },
      slot_id: {
        type: Type.INTEGER,
        description:
          'Exact slot_id returned by check_doctor_availability, if known.',
      },
      caller_phone: {
        type: Type.STRING,
        description:
          'The phone number the caller spoke aloud and confirmed during the call.',
      },
      caller_name: {
        type: Type.STRING,
        description: 'Optional name if the caller volunteered it.',
      },
    },
    required: ['caller_phone'],
  },
};

const cancelAppointmentTool: FunctionDeclaration = {
  name: 'cancel_appointment',
  description:
    'Cancels an existing confirmed appointment found using the phone number the caller spoke aloud. Only call this AFTER reading the phone number back to the caller and receiving their confirmation.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      caller_phone: {
        type: Type.STRING,
        description:
          'The phone number the caller spoke aloud and confirmed during the call.',
      },
      doctor_name: {
        type: Type.STRING,
        description:
          'Optional doctor name if the caller has more than one appointment.',
      },
      date: {
        type: Type.STRING,
        description: 'Optional appointment date in YYYY-MM-DD format.',
      },
    },
    required: ['caller_phone'],
  },
};

function buildSystemInstruction(): string {
  const { doctors } = getSchedule();
  const today = getLocalDateString(0);
  const tomorrow = getLocalDateString(1);
  const dayAfter = getLocalDateString(2);

  const roster = doctors
    .map((d) => `- ${d.name} (${d.specialty}, ${d.room})`)
    .join('\n');

  return `You are the friendly, professional phone receptionist for Meridian Clinic.

Today's date is ${today}. Tomorrow is ${tomorrow}. The day after tomorrow is ${dayAfter}.

Clinic doctors:
${roster}

Core rules you MUST follow on every call:
1. Speak naturally, warmly, and concisely—1 to 3 short sentences at a time, like a real clinic receptionist on a phone call. Never use markdown, bullet points, or asterisks when speaking.
2. Callers are identified ONLY by the phone number they say out loud. Never ask for a login, account, email, OTP, or caller-ID.
3. ALWAYS call check_doctor_availability before telling the caller which times are open. Offer 2 to 4 clear options in natural spoken form (for example, "tomorrow at 10:30 AM or 2:00 PM").
4. CRITICAL CONFIRMATION RULE: Before calling book_appointment or cancel_appointment, you MUST read the caller's spoken phone number back clearly digit by digit or in clean groups (for example, "Just to confirm, that's 5-5-5, 0-1-4, 8-8-2-1—is that right?") and wait for the caller to confirm it is correct. Never book or cancel before they confirm the phone number.
5. After booking or cancelling, confirm the doctor, date, time, and phone number clearly, then ask if there is anything else you can help with. You must be ready to handle availability checks, booking, and cancellation all smoothly in the same call.`;
}

function safeSend(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export async function attachVoiceCallSession(
  clientWs: WebSocket,
  onScheduleMutated: (event: HighlightEvent) => void
): Promise<void> {
  let ai: GoogleGenAI;
  try {
    ai = createGeminiClient();
  } catch (err) {
    safeSend(clientWs, {
      type: 'error',
      message:
        err instanceof Error ? err.message : 'Unable to initialize Gemini API.',
    });
    clientWs.close();
    return;
  }

  let closed = false;
  let session: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;

  try {
    session = await ai.live.connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Zephyr',
            },
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: buildSystemInstruction(),
        tools: [
          {
            functionDeclarations: [
              checkDoctorAvailabilityTool,
              bookAppointmentTool,
              cancelAppointmentTool,
            ],
          },
        ],
      },
      callbacks: {
        onopen: () => {
          safeSend(clientWs, { type: 'connected' });
        },
        onmessage: (message: LiveServerMessage) => {
          if (closed) return;

          const serverContent = message.serverContent;
          if (serverContent?.interrupted) {
            safeSend(clientWs, { type: 'interrupted' });
          }

          if (serverContent?.inputTranscription?.text) {
            safeSend(clientWs, {
              type: 'transcript',
              speaker: 'caller',
              text: serverContent.inputTranscription.text,
            });
          }

          if (serverContent?.outputTranscription?.text) {
            safeSend(clientWs, {
              type: 'transcript',
              speaker: 'agent',
              text: serverContent.outputTranscription.text,
            });
          }

          for (const part of serverContent?.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              safeSend(clientWs, {
                type: 'audio',
                data: part.inlineData.data,
              });
            }
          }

          if (serverContent?.turnComplete) {
            safeSend(clientWs, { type: 'turn_complete' });
          }

          const calls = message.toolCall?.functionCalls ?? [];
          if (calls.length > 0 && session) {
            const functionResponses = calls.map((call) => {
              const args = (call.args ?? {}) as Record<string, unknown>;
              let responsePayload: Record<string, unknown>;

              if (call.name === 'check_doctor_availability') {
                const avail = checkDoctorAvailability({
                  doctor_name: args.doctor_name as string | undefined,
                  specialty: args.specialty as string | undefined,
                  date: args.date as string | undefined,
                });
                responsePayload = avail;
              } else if (call.name === 'book_appointment') {
                const res = bookAppointment({
                  doctor_name: args.doctor_name as string | undefined,
                  date: args.date as string | undefined,
                  time: args.time as string | undefined,
                  slot_id:
                    typeof args.slot_id === 'number' ? args.slot_id : undefined,
                  caller_phone: String(args.caller_phone ?? ''),
                  caller_name: args.caller_name as string | undefined,
                });
                responsePayload = res;

                if (res.success && res.appointment) {
                  const card: ActionCardPayload = {
                    id: `booked-${res.appointment.id}-${Date.now()}`,
                    type: 'booked',
                    doctorName: res.appointment.doctorName,
                    specialty: res.appointment.specialty,
                    date: res.appointment.date,
                    displayTime: res.appointment.displayTime,
                    callerPhoneFormatted: res.appointment.callerPhoneFormatted,
                    appointmentId: res.appointment.id,
                  };
                  safeSend(clientWs, { type: 'action_card', card });
                  onScheduleMutated({
                    appointmentId: res.appointment.id,
                    action: 'booked',
                  });
                }
              } else if (call.name === 'cancel_appointment') {
                const res = cancelAppointment({
                  caller_phone: String(args.caller_phone ?? ''),
                  doctor_name: args.doctor_name as string | undefined,
                  date: args.date as string | undefined,
                });
                responsePayload = res;

                if (res.success && res.appointment) {
                  const card: ActionCardPayload = {
                    id: `cancelled-${res.appointment.id}-${Date.now()}`,
                    type: 'cancelled',
                    doctorName: res.appointment.doctorName,
                    specialty: res.appointment.specialty,
                    date: res.appointment.date,
                    displayTime: res.appointment.displayTime,
                    callerPhoneFormatted: res.appointment.callerPhoneFormatted,
                    appointmentId: res.appointment.id,
                  };
                  safeSend(clientWs, { type: 'action_card', card });
                  onScheduleMutated({
                    appointmentId: res.appointment.id,
                    action: 'cancelled',
                  });
                }
              } else {
                responsePayload = {
                  error: `Unknown tool: ${call.name}`,
                };
              }

              return {
                id: call.id,
                name: call.name,
                response: responsePayload,
              };
            });

            session.sendToolResponse({ functionResponses });
          }
        },
        onerror: (err: unknown) => {
          const msg =
            err && typeof err === 'object' && 'message' in err
              ? String((err as { message: unknown }).message)
              : 'Voice connection encountered an error.';
          safeSend(clientWs, { type: 'error', message: msg });
        },
        onclose: () => {
          if (!closed) {
            closed = true;
            safeSend(clientWs, { type: 'ended' });
            clientWs.close();
          }
        },
      },
    });

    // Greet the caller naturally as soon as the line connects
    if (!closed && session) {
      safeSend(clientWs, { type: 'connected' });
      session.sendClientContent({
        turns: [
          {
            role: 'user',
            parts: [
              {
                text: 'The call has just connected. Greet the caller warmly in one short sentence as Meridian Clinic and ask how you can help.',
              },
            ],
          },
        ],
        turnComplete: true,
      });
    }
  } catch (err) {
    safeSend(clientWs, {
      type: 'error',
      message:
        err instanceof Error
          ? err.message
          : 'Failed to connect to the Gemini Live voice service.',
    });
    clientWs.close();
    return;
  }

  clientWs.on('message', (raw) => {
    if (closed || !session) return;
    try {
      const msg = JSON.parse(raw.toString()) as {
        type?: string;
        audio?: string;
        data?: string;
      };
      const pcmBase64 = msg.audio || msg.data;
      if ((msg.type === 'audio' || msg.audio) && pcmBase64) {
        session.sendRealtimeInput({
          audio: {
            data: pcmBase64,
            mimeType: 'audio/pcm;rate=16000',
          },
        });
      } else if (msg.type === 'end') {
        closed = true;
        session.close();
        clientWs.close();
      }
    } catch {
      // Ignore malformed frames
    }
  });

  clientWs.on('close', () => {
    if (!closed) {
      closed = true;
      try {
        session?.close();
      } catch {
        // Ignore close errors
      }
    }
  });
}
