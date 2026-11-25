import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CheckCircle2,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  X,
  XCircle,
} from 'lucide-react';
import { formatDuration, formatShortDate } from '../lib/dates';
import type { ActionCardPayload, CallState, TranscriptEntry } from '../types';
import type { VoiceLevelState } from '../hooks/useVoiceCall';
import { AudioWaveform } from './AudioWaveform';

interface PhoneCallOverlayProps {
  isOpen: boolean;
  callState: CallState;
  isMuted: boolean;
  elapsedSeconds: number;
  transcript: TranscriptEntry[];
  actionCards: ActionCardPayload[];
  error: string | null;
  voiceLevel: VoiceLevelState;
  today: string;
  onToggleMute: () => void;
  onEndCall: () => void;
  onCallAgain: () => void;
  onClose: () => void;
}

export function PhoneCallOverlay({
  isOpen,
  callState,
  isMuted,
  elapsedSeconds,
  transcript,
  actionCards,
  error,
  voiceLevel,
  today,
  onToggleMute,
  onEndCall,
  onCallAgain,
  onClose,
}: PhoneCallOverlayProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, actionCards]);

  const latestCard = actionCards[0] ?? null;

  const stateLabel =
    callState === 'ringing'
      ? 'Ringing'
      : callState === 'connected'
        ? `Connected · ${formatDuration(elapsedSeconds)}`
        : `Ended · ${formatDuration(elapsedSeconds)}`;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="dialog"
          aria-modal="true"
          aria-label="Meridian Clinic Voice Call"
        >
          <motion.div
            className="flex h-[92dvh] w-full max-w-[390px] flex-col overflow-hidden rounded-t-3xl bg-[#141517] text-zinc-100 shadow-2xl sm:h-[640px] sm:rounded-[32px] sm:border sm:border-zinc-800"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Handset Header */}
            <div className="flex items-start justify-between px-6 pt-6 pb-2">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-white">
                  Meridian Clinic
                </h2>
                <p className="mt-0.5 font-mono text-xs tabular-nums text-zinc-400">
                  {stateLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2DD4BF]"
                aria-label="Close call screen"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Waveform */}
            <div className="border-b border-zinc-800/80 px-6">
              <AudioWaveform
                callState={callState}
                voiceLevel={voiceLevel}
                isMuted={isMuted}
              />
            </div>

            {/* Confirmation Card (inside phone) */}
            <AnimatePresence initial={false}>
              {latestCard && (
                <motion.div
                  key={latestCard.id}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="mx-5 mt-4 rounded-xl border border-zinc-700/80 bg-zinc-900/90 p-3.5"
                >
                  <div className="flex items-center gap-2 text-xs font-medium">
                    {latestCard.type === 'booked' ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-[#2DD4BF]" />
                        <span className="text-[#2DD4BF]">
                          Appointment confirmed
                        </span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 shrink-0 text-rose-400" />
                        <span className="text-rose-400">
                          Appointment cancelled
                        </span>
                      </>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-white">
                    {latestCard.doctorName}
                  </p>
                  <p className="mt-0.5 font-mono text-xs tabular-nums text-zinc-400">
                    {formatShortDate(latestCard.date, today)} ·{' '}
                    {latestCard.displayTime}
                  </p>
                  <p className="mt-1 font-mono text-xs tabular-nums text-zinc-400">
                    Phone {latestCard.callerPhoneFormatted}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Live Transcript */}
            <div
              ref={scrollRef}
              className="flex-1 space-y-3 overflow-y-auto px-6 py-4"
            >
              {error && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-950/40 p-3.5 text-xs leading-relaxed text-rose-200">
                  {error}
                </div>
              )}

              {!error && transcript.length === 0 && (
                <div className="pt-8 text-center">
                  <p className="text-sm text-zinc-400">
                    {callState === 'ringing'
                      ? 'Connecting your call...'
                      : 'Ask for doctor availability, book a slot, or cancel using your phone number.'}
                  </p>
                </div>
              )}

              {transcript.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex flex-col ${
                    entry.speaker === 'caller' ? 'items-end' : 'items-start'
                  }`}
                >
                  <span className="mb-1 text-[11px] text-zinc-500">
                    {entry.speaker === 'caller' ? 'You' : 'Meridian'}
                  </span>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      entry.speaker === 'caller'
                        ? 'bg-[#0F766E] text-white'
                        : 'bg-zinc-800/90 text-zinc-100'
                    }`}
                  >
                    {entry.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Handset Controls */}
            <div className="border-t border-zinc-800/80 bg-[#111214] px-6 py-5">
              {callState === 'ringing' || callState === 'connected' ? (
                <div className="flex items-center justify-center gap-8">
                  <div className="flex flex-col items-center gap-1.5">
                    <button
                      type="button"
                      onClick={onToggleMute}
                      className={`flex h-14 w-14 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2DD4BF] ${
                        isMuted
                          ? 'bg-zinc-100 text-zinc-900'
                          : 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700'
                      }`}
                      aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                    >
                      {isMuted ? (
                        <MicOff className="h-5 w-5" />
                      ) : (
                        <Mic className="h-5 w-5" />
                      )}
                    </button>
                    <span className="text-xs text-zinc-400">
                      {isMuted ? 'Unmute' : 'Mute'}
                    </span>
                  </div>

                  <div className="flex flex-col items-center gap-1.5">
                    <button
                      type="button"
                      onClick={onEndCall}
                      className="flex h-14 w-14 items-center justify-center rounded-full bg-[#B91C1C] text-white transition-colors hover:bg-[#991B1B] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400"
                      aria-label="End call"
                    >
                      <PhoneOff className="h-5 w-5" />
                    </button>
                    <span className="text-xs text-zinc-400">End</span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={onCallAgain}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0F766E] px-5 text-sm font-medium text-white transition-colors hover:bg-[#115E59] whitespace-nowrap shrink-0"
                  >
                    <Phone className="h-4 w-4" />
                    Call Again
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-700 px-5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 whitespace-nowrap shrink-0"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
