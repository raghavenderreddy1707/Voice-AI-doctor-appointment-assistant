import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { formatShortDate } from '../lib/dates';
import type { DoctorWithSlots, TimeSlot } from '../types';

interface DoctorsPanelProps {
  doctors: DoctorWithSlots[];
  today: string;
  isLoading: boolean;
}

export function DoctorsPanel({ doctors, today, isLoading }: DoctorsPanelProps) {
  const [query, setQuery] = useState('');
  const [specialty, setSpecialty] = useState('All');

  const specialties = useMemo(() => {
    const unique = Array.from(new Set(doctors.map((d) => d.specialty)));
    return ['All', ...unique];
  }, [doctors]);

  const filteredDoctors = useMemo(() => {
    const q = query.trim().toLowerCase();
    return doctors.filter((doc) => {
      const specOk = specialty === 'All' || doc.specialty === specialty;
      const queryOk =
        !q ||
        doc.name.toLowerCase().includes(q) ||
        doc.specialty.toLowerCase().includes(q);
      return specOk && queryOk;
    });
  }, [doctors, query, specialty]);

  const totalOpenSlots = useMemo(
    () =>
      filteredDoctors.reduce(
        (sum, doc) => sum + doc.slots.filter((s) => !s.isBooked).length,
        0
      ),
    [filteredDoctors]
  );

  return (
    <section id="doctors" className="scroll-mt-20">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-[#18181B]">
          Doctors & open slots
        </h2>
        <p className="font-mono text-xs tabular-nums text-[#64748B]">
          {filteredDoctors.length} doctors · {totalOpenSlots} open
        </p>
      </div>

      {/* Simple filter bar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by doctor or specialty"
            aria-label="Filter doctors"
            className="h-10 w-full rounded-lg border border-[#E5E5E0] bg-white pr-3 pl-9 text-sm text-[#18181B] placeholder:text-[#94A3B8] focus:border-[#0F766E] focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
          {specialties.map((spec) => {
            const active = specialty === spec;
            return (
              <button
                key={spec}
                type="button"
                onClick={() => setSpecialty(spec)}
                className={`h-8 rounded-md px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[#0F766E] text-white'
                    : 'text-[#64748B] hover:bg-black/5 hover:text-[#18181B]'
                }`}
              >
                {spec}
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#E5E5E0] bg-white">
        {isLoading ? (
          <div className="divide-y divide-[#E5E5E0]">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-3 p-5">
                <div className="h-4 w-40 animate-pulse rounded bg-zinc-100" />
                <div className="h-3 w-28 animate-pulse rounded bg-zinc-100" />
                <div className="flex gap-2 pt-1">
                  <div className="h-7 w-16 animate-pulse rounded bg-zinc-100" />
                  <div className="h-7 w-16 animate-pulse rounded bg-zinc-100" />
                  <div className="h-7 w-16 animate-pulse rounded bg-zinc-100" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredDoctors.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-[#64748B]">
              No doctors match your current filter.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSpecialty('All');
              }}
              className="mt-3 text-sm font-medium text-[#0F766E] hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-[#E5E5E0]">
            {filteredDoctors.map((doc) => {
              const openSlots = doc.slots.filter((s) => !s.isBooked);
              const byDate = openSlots.reduce<Record<string, TimeSlot[]>>(
                (acc, slot) => {
                  if (!acc[slot.date]) acc[slot.date] = [];
                  acc[slot.date].push(slot);
                  return acc;
                },
                {}
              );
              const dateEntries = Object.entries(byDate);

              return (
                <li key={doc.id} className="p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <h3 className="text-[15px] font-semibold text-[#18181B]">
                        {doc.name}
                      </h3>
                      <p className="mt-0.5 text-xs text-[#64748B]">
                        {doc.specialty} · {doc.room}
                      </p>
                    </div>
                    <span className="font-mono text-xs tabular-nums text-[#64748B]">
                      {openSlots.length} open
                    </span>
                  </div>

                  {dateEntries.length === 0 ? (
                    <p className="mt-3 text-xs text-[#64748B]">
                      No open slots remaining.
                    </p>
                  ) : (
                    <div className="mt-3.5 space-y-2.5">
                      {dateEntries.map(([dateStr, slots]) => (
                        <div
                          key={dateStr}
                          className="flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:gap-4"
                        >
                          <span className="w-32 shrink-0 text-xs font-medium text-[#64748B]">
                            {formatShortDate(dateStr, today)}
                          </span>
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {slots.map((slot) => (
                              <span
                                key={slot.id}
                                className="font-mono text-xs tabular-nums text-[#18181B]"
                              >
                                {slot.displayTime}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
