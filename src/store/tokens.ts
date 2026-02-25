import fs from 'fs';
import path from 'path';
import os from 'os';

interface TokenRecord {
  userId: number;
  accessToken: string;
  installedAt: string;
}

const STORE_PATH = path.join(process.cwd(), 'data', 'tokens.json');

function ensureDir() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(filePath: string, data: string): void {
  const tmp = path.join(os.tmpdir(), `tokens-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

export function saveToken(userId: number, accessToken: string): void {
  ensureDir();
  let records: Record<number, TokenRecord> = {};
  try {
    records = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {}
  records[userId] = { userId, accessToken, installedAt: new Date().toISOString() };
  atomicWrite(STORE_PATH, JSON.stringify(records, null, 2));
}

export function getToken(userId: number): TokenRecord | null {
  try {
    const records: Record<number, TokenRecord> = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return records[userId] ?? null;
  } catch {
    return null;
  }
}

export function removeToken(userId: number): void {
  try {
    ensureDir();
    let records: Record<number, TokenRecord> = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    delete records[userId];
    atomicWrite(STORE_PATH, JSON.stringify(records, null, 2));
  } catch {}
}
