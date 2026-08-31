const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const { sql, initDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Inicializar banco e admin padrão ────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'MinecraftAdmin@2025';

async function bootstrap() {
  try {
    await initDb();
    const res = await sql`SELECT id FROM admin WHERE username = ${ADMIN_USER}`;
    if (res.rows.length === 0) {
      const hash = bcrypt.hashSync(ADMIN_PASS, 12);
      await sql`INSERT INTO admin (username, password) VALUES (${ADMIN_USER}, ${hash})`;
      console.log(`✅ Admin criado: ${ADMIN_USER}`);
      console.log('⚠️  Defina ADMIN_PASS via variável de ambiente!');
    }
  } catch (err) {
    console.error('❌ Erro ao inicializar banco:', err.message);
  }
}

bootstrap();

// ─── Middlewares ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'mc-whitelist-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8, // 8 horas
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// ─── Rate limiting simples (brute-force) ─────────────────────────────────────
const loginAttempts = new Map();
function loginRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, firstAttempt: now };
  if (now - entry.firstAttempt > 15 * 60 * 1000) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return next();
  }
  if (entry.count >= 10) {
    return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em 15 minutos.' });
  }
  entry.count++;
  loginAttempts.set(ip, entry);
  next();
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Não autorizado' });
}

// ─── Validação de nick ────────────────────────────────────────────────────────
function validarNick(nick) {
  if (!nick || typeof nick !== 'string') return false;
  return /^[a-zA-Z0-9_]{3,16}$/.test(nick.trim());
}

// ════════════════════════════════════════════════════════════════════════════
//  ROTAS PÚBLICAS (Jogador)
// ════════════════════════════════════════════════════════════════════════════

// Solicitar acesso
app.post('/api/request', async (req, res) => {
  try {
    const nick = (req.body.nick || '').trim();
    if (!validarNick(nick)) {
      return res.status(400).json({ error: 'Nick inválido! Use 3-16 caracteres (letras, números ou _)' });
    }

    const existing = await sql`SELECT status FROM players WHERE LOWER(nick) = LOWER(${nick})`;
    if (existing.rows.length > 0) {
      const { status } = existing.rows[0];
      return res.json({ status, message: statusMessage(status) });
    }

    await sql`INSERT INTO players (nick) VALUES (${nick})`;
    res.json({ status: 'pending', message: '⏳ Pedido enviado! Aguarde a aprovação do admin.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
});

// Checar status
app.get('/api/status/:nick', async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    if (!validarNick(nick)) return res.status(400).json({ error: 'Nick inválido' });

    const result = await sql`SELECT status FROM players WHERE LOWER(nick) = LOWER(${nick})`;
    if (result.rows.length === 0) {
      return res.json({ status: 'not_found', message: '❓ Nick não encontrado. Faça uma solicitação.' });
    }
    const { status } = result.rows[0];
    res.json({ status, message: statusMessage(status) });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── Verificação pelo Addon Bedrock ──────────────────────────────────────────
app.get('/api/check/:nick', async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const result = await sql`SELECT status FROM players WHERE LOWER(nick) = LOWER(${nick})`;
    const allowed = result.rows.length > 0 && result.rows[0].status === 'approved';
    res.json({ allowed, nick });
  } catch (err) {
    res.json({ allowed: false, nick: req.params.nick });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  ROTAS ADMIN
// ════════════════════════════════════════════════════════════════════════════

// Login
app.post('/api/admin/login', loginRateLimit, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });

    const result = await sql`SELECT * FROM admin WHERE username = ${username}`;
    const admin = result.rows[0];
    if (!admin || !bcrypt.compareSync(password, admin.password)) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos' });
    }
    req.session.isAdmin = true;
    req.session.username = username;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// Logout
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Verificar sessão
app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ username: req.session.username });
});

// Listar jogadores
app.get('/api/admin/players', requireAdmin, async (req, res) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : null;

    let pending, approved, rejected;
    if (search) {
      pending  = await sql`SELECT * FROM players WHERE status = 'pending'  AND nick ILIKE ${search} ORDER BY requested_at DESC`;
      approved = await sql`SELECT * FROM players WHERE status = 'approved' AND nick ILIKE ${search} ORDER BY updated_at DESC`;
      rejected = await sql`SELECT * FROM players WHERE status = 'rejected' AND nick ILIKE ${search} ORDER BY updated_at DESC`;
    } else {
      pending  = await sql`SELECT * FROM players WHERE status = 'pending'  ORDER BY requested_at DESC`;
      approved = await sql`SELECT * FROM players WHERE status = 'approved' ORDER BY updated_at DESC`;
      rejected = await sql`SELECT * FROM players WHERE status = 'rejected' ORDER BY updated_at DESC`;
    }

    res.json({ pending: pending.rows, approved: approved.rows, rejected: rejected.rows });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar jogadores.' });
  }
});

