import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CallToneSynthesizer,
  Pcm24kPlayer,
  computeRms,
  float32ToPcm16Base64,
} from '../lib/audio';
import { formatClockTime } from '../lib/dates';
import type { ActionCardPayload, CallState, TranscriptEntry } from '../types';

export interface VoiceLevelState {
  level: number;
  speaker: 'idle' | 'caller' | 'agent';
}

interface UseVoiceCallOptions {
  wsUrl: string;
}

export function useVoiceCall({ wsUrl }: UseVoiceCallOptions) {
  const [callState, setCallState] = useState<CallState>('idle');
  const [isOpen, setIsOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [actionCards, setActionCards] = useState<ActionCardPayload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [voiceLevel, setVoiceLevel] = useState<VoiceLevelState>({
    level: 0,
    speaker: 'idle',
  });

  // Refs used inside audio/WebSocket callbacks to avoid stale closures
  const wsRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playerRef = useRef<Pcm24kPlayer | null>(null);
  const tonesRef = useRef<CallToneSynthesizer | null>(null);
  const isMutedRef = useRef(false);
  const callStateRef = useRef<CallState>('idle');
  const micLevelRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const connectedAtRef = useRef<number>(0);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  const stopMediaAndSocket = useCallback((sendEndSignal: boolean) => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      try {
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
      processorRef.current = null;
    }

    if (inputCtxRef.current) {
      if (inputCtxRef.current.state !== 'closed') {
        void inputCtxRef.current.close();
      }
      inputCtxRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }

    if (playerRef.current) {
      void playerRef.current.close();
      playerRef.current = null;
    }

    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      if (sendEndSignal && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'end' }));
        } catch {
          // ignore
        }
      }
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
    }

    micLevelRef.current = 0;
    setVoiceLevel({ level: 0, speaker: 'idle' });
  }, []);

  const appendTranscriptDelta = useCallback(
    (speaker: 'caller' | 'agent', deltaText: string) => {
      const clean = deltaText;
      if (!clean) return;
      setTranscript((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.speaker === speaker) {
          const needsSpace =
            last.text.length > 0 &&
            !last.text.endsWith(' ') &&
            !clean.startsWith(' ') &&
            !/^[,.;:!?']/.test(clean);
          const merged = needsSpace ? `${last.text} ${clean}` : `${last.text}${clean}`;
          return [
            ...prev.slice(0, -1),
            { ...last, text: merged.replace(/\s+/g, ' ') },
          ];
        }
        return [
          ...prev,
          {
            id: `${speaker}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            speaker,
            text: clean.trimStart(),
            timestamp: formatClockTime(),
          },
        ];
      });
    },
    []
  );

  const startCall = useCallback(async () => {
    stopMediaAndSocket(false);
    setError(null);
    setTranscript([]);
    setActionCards([]);
    setElapsedSeconds(0);
    setIsMuted(false);
    isMutedRef.current = false;
    setIsOpen(true);
    setCallState('ringing');
    callStateRef.current = 'ringing';

    if (!tonesRef.current) {
      tonesRef.current = new CallToneSynthesizer();
    }
    tonesRef.current.startRinging();
    const ringStartedAt = Date.now();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      tonesRef.current.stopRinging();
      setError(
        'Microphone access is needed to speak with the appointment assistant. Please allow microphone access and try again.'
      );
      setCallState('ended');
      return;
    }

    const stateAfterMic = callStateRef.current as CallState;
    if (stateAfterMic === 'ended' || stateAfterMic === 'idle') {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    micStreamRef.current = stream;

    const player = new Pcm24kPlayer();
    await player.resume();
    playerRef.current = player;

    const inputCtx = new AudioContext({ sampleRate: 16000 });
    if (inputCtx.state === 'suspended') {
      await inputCtx.resume();
    }
    inputCtxRef.current = inputCtx;

    const source = inputCtx.createMediaStreamSource(stream);
    const processor = inputCtx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    // Connect through a zero-gain sink so microphone audio isn't echoed locally
    const silentGain = inputCtx.createGain();
    silentGain.gain.value = 0;
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(inputCtx.destination);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const markConnected = () => {
      if (callStateRef.current !== 'ringing') return;
      const elapsedRing = Date.now() - ringStartedAt;
      const delay = Math.max(0, 900 - elapsedRing);

      window.setTimeout(() => {
        if (callStateRef.current !== 'ringing') return;
        tonesRef.current?.playConnectChime();
        setCallState('connected');
        callStateRef.current = 'connected';
        connectedAtRef.current = Date.now();
        timerRef.current = window.setInterval(() => {
          setElapsedSeconds(
            Math.floor((Date.now() - connectedAtRef.current) / 1000)
          );
        }, 500);
      }, delay);
    };

    processor.onaudioprocess = (event) => {
      const channelData = event.inputBuffer.getChannelData(0);
      if (isMutedRef.current) {
        micLevelRef.current = 0;
        return;
      }
      micLevelRef.current = computeRms(channelData);
      if (
        wsRef.current &&
        wsRef.current.readyState === WebSocket.OPEN &&
        callStateRef.current === 'connected'
      ) {
        const base64 = float32ToPcm16Base64(channelData);
        wsRef.current.send(JSON.stringify({ type: 'audio', audio: base64 }));
      }
    };

    const tickMeter = () => {
      const agentLevel = playerRef.current?.getLevel() ?? 0;
      const callerLevel = isMutedRef.current ? 0 : micLevelRef.current;

      if (agentLevel > 0.03) {
        setVoiceLevel({ level: agentLevel, speaker: 'agent' });
      } else if (callerLevel > 0.035 && callStateRef.current === 'connected') {
        setVoiceLevel({ level: callerLevel, speaker: 'caller' });
      } else {
        setVoiceLevel({ level: 0, speaker: 'idle' });
      }

      rafRef.current = requestAnimationFrame(tickMeter);
    };
    rafRef.current = requestAnimationFrame(tickMeter);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type?: string;
          data?: string;
          audio?: string;
          speaker?: 'caller' | 'agent';
          text?: string;
          card?: ActionCardPayload;
          message?: string;
        };

        if (msg.type === 'connected') {
          markConnected();
        } else if (msg.type === 'audio' || msg.audio) {
          markConnected();
          const pcm = msg.data || msg.audio;
          if (pcm) {
            playerRef.current?.enqueueBase64Pcm(pcm);
          }
        } else if (msg.type === 'interrupted') {
          playerRef.current?.interrupt();
        } else if (msg.type === 'transcript' && msg.speaker && msg.text) {
          appendTranscriptDelta(msg.speaker, msg.text);
        } else if (msg.type === 'action_card' && msg.card) {
          setActionCards((prev) => [msg.card!, ...prev].slice(0, 3));
        } else if (msg.type === 'error') {
          tonesRef.current?.stopRinging();
          setError(msg.message || 'The voice session encountered an error.');
          stopMediaAndSocket(false);
          setCallState('ended');
        } else if (msg.type === 'ended') {
          tonesRef.current?.playEndTone();
          stopMediaAndSocket(false);
          setCallState('ended');
        }
      } catch {
        // Ignore non-JSON frames
      }
    };

    ws.onerror = () => {
      tonesRef.current?.stopRinging();
      setError(
        `Could not reach the voice server (${wsUrl}). Check that the server is running and try again.`
      );
      stopMediaAndSocket(false);
      setCallState('ended');
    };

    ws.onclose = () => {
      if (
        callStateRef.current === 'ringing' ||
        callStateRef.current === 'connected'
      ) {
        tonesRef.current?.playEndTone();
        stopMediaAndSocket(false);
        setCallState('ended');
      }
    };
  }, [wsUrl, appendTranscriptDelta, stopMediaAndSocket]);

  const endCall = useCallback(() => {
    if (callStateRef.current === 'ringing' || callStateRef.current === 'connected') {
      tonesRef.current?.playEndTone();
    }
    stopMediaAndSocket(true);
    setCallState('ended');
  }, [stopMediaAndSocket]);

  const closeOverlay = useCallback(() => {
    if (callStateRef.current === 'ringing' || callStateRef.current === 'connected') {
      tonesRef.current?.playEndTone();
      stopMediaAndSocket(true);
    }
    setIsOpen(false);
    setCallState('idle');
  }, [stopMediaAndSocket]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  useEffect(() => {
    return () => {
      stopMediaAndSocket(false);
      tonesRef.current?.dispose();
    };
  }, [stopMediaAndSocket]);

  return {
    callState,
    isOpen,
    isMuted,
    elapsedSeconds,
    transcript,
    actionCards,
    error,
    voiceLevel,
    startCall,
    endCall,
    closeOverlay,
    toggleMute,
  };
}
