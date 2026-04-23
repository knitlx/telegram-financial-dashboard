ALTER TYPE tx_kind ADD VALUE IF NOT EXISTS 'transfer';

CREATE TABLE IF NOT EXISTS public.fx_exchanges (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         bigint NOT NULL,

    from_currency   text NOT NULL,
    from_amount     numeric(18,4) NOT NULL,

    to_currency     text NOT NULL,
    to_amount       numeric(18,4) NOT NULL,

    actual_rate     numeric(18,6) NOT NULL,
    market_rate     numeric(18,6),
    rate_diff_pct   numeric(8,4) GENERATED ALWAYS AS (
                        CASE WHEN market_rate IS NOT NULL AND market_rate <> 0
                             THEN round(((actual_rate - market_rate) / market_rate) * 100, 4)
                             ELSE NULL
                        END
                    ) STORED,
    loss_in_from    numeric(18,4) GENERATED ALWAYS AS (
                        CASE WHEN market_rate IS NOT NULL AND market_rate <> 0
                             THEN round(from_amount - (to_amount / market_rate), 4)
                             ELSE NULL
                        END
                    ) STORED,

    note            text,
    exchanged_at    timestamp with time zone NOT NULL DEFAULT now(),
    created_at      timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fx_exchanges_user_idx ON public.fx_exchanges (user_id, exchanged_at DESC);
