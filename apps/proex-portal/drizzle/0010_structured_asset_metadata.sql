-- Additive private descriptive metadata; legacy rows intentionally remain NULL.
-- These fields never modify ledger balances, operational condition or permissions.
ALTER TABLE items ADD COLUMN brand TEXT CHECK(brand IS NULL OR length(brand)<=120);
ALTER TABLE items ADD COLUMN model TEXT CHECK(model IS NULL OR length(model)<=160);
ALTER TABLE items ADD COLUMN serial_number TEXT CHECK(serial_number IS NULL OR length(serial_number)<=160);
ALTER TABLE items ADD COLUMN asset_location TEXT CHECK(asset_location IS NULL OR length(asset_location)<=300);
ALTER TABLE items ADD COLUMN responsible_unit TEXT CHECK(responsible_unit IS NULL OR length(responsible_unit)<=240);
ALTER TABLE items ADD COLUMN responsible_reference TEXT CHECK(responsible_reference IS NULL OR length(responsible_reference)<=240);
ALTER TABLE items ADD COLUMN conservation_state TEXT CHECK(conservation_state IS NULL OR length(conservation_state)<=200);
ALTER TABLE items ADD COLUMN asset_status TEXT CHECK(asset_status IS NULL OR length(asset_status)<=160);
ALTER TABLE items ADD COLUMN origin TEXT CHECK(origin IS NULL OR length(origin)<=240);
ALTER TABLE items ADD COLUMN destination TEXT CHECK(destination IS NULL OR length(destination)<=240);
ALTER TABLE items ADD COLUMN process_reference TEXT CHECK(process_reference IS NULL OR length(process_reference)<=120);
ALTER TABLE items ADD COLUMN responsibility_term TEXT CHECK(responsibility_term IS NULL OR length(responsibility_term)<=160);
ALTER TABLE items ADD COLUMN invoice_reference TEXT CHECK(invoice_reference IS NULL OR length(invoice_reference)<=160);
ALTER TABLE items ADD COLUMN source_reference TEXT CHECK(source_reference IS NULL OR length(source_reference)<=500);
ALTER TABLE items ADD COLUMN acquisition_date TEXT CHECK(acquisition_date IS NULL OR (length(acquisition_date)=10 AND acquisition_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'));
ALTER TABLE items ADD COLUMN acquisition_value_cents INTEGER CHECK(acquisition_value_cents IS NULL OR (typeof(acquisition_value_cents)='integer' AND acquisition_value_cents BETWEEN 0 AND 1000000000000));
CREATE TRIGGER items_asset_source_insert BEFORE INSERT ON items
WHEN NEW.acquisition_value_cents IS NOT NULL AND
  COALESCE(NULLIF(trim(NEW.source_reference),''),NULLIF(trim(NEW.invoice_reference),''),NULLIF(trim(NEW.process_reference),''),NULLIF(trim(NEW.responsibility_term),'')) IS NULL
BEGIN SELECT RAISE(ABORT,'asset_value_source_required'); END;
CREATE TRIGGER items_asset_source_update BEFORE UPDATE ON items
WHEN NEW.acquisition_value_cents IS NOT NULL AND
  COALESCE(NULLIF(trim(NEW.source_reference),''),NULLIF(trim(NEW.invoice_reference),''),NULLIF(trim(NEW.process_reference),''),NULLIF(trim(NEW.responsibility_term),'')) IS NULL
BEGIN SELECT RAISE(ABORT,'asset_value_source_required'); END;
