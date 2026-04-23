import json
import httpx
from typing import Optional
from db import fetch, fetchrow


_CRYPTO_IDS = {
    "USDT": "tether",
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "TON": "the-open-network",
    "USDC": "usd-coin",
}

_FIAT_SYMBOLS = {
    "RUB", "USD", "EUR", "THB", "GBP", "CNY", "TRY", "KZT", "AED", "SGD",
}


async def _rate_via_coingecko(from_currency: str, to_currency: str) -> Optional[float]:
    from_c = from_currency.upper()
    to_c = to_currency.upper()

    if from_c in _CRYPTO_IDS and to_c in _FIAT_SYMBOLS:
        coin_id = _CRYPTO_IDS[from_c]
        vs = to_c.lower()
        url = f"https://api.coingecko.com/api/v3/simple/price?ids={coin_id}&vs_currencies={vs}"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
        return data.get(coin_id, {}).get(vs)

    if from_c in _FIAT_SYMBOLS and to_c in _CRYPTO_IDS:
        rate = await _rate_via_coingecko(to_c, from_c)
        return round(1 / rate, 8) if rate else None

    if from_c in _CRYPTO_IDS and to_c in _CRYPTO_IDS:
        rate_from = await _rate_via_coingecko(from_c, "USD")
        rate_to = await _rate_via_coingecko(to_c, "USD")
        if rate_from and rate_to:
            return round(rate_from / rate_to, 8)

    return None


async def _get_market_rate(from_currency: str, to_currency: str) -> Optional[float]:
    from_c = from_currency.upper()
    to_c = to_currency.upper()

    if from_c in _CRYPTO_IDS or to_c in _CRYPTO_IDS:
        try:
            return await _rate_via_coingecko(from_c, to_c)
        except Exception:
            return None

    try:
        url = f"https://open.er-api.com/v6/latest/{from_c}"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
        return data.get("rates", {}).get(to_c)
    except Exception:
        return None


async def record_exchange(
    user_id: int,
    from_currency: str,
    from_amount: float,
    to_currency: str,
    to_amount: float,
    iso_datetime: Optional[str] = None,
    note: Optional[str] = None,
) -> str:
    actual_rate = round(to_amount / from_amount, 6) if from_amount else 0
    market_rate = await _get_market_rate(from_currency, to_currency)

    rows = await fetch(
        """
        INSERT INTO public.fx_exchanges
          (user_id, from_currency, from_amount, to_currency, to_amount, actual_rate, market_rate, note, exchanged_at)
        VALUES
          ($1::bigint, $2, $3::numeric, $4, $5::numeric, $6::numeric, $7::numeric, $8,
           COALESCE($9::timestamptz, now()))
        RETURNING
          id, from_currency, from_amount, to_currency, to_amount,
          actual_rate, market_rate, rate_diff_pct, loss_in_from,
          to_char(exchanged_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS exchanged_at
        """,
        user_id, from_currency.upper(), from_amount,
        to_currency.upper(), to_amount,
        actual_rate, market_rate, note, iso_datetime,
    )
    return json.dumps(rows[0], default=str) if rows else '{"error": "not inserted"}'


async def get_exchange_stats(
    user_id: int,
    from_currency: str = "",
    to_currency: str = "",
    date_from: str = "",
    date_to: str = "",
) -> str:
    rows = await fetch(
        """
        SELECT
          from_currency, to_currency,
          COUNT(*)                             AS exchanges_count,
          SUM(from_amount)                     AS total_from,
          SUM(to_amount)                       AS total_to,
          AVG(actual_rate)                     AS avg_actual_rate,
          AVG(market_rate)                     AS avg_market_rate,
          AVG(rate_diff_pct)                   AS avg_rate_diff_pct,
          SUM(loss_in_from)                    AS total_loss_in_from
        FROM public.fx_exchanges
        WHERE user_id = $1::bigint
          AND (NULLIF($2,'') IS NULL OR upper(from_currency) = upper($2))
          AND (NULLIF($3,'') IS NULL OR upper(to_currency) = upper($3))
          AND (NULLIF($4,'')::date IS NULL OR exchanged_at::date >= NULLIF($4,'')::date)
          AND (NULLIF($5,'')::date IS NULL OR exchanged_at::date <= NULLIF($5,'')::date)
        GROUP BY from_currency, to_currency
        ORDER BY total_from DESC
        """,
        user_id, from_currency, to_currency, date_from, date_to,
    )
    return json.dumps(rows, default=str)


async def get_exchanges(
    user_id: int,
    from_currency: str = "",
    to_currency: str = "",
    date_from: str = "",
    date_to: str = "",
    limit: int = 20,
) -> str:
    rows = await fetch(
        """
        SELECT
          id, from_currency, from_amount, to_currency, to_amount,
          actual_rate, market_rate, rate_diff_pct, loss_in_from, note,
          to_char(exchanged_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS exchanged_at
        FROM public.fx_exchanges
        WHERE user_id = $1::bigint
          AND (NULLIF($2,'') IS NULL OR upper(from_currency) = upper($2))
          AND (NULLIF($3,'') IS NULL OR upper(to_currency) = upper($3))
          AND (NULLIF($4,'')::date IS NULL OR exchanged_at::date >= NULLIF($4,'')::date)
          AND (NULLIF($5,'')::date IS NULL OR exchanged_at::date <= NULLIF($5,'')::date)
        ORDER BY exchanged_at DESC
        LIMIT $6
        """,
        user_id, from_currency, to_currency, date_from, date_to, limit,
    )
    return json.dumps(rows, default=str)
