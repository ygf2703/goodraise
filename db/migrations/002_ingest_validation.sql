-- Bring databases initialized by the old importer up to the Node ingest contract.
ALTER TABLE goodraise.import_batches
  ADD COLUMN IF NOT EXISTS skipped_invalid_rows INTEGER NOT NULL DEFAULT 0;
