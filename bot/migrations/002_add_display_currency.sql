ALTER TABLE public.user_settings
    ADD COLUMN IF NOT EXISTS display_currency text;
