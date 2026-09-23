import crypto from 'crypto';

export const TELEGRAM_PRODUCTION_PUBLIC_KEY_HEX =
  'e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const DEFAULT_AUTH_MAX_AGE_SECONDS = 5 * 60;
const DEFAULT_SESSION_TTL_SECONDS = 30 * 60;
const CLOCK_SKEW_SECONDS = 30;

export class TelegramMiniAppValidationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonEmptyString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function parseTelegramUserId(value) {
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) throw new TelegramMiniAppValidationError('invalid_user');

  try {
    if (BigInt(normalized) <= 0n) throw new TelegramMiniAppValidationError('invalid_user');
  } catch (error) {
    if (error instanceof TelegramMiniAppValidationError) throw error;
    throw new TelegramMiniAppValidationError('invalid_user');
  }

  return normalized;
}

function parseInitData(initData) {
  if (typeof initData !== 'string' || !initData || initData.length > 8192) {
    throw new TelegramMiniAppValidationError('invalid_init_data');
  }

  const params = new URLSearchParams(initData);
  const entries = [];
  const seen = new Set();
  for (const [key, value] of params.entries()) {
    if (!key || seen.has(key)) throw new TelegramMiniAppValidationError('invalid_init_data');
    seen.add(key);
    entries.push([key, value]);
  }

  const signature = params.get('signature');
  if (!signature) throw new TelegramMiniAppValidationError('missing_signature');

  const userRaw = params.get('user');
  const authDateRaw = params.get('auth_date');
  if (!userRaw || !authDateRaw) throw new TelegramMiniAppValidationError('missing_identity');

  let user;
  try {
    user = JSON.parse(userRaw);
  } catch {
    throw new TelegramMiniAppValidationError('invalid_user');
  }

  if (!user || typeof user !== 'object' || Array.isArray(user)) {
    throw new TelegramMiniAppValidationError('invalid_user');
  }

  const telegramUserId = parseTelegramUserId(user.id);
  const authDate = Number.parseInt(authDateRaw, 10);
  if (!Number.isSafeInteger(authDate) || String(authDate) !== authDateRaw || authDate <= 0) {
    throw new TelegramMiniAppValidationError('invalid_auth_date');
  }

  const dataCheckString = entries
    .filter(([key]) => key !== 'hash' && key !== 'signature')
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  return { signature, telegramUserId, authDate, user, dataCheckString };
}

export function getTelegramProductionPublicKey() {
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(TELEGRAM_PRODUCTION_PUBLIC_KEY_HEX, 'hex')]),
    format: 'der',
    type: 'spki',
  });
}

export function verifyTelegramMiniAppInitData(initData, {
  botId,
  publicKey = getTelegramProductionPublicKey(),
  now = Math.floor(Date.now() / 1000),
  maxAgeSeconds = DEFAULT_AUTH_MAX_AGE_SECONDS,
} = {}) {
  const normalizedBotId = parseTelegramUserId(botId);
  const parsed = parseInitData(initData);
  const signature = Buffer.from(parsed.signature, 'base64url');
  if (signature.length !== 64) throw new TelegramMiniAppValidationError('invalid_signature');

  const dataCheckString = `${normalizedBotId}:WebAppData\n${parsed.dataCheckString}`;
  const isValid = crypto.verify(null, Buffer.from(dataCheckString), publicKey, signature);
  if (!isValid) throw new TelegramMiniAppValidationError('invalid_signature');

  const maxAge = positiveInt(maxAgeSeconds, DEFAULT_AUTH_MAX_AGE_SECONDS);
  if (parsed.authDate > now + CLOCK_SKEW_SECONDS || now - parsed.authDate > maxAge) {
    throw new TelegramMiniAppValidationError('expired_init_data');
  }

  return {
    telegramUserId: parsed.telegramUserId,
    authDate: parsed.authDate,
    user: {
      id: parsed.telegramUserId,
      firstName: nonEmptyString(parsed.user.first_name),
      lastName: nonEmptyString(parsed.user.last_name),
      username: nonEmptyString(parsed.user.username),
      languageCode: nonEmptyString(parsed.user.language_code),
    },
  };
}

export function getTelegramMiniAppConfig(env = process.env) {
  const enabled = String(env.TELEGRAM_MINI_APP_ENABLED || '').toLowerCase() === 'true';
  if (!enabled) return { enabled: false };

  const botId = nonEmptyString(env.TELEGRAM_MINI_APP_BOT_ID);
  const botDatabase = nonEmptyString(env.TELEGRAM_MINI_APP_BOT_DATABASE);
  if (!botId || !botDatabase) {
    throw new Error('Telegram Mini App requires TELEGRAM_MINI_APP_BOT_ID and TELEGRAM_MINI_APP_BOT_DATABASE');
  }
  parseTelegramUserId(botId);
  if (!/^[A-Za-z0-9_]+$/.test(botDatabase)) {
    throw new Error('TELEGRAM_MINI_APP_BOT_DATABASE has an invalid value');
  }

  return {
    enabled: true,
    botId,
    botDatabase,
    authMaxAgeSeconds: positiveInt(env.TELEGRAM_MINI_APP_AUTH_MAX_AGE_SECONDS, DEFAULT_AUTH_MAX_AGE_SECONDS),
    sessionTtlSeconds: positiveInt(env.TELEGRAM_MINI_APP_SESSION_TTL_SECONDS, DEFAULT_SESSION_TTL_SECONDS),
  };
}
