const { sql } = require('@vercel/postgres');

// Criar tabelas no Postgres (executa uma vez na inicialização)
async function initDb() {
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
}

module.exports = { sql, initDb };
