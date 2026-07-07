-- Company preferences: default weather location for the map.
-- NULL = follow the fleet (weather at the most recent asset position).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS weather_place TEXT;

-- Admins update their own company's settings (001 only created SELECT).
-- Scoped to admins via the profiles.role check.
CREATE POLICY "admins update own company" ON companies
  FOR UPDATE USING (
    id = current_company_id()
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
