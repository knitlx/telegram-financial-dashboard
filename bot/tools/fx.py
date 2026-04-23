import json
import httpx

from tools.transfers import _get_market_rate


async def fx_convert(from_currency: str, to_currency: str, amount: float = 1.0) -> str:
    from_c = from_currency.upper()
    to_c = to_currency.upper()

    rate = await _get_market_rate(from_c, to_c)

    if rate is None:
        return json.dumps({"error": f"no rate for {from_c}/{to_c}"})

    return json.dumps({
        "from": from_c,
        "to": to_c,
        "rate": rate,
        "amount": amount,
        "result": round(rate * amount, 4),
    })
