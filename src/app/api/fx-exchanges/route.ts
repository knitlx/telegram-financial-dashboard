import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { validateInitData } from '@/lib/telegram';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(req: NextRequest) {
  try {
    const allowDevBypass =
      process.env.NODE_ENV === 'development' &&
      process.env.ALLOW_DEV_AUTH_BYPASS === 'true';
    const authorization = req.headers.get('Authorization');
    const token = process.env.TELEGRAM_BOT_TOKEN;

    let userId: number | null = null;

    if (authorization?.startsWith('Tma ')) {
      if (!token) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
      }
      const user = validateInitData(authorization.substring(4), token);
      userId = user.id;
    } else if (allowDevBypass) {
      const devUserId = Number(process.env.DEV_USER_ID);
      if (!Number.isInteger(devUserId) || devUserId <= 0) {
        return NextResponse.json(
          { error: 'Set DEV_USER_ID to use ALLOW_DEV_AUTH_BYPASS in development' },
          { status: 400 },
        );
      }
      userId = devUserId;
    } else {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rows = await query(
      `SELECT id, from_currency, from_amount, to_currency, to_amount, actual_rate, market_rate, rate_diff_pct, loss_in_from, note, exchanged_at FROM public.fx_exchanges WHERE user_id = $1 ORDER BY exchanged_at DESC`,
      [userId],
    );

    return NextResponse.json(rows);
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (message.includes('Invalid initData')) {
      return NextResponse.json({ error: `Unauthorized: ${message}` }, { status: 401 });
    }
    console.error('FX API Error:', error);
    return NextResponse.json({ error: 'Failed to fetch exchanges' }, { status: 500 });
  }
}
