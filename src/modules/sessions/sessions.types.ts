export interface SessionInfo {
  name: string;
  path: string;
  exists: boolean;
  /** creds.json existe e contém uma conta pareada (me.id). */
  authenticated: boolean;
  account?: { id: string; name?: string; lid?: string };
  files: number;
  sizeBytes: number;
  lastUpdatedAt?: string;
  /** Sessão em uso por este processo (lock adquirido). */
  locked: boolean;
}
