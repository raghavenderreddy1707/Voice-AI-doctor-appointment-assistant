import type { CallState } from '../types';
import type { VoiceLevelState } from '../hooks/useVoiceCall';

interface AudioWaveformProps {
  callState: CallState;
  voiceLevel: VoiceLevelState;
  isMuted: boolean;
}

const BAR_WEIGHTS = [
  0.24, 0.36, 0.5, 0.68, 0.82, 0.94, 1.0, 0.88, 0.74, 0.92, 0.98, 0.78, 0.62,
  0.84, 0.96, 0.76, 0.58, 0.72, 0.86, 0.64, 0.48, 0.34, 0.24,
];

export function AudioWaveform({
  callState,
  voiceLevel,
  isMuted,
}: AudioWaveformProps) {
  const isRinging = callState === 'ringing';
  const isConnected = callState === 'connected';
  const activeEnergy = isConnected ? Math.max(0.06, voiceLevel.level) : 0.04;

  const barColor =
    isRinging
      ? 'bg-amber-400/75'
      : voiceLevel.speaker === 'agent'
        ? 'bg-[#2DD4BF]'
        : voiceLevel.speaker === 'caller'
          ? 'bg-zinc-200'
          : 'bg-zinc-600/70';

  const statusText = isRinging
    ? 'Calling appointment desk...'
    : callState === 'ended'
      ? 'Call ended'
      : isMuted
        ? 'Microphone muted'
        : voiceLevel.speaker === 'agent'
          ? 'Assistant speaking'
          : voiceLevel.speaker === 'caller'
            ? 'Listening to you'
            : 'Ready — speak naturally';

  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <div
        className="flex h-12 items-center justify-center gap-1"
        aria-hidden="true"
      >
        {BAR_WEIGHTS.map((weight, idx) => {
          const jitter =
            isConnected && voiceLevel.level > 0.03
              ? 0.75 + (((idx * 37) % 10) / 10) * 0.45
              : 1;
          const scaleY = isRinging
            ? 0.22 + weight * 0.25
            : Math.min(1, Math.max(0.12, activeEnergy * weight * jitter * 1.45));

          return (
            <span
              key={idx}
              className={`h-10 w-[3px] rounded-full transition-transform duration-100 ease-out ${barColor}`}
              style={{
                transform: `scaleY(${scaleY.toFixed(3)})`,
              }}
            />
          );
        })}
      </div>
      <p className="text-xs text-zinc-400">{statusText}</p>
    </div>
  );
}
