import { createHmac, timingSafeEqual } from 'node:crypto';

interface TelegramInitUser {
  id: number;
  [key: string]: unknown;
}

/**
 * Validates the Telegram Mini App initData string.
 * @param initData The initData string from the Telegram Web App.
 * @param botToken The secret token of your Telegram bot.
 * @returns The parsed user data object if validation is successful, otherwise throws an error.
 */
export function validateInitData(initData: string, botToken: string): TelegramInitUser {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');

  if (!hash) {
    throw new Error('Invalid initData: Hash is missing');
  }

  params.delete('hash');

  const keys = Array.from(params.keys()).sort();
  const dataCheckString = keys
    .map(key => `${key}=${params.get(key)}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const hashBuf = Buffer.from(hash, 'hex');
  const calcBuf = Buffer.from(calculatedHash, 'hex');

  if (hashBuf.length !== calcBuf.length || !timingSafeEqual(hashBuf, calcBuf)) {
    throw new Error('Invalid initData: Hash does not match');
  }

  const authDate = Number(params.get('auth_date') ?? '0');
  const maxAgeSec = Number(process.env.TELEGRAM_INITDATA_MAX_AGE_SEC ?? '86400');
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new Error('Invalid initData: auth_date is missing');
  }
  if (!Number.isFinite(maxAgeSec) || maxAgeSec <= 0) {
    throw new Error('Invalid server config: TELEGRAM_INITDATA_MAX_AGE_SEC');
  }
  if (nowSec - authDate > maxAgeSec) {
    throw new Error('Invalid initData: auth_date is expired');
  }

  const userJson = params.get('user');
  if (!userJson) {
    throw new Error('Invalid initData: User data is missing');
  }

  return JSON.parse(userJson) as TelegramInitUser;
}
