-- =========================================================================
-- TABELA: admin_protection_zones (Proteções de Terreno do Administrador)
-- Execute este script no SQL Editor do Supabase para criar a tabela.
-- =========================================================================

CREATE TABLE IF NOT EXISTS admin_protection_zones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  world TEXT NOT NULL DEFAULT 'world',
  center_x INTEGER NOT NULL,
  center_z INTEGER NOT NULL,
  radius INTEGER NOT NULL DEFAULT 50,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Permissões / RLS
ALTER TABLE admin_protection_zones ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'admin_protection_zones' AND policyname = 'Acesso Total Service Role admin_protection_zones'
  ) THEN
    CREATE POLICY "Acesso Total Service Role admin_protection_zones" 
      ON admin_protection_zones 
      FOR ALL 
      USING (true) 
      WITH CHECK (true);
  END IF;
END $$;
