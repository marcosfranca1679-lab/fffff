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
const ADMIN_PASS = process.env.ADMIN_PASS || 'senha123'; // Troque antes de usar!

// Criar admin padrão se não existir
const adminExists = db.prepare('SELECT id FROM admin WHERE username = ?').get(ADMIN_USER);
if (!adminExists) {
  const hash = bcrypt.hashSync(ADMIN_PASS, 10);
  db.prepare('INSERT INTO admin (username, password) VALUES (?, ?)').run(ADMIN_USER, hash);
  console.log(`✅ Admin criado: ${ADMIN_USER} / ${ADMIN_PASS}`);
}

// ─── Middlewares ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'minecraft-whitelist-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 horas
}));

// ─── Middleware de autenticação admin ────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Não autorizado' });
}

// ════════════════════════════════════════════════════════════════════════════
//  ROTAS PÚBLICAS (Jogador)
// ════════════════════════════════════════════════════════════════════════════

// Solicitar acesso
app.post('/api/request', (req, res) => {
  const nick = (req.body.nick || '').trim();
  if (!nick || nick.length < 3 || nick.length > 16) {
    return res.status(400).json({ error: 'Nick inválido (3-16 caracteres)' });
  }

  const existing = db.prepare('SELECT * FROM players WHERE nick = ?').get(nick);
  if (existing) {
    return res.json({ status: existing.status, message: statusMessage(existing.status) });
  }

  db.prepare('INSERT INTO players (nick) VALUES (?)').run(nick);
  res.json({ status: 'pending', message: 'Pedido enviado! Aguarde a aprovação do admin.' });
});

// Checar status do pedido
app.get('/api/status/:nick', (req, res) => {
  const nick = req.params.nick.trim();
  const player = db.prepare('SELECT status FROM players WHERE nick = ?').get(nick);
  if (!player) return res.json({ status: 'not_found', message: 'Nick não encontrado. Faça uma solicitação.' });
  res.json({ status: player.status, message: statusMessage(player.status) });
});

// ────────────────────────────────────────────────────────────────────────────
//  ROTA USADA PELO MOD (Addon Bedrock)
// ────────────────────────────────────────────────────────────────────────────

// O mod chama essa rota quando um jogador entra no servidor
app.get('/api/check/:nick', (req, res) => {
  const nick = req.params.nick.trim();
  const player = db.prepare('SELECT status FROM players WHERE nick = ?').get(nick);
  const allowed = player && player.status === 'approved';
  res.json({ allowed, nick });
});

// ════════════════════════════════════════════════════════════════════════════
//  ROTAS DO ADMIN
// ════════════════════════════════════════════════════════════════════════════

// Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT * FROM admin WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password)) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos' });
  }
  req.session.isAdmin = true;
  req.session.username = username;
  res.json({ success: true });
});

// Logout
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Verificar se está logado
app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ username: req.session.username });
});

// Listar todos os jogadores (separados por status)
app.get('/api/admin/players', requireAdmin, (req, res) => {
  const pending  = db.prepare("SELECT * FROM players WHERE status = 'pending'  ORDER BY requested_at DESC").all();
  const approved = db.prepare("SELECT * FROM players WHERE status = 'approved' ORDER BY updated_at DESC").all();
  const rejected = db.prepare("SELECT * FROM players WHERE status = 'rejected' ORDER BY updated_at DESC").all();
  res.json({ pending, approved, rejected });
});

// Aprovar jogador
app.post('/api/admin/approve/:nick', requireAdmin, (req, res) => {
  const nick = req.params.nick;
  const result = db.prepare("UPDATE players SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE nick = ?").run(nick);
  if (result.changes === 0) return res.status(404).json({ error: 'Nick não encontrado' });
  res.json({ success: true, message: `${nick} aprovado!` });
});

// Rejeitar jogador
app.post('/api/admin/reject/:nick', requireAdmin, (req, res) => {
  const nick = req.params.nick;
  const result = db.prepare("UPDATE players SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE nick = ?").run(nick);
  if (result.changes === 0) return res.status(404).json({ error: 'Nick não encontrado' });
  res.json({ success: true, message: `${nick} rejeitado.` });
});

// Remover jogador (apagar do banco)
app.delete('/api/admin/remove/:nick', requireAdmin, (req, res) => {
  const nick = req.params.nick;
  db.prepare('DELETE FROM players WHERE nick = ?').run(nick);
  res.json({ success: true, message: `${nick} removido.` });
});

// Adicionar Nick manualmente (sem precisar de solicitação)
app.post('/api/admin/add', requireAdmin, (req, res) => {
  const nick = (req.body.nick || '').trim();
  if (!nick) return res.status(400).json({ error: 'Nick inválido' });
  try {
    db.prepare("INSERT OR REPLACE INTO players (nick, status) VALUES (?, 'approved')").run(nick);
    res.json({ success: true, message: `${nick} adicionado e aprovado!` });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao adicionar jogador' });
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

// ─── Iniciar servidor ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor rodando em http://localhost:${PORT}`);
  console.log(`🔐 Painel Admin: http://localhost:${PORT}/admin.html`);
  console.log(`🎮 Página jogador: http://localhost:${PORT}/\n`);
});
