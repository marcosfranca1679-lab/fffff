-- ══════════════════════════════════════════════════════════════════════════════
-- 5DAY MC — SCHEMA PERFIL VIP (FOTO DE PERFIL & MOLDURAS ANIMADAS MINECRAFT)
-- Execute este script no SQL Editor do seu projeto no Supabase
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Tabela Principal de Perfis VIP (Armazena Foto e Moldura dos Jogadores)
CREATE TABLE IF NOT EXISTS user_vip_profiles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_nick    TEXT UNIQUE NOT NULL,
  avatar_url   TEXT,                                -- Imagem otimizada (Base64 data URL ou URL pública)
  frame_id     TEXT NOT NULL DEFAULT 'portal_nether', -- Identificador da moldura de Minecraft
  status       TEXT NOT NULL DEFAULT 'inactive',     -- 'active', 'inactive', 'expired'
  expires_at   TIMESTAMPTZ,                         -- Vencimento do plano de 30 dias
  renewed_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Tabela de Pagamentos Pendentes de Perfil VIP (Mercado Pago PIX)
CREATE TABLE IF NOT EXISTS profile_pending_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_nick         TEXT NOT NULL,
  mp_preference_id  TEXT UNIQUE,
  mp_payment_id     TEXT,
  avatar_url        TEXT,
  frame_id          TEXT NOT NULL DEFAULT 'portal_nether',
  status            TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'cancelled'
  amount            NUMERIC(10,2) NOT NULL DEFAULT 9.99,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '2 hours'
);

-- 3. Tabela de Histórico de Transações e Pagamentos do Perfil VIP
CREATE TABLE IF NOT EXISTS profile_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_nick         TEXT NOT NULL,
  mp_payment_id     TEXT,
  mp_preference_id  TEXT,
  frame_id          TEXT,
  status            TEXT NOT NULL DEFAULT 'approved',
  amount            NUMERIC(10,2) NOT NULL DEFAULT 9.99,
  tipo              TEXT NOT NULL DEFAULT 'assinatura', -- 'assinatura', 'renovacao'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Índices de Alta Performance
CREATE INDEX IF NOT EXISTS idx_user_vip_profiles_nick ON user_vip_profiles(user_nick);
CREATE INDEX IF NOT EXISTS idx_user_vip_profiles_status ON user_vip_profiles(status);
CREATE INDEX IF NOT EXISTS idx_user_vip_profiles_expires ON user_vip_profiles(expires_at);
CREATE INDEX IF NOT EXISTS idx_profile_pending_pref ON profile_pending_payments(mp_preference_id);
CREATE INDEX IF NOT EXISTS idx_profile_pending_nick ON profile_pending_payments(user_nick);
CREATE INDEX IF NOT EXISTS idx_profile_payments_nick ON profile_payments(user_nick);
CREATE INDEX IF NOT EXISTS idx_profile_payments_mp_id ON profile_payments(mp_payment_id);

-- 5. Configuração de Segurança e Permissões de Contingência (Sem bloqueios de RLS)
ALTER TABLE user_vip_profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_pending_payments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_payments          ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE user_vip_profiles        TO anon, authenticated, service_role;
GRANT ALL ON TABLE profile_pending_payments TO anon, authenticated, service_role;
GRANT ALL ON TABLE profile_payments         TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Permitir tudo em user_vip_profiles" ON user_vip_profiles;
CREATE POLICY "Permitir tudo em user_vip_profiles" ON user_vip_profiles FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir tudo em profile_pending_payments" ON profile_pending_payments;
CREATE POLICY "Permitir tudo em profile_pending_payments" ON profile_pending_payments FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir tudo em profile_payments" ON profile_payments;
CREATE POLICY "Permitir tudo em profile_payments" ON profile_payments FOR ALL USING (true) WITH CHECK (true);

-- 6. Suporte a Realtime (Consumo Zero no Vercel via WebSockets)
ALTER TABLE user_vip_profiles REPLICA IDENTITY FULL;
ALTER TABLE profile_pending_payments REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'user_vip_profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE user_vip_profiles;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'profile_pending_payments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE profile_pending_payments;
  END IF;
END $$;
