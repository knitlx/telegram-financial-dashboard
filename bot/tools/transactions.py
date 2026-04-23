import json
from typing import Optional
from db import fetch, execute, fetchrow


async def add_transaction(
    user_id: int,
    category: str,
    title: str,
    amount: float,
    currency: str,
    kind: str = "expense",
    iso_datetime: Optional[str] = None,
) -> str:
    rows = await fetch(
        """
        INSERT INTO public.transactions (user_id, category, title, amount, currency, timestamp, kind)
        SELECT $1::bigint, $2, $3, $4::numeric, $5, COALESCE($6::timestamptz, now()), $7::tx_kind
        RETURNING id, category, title, amount, currency, kind,
                  to_char(timestamp, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS ts
        """,
        user_id, category, title, amount, currency.upper(), iso_datetime, kind,
    )
    return json.dumps(rows[0], default=str) if rows else '{"error": "not inserted"}'


async def get_transactions(
    user_id: int,
    date_from: str = "",
    date_to: str = "",
    currency: str = "",
    category: str = "",
    kind: str = "",
    tx_id: str = "",
    title: str = "",
    amount: str = "",
    limit: Optional[int] = None,
) -> str:
    rows = await fetch(
        """
        WITH base AS (
          SELECT id, kind::text AS kind_txt, currency, category, title, amount, "timestamp"
          FROM public.transactions
          WHERE user_id::text = $1::text
            AND (NULLIF($2,'')::date IS NULL OR "timestamp"::date >= NULLIF($2,'')::date)
            AND (NULLIF($3,'')::date IS NULL OR "timestamp"::date <= NULLIF($3,'')::date)
            AND (NULLIF($4,'') IS NULL OR upper(currency) = upper($4))
            AND (NULLIF($5,'') IS NULL OR category = $5)
            AND (NULLIF($6,'') IS NULL OR kind::text = lower($6))
            AND (NULLIF($7,'') IS NULL OR ($7 ~* '^[0-9a-f-]{36}$' AND id::text = $7))
            AND (NULLIF($8,'') IS NULL OR title ILIKE ('%' || $8 || '%'))
            AND (NULLIF($9,'')::numeric IS NULL OR amount = NULLIF($9,'')::numeric)
        ),
        details AS (
          SELECT id, kind_txt, currency, category, title, amount, "timestamp"
          FROM base
          ORDER BY "timestamp" DESC
          LIMIT COALESCE(NULLIF($10::int, 0), 50)
        )
        SELECT 'detail' AS kind_row, id, kind_txt AS kind, currency, category, title, amount,
               to_char("timestamp", 'YYYY-MM-DD"T"HH24:MI:SSOF') AS ts
        FROM details
        UNION ALL
        SELECT 'category_total', NULL, kind_txt, currency, category, NULL, SUM(amount), NULL
        FROM base GROUP BY kind_txt, currency, category
        UNION ALL
        SELECT 'currency_total', NULL, NULL, currency, NULL, NULL, SUM(amount), NULL
        FROM base GROUP BY currency
        ORDER BY 1, 8 DESC NULLS LAST
        """,
        str(user_id), date_from, date_to, currency, category, kind, tx_id, title, amount, limit,
    )
    return json.dumps(rows, default=str)


async def update_transaction(
    user_id: int,
    tx_id: str,
    amount: Optional[float] = None,
    category: Optional[str] = None,
    title: Optional[str] = None,
    currency: Optional[str] = None,
    iso_datetime: Optional[str] = None,
    kind: Optional[str] = None,
) -> str:
    fields = []
    values: list = []
    idx = 1

    for col, val in [
        ("amount", amount),
        ("category", category),
        ("title", title),
        ("currency", currency.upper() if currency else None),
        ("timestamp", iso_datetime),
        ("kind", kind),
    ]:
        if val is not None:
            fields.append(f"{col} = ${idx + 2}")
            values.append(val)
            idx += 1

    if not fields:
        return '{"error": "no fields to update"}'

    query = f"""
        UPDATE public.transactions
        SET {', '.join(fields)}, updated_at = now()
        WHERE id = $1::uuid AND user_id = $2::bigint
        RETURNING id
    """
    row = await fetchrow(query, tx_id, user_id, *values)
    return json.dumps(row, default=str) if row else '{"error": "not found"}'


async def delete_transaction(tx_id: str) -> str:
    result = await execute(
        "DELETE FROM public.transactions WHERE id = $1::uuid",
        tx_id,
    )
    return json.dumps({"deleted": result})
