import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { validateInitData } from '@/lib/telegram';

export async function GET(req: NextRequest) {
  try {
    const authorization = req.headers.get('Authorization');
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!authorization || !authorization.startsWith('Tma ')) {
      return NextResponse.json({ error: 'Unauthorized: Missing Authorization Header' }, { status: 401 });
    }

    if (!token) {
      console.error('TELEGRAM_BOT_TOKEN is not set on the server.');
      return NextResponse.json({ error: 'Internal Server Error: Bot token not configured' }, { status: 500 });
    }

    const initData = authorization.substring(4);
    const user = validateInitData(initData, token);

    // At this point, the user is authenticated.
    // The user object from initData contains the user's ID.
    const userId = user.id;

    const client = await pool.connect();
    const result = await client.query(
      'SELECT id, user_id, category, title, amount, currency, timestamp, day, kind, created_at, updated_at FROM public.transactions WHERE user_id = $1 ORDER BY timestamp DESC',
      [userId]
    );
    client.release();
    
    return NextResponse.json(result.rows);

  } catch (error: any) {
    // Catch validation errors from validateInitData as well as DB errors
    if (error.message.includes('Invalid initData')) {
      return NextResponse.json({ error: `Unauthorized: ${error.message}` }, { status: 401 });
    }
    
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
  }
}

