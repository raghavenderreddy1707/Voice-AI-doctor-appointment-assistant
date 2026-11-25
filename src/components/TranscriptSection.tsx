import type { CallState, TranscriptEntry } from '../types';

interface TranscriptSectionProps {
  transcript: TranscriptEntry[];
  callState: CallState;
  onStartCall: () => void;
}

export function TranscriptSection({
  transcript,
  callState,
  onStartCall,
}: TranscriptSectionProps) {
  return (
    <section id="transcript" className="scroll-mt-20">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-[#18181B]">
          Call transcript
        </h2>
        <p className="text-xs text-[#64748B]">
          {callState === 'connected'
            ? 'Live call in progress'
            : transcript.length > 0
              ? `${transcript.length} turns recorded`
              : 'No active call'}
        </p>
      </div>

      <div className="rounded-xl border border-[#E5E5E0] bg-white">
        {transcript.length === 0 ? (
          <div className="flex flex-col items-start justify-between gap-3 p-6 sm:flex-row sm:items-center">
            <p className="text-sm text-[#64748B]">
              Start a call to speak with the receptionist and watch the live
              transcript appear here.
            </p>
            <button
              type="button"
              onClick={onStartCall}
              className="text-sm font-medium text-[#0F766E] hover:underline whitespace-nowrap shrink-0"
            >
              Start a call
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-[#E5E5E0]">
            {transcript.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-baseline sm:gap-6"
              >
                <div className="flex w-28 shrink-0 items-baseline justify-between sm:block">
                  <span
                    className={`text-xs font-semibold ${
                      entry.speaker === 'agent'
                        ? 'text-[#0F766E]'
                        : 'text-[#18181B]'
                    }`}
                  >
                    {entry.speaker === 'agent' ? 'Meridian' : 'Caller'}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-[#94A3B8] sm:ml-2">
                    {entry.timestamp}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-[#27272A]">
                  {entry.text}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
