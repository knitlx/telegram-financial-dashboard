import { NextRequest } from 'next/server';
import { validateInitData } from '@/lib/telegram';

interface UserAuthResult {
  userId: number;
}

function parsePositiveInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function resolveUserId(req: NextRequest): UserAuthResult {
  const authorization = req.headers.get('Authorization');
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const host = req.headers.get('host') ?? '';
  const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);

  if (authorization?.startsWith('Tma ')) {
    if (!botToken) {
      throw new Error('Bot token not configured');
    }
    const user = validateInitData(authorization.substring(4), botToken);
    return { userId: user.id };
  }

  const allowLocalBypass = process.env.NODE_ENV === 'development' || isLocalHost;
  if (allowLocalBypass) {
    const devUserId =
      parsePositiveInt(process.env.DEV_USER_ID) ??
      712666276;
    return { userId: devUserId };
  }

  throw new Error('Unauthorized: Missing Authorization Header');
}
