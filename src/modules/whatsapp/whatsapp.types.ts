export enum ConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  QR_CODE = 'QR_CODE',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
  LOGGED_OUT = 'LOGGED_OUT',
  ERROR = 'ERROR',
}

export interface ConnectionSnapshot {
  status: ConnectionStatus;
  sessionName: string;
  hasSession: boolean;
  qrAvailable: boolean;
  qrGeneratedAt?: string;
  connectedAt?: string;
  lastDisconnect?: { code?: number; reason: string; at: string };
  reconnectAttempts: number;
  user?: { id: string; name?: string; lid?: string };
}

export interface QrPayload {
  qr: string;
  dataUrl: string;
  generatedAt: string;
  cycle: number;
}

export const WA_EVENTS = {
  STATUS: 'whatsapp.status',
  QR: 'whatsapp.qr',
  CONNECTED: 'whatsapp.connected',
  DISCONNECTED: 'whatsapp.disconnected',
  RECONNECTING: 'whatsapp.reconnecting',
  LOGGED_OUT: 'whatsapp.logged_out',
  ERROR: 'whatsapp.error',
  MESSAGE: 'whatsapp.message',
} as const;