// Estatísticas
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const result = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')  AS pending,
        COUNT(*) FILTER (WHERE status = 'approved') AS approved,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
        COUNT(*) AS total
      FROM players
    `;
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar estatísticas.' });
  }
});

// Aprovar
app.post('/api/admin/approve/:nick', requireAdmin, async (req, res) => {
  try {
    const { nick } = req.params;
    const result = await sql`
      UPDATE players SET status = 'approved', updated_at = CURRENT_TIMESTAMP
      WHERE LOWER(nick) = LOWER(${nick})
    `;
    if (result.rowCount === 0) return res.status(404).json({ error: 'Nick não encontrado' });
    console.log(`[ADMIN] ${req.session.username} aprovou: ${nick}`);
    res.json({ success: true, message: `✅ ${nick} aprovado!` });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// Rejeitar
app.post('/api/admin/reject/:nick', requireAdmin, async (req, res) => {
  try {
    const { nick } = req.params;
    const result = await sql`
      UPDATE players SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
      WHERE LOWER(nick) = LOWER(${nick})
    `;
    if (result.rowCount === 0) return res.status(404).json({ error: 'Nick não encontrado' });
    console.log(`[ADMIN] ${req.session.username} rejeitou: ${nick}`);
    res.json({ success: true, message: `❌ ${nick} rejeitado.` });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// Remover
app.delete('/api/admin/remove/:nick', requireAdmin, async (req, res) => {
  try {
    const { nick } = req.params;
    const result = await sql`DELETE FROM players WHERE LOWER(nick) = LOWER(${nick})`;
    if (result.rowCount === 0) return res.status(404).json({ error: 'Nick não encontrado' });
    console.log(`[ADMIN] ${req.session.username} removeu: ${nick}`);
    res.json({ success: true, message: `🗑️ ${nick} removido.` });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// Adicionar manualmente
app.post('/api/admin/add', requireAdmin, async (req, res) => {
  try {
    const nick = (req.body.nick || '').trim();
    if (!validarNick(nick)) return res.status(400).json({ error: 'Nick inválido! Use 3-16 caracteres (letras, números ou _)' });

    await sql`
      INSERT INTO players (nick, status) VALUES (${nick}, 'approved')
      ON CONFLICT (nick) DO UPDATE SET status = 'approved', updated_at = CURRENT_TIMESTAMP
    `;
    console.log(`[ADMIN] ${req.session.username} adicionou manualmente: ${nick}`);
    res.json({ success: true, message: `✅ ${nick} adicionado e aprovado!` });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao adicionar jogador.' });
  }
});

// Trocar senha
app.post('/api/admin/change-password', requireAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Senha nova deve ter pelo menos 8 caracteres' });
    }
    const result = await sql`SELECT * FROM admin WHERE username = ${req.session.username}`;
    const admin = result.rows[0];
    if (!admin || !bcrypt.compareSync(currentPassword, admin.password)) {
      return res.status(401).json({ error: 'Senha atual incorreta' });
    }
    const hash = bcrypt.hashSync(newPassword, 12);
    await sql`UPDATE admin SET password = ${hash} WHERE username = ${req.session.username}`;
    res.json({ success: true, message: '🔐 Senha alterada com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── Helper ──────────────────────────────────────────────────────────────────
function statusMessage(status) {
  const msgs = {
    pending:  '⏳ Aguardando aprovação do administrador...',
    approved: '✅ Acesso liberado! Você pode entrar no servidor.',
    rejected: '❌ Seu acesso foi negado pelo administrador.'
  };
  return msgs[status] || 'Status desconhecido';
}

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Rota não encontrada' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor rodando em http://localhost:${PORT}`);
  console.log(`🔐 Painel Admin: http://localhost:${PORT}/admin.html`);
  console.log(`🎮 Página jogador: http://localhost:${PORT}/\n`);
});
