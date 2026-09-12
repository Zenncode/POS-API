import fs from 'fs';
import path from 'path';

function normalizeEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const startsWithDoubleQuote = trimmed.startsWith('"') && trimmed.endsWith('"');
  const startsWithSingleQuote = trimmed.startsWith("'") && trimmed.endsWith("'");

  if (startsWithDoubleQuote) {
    return trimmed.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r');
  }

  if (startsWithSingleQuote) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

export function loadEnvFile(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf-8');
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = normalizeEnvValue(line.slice(separatorIndex + 1));

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
