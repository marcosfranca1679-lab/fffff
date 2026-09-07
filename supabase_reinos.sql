-- ==============================================================================
-- SISTEMA DE REINOS & GUILDAS — 5DAY MC
-- Execute este script no SQL Editor do Supabase
-- ==============================================================================

-- 1. Permissões concedidas pelo Administrador para criar Reino
CREATE TABLE IF NOT EXISTS kingdom_permissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_nick    TEXT NOT NULL UNIQUE,
  allowed      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Tabela de Reinos
CREATE TABLE IF NOT EXISTS kingdoms (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         TEXT NOT NULL UNIQUE,
  tag          VARCHAR(3) NOT NULL UNIQUE,
  logo         TEXT NOT NULL DEFAULT '👑',
  cor          TEXT NOT NULL DEFAULT '#f59e0b',
  descricao    TEXT NOT NULL,
  owner_nick   TEXT NOT NULL UNIQUE,
  taxa_paga    NUMERIC(10, 2) NOT NULL DEFAULT 19.99,
  pontos       INTEGER NOT NULL DEFAULT 0,
  kills        INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Garantir colunas logo e cor caso a tabela já tenha sido criada anteriormente
ALTER TABLE kingdoms ADD COLUMN IF NOT EXISTS logo TEXT DEFAULT '👑';
ALTER TABLE kingdoms ADD COLUMN IF NOT EXISTS cor  TEXT DEFAULT '#f59e0b';

-- 3. Membros do Reino (um jogador só pode estar em um reino por vez)
CREATE TABLE IF NOT EXISTS kingdom_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kingdom_id   UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  user_nick    TEXT NOT NULL UNIQUE,
  role         TEXT NOT NULL DEFAULT 'membro', -- 'lider' ou 'membro'
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Bate-papo privado do Reino (apenas membros do reino visualizam)
CREATE TABLE IF NOT EXISTS kingdom_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kingdom_id   UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  author_nick  TEXT NOT NULL,
  author_role  TEXT NOT NULL DEFAULT 'membro',
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4.5. Convites para o Reino / Clã
CREATE TABLE IF NOT EXISTS kingdom_invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kingdom_id   UUID NOT NULL REFERENCES kingdoms(id) ON DELETE CASCADE,
  invited_nick TEXT NOT NULL,
  invited_by   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'rejected'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Índices de alta performance
CREATE INDEX IF NOT EXISTS idx_kingdom_members_kid ON kingdom_members(kingdom_id);
CREATE INDEX IF NOT EXISTS idx_kingdom_members_nick ON kingdom_members(user_nick);
CREATE INDEX IF NOT EXISTS idx_kingdom_messages_kid ON kingdom_messages(kingdom_id);
CREATE INDEX IF NOT EXISTS idx_kingdom_invites_target ON kingdom_invites(invited_nick, status);
CREATE INDEX IF NOT EXISTS idx_kingdom_invites_kid ON kingdom_invites(kingdom_id);
CREATE INDEX IF NOT EXISTS idx_kingdoms_pontos ON kingdoms(pontos DESC);
CREATE INDEX IF NOT EXISTS idx_kingdoms_logo ON kingdoms(logo);
CREATE INDEX IF NOT EXISTS idx_kingdoms_cor  ON kingdoms(cor);

-- 6. Desativar RLS para acesso direto do backend com service/anon key
ALTER TABLE kingdom_permissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE kingdoms            DISABLE ROW LEVEL SECURITY;
ALTER TABLE kingdom_members     DISABLE ROW LEVEL SECURITY;
ALTER TABLE kingdom_messages    DISABLE ROW LEVEL SECURITY;
ALTER TABLE kingdom_invites     DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE kingdom_permissions TO anon, authenticated, service_role;
GRANT ALL ON TABLE kingdoms            TO anon, authenticated, service_role;
GRANT ALL ON TABLE kingdom_members     TO anon, authenticated, service_role;
GRANT ALL ON TABLE kingdom_messages    TO anon, authenticated, service_role;
GRANT ALL ON TABLE kingdom_invites     TO anon, authenticated, service_role;

-- 7. Políticas de contingência permissivas
DROP POLICY IF EXISTS "Permitir tudo em kingdom_permissions" ON kingdom_permissions;
CREATE POLICY "Permitir tudo em kingdom_permissions" ON kingdom_permissions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir tudo em kingdoms" ON kingdoms;
CREATE POLICY "Permitir tudo em kingdoms" ON kingdoms FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir tudo em kingdom_members" ON kingdom_members;
CREATE POLICY "Permitir tudo em kingdom_members" ON kingdom_members FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir tudo em kingdom_messages" ON kingdom_messages;
CREATE POLICY "Permitir tudo em kingdom_messages" ON kingdom_messages FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir tudo em kingdom_invites" ON kingdom_invites;
CREATE POLICY "Permitir tudo em kingdom_invites" ON kingdom_invites FOR ALL USING (true) WITH CHECK (true);

-- 8. Ativar Realtime WebSockets (Entrega instantânea em 10ms com consumo ZERO no Vercel)
ALTER TABLE messages REPLICA IDENTITY FULL;
ALTER TABLE kingdom_messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'kingdom_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE kingdom_messages;
  END IF;
-- 9. Colunas de Assinatura e Planos dos Reinos
ALTER TABLE kingdoms
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_renewed_at TIMESTAMPTZ;

-- Define expiração inicial de 30 dias para reinos legados que ainda não têm data
UPDATE kingdoms
SET
  subscription_expires_at = NOW() + INTERVAL '30 days',
  subscription_renewed_at = NOW()
WHERE subscription_expires_at IS NULL;

-- 10. Tabela de Pagamentos / Histórico do Mercado Pago
CREATE TABLE IF NOT EXISTS kingdom_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kingdom_id        UUID REFERENCES kingdoms(id) ON DELETE CASCADE,
  owner_nick        TEXT NOT NULL,
  mp_payment_id     TEXT,
  mp_preference_id  TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  amount            NUMERIC(10,2) NOT NULL DEFAULT 19.99,
  tipo              TEXT NOT NULL DEFAULT 'assinatura',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Tabela de Pagamentos Pendentes Pré-Criação de Reino
CREATE TABLE IF NOT EXISTS kingdom_pending_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_nick        TEXT NOT NULL,
  mp_payment_id     TEXT,
  mp_preference_id  TEXT UNIQUE,
  nome              TEXT NOT NULL,
  tag               TEXT NOT NULL,
  logo              TEXT NOT NULL DEFAULT '👑',
  cor               TEXT NOT NULL DEFAULT '#f59e0b',
  descricao         TEXT DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'pending',
  amount            NUMERIC(10,2) NOT NULL DEFAULT 19.99,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '2 hours'
);

