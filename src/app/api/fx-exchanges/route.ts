import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { resolveUserId } from '@/lib/auth-user';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = resolveUserId(req);

    const rows = await query(
      `SELECT id, from_currency, from_amount, to_currency, to_amount, actual_rate, market_rate, rate_diff_pct, loss_in_from, note, exchanged_at FROM public.fx_exchanges WHERE user_id = $1 ORDER BY exchanged_at DESC`,
      [userId],
    );

    return NextResponse.json(rows);
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (message.includes('Invalid initData') || message.includes('Unauthorized')) {
      return NextResponse.json({ error: `Unauthorized: ${message}` }, { status: 401 });
    }
    console.error('FX API Error:', error);
    return NextResponse.json({ error: 'Failed to fetch exchanges' }, { status: 500 });
  }
}
