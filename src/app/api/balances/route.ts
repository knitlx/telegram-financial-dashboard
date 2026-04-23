import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { resolveUserId } from '@/lib/auth-user';

interface BalanceRow {
  currency: string;
  snapshot_balance: string;
  tx_delta: string;
  fx_delta: string;
  current_balance: string;
  snapshot_at: string | null;
  snapshot_note: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = resolveUserId(req);
    const regclass = await query<{ table_name: string | null }>(
      `SELECT to_regclass('public.balance_snapshots')::text AS table_name`,
    );
    const hasSnapshotsTable = Boolean(regclass[0]?.table_name);

    const rows = hasSnapshotsTable
      ? await query<BalanceRow>(
          `
      WITH currencies AS (
        SELECT upper(currency) AS currency
        FROM public.transactions
        WHERE user_id = $1
        UNION
        SELECT upper(from_currency) AS currency
        FROM public.fx_exchanges
        WHERE user_id = $1
        UNION
        SELECT upper(to_currency) AS currency
        FROM public.fx_exchanges
        WHERE user_id = $1
        UNION
        SELECT upper(currency) AS currency
        FROM public.balance_snapshots
        WHERE user_id = $1
      ),
      latest_snapshot AS (
        SELECT DISTINCT ON (upper(currency))
               upper(currency) AS currency,
               balance_amount,
               snapshot_at,
               note
        FROM public.balance_snapshots
        WHERE user_id = $1
        ORDER BY upper(currency), snapshot_at DESC, created_at DESC
      ),
      tx_delta AS (
        SELECT
          c.currency,
          COALESCE(SUM(
            CASE
              WHEN t.kind::text = 'income' THEN t.amount
              WHEN t.kind::text = 'expense' THEN -t.amount
              ELSE 0
            END
          ), 0) AS tx_delta
        FROM currencies c
        LEFT JOIN latest_snapshot s ON s.currency = c.currency
        LEFT JOIN public.transactions t
          ON t.user_id = $1
         AND upper(t.currency) = c.currency
         AND (s.snapshot_at IS NULL OR t.timestamp >= s.snapshot_at)
        GROUP BY c.currency
      ),
      fx_delta AS (
        SELECT
          c.currency,
          COALESCE(SUM(CASE WHEN upper(e.to_currency) = c.currency THEN e.to_amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN upper(e.from_currency) = c.currency THEN e.from_amount ELSE 0 END), 0) AS fx_delta
        FROM currencies c
        LEFT JOIN latest_snapshot s ON s.currency = c.currency
        LEFT JOIN public.fx_exchanges e
          ON e.user_id = $1
         AND (upper(e.from_currency) = c.currency OR upper(e.to_currency) = c.currency)
         AND (s.snapshot_at IS NULL OR e.exchanged_at >= s.snapshot_at)
        GROUP BY c.currency
      )
      SELECT
        c.currency,
        COALESCE(s.balance_amount, 0)::text AS snapshot_balance,
        COALESCE(tx.tx_delta, 0)::text AS tx_delta,
        COALESCE(fx.fx_delta, 0)::text AS fx_delta,
        (COALESCE(s.balance_amount, 0) + COALESCE(tx.tx_delta, 0) + COALESCE(fx.fx_delta, 0))::text AS current_balance,
        to_char(s.snapshot_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS snapshot_at,
        s.note AS snapshot_note
      FROM currencies c
      LEFT JOIN latest_snapshot s ON s.currency = c.currency
      LEFT JOIN tx_delta tx ON tx.currency = c.currency
      LEFT JOIN fx_delta fx ON fx.currency = c.currency
      ORDER BY c.currency
      `,
          [userId],
        )
      : await query<BalanceRow>(
          `
      WITH currencies AS (
        SELECT upper(currency) AS currency
        FROM public.transactions
        WHERE user_id = $1
        UNION
        SELECT upper(from_currency) AS currency
        FROM public.fx_exchanges
        WHERE user_id = $1
        UNION
        SELECT upper(to_currency) AS currency
        FROM public.fx_exchanges
        WHERE user_id = $1
      ),
      tx_delta AS (
        SELECT
          c.currency,
          COALESCE(SUM(
            CASE
              WHEN t.kind::text = 'income' THEN t.amount
              WHEN t.kind::text = 'expense' THEN -t.amount
              ELSE 0
            END
          ), 0) AS tx_delta
        FROM currencies c
        LEFT JOIN public.transactions t
          ON t.user_id = $1
         AND upper(t.currency) = c.currency
        GROUP BY c.currency
      ),
      fx_delta AS (
        SELECT
          c.currency,
          COALESCE(SUM(CASE WHEN upper(e.to_currency) = c.currency THEN e.to_amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN upper(e.from_currency) = c.currency THEN e.from_amount ELSE 0 END), 0) AS fx_delta
        FROM currencies c
        LEFT JOIN public.fx_exchanges e
          ON e.user_id = $1
         AND (upper(e.from_currency) = c.currency OR upper(e.to_currency) = c.currency)
        GROUP BY c.currency
      )
      SELECT
        c.currency,
        '0'::text AS snapshot_balance,
        COALESCE(tx.tx_delta, 0)::text AS tx_delta,
        COALESCE(fx.fx_delta, 0)::text AS fx_delta,
        (COALESCE(tx.tx_delta, 0) + COALESCE(fx.fx_delta, 0))::text AS current_balance,
        NULL::text AS snapshot_at,
        NULL::text AS snapshot_note
      FROM currencies c
      LEFT JOIN tx_delta tx ON tx.currency = c.currency
      LEFT JOIN fx_delta fx ON fx.currency = c.currency
      ORDER BY c.currency
      `,
          [userId],
        );

    return NextResponse.json({ balances: rows });
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (message.includes('Invalid initData') || message.includes('Unauthorized')) {
      return NextResponse.json({ error: `Unauthorized: ${message}` }, { status: 401 });
    }

    console.error('Balances API Error:', error);
    return NextResponse.json({ error: 'Failed to fetch balances' }, { status: 500 });
  }
}