-- Índices de Otimização
CREATE INDEX IF NOT EXISTS idx_kingdom_payments_kingdom_id ON kingdom_payments(kingdom_id);
CREATE INDEX IF NOT EXISTS idx_kingdom_payments_mp_id ON kingdom_payments(mp_payment_id);
CREATE INDEX IF NOT EXISTS idx_kingdom_pending_mp_pref ON kingdom_pending_payments(mp_preference_id);
CREATE INDEX IF NOT EXISTS idx_kingdom_pending_nick ON kingdom_pending_payments(owner_nick);
CREATE INDEX IF NOT EXISTS idx_kingdoms_sub_status ON kingdoms(subscription_status);
CREATE INDEX IF NOT EXISTS idx_kingdoms_sub_expires ON kingdoms(subscription_expires_at);

-- Permissões das novas tabelas
ALTER TABLE kingdom_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE kingdom_pending_payments ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE kingdom_payments TO anon, authenticated, service_role;
GRANT ALL ON TABLE kingdom_pending_payments TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Permitir tudo em kingdom_payments" ON kingdom_payments;
CREATE POLICY "Permitir tudo em kingdom_payments" ON kingdom_payments FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir tudo em kingdom_pending_payments" ON kingdom_pending_payments;
CREATE POLICY "Permitir tudo em kingdom_pending_payments" ON kingdom_pending_payments FOR ALL USING (true) WITH CHECK (true);

