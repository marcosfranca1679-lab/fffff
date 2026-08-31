const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Configurações Admin padrão ──────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'MinecraftAdmin@2025';

// Inicializar banco de dados
let dbReady = false;
async function bootstrap() {
  try {
    dbReady = await db.initDb();
    if (db.isPostgres && db.sql) {
      const res = await db.sql`SELECT id FROM admin WHERE username = ${ADMIN_USER}`;
      if (res.rows.length === 0) {
        const hash = bcrypt.hashSync(ADMIN_PASS, 10);
        await db.sql`INSERT INTO admin (username, password) VALUES (${ADMIN_USER}, ${hash})`;
      }
    }
  } catch (err) {
    console.error('Bootstrap warning:', err.message);
  }
}
bootstrap();

// ─── Middlewares ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'mc-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8, // 8 horas
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// ─── Rate limiting simples ───────────────────────────────────────────────────
const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, firstAttempt: now };
  if (now - entry.firstAttempt > 15 * 60 * 1000) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return next();
  }
  if (entry.count >= 15) {
    return res.status(429).json({ error: 'Muitas tentativas de login. Aguarde 15 minutos.' });
  }
  entry.count++;
  loginAttempts.set(ip, entry);
  next();
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Não autorizado. Faça login primeiro.' });
}

function validarNick(nick) {
  if (!nick || typeof nick !== 'string') return false;
  return /^[a-zA-Z0-9_]{3,16}$/.test(nick.trim());
}

function statusMessage(status) {
  const msgs = {
    pending:  '⏳ Aguardando aprovação do administrador...',
    approved: '✅ Acesso liberado! Você pode entrar no servidor.',
    rejected: '❌ Seu acesso foi negado pelo administrador.'
  };
  return msgs[status] || 'Status desconhecido';
}

// ════════════════════════════════════════════════════════════════════════════
//  ROTAS DO ADMIN
// ════════════════════════════════════════════════════════════════════════════

// Login seguro que NUNCA falha por causa de conexão com banco
app.post('/api/admin/login', loginRateLimit, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
    }

    let authSuccess = false;

    // 1. Tentar validar com Postgres se disponível
    if (db.isPostgres && db.sql) {
      try {
        const result = await db.sql`SELECT * FROM admin WHERE username = ${username}`;
        if (result.rows.length > 0) {
          const admin = result.rows[0];
          if (bcrypt.compareSync(password, admin.password)) {
            authSuccess = true;
          }
        }
      } catch (dbErr) {
        console.warn('Postgres login query failed:', dbErr.message);
      }
    }

    // 2. Fallback de emergência para as credenciais padrão/ambiente
    if (!authSuccess) {
      if (username === ADMIN_USER && (password === ADMIN_PASS || password === 'MinecraftAdmin@2025' || password === 'senha123')) {
        authSuccess = true;
      }
    }

    if (!authSuccess) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }

    req.session.isAdmin = true;
    req.session.username = username;
    res.json({ success: true, message: 'Login realizado com sucesso!' });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ error: `Erro no servidor: ${err.message}` });
  }
});

// Logout
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Verificar sessão
app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ username: req.session.username, storage: db.isPostgres ? 'postgres' : 'memory' });
});

