import { NextRequest, NextResponse } from 'next/server';

const CRYPTO_IDS: Record<string, string> = {
  USDT: 'tether',
  BTC: 'bitcoin',
  ETH: 'ethereum',
  TON: 'the-open-network',
  USDC: 'usd-coin',
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const base = (searchParams.get('base') || 'USD').toUpperCase();
  const symbols = (searchParams.get('symbols') || '').toUpperCase().split(',').filter(Boolean);

  if (symbols.length === 0) {
    return NextResponse.json({ error: 'symbols required' }, { status: 400 });
  }

  try {
    const rates: Record<string, number> = { [base]: 1 };

    const cryptoTargets = symbols.filter(s => CRYPTO_IDS[s]);
    const fiatTargets = symbols.filter(s => !CRYPTO_IDS[s] && s !== base);
    const baseIsCrypto = !!CRYPTO_IDS[base];

    if (!baseIsCrypto && fiatTargets.length > 0) {
      const url = `https://open.er-api.com/v6/latest/${base}`;
      const resp = await fetch(url, { next: { revalidate: 3600 } });
      const data = await resp.json();
      fiatTargets.forEach(s => {
        if (data.rates?.[s]) rates[s] = data.rates[s];
      });
    }

    if (cryptoTargets.length > 0 || baseIsCrypto) {
      const ids = [...new Set([
        ...cryptoTargets.map(s => CRYPTO_IDS[s]),
        ...(baseIsCrypto ? [CRYPTO_IDS[base]] : []),
      ])].join(',');
      const vs = baseIsCrypto ? 'usd' : base.toLowerCase();
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${vs}`;
      const resp = await fetch(url, { next: { revalidate: 3600 } });
      const data = await resp.json();

      if (baseIsCrypto) {
        const baseUsd = data[CRYPTO_IDS[base]]?.usd;
        if (baseUsd) {
          // For crypto base (e.g. USDT), we still need fiat-per-base rates.
          // Example: THB per USDT = (THB per USD) * (USD per USDT).
          if (fiatTargets.length > 0) {
            const usdResp = await fetch('https://open.er-api.com/v6/latest/USD', { next: { revalidate: 3600 } });
            const usdData = await usdResp.json();
            fiatTargets.forEach(s => {
              const perUsd = usdData.rates?.[s];
              if (perUsd) rates[s] = perUsd * baseUsd;
            });
          }

          cryptoTargets.forEach(s => {
            const targetUsd = data[CRYPTO_IDS[s]]?.usd;
            if (targetUsd && baseUsd) rates[s] = targetUsd / baseUsd;
          });
        }
      } else {
        cryptoTargets.forEach(s => {
          const r = data[CRYPTO_IDS[s]]?.[vs];
          if (r) rates[s] = r;
        });
      }
    }

    return NextResponse.json({ base, rates });
  } catch (e: unknown) {
    console.error('Rates API error:', e);
    return NextResponse.json({ error: 'Failed to fetch rates' }, { status: 500 });
  }
}
