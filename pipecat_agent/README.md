# Meridian Clinic — Python Pipecat Voice Pipeline

Real-time voice AI pipeline built with **Pipecat**, **Silero VAD**, **ElevenLabs STT & TTS**, and **Google Gemini** function calling.

## Pipeline Flow

```text
Browser 16kHz PCM Audio (WebSocket)
  -> FastAPIWebsocketTransport + SileroVADAnalyzer
  -> ElevenLabsSTTService
  -> GoogleLLMService (check_doctor_availability, book_appointment, cancel_appointment)
  -> ElevenLabsTTSService (24kHz PCM)
  -> Browser Audio Output + Live Transcript + Dashboard Webhook Sync
```

## Setup & Run

```bash
cd pipecat_agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export GEMINI_API_KEY="your-gemini-key"
export ELEVENLABS_API_KEY="your-elevenlabs-key"
# Optional: defaults to ../data/clinic.db shared with the web dashboard
export CLINIC_DB_PATH="../data/clinic.db"

python bot.py
```

The Pipecat server listens on `ws://localhost:8000/ws/call`. Open **Voice Engine** in the Meridian Clinic dashboard footer and select **Local Pipecat Server** to connect the browser phone overlay directly to this pipeline.