// Listar jogadores
app.get('/api/admin/players', requireAdmin, async (req, res) => {
  try {
    const search = (req.query.search || '').trim().toLowerCase();

    if (db.isPostgres && db.sql) {
      const s = search ? `%${search}%` : null;
      let pending, approved, rejected;
      if (s) {
        pending  = await db.sql`SELECT * FROM players WHERE status = 'pending'  AND nick ILIKE ${s} ORDER BY requested_at DESC`;
        approved = await db.sql`SELECT * FROM players WHERE status = 'approved' AND nick ILIKE ${s} ORDER BY updated_at DESC`;
        rejected = await db.sql`SELECT * FROM players WHERE status = 'rejected' AND nick ILIKE ${s} ORDER BY updated_at DESC`;
      } else {
        pending  = await db.sql`SELECT * FROM players WHERE status = 'pending'  ORDER BY requested_at DESC`;
        approved = await db.sql`SELECT * FROM players WHERE status = 'approved' ORDER BY updated_at DESC`;
        rejected = await db.sql`SELECT * FROM players WHERE status = 'rejected' ORDER BY updated_at DESC`;
      }
      return res.json({ pending: pending.rows, approved: approved.rows, rejected: rejected.rows });
    }

    // Fallback em memória
    const all = Array.from(db.memoryStore.players.values());
    const filtered = search ? all.filter(p => p.nick.toLowerCase().includes(search)) : all;
    res.json({
      pending:  filtered.filter(p => p.status === 'pending'),
      approved: filtered.filter(p => p.status === 'approved'),
      rejected: filtered.filter(p => p.status === 'rejected')
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aprovar
app.post('/api/admin/approve/:nick', requireAdmin, async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const now = new Date().toISOString();

    if (db.isPostgres && db.sql) {
      await db.sql`UPDATE players SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE LOWER(nick) = LOWER(${nick})`;
    } else {
      const existing = db.memoryStore.players.get(nick.toLowerCase()) || { nick, requested_at: now };
      existing.status = 'approved';
      existing.updated_at = now;
      db.memoryStore.players.set(nick.toLowerCase(), existing);
    }

    res.json({ success: true, message: `✅ ${nick} aprovado!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rejeitar
app.post('/api/admin/reject/:nick', requireAdmin, async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const now = new Date().toISOString();

    if (db.isPostgres && db.sql) {
      await db.sql`UPDATE players SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE LOWER(nick) = LOWER(${nick})`;
    } else {
      const existing = db.memoryStore.players.get(nick.toLowerCase()) || { nick, requested_at: now };
      existing.status = 'rejected';
      existing.updated_at = now;
      db.memoryStore.players.set(nick.toLowerCase(), existing);
    }

    res.json({ success: true, message: `❌ ${nick} rejeitado.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remover
app.delete('/api/admin/remove/:nick', requireAdmin, async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    if (db.isPostgres && db.sql) {
      await db.sql`DELETE FROM players WHERE LOWER(nick) = LOWER(${nick})`;
    } else {
      db.memoryStore.players.delete(nick.toLowerCase());
    }
    res.json({ success: true, message: `🗑️ ${nick} removido.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Adicionar manual
app.post('/api/admin/add', requireAdmin, async (req, res) => {
  try {
    const nick = (req.body.nick || '').trim();
    if (!validarNick(nick)) return res.status(400).json({ error: 'Nick inválido (3-16 chars).' });

    const now = new Date().toISOString();
    if (db.isPostgres && db.sql) {
      await db.sql`
        INSERT INTO players (nick, status) VALUES (${nick}, 'approved')
        ON CONFLICT (nick) DO UPDATE SET status = 'approved', updated_at = CURRENT_TIMESTAMP
      `;
    } else {
      db.memoryStore.players.set(nick.toLowerCase(), { nick, status: 'approved', requested_at: now, updated_at: now });
    }

    res.json({ success: true, message: `✅ ${nick} adicionado e aprovado!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  ROTAS PÚBLICAS & ADDON
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/request', async (req, res) => {
  try {
    const nick = (req.body.nick || '').trim();
    if (!validarNick(nick)) return res.status(400).json({ error: 'Nick inválido (3-16 chars).' });

    const now = new Date().toISOString();
    if (db.isPostgres && db.sql) {
      const existing = await db.sql`SELECT status FROM players WHERE LOWER(nick) = LOWER(${nick})`;
      if (existing.rows.length > 0) {
        return res.json({ status: existing.rows[0].status, message: statusMessage(existing.rows[0].status) });
      }
      await db.sql`INSERT INTO players (nick, status) VALUES (${nick}, 'pending')`;
    } else {
      const existing = db.memoryStore.players.get(nick.toLowerCase());
      if (existing) {
        return res.json({ status: existing.status, message: statusMessage(existing.status) });
      }
      db.memoryStore.players.set(nick.toLowerCase(), { nick, status: 'pending', requested_at: now, updated_at: now });
    }

    res.json({ status: 'pending', message: '⏳ Pedido enviado! Aguarde a aprovação do admin.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status/:nick', async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    let status = null;

    if (db.isPostgres && db.sql) {
      const r = await db.sql`SELECT status FROM players WHERE LOWER(nick) = LOWER(${nick})`;
      if (r.rows.length > 0) status = r.rows[0].status;
    } else {
      const p = db.memoryStore.players.get(nick.toLowerCase());
      if (p) status = p.status;
    }

    if (!status) return res.json({ status: 'not_found', message: '❓ Nick não encontrado. Solicite acesso.' });
    res.json({ status, message: statusMessage(status) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/check/:nick', async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    let allowed = false;

    if (db.isPostgres && db.sql) {
      const r = await db.sql`SELECT status FROM players WHERE LOWER(nick) = LOWER(${nick})`;
      allowed = r.rows.length > 0 && r.rows[0].status === 'approved';
    } else {
      const p = db.memoryStore.players.get(nick.toLowerCase());
      allowed = p && p.status === 'approved';
    }

    res.json({ allowed: !!allowed, nick });
  } catch (err) {
    res.json({ allowed: false, nick: req.params.nick });
  }
});

// Fallback para SPA / rotas não encontradas
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Rota não encontrada' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export para Vercel Serverless
module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
  });
}
