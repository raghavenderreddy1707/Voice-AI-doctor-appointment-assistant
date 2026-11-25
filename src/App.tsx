import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Phone, RotateCcw } from 'lucide-react';
import { AppointmentsPanel } from './components/AppointmentsPanel';
import { DoctorsPanel } from './components/DoctorsPanel';
import { PhoneCallOverlay } from './components/PhoneCallOverlay';
import { PipelineModal } from './components/PipelineModal';
import { TranscriptSection } from './components/TranscriptSection';
import { useVoiceCall } from './hooks/useVoiceCall';
import type { HighlightEvent, SchedulePayload } from './types';

function getDefaultCallWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/call`;
}

function getEventsWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/events`;
}

export default function App() {
  const [schedule, setSchedule] = useState<SchedulePayload>({
    doctors: [],
    appointments: [],
    today: '',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<HighlightEvent | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  const [voiceMode, setVoiceMode] = useState<'builtin' | 'pipecat'>('builtin');
  const [pipecatUrl, setPipecatUrl] = useState('ws://localhost:8000/ws/call');
  const [isPipelineModalOpen, setIsPipelineModalOpen] = useState(false);

  const highlightTimerRef = useRef<number | null>(null);

  const activeCallWsUrl = useMemo(
    () => (voiceMode === 'pipecat' ? pipecatUrl : getDefaultCallWsUrl()),
    [voiceMode, pipecatUrl]
  );

  const voiceCall = useVoiceCall({ wsUrl: activeCallWsUrl });

  const fetchSchedule = useCallback(async () => {
    try {
      setLoadError(null);
      const res = await fetch('/api/schedule');
      if (!res.ok) throw new Error('Unable to load clinic schedule.');
      const data = (await res.json()) as SchedulePayload;
      setSchedule(data);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Unable to load clinic schedule.'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSchedule();
  }, [fetchSchedule]);

  // Real-time schedule sync over /ws/events with automatic reconnection
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(getEventsWsUrl());

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type?: string;
            schedule?: SchedulePayload;
            highlight?: HighlightEvent | null;
          };

          if (
            (msg.type === 'schedule_snapshot' ||
              msg.type === 'schedule_updated') &&
            msg.schedule
          ) {
            setSchedule(msg.schedule);
            setIsLoading(false);
            setLoadError(null);

            if (msg.highlight) {
              setHighlight(msg.highlight);
              if (highlightTimerRef.current !== null) {
                window.clearTimeout(highlightTimerRef.current);
              }
              highlightTimerRef.current = window.setTimeout(() => {
                setHighlight(null);
              }, 3000);
            }
          }
        } catch {
          // Ignore non-JSON frames
        }
      };

      ws.onclose = () => {
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, 2500);
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
      ws?.close();
    };
  }, []);

  const handleResetData = useCallback(async () => {
    setIsResetting(true);
    try {
      const res = await fetch('/api/reset', { method: 'POST' });
      if (res.ok) {
        const data = (await res.json()) as SchedulePayload;
        setSchedule(data);
        setHighlight(null);
      }
    } finally {
      setIsResetting(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#F8F8F6] text-[#18181B]">
      {/* Strict 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 border-b border-[#E5E5E0] bg-[#F8F8F6]/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-8 px-5 sm:px-8">
          <a
            href="#"
            className="font-display text-base font-bold tracking-tight text-[#18181B] whitespace-nowrap shrink-0"
          >
            Meridian Clinic
          </a>

          <nav
            aria-label="Primary"
            className="hidden items-center gap-7 text-sm font-medium text-[#64748B] md:flex"
          >
            <a
              href="#doctors"
              className="transition-colors hover:text-[#18181B] whitespace-nowrap shrink-0"
            >
              Doctors
            </a>
            <a
              href="#appointments"
              className="transition-colors hover:text-[#18181B] whitespace-nowrap shrink-0"
            >
              Appointments
            </a>
            <a
              href="#transcript"
              className="transition-colors hover:text-[#18181B] whitespace-nowrap shrink-0"
            >
              Transcript
            </a>
          </nav>

          <button
            type="button"
            onClick={() => void voiceCall.startCall()}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0F766E] px-4 text-sm font-medium text-white transition-colors hover:bg-[#115E59] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F766E] whitespace-nowrap shrink-0"
          >
            <Phone className="h-4 w-4" />
            Try Call
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
        {/* Minimal Intro */}
        <div className="mb-10 max-w-xl">
          <h1
            className="text-2xl font-semibold tracking-tight text-[#18181B] sm:text-3xl"
            style={{ textWrap: 'balance' }}
          >
            Voice appointment desk
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#64748B]">
            Click Try Call to check doctor availability, book an open slot, or
            cancel an existing visit using only your spoken phone number.
          </p>
        </div>

        {loadError && (
          <div className="mb-8 flex items-center justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50 px-5 py-3.5 text-sm text-rose-800">
            <span>{loadError}</span>
            <button
              type="button"
              onClick={() => void fetchSchedule()}
              className="font-medium underline whitespace-nowrap shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {/* Primary 2-Column Schedule Workspace */}
        <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <DoctorsPanel
              doctors={schedule.doctors}
              today={schedule.today}
              isLoading={isLoading}
            />
          </div>

          <div className="lg:col-span-5">
            <AppointmentsPanel
              appointments={schedule.appointments}
              today={schedule.today}
              isLoading={isLoading}
              highlight={highlight}
              onStartCall={() => void voiceCall.startCall()}
            />
          </div>
        </div>

        {/* Live / Recent Call Transcript */}
        <div className="mt-12">
          <TranscriptSection
            transcript={voiceCall.transcript}
            callState={voiceCall.callState}
            onStartCall={() => void voiceCall.startCall()}
          />
        </div>
      </main>

      {/* Quiet Footer with Real Actions */}
      <footer className="mt-16 border-t border-[#E5E5E0]">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-5 py-6 text-xs text-[#64748B] sm:flex-row sm:items-center sm:px-8">
          <span>Meridian Clinic · Shared SQLite schedule</span>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setIsPipelineModalOpen(true)}
              className="transition-colors hover:text-[#18181B] whitespace-nowrap shrink-0"
            >
              Voice engine:{' '}
              <span className="font-medium text-[#18181B]">
                {voiceMode === 'pipecat' ? 'Pipecat' : 'Built-in'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void handleResetData()}
              disabled={isResetting}
              className="inline-flex items-center gap-1.5 transition-colors hover:text-[#18181B] disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {isResetting ? 'Resetting...' : 'Reset sample data'}
            </button>
          </div>
        </div>
      </footer>

      {/* Phone-Style Call Overlay */}
      <PhoneCallOverlay
        isOpen={voiceCall.isOpen}
        callState={voiceCall.callState}
        isMuted={voiceCall.isMuted}
        elapsedSeconds={voiceCall.elapsedSeconds}
        transcript={voiceCall.transcript}
        actionCards={voiceCall.actionCards}
        error={voiceCall.error}
        voiceLevel={voiceCall.voiceLevel}
        today={schedule.today}
        onToggleMute={voiceCall.toggleMute}
        onEndCall={voiceCall.endCall}
        onCallAgain={() => void voiceCall.startCall()}
        onClose={voiceCall.closeOverlay}
      />

      {/* Quiet Voice Engine Settings Modal */}
      <PipelineModal
        isOpen={isPipelineModalOpen}
        mode={voiceMode}
        pipecatUrl={pipecatUrl}
        onSave={(nextMode, nextUrl) => {
          setVoiceMode(nextMode);
          setPipecatUrl(nextUrl);
        }}
        onClose={() => setIsPipelineModalOpen(false)}
      />
    </div>
  );
}
