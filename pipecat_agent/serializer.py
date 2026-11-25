"""JSON WebSocket FrameSerializer matching the Meridian Clinic browser client.

Translates base64-encoded 16kHz PCM audio frames from the browser phone screen
into Pipecat InputAudioRawFrame objects, and serializes Pipecat OutputAudioRawFrame
and interruption frames back to the exact JSON format expected by the frontend.
"""

from __future__ import annotations

import base64
import json
from typing import Optional

from pipecat.frames.frames import (
    EndFrame,
    Frame,
    InputAudioRawFrame,
    OutputAudioRawFrame,
    StartInterruptionFrame,
)
from pipecat.serializers.base_serializer import FrameSerializer, FrameSerializerType


class BrowserJsonFrameSerializer(FrameSerializer):
    def __init__(self, sample_rate_in: int = 16000) -> None:
        super().__init__()
        self._sample_rate_in = sample_rate_in

    @property
    def type(self) -> FrameSerializerType:
        return FrameSerializerType.TEXT

    async def serialize(self, frame: Frame) -> Optional[str]:
        if isinstance(frame, OutputAudioRawFrame):
            encoded = base64.b64encode(frame.audio).decode("ascii")
            return json.dumps({"type": "audio", "data": encoded})
        if isinstance(frame, StartInterruptionFrame):
            return json.dumps({"type": "interrupted"})
        return None

    async def deserialize(self, data: str | bytes) -> Optional[Frame]:
        if isinstance(data, bytes):
            data = data.decode("utf-8", errors="ignore")
        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            return None

        msg_type = payload.get("type")
        if msg_type == "end":
            return EndFrame()

        pcm_b64 = payload.get("audio") or payload.get("data")
        if (msg_type == "audio" or payload.get("audio")) and pcm_b64:
            pcm_bytes = base64.b64decode(pcm_b64)
            return InputAudioRawFrame(
                audio=pcm_bytes,
                sample_rate=self._sample_rate_in,
                num_channels=1,
            )

        return None
