let sql = null;
let isPostgresAvailable = false;

// Tenta carregar @vercel/postgres se a variável de ambiente existir
if (process.env.POSTGRES_URL || process.env.DATABASE_URL) {
  try {
    const vercelPg = require('@vercel/postgres');
    sql = vercelPg.sql;
    isPostgresAvailable = true;
  } catch (e) {
    console.warn('⚠️ Postgres não disponível, usando fallback em memória.');
  }
}

// Armazenamento em memória (fallback) para nunca dar erro interno
const memoryStore = {
  players: new Map(), // nick -> { nick, status, requested_at, updated_at }
  admin: new Map()    // username -> { username, password }
};

async function initDb() {
  if (isPostgresAvailable && sql) {
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS players (
          id        SERIAL PRIMARY KEY,
          nick      TEXT NOT NULL,
          status    TEXT NOT NULL DEFAULT 'pending',
          requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT players_nick_unique UNIQUE (nick)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS admin (
          id       SERIAL PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL
        )
      `;
      console.log('✅ Banco Postgres conectado e inicializado!');
      return true;
    } catch (err) {
      console.error('⚠️ Falha ao inicializar Postgres:', err.message);
      isPostgresAvailable = false;
      return false;
    }
  }
  return false;
}

module.exports = {
  get sql() { return isPostgresAvailable ? sql : null; },
  get isPostgres() { return isPostgresAvailable; },
  memoryStore,
  initDb
};
