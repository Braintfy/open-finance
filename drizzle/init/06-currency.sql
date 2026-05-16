-- PURPOSE: Snapshot курсов валют (общий, не tenant-scoped).
-- Source по умолчанию — ЦБ РФ через cbr-xml-daily.ru.
CREATE TABLE IF NOT EXISTS currency_rates (
  code VARCHAR(8) PRIMARY KEY,
  nominal INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  rate_rub NUMERIC(18, 6) NOT NULL,
  previous_rub NUMERIC(18, 6),
  source TEXT NOT NULL DEFAULT 'cbr',
  source_date TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS currency_rates_updated_at_idx ON currency_rates(updated_at DESC);
