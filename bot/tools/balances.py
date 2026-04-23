import json
from typing import Optional
from db import fetch, execute


async def _ensure_balance_snapshots_table() -> None:
    await execute(
        """
        CREATE TABLE IF NOT EXISTS public.balance_snapshots (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id bigint NOT NULL,
            currency text NOT NULL,
            balance_amount numeric(18,4) NOT NULL,
            note text,
            snapshot_at timestamp with time zone NOT NULL DEFAULT now(),
            created_at timestamp with time zone NOT NULL DEFAULT now()
        )
        """
    )
    await execute(
        """
        CREATE INDEX IF NOT EXISTS balance_snapshots_user_currency_idx
            ON public.balance_snapshots (user_id, currency, snapshot_at DESC)
        """
    )


async def set_balance_snapshot(
    user_id: int,
    currency: str,
    balance_amount: float,
    iso_datetime: Optional[str] = None,
    note: Optional[str] = None,
) -> str:
    await _ensure_balance_snapshots_table()
    rows = await fetch(
        """
        INSERT INTO public.balance_snapshots (user_id, currency, balance_amount, snapshot_at, note)
        VALUES ($1::bigint, upper($2), $3::numeric, COALESCE($4::timestamptz, now()), $5)
        RETURNING id, user_id, currency, balance_amount,
                  to_char(snapshot_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS snapshot_at,
                  note
        """,
        user_id,
        currency,
        balance_amount,
        iso_datetime,
        note,
    )
    return json.dumps(rows[0], default=str) if rows else '{"error": "not inserted"}'


async def get_balance_snapshots(user_id: int, currency: str = "", limit: int = 20) -> str:
    await _ensure_balance_snapshots_table()
    rows = await fetch(
        """
        SELECT id, currency, balance_amount,
               to_char(snapshot_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS snapshot_at,
               note,
               to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at
        FROM public.balance_snapshots
        WHERE user_id = $1::bigint
          AND (NULLIF($2, '') IS NULL OR upper(currency) = upper($2))
        ORDER BY snapshot_at DESC, created_at DESC
        LIMIT COALESCE(NULLIF($3::int, 0), 20)
        """,
        user_id,
        currency,
        limit,
    )
    return json.dumps(rows, default=str)


async def get_currency_balances(user_id: int) -> str:
    await _ensure_balance_snapshots_table()
    rows = await fetch(
        """
        WITH currencies AS (
          SELECT upper(currency) AS currency
          FROM public.transactions
          WHERE user_id = $1::bigint
          UNION
          SELECT upper(from_currency) AS currency
          FROM public.fx_exchanges
          WHERE user_id = $1::bigint
          UNION
          SELECT upper(to_currency) AS currency
          FROM public.fx_exchanges
          WHERE user_id = $1::bigint
          UNION
          SELECT upper(currency) AS currency
          FROM public.balance_snapshots
          WHERE user_id = $1::bigint
        ),
        latest_snapshot AS (
          SELECT DISTINCT ON (upper(currency))
                 upper(currency) AS currency,
                 balance_amount,
                 snapshot_at,
                 note
          FROM public.balance_snapshots
          WHERE user_id = $1::bigint
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
            ON t.user_id = $1::bigint
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
            ON e.user_id = $1::bigint
           AND (upper(e.from_currency) = c.currency OR upper(e.to_currency) = c.currency)
           AND (s.snapshot_at IS NULL OR e.exchanged_at >= s.snapshot_at)
          GROUP BY c.currency
        )
        SELECT
          c.currency,
          COALESCE(s.balance_amount, 0) AS snapshot_balance,
          COALESCE(tx.tx_delta, 0) AS tx_delta,
          COALESCE(fx.fx_delta, 0) AS fx_delta,
          (COALESCE(s.balance_amount, 0) + COALESCE(tx.tx_delta, 0) + COALESCE(fx.fx_delta, 0)) AS current_balance,
          to_char(s.snapshot_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS snapshot_at,
          s.note AS snapshot_note
        FROM currencies c
        LEFT JOIN latest_snapshot s ON s.currency = c.currency
        LEFT JOIN tx_delta tx ON tx.currency = c.currency
        LEFT JOIN fx_delta fx ON fx.currency = c.currency
        ORDER BY c.currency
        """,
        user_id,
    )
    return json.dumps(rows, default=str)
