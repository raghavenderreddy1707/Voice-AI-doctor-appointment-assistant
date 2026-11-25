"""Meridian Clinic — Pipecat Real-Time Voice AI Pipeline.

Pipeline architecture:
    Browser Audio (16kHz PCM over WebSocket)
      -> FastAPIWebsocketTransport (with SileroVADAnalyzer)
      -> ElevenLabsSTTService (Speech-to-Text)
      -> LLMContextAggregatorPair.user()
      -> GoogleLLMService (Gemini + function calling tools)
      -> ElevenLabsTTSService (24kHz PCM Text-to-Speech)
      -> FastAPIWebsocketTransport.output()
      -> LLMContextAggregatorPair.assistant()

Registered tools:
    - check_doctor_availability
    - book_appointment
    - cancel_appointment
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

import aiohttp
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import (
    Frame,
    LLMFullResponseEndFrame,
    LLMTextFrame,
    TranscriptionFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.elevenlabs.stt import ElevenLabsSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.google.llm import GoogleLLMService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

from db import (
    book_appointment,
    cancel_appointment,
    check_doctor_availability,
    list_doctors_summary,
    local_date_str,
)
from serializer import BrowserJsonFrameSerializer

load_dotenv(override=True)

DASHBOARD_URL = os.getenv("DASHBOARD_URL", "http://127.0.0.1:3000")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

app = FastAPI(title="Meridian Clinic Pipecat Voice Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def build_system_prompt() -> str:
    doctors = list_doctors_summary()
    roster = "\n".join(
        f"- {d['name']} ({d['specialty']}, {d['room']})" for d in doctors
    )
    return (
        "You are the warm, concise phone receptionist for Meridian Clinic.\n\n"
        f"Today's date is {local_date_str(0)}. Tomorrow is {local_date_str(1)}.\n\n"
        f"Clinic doctors:\n{roster}\n\n"
        "Rules:\n"
        "1. Speak naturally in 1 to 3 short sentences. No markdown or bullet lists.\n"
        "2. Identify callers ONLY by the phone number they say out loud. No login, OTP, or caller-ID.\n"
        "3. Always call check_doctor_availability before offering open slots.\n"
        "4. ALWAYS read the caller's phone number back clearly and wait for them to confirm "
        "before calling book_appointment or cancel_appointment.\n"
        "5. Support checking availability, booking, and cancellation smoothly in a single call."
    )


def build_tools_schema() -> ToolsSchema:
    return ToolsSchema(
        standard_tools=[
            FunctionSchema(
                name="check_doctor_availability",
                description=(
                    "Returns open appointment slots for a doctor, medical specialty, or date."
                ),
                properties={
                    "doctor_name": {
                        "type": "string",
                        "description": "Doctor name or last name, e.g. 'Dr. Maya Lin'.",
                    },
                    "specialty": {
                        "type": "string",
                        "description": "Medical specialty, e.g. 'Cardiology' or 'Dermatology'.",
                    },
                    "date": {
                        "type": "string",
                        "description": "Date in YYYY-MM-DD format, or 'today' / 'tomorrow'.",
                    },
                },
                required=[],
            ),
            FunctionSchema(
                name="book_appointment",
                description=(
                    "Books an available slot using the caller's spoken phone number. "
                    "Only call after reading the phone number back and confirming with the caller."
                ),
                properties={
                    "doctor_name": {"type": "string", "description": "Doctor name."},
                    "date": {"type": "string", "description": "Date in YYYY-MM-DD format."},
                    "time": {"type": "string", "description": "Start time, e.g. '10:30' or '2:30 PM'."},
                    "slot_id": {"type": "integer", "description": "Optional exact slot_id."},
                    "caller_phone": {
                        "type": "string",
                        "description": "Phone number spoken and confirmed by the caller.",
                    },
                    "caller_name": {
                        "type": "string",
                        "description": "Optional caller name if volunteered.",
                    },
                },
                required=["caller_phone"],
            ),
            FunctionSchema(
                name="cancel_appointment",
                description=(
                    "Cancels an existing appointment found by the caller's spoken phone number. "
                    "Only call after reading the phone number back and confirming with the caller."
                ),
                properties={
                    "caller_phone": {
                        "type": "string",
                        "description": "Phone number spoken and confirmed by the caller.",
                    },
                    "doctor_name": {
                        "type": "string",
                        "description": "Optional doctor name if the caller has multiple appointments.",
                    },
                    "date": {
                        "type": "string",
                        "description": "Optional date in YYYY-MM-DD format.",
                    },
                },
                required=["caller_phone"],
            ),
        ]
    )


class TranscriptForwarder(FrameProcessor):
    """Forwards STT user transcripts and LLM assistant text to the browser UI."""

    def __init__(self, websocket: WebSocket) -> None:
        super().__init__()
        self._ws = websocket

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        try:
            if isinstance(frame, TranscriptionFrame) and frame.text.strip():
                await self._ws.send_text(
                    json.dumps(
                        {
                            "type": "transcript",
                            "speaker": "caller",
                            "text": frame.text,
                        }
                    )
                )
            elif isinstance(frame, LLMTextFrame) and frame.text:
                await self._ws.send_text(
                    json.dumps(
                        {
                            "type": "transcript",
                            "speaker": "agent",
                            "text": frame.text,
                        }
                    )
                )
            elif isinstance(frame, LLMFullResponseEndFrame):
                await self._ws.send_text(json.dumps({"type": "turn_complete"}))
        except Exception:
            pass
        await self.push_frame(frame, direction)


async def notify_dashboard(appointment_id: int, action: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            await client.post(
                f"{DASHBOARD_URL}/api/events/notify",
                json={"appointmentId": appointment_id, "action": action},
            )
    except Exception as exc:
        logger.debug(f"Dashboard webhook skipped: {exc}")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "pipeline": "pipecat-elevenlabs-gemini-silero"}


@app.websocket("/ws/call")
async def voice_call_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    await websocket.send_text(json.dumps({"type": "connected"}))

    elevenlabs_key = os.getenv("ELEVENLABS_API_KEY", "")
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    if not elevenlabs_key or not gemini_key:
        await websocket.send_text(
            json.dumps(
                {
                    "type": "error",
                    "message": "ELEVENLABS_API_KEY and GEMINI_API_KEY must be set to run the Pipecat server.",
                }
            )
        )
        await websocket.close()
        return

    async with aiohttp.ClientSession() as http_session:
        transport = FastAPIWebsocketTransport(
            websocket=websocket,
            params=FastAPIWebsocketParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                audio_in_sample_rate=16000,
                audio_out_sample_rate=24000,
                vad_analyzer=SileroVADAnalyzer(),
                serializer=BrowserJsonFrameSerializer(sample_rate_in=16000),
            ),
        )

        stt = ElevenLabsSTTService(
            api_key=elevenlabs_key,
            aiohttp_session=http_session,
        )

        llm = GoogleLLMService(
            api_key=gemini_key,
            model=GEMINI_MODEL,
        )

        tts = ElevenLabsTTSService(
            api_key=elevenlabs_key,
            voice_id=ELEVENLABS_VOICE_ID,
            sample_rate=24000,
            aiohttp_session=http_session,
        )

        async def handle_check_availability(params: FunctionCallParams) -> None:
            args: dict[str, Any] = params.arguments or {}
            logger.info(f"Tool check_doctor_availability({args})")
            result = check_doctor_availability(
                doctor_name=args.get("doctor_name"),
                specialty=args.get("specialty"),
                date=args.get("date"),
            )
            await params.result_callback(result)

        async def handle_book_appointment(params: FunctionCallParams) -> None:
            args: dict[str, Any] = params.arguments or {}
            logger.info(f"Tool book_appointment({args})")
            result = book_appointment(
                caller_phone=str(args.get("caller_phone", "")),
                doctor_name=args.get("doctor_name"),
                date=args.get("date"),
                time=args.get("time"),
                slot_id=args.get("slot_id"),
                caller_name=args.get("caller_name"),
            )
            if result.get("success") and result.get("appointment"):
                appt = result["appointment"]
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "action_card",
                            "card": {
                                "id": f"booked-{appt['id']}-{int(time.time() * 1000)}",
                                "type": "booked",
                                "doctorName": appt["doctorName"],
                                "specialty": appt["specialty"],
                                "date": appt["date"],
                                "displayTime": appt["displayTime"],
                                "callerPhoneFormatted": appt["callerPhoneFormatted"],
                                "appointmentId": appt["id"],
                            },
                        }
                    )
                )
                await notify_dashboard(appt["id"], "booked")
            await params.result_callback(result)

        async def handle_cancel_appointment(params: FunctionCallParams) -> None:
            args: dict[str, Any] = params.arguments or {}
            logger.info(f"Tool cancel_appointment({args})")
            result = cancel_appointment(
                caller_phone=str(args.get("caller_phone", "")),
                doctor_name=args.get("doctor_name"),
                date=args.get("date"),
            )
            if result.get("success") and result.get("appointment"):
                appt = result["appointment"]
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "action_card",
                            "card": {
                                "id": f"cancelled-{appt['id']}-{int(time.time() * 1000)}",
                                "type": "cancelled",
                                "doctorName": appt["doctorName"],
                                "specialty": appt["specialty"],
                                "date": appt["date"],
                                "displayTime": appt["displayTime"],
                                "callerPhoneFormatted": appt["callerPhoneFormatted"],
                                "appointmentId": appt["id"],
                            },
                        }
                    )
                )
                await notify_dashboard(appt["id"], "cancelled")
            await params.result_callback(result)

        llm.register_function("check_doctor_availability", handle_check_availability)
        llm.register_function("book_appointment", handle_book_appointment)
        llm.register_function("cancel_appointment", handle_cancel_appointment)

        context = LLMContext(
            messages=[
                {"role": "system", "content": build_system_prompt()},
                {
                    "role": "user",
                    "content": "The call has just connected. Greet the caller warmly in one short sentence as Meridian Clinic and ask how you can help.",
                },
            ],
            tools=build_tools_schema(),
        )
        context_aggregator = LLMContextAggregatorPair(context)
        transcript_forwarder = TranscriptForwarder(websocket)

        pipeline = Pipeline(
            [
                transport.input(),
                stt,
                transcript_forwarder,
                context_aggregator.user(),
                llm,
                tts,
                transport.output(),
                context_aggregator.assistant(),
            ]
        )

        task = PipelineTask(
            pipeline,
            params=PipelineParams(
                allow_interruptions=True,
                enable_metrics=False,
            ),
        )

        @transport.event_handler("on_client_connected")
        async def on_client_connected(_transport: Any, _client: Any) -> None:
            await task.queue_frames([context_aggregator.user().get_context_frame()])

        @transport.event_handler("on_client_disconnected")
        async def on_client_disconnected(_transport: Any, _client: Any) -> None:
            await task.cancel()

        runner = PipelineRunner(handle_sigint=False)
        await runner.run(task)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "bot:app",
        host="0.0.0.0",
        port=int(os.getenv("PIPECAT_PORT", "8000")),
        reload=False,
    )
