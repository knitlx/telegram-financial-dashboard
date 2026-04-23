CREATE TABLE IF NOT EXISTS public.balance_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id bigint NOT NULL,
    currency text NOT NULL,
    balance_amount numeric(18,4) NOT NULL,
    note text,
    snapshot_at timestamp with time zone NOT NULL DEFAULT now(),
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS balance_snapshots_user_currency_idx
    ON public.balance_snapshots (user_id, currency, snapshot_at DESC);
