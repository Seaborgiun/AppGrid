import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

interface TokenRecord {
  userId: number;
  accessToken: string;
  installedAt: string;
}

/** Encrypted token record stored on disk when TOKEN_ENCRYPTION_KEY is set. */
interface EncryptedTokenRecord {
  userId: number;
  iv: string;
  authTag: string;
  encrypted: string;
  installedAt: string;
}

type StoredRecord = TokenRecord | EncryptedTokenRecord;

const STORE_PATH = path.join(process.cwd(), 'data', 'tokens.json');
const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer | null {
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyHex) return null;
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY deve ter exatamente 64 caracteres hexadecimais (32 bytes).');
  }
  return key;
}

function encryptToken(plaintext: string, key: Buffer): { iv: string; authTag: string; encrypted: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    encrypted: encrypted.toString('hex'),
  };
}

function decryptToken(record: EncryptedTokenRecord, key: Buffer): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(record.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(record.authTag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(record.encrypted, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function isEncrypted(record: StoredRecord): record is EncryptedTokenRecord {
  return 'iv' in record && 'authTag' in record && 'encrypted' in record;
}

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
  let records: Record<number, StoredRecord> = {};
  try {
    records = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {}

  const key = getEncryptionKey();
  if (key) {
    const enc = encryptToken(accessToken, key);
    records[userId] = { userId, ...enc, installedAt: new Date().toISOString() };
  } else {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[Tokens] AVISO: TOKEN_ENCRYPTION_KEY não definida — tokens salvos em texto plano.');
    }
    records[userId] = { userId, accessToken, installedAt: new Date().toISOString() };
  }

  atomicWrite(STORE_PATH, JSON.stringify(records, null, 2));
}

export function getToken(userId: number): TokenRecord | null {
  try {
    const records: Record<number, StoredRecord> = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    const record = records[userId];
    if (!record) return null;

    if (isEncrypted(record)) {
      const key = getEncryptionKey();
      if (!key) {
        console.warn('[Tokens] AVISO: registro criptografado encontrado mas TOKEN_ENCRYPTION_KEY não está definida.');
        return null;
      }
      const accessToken = decryptToken(record, key);
      return { userId: record.userId, accessToken, installedAt: record.installedAt };
    }

    return record as TokenRecord;
  } catch {
    return null;
  }
}

export function removeToken(userId: number): void {
  try {
    ensureDir();
    const records: Record<number, StoredRecord> = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    delete records[userId];
    atomicWrite(STORE_PATH, JSON.stringify(records, null, 2));
  } catch {}
}

export function getAllTokens(): TokenRecord[] {
  try {
    const records: Record<number, StoredRecord> = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    const key = getEncryptionKey();
    return Object.values(records).map((record) => {
      if (isEncrypted(record)) {
        if (!key) {
          console.warn('[Tokens] AVISO: registro criptografado encontrado mas TOKEN_ENCRYPTION_KEY não está definida.');
          return null;
        }
        const accessToken = decryptToken(record, key);
        return { userId: record.userId, accessToken, installedAt: record.installedAt };
      }
      return record as TokenRecord;
    }).filter((r): r is TokenRecord => r !== null);
  } catch {
    return [];
  }
}
