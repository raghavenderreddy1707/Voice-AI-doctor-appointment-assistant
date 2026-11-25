import { useState } from 'react';
import { X } from 'lucide-react';

interface PipelineModalProps {
  isOpen: boolean;
  mode: 'builtin' | 'pipecat';
  pipecatUrl: string;
  onSave: (mode: 'builtin' | 'pipecat', pipecatUrl: string) => void;
  onClose: () => void;
}

export function PipelineModal({
  isOpen,
  mode,
  pipecatUrl,
  onSave,
  onClose,
}: PipelineModalProps) {
  const [selectedMode, setSelectedMode] = useState<'builtin' | 'pipecat'>(mode);
  const [urlInput, setUrlInput] = useState(pipecatUrl);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Voice engine settings"
    >
      <div className="w-full max-w-md rounded-2xl border border-[#E5E5E0] bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#18181B]">
            Voice engine
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#64748B] hover:bg-black/5 hover:text-[#18181B]"
            aria-label="Close voice engine settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-sm text-[#64748B]">
          Use the built-in real-time voice server or point calls at your local
          Python Pipecat + ElevenLabs server.
        </p>

        <div className="mt-4 space-y-2.5">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#E5E5E0] p-3.5 hover:bg-[#F8F8F6]">
            <input
              type="radio"
              name="voice-mode"
              checked={selectedMode === 'builtin'}
              onChange={() => setSelectedMode('builtin')}
              className="mt-1 accent-[#0F766E]"
            />
            <div>
              <div className="text-sm font-medium text-[#18181B]">
                Built-in live voice (default)
              </div>
              <div className="mt-0.5 text-xs text-[#64748B]">
                Gemini Live audio + tool calling over this server&apos;s
                WebSocket.
              </div>
            </div>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#E5E5E0] p-3.5 hover:bg-[#F8F8F6]">
            <input
              type="radio"
              name="voice-mode"
              checked={selectedMode === 'pipecat'}
              onChange={() => setSelectedMode('pipecat')}
              className="mt-1 accent-[#0F766E]"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-[#18181B]">
                Python Pipecat server
              </div>
              <div className="mt-0.5 text-xs text-[#64748B]">
                Silero VAD · ElevenLabs STT/TTS · Gemini LLM sharing{' '}
                <span className="font-mono">data/clinic.db</span>.
              </div>
              {selectedMode === 'pipecat' && (
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="ws://localhost:8000/ws/call"
                  className="mt-2.5 h-9 w-full rounded-lg border border-[#E5E5E0] bg-white px-3 font-mono text-xs text-[#18181B] focus:border-[#0F766E] focus:outline-none"
                />
              )}
            </div>
          </label>
        </div>

        <div className="mt-4 rounded-xl bg-[#F8F8F6] p-3 font-mono text-[11px] leading-relaxed text-[#475569]">
          cd pipecat_agent &amp;&amp; pip install -r requirements.txt &amp;&amp;
          python bot.py
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg px-4 text-sm font-medium text-[#64748B] hover:bg-black/5 hover:text-[#18181B]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(
                selectedMode,
                urlInput.trim() || 'ws://localhost:8000/ws/call'
              );
              onClose();
            }}
            className="h-9 rounded-lg bg-[#0F766E] px-4 text-sm font-medium text-white hover:bg-[#115E59]"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
