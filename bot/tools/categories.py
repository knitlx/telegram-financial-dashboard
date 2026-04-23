import json
from db import fetch, execute


async def add_category(user_id: int, name: str, kind: str) -> str:
    rows = await fetch(
        """
        INSERT INTO public.user_categories (user_id, name, kind, is_default)
        VALUES ($1::bigint, $2, $3::tx_kind, false)
        ON CONFLICT (user_id, name, kind) DO UPDATE SET is_active = true
        RETURNING id, name, kind::text, is_active
        """,
        user_id, name, kind,
    )
    return json.dumps(rows[0], default=str) if rows else '{"error": "failed"}'


async def deactivate_category(user_id: int, name: str, kind: str) -> str:
    rows = await fetch(
        """
        UPDATE public.user_categories
        SET is_active = false
        WHERE user_id = $1::bigint AND lower(name) = lower($2) AND kind = $3::tx_kind
        RETURNING id, name, kind::text, is_active
        """,
        user_id, name, kind,
    )
    return json.dumps(rows[0], default=str) if rows else '{"error": "not found"}'


async def rename_category(user_id: int, old_name: str, new_name: str, kind: str) -> str:
    rows = await fetch(
        """
        SELECT 1
        FROM public.user_categories
        WHERE user_id = $1::bigint AND lower(name) = lower($2) AND kind = $3::tx_kind
        LIMIT 1
        """,
        user_id, new_name, kind,
    )
    new_exists = bool(rows)

    if new_exists:
        await execute(
            """
            UPDATE public.transactions
            SET category = $3
            WHERE user_id = $1::bigint AND lower(category) = lower($2) AND kind = $4::tx_kind
            """,
            user_id, old_name, new_name, kind,
        )
        await execute(
            """
            UPDATE public.user_categories
            SET is_active = true
            WHERE user_id = $1::bigint AND lower(name) = lower($2) AND kind = $3::tx_kind
            """,
            user_id, new_name, kind,
        )
        await execute(
            """
            UPDATE public.user_categories
            SET is_active = false
            WHERE user_id = $1::bigint AND lower(name) = lower($2) AND kind = $3::tx_kind
            """,
            user_id, old_name, kind,
        )
    else:
        await execute(
            """
            UPDATE public.user_categories
            SET name = $3
            WHERE user_id = $1::bigint AND lower(name) = lower($2) AND kind = $4::tx_kind
            """,
            user_id, old_name, new_name, kind,
        )
        await execute(
            """
            UPDATE public.transactions
            SET category = $3
            WHERE user_id = $1::bigint AND lower(category) = lower($2) AND kind = $4::tx_kind
            """,
            user_id, old_name, new_name, kind,
        )
    return json.dumps({"renamed": True, "from": old_name, "to": new_name})
