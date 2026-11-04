-- Bilingual items: an optional English rendering of the stem, options, rationales and explanation.
-- Labs are shared (test names are already English; flags are rendered per language in the UI).
ALTER TABLE items ADD COLUMN i18n jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Where an item came from: 'faculty' (written in-app) or 'sample_bank' (bundled simulated items).
ALTER TABLE items ADD COLUMN origin text NOT NULL DEFAULT 'faculty' CHECK (origin IN ('faculty','sample_bank'));
