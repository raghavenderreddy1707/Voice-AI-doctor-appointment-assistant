import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { HighlightEvent } from './src/types.ts';
import { getSchedule, resetDatabase } from './src/server/db.ts';
import { attachVoiceCallSession } from './src/server/voiceSession.ts';

const PORT = Number(process.env.PORT) || 3000;
const app = express();
app.use(express.json());

const server = http.createServer(app);

// WebSocket servers attached with noServer so we route /ws/call and /ws/events cleanly
const callWss = new WebSocketServer({ noServer: true });
const eventsWss = new WebSocketServer({ noServer: true });

const eventClients = new Set<WebSocket>();

eventsWss.on('connection', (ws) => {
  eventClients.add(ws);
  ws.send(
    JSON.stringify({
      type: 'schedule_snapshot',
      schedule: getSchedule(),
    })
  );

  ws.on('close', () => {
    eventClients.delete(ws);
  });
});

function broadcastScheduleUpdate(highlight?: HighlightEvent): void {
  const payload = JSON.stringify({
    type: 'schedule_updated',
    schedule: getSchedule(),
    highlight: highlight ?? null,
  });

  for (const client of eventClients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}

callWss.on('connection', (ws) => {
  void attachVoiceCallSession(ws, (highlight) => {
    broadcastScheduleUpdate(highlight);
  });
});

server.on('upgrade', (request, socket, head) => {
  const url = request.url || '';
  if (url.startsWith('/ws/call')) {
    callWss.handleUpgrade(request, socket, head, (ws) => {
      callWss.emit('connection', ws, request);
    });
  } else if (url.startsWith('/ws/events')) {
    eventsWss.handleUpgrade(request, socket, head, (ws) => {
      eventsWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// REST API Routes
app.get('/api/schedule', (_req, res) => {
  res.json(getSchedule());
});

app.post('/api/reset', (_req, res) => {
  const schedule = resetDatabase();
  broadcastScheduleUpdate();
  res.json(schedule);
});

// Webhook endpoint used by the external Python Pipecat server after mutating the shared SQLite DB
app.post('/api/events/notify', (req, res) => {
  const { appointmentId, action } = (req.body ?? {}) as {
    appointmentId?: number;
    action?: 'booked' | 'cancelled';
  };
  if (
    typeof appointmentId === 'number' &&
    (action === 'booked' || action === 'cancelled')
  ) {
    broadcastScheduleUpdate({ appointmentId, action });
  } else {
    broadcastScheduleUpdate();
  }
  res.json({ ok: true });
});

async function startServer() {
  const isProd =
    process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Meridian Clinic server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
