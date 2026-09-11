import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';

type RoomBroadcastPayload = {
  room?: string;
  event?: string;
  data?: unknown;
};

let io: SocketServer | null = null;

function resolveSocketPath(): string {
  const raw = process.env.SOCKET_PATH?.trim();
  if (!raw) {
    return '/socket.io';
  }

  return raw.startsWith('/') ? raw : `/${raw}`;
}

function resolveAllowedOrigins(): string[] {
  const originValue = process.env.SOCKET_CORS_ORIGIN ?? process.env.CORS_ORIGIN;
  if (!originValue) {
    return ['*'];
  }

  return originValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) {
    return true;
  }

  return allowedOrigins.includes('*') || allowedOrigins.includes(origin);
}

function bindSocketEvents(socket: Socket): void {
  socket.emit('socket:welcome', {
    id: socket.id,
    connectedAt: new Date().toISOString(),
  });

  socket.on('ping', (payload: unknown, ack?: (response: unknown) => void) => {
    const response = {
      message: 'pong',
      timestamp: new Date().toISOString(),
      payload: payload ?? null,
    };

    if (typeof ack === 'function') {
      ack(response);
      return;
    }

    socket.emit('pong', response);
  });

  socket.on('join:room', (room: string, ack?: (response: unknown) => void) => {
    const normalizedRoom = typeof room === 'string' ? room.trim() : '';
    if (!normalizedRoom) {
      if (typeof ack === 'function') {
        ack({ ok: false, message: 'Room is required' });
      }
      return;
    }

    void socket.join(normalizedRoom);
    if (typeof ack === 'function') {
      ack({ ok: true, room: normalizedRoom });
    }
  });

  socket.on('leave:room', (room: string, ack?: (response: unknown) => void) => {
    const normalizedRoom = typeof room === 'string' ? room.trim() : '';
    if (!normalizedRoom) {
      if (typeof ack === 'function') {
        ack({ ok: false, message: 'Room is required' });
      }
      return;
    }

    void socket.leave(normalizedRoom);
    if (typeof ack === 'function') {
      ack({ ok: true, room: normalizedRoom });
    }
  });

  socket.on('broadcast:room', (payload: RoomBroadcastPayload, ack?: (response: unknown) => void) => {
    const room = typeof payload?.room === 'string' ? payload.room.trim() : '';
    const eventName = typeof payload?.event === 'string' ? payload.event.trim() : '';

    if (!room || !eventName) {
      if (typeof ack === 'function') {
        ack({ ok: false, message: 'room and event are required' });
      }
      return;
    }

    io?.to(room).emit(eventName, payload?.data ?? null);
    if (typeof ack === 'function') {
      ack({ ok: true, room, event: eventName });
    }
  });
}

export function initializeSocketServer(httpServer: HttpServer): SocketServer {
  if (io) {
    return io;
  }

  const socketPath = resolveSocketPath();
  const allowedOrigins = resolveAllowedOrigins();

  io = new SocketServer(httpServer, {
    path: socketPath,
    cors: {
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin, allowedOrigins)) {
          callback(null, true);
          return;
        }

        callback(new Error('Socket CORS blocked'));
      },
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    bindSocketEvents(socket);
  });

  return io;
}

export function getSocketServer(): SocketServer | null {
  return io;
}

export async function closeSocketServer(): Promise<void> {
  if (!io) {
    return;
  }

  await new Promise<void>((resolve) => {
    io?.close(() => resolve());
  });

  io = null;
}
