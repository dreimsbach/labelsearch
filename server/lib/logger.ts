import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

type LogLevel = 'info' | 'warn' | 'error';

const defaultLogFile = path.resolve(process.cwd(), 'logs/app.log');
const logFile = process.env.LOG_FILE_PATH?.trim() || defaultLogFile;
const logDir = path.dirname(logFile);

let initialized = false;
let initFailed = false;

async function ensureLogDir(): Promise<void> {
  if (initialized || initFailed) {
    return;
  }

  try {
    await mkdir(logDir, { recursive: true });
    initialized = true;
  } catch {
    initFailed = true;
  }
}

function serializeMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) {
    return '';
  }

  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ' {"meta":"unserializable"}';
  }
}

export async function log(level: LogLevel, message: string, meta?: Record<string, unknown>): Promise<void> {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${serializeMeta(meta)}\n`;

  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(line.trimEnd());
  } else {
    // eslint-disable-next-line no-console
    console.log(line.trimEnd());
  }

  await ensureLogDir();
  if (!initialized) {
    return;
  }

  try {
    await appendFile(logFile, line, 'utf8');
  } catch {
    // Ignore file write failures; console output is still available.
  }
}

export function logInfo(message: string, meta?: Record<string, unknown>): Promise<void> {
  return log('info', message, meta);
}

export function logWarn(message: string, meta?: Record<string, unknown>): Promise<void> {
  return log('warn', message, meta);
}

export function logError(message: string, meta?: Record<string, unknown>): Promise<void> {
  return log('error', message, meta);
}

