import json
from typing import Optional
from db import execute, fetchrow


async def set_user_settings(user_id: int, iana_tz: Optional[str] = None, default_currency: Optional[str] = None) -> str:
    if not iana_tz and not default_currency:
        return '{"error": "nothing to update"}'

    row = await fetchrow(
        """
        INSERT INTO public.user_settings (user_id, user_timezone, default_currency, updated_at)
        VALUES ($1, COALESCE($2, 'UTC'), $3, now())
        ON CONFLICT (user_id) DO UPDATE
        SET
          user_timezone = COALESCE(EXCLUDED.user_timezone, public.user_settings.user_timezone),
          default_currency = COALESCE(EXCLUDED.default_currency, public.user_settings.default_currency),
          updated_at = now()
        RETURNING user_id, user_timezone, default_currency
        """,
        user_id,
        iana_tz,
        default_currency.upper() if default_currency else None,
    )
    return json.dumps(row, default=str) if row else '{"error": "failed"}'


async def get_user_settings(user_id: int) -> dict:
    row = await fetchrow(
        "SELECT user_timezone, default_currency FROM public.user_settings WHERE user_id = $1 LIMIT 1",
        user_id,
    )
    return row or {"user_timezone": "UTC", "default_currency": None}


async def get_user_categories(user_id: int) -> dict:
    row = await fetchrow(
        """
        SELECT json_build_object(
          'expense', json_agg(json_build_object('name', name) ORDER BY name) FILTER (WHERE kind = 'expense'),
          'income',  json_agg(json_build_object('name', name) ORDER BY name) FILTER (WHERE kind = 'income')
        ) AS user_categories
        FROM public.user_categories
        WHERE user_id = $1::bigint AND is_active = true
        """,
        user_id,
    )
    return row["user_categories"] if row else {}


async def seed_categories(user_id: int) -> None:
    await execute(
        """
        DO $$
        DECLARE cnt integer;
        BEGIN
          SELECT COUNT(*) INTO cnt FROM public.user_categories
          WHERE user_id = $1::bigint AND is_active = true;
          IF cnt = 0 THEN
            PERFORM public.seed_default_categories($1::bigint);
          END IF;
        END $$;
        """,
        user_id,
    )
