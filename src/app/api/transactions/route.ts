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
      'SELECT id, user_id, category, title, amount, currency, timestamp, day, kind, created_at, updated_at FROM public.transactions WHERE user_id = $1 ORDER BY timestamp DESC',
      [userId],
    );

    const settings = await query<{ default_currency: string }>(
      'SELECT default_currency FROM public.user_settings WHERE user_id = $1',
      [userId],
    );
    const defaultCurrency = settings[0]?.default_currency ?? null;

    return NextResponse.json({ transactions: rows, defaultCurrency });

  } catch (error: unknown) {
    const message = errorMessage(error);
    if (message.includes('Invalid initData') || message.includes('Unauthorized')) {
      return NextResponse.json({ error: `Unauthorized: ${message}` }, { status: 401 });
    }

    console.error('API Error:', error);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}
