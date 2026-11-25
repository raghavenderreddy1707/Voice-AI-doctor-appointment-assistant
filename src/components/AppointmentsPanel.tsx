import { formatShortDate } from '../lib/dates';
import type { Appointment, HighlightEvent } from '../types';

interface AppointmentsPanelProps {
  appointments: Appointment[];
  today: string;
  isLoading: boolean;
  highlight: HighlightEvent | null;
  onStartCall: () => void;
}

export function AppointmentsPanel({
  appointments,
  today,
  isLoading,
  highlight,
  onStartCall,
}: AppointmentsPanelProps) {
  const confirmedCount = appointments.filter(
    (a) => a.status === 'confirmed'
  ).length;

  return (
    <section id="appointments" className="scroll-mt-20">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-[#18181B]">
          Appointments
        </h2>
        <p className="font-mono text-xs tabular-nums text-[#64748B]">
          {confirmedCount} confirmed · {appointments.length} total
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#E5E5E0] bg-white">
        {isLoading ? (
          <div className="divide-y divide-[#E5E5E0]">
            {[1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between p-4">
                <div className="space-y-2">
                  <div className="h-4 w-32 animate-pulse rounded bg-zinc-100" />
                  <div className="h-3 w-44 animate-pulse rounded bg-zinc-100" />
                </div>
                <div className="h-4 w-16 animate-pulse rounded bg-zinc-100" />
              </div>
            ))}
          </div>
        ) : appointments.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-[#64748B]">
              No appointments booked yet.
            </p>
            <button
              type="button"
              onClick={onStartCall}
              className="mt-3 text-sm font-medium text-[#0F766E] hover:underline"
            >
              Try a voice call to book one
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[#E5E5E0] text-xs font-medium text-[#64748B]">
                  <th className="py-3 pr-3 pl-5 font-medium">Phone</th>
                  <th className="px-3 py-3 font-medium">Doctor</th>
                  <th className="px-3 py-3 font-medium">Date & time</th>
                  <th className="py-3 pr-5 pl-3 text-right font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E5E0] text-sm">
                {appointments.map((appt) => {
                  const isHighlighted = highlight?.appointmentId === appt.id;
                  const flashClass = isHighlighted
                    ? highlight.action === 'booked'
                      ? 'animate-row-booked'
                      : 'animate-row-cancelled'
                    : '';
                  const isCancelled = appt.status === 'cancelled';

                  return (
                    <tr
                      key={`${appt.id}-${isHighlighted ? highlight.action : 'idle'}`}
                      className={`transition-colors hover:bg-[#F8F8F6]/70 ${flashClass}`}
                    >
                      <td className="py-3.5 pr-3 pl-5 align-top">
                        <div className="font-mono text-[13px] font-medium tabular-nums text-[#18181B]">
                          {appt.callerPhoneFormatted}
                        </div>
                        {appt.callerName && (
                          <div className="mt-0.5 text-xs text-[#64748B]">
                            {appt.callerName}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3.5 align-top">
                        <div
                          className={`font-medium ${
                            isCancelled
                              ? 'text-[#64748B] line-through'
                              : 'text-[#18181B]'
                          }`}
                        >
                          {appt.doctorName}
                        </div>
                        <div className="mt-0.5 text-xs text-[#64748B]">
                          {appt.specialty}
                        </div>
                      </td>
                      <td className="px-3 py-3.5 align-top">
                        <div className="font-mono text-xs tabular-nums text-[#18181B]">
                          {formatShortDate(appt.date, today)}
                        </div>
                        <div className="mt-0.5 font-mono text-xs tabular-nums text-[#64748B]">
                          {appt.displayTime}
                        </div>
                      </td>
                      <td className="py-3.5 pr-5 pl-3 text-right align-top">
                        <span
                          className={`text-xs font-medium ${
                            isCancelled ? 'text-[#B91C1C]' : 'text-[#15803D]'
                          }`}
                        >
                          {isCancelled ? 'Cancelled' : 'Confirmed'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
