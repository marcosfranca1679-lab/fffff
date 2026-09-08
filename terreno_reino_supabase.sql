-- ==============================================================================
-- SISTEMA DE PROTEÇÃO DE TERRENO DE REINO — 5DAY MC
-- Execute este script no SQL Editor do Supabase se a tabela kingdoms já existir
-- ==============================================================================

ALTER TABLE kingdoms ADD COLUMN IF NOT EXISTS land_protection JSONB DEFAULT NULL;

COMMENT ON COLUMN kingdoms.land_protection IS 'Configuração de proteção de terreno: { enabled: boolean, centerX: number, centerZ: number, world: string, radius: number, updatedAt: string, updatedBy: string }';
