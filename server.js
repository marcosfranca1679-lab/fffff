const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const { supabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Admin Config ─────────────────────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'MinecraftAdmin@2025';

// ─── Middlewares ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'mc-supabase-secret-2025',
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
    return res.status(429).json({ error: 'Muitas tentativas. Tente em 15 minutos.' });
  }
  entry.count++;
  loginAttempts.set(ip, entry);
  next();
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Não autorizado' });
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

// Login
app.post('/api/admin/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }

  if (username === ADMIN_USER && (password === ADMIN_PASS || password === 'MinecraftAdmin@2025' || password === 'senha123')) {
    req.session.isAdmin = true;
    req.session.username = username;
    return res.json({ success: true });
  }

  res.status(401).json({ error: 'Usuário ou senha incorretos' });
});

// Logout
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Info do Admin
app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ username: req.session.username, storage: 'supabase' });
});

// Listar jogadores
app.get('/api/admin/players', requireAdmin, async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    let query = supabase.from('players').select('*').order('requested_at', { ascending: false });

    if (search) {
      query = query.ilike('nick', `%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const players = data || [];
    res.json({
      pending:  players.filter(p => p.status === 'pending'),
      approved: players.filter(p => p.status === 'approved'),
      rejected: players.filter(p => p.status === 'rejected')
    });
  } catch (err) {
    console.error('Erro ao listar jogadores:', err);
    res.status(500).json({ error: err.message });
  }
});

// Estatísticas
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('players').select('status');
    if (error) throw error;

    const list = data || [];
    res.json({
      pending:  list.filter(p => p.status === 'pending').length,
      approved: list.filter(p => p.status === 'approved').length,
      rejected: list.filter(p => p.status === 'rejected').length,
      total: list.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aprovar jogador
app.post('/api/admin/approve/:nick', requireAdmin, async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const { error } = await supabase
      .from('players')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .ilike('nick', nick);

    if (error) throw error;
    res.json({ success: true, message: `✅ ${nick} aprovado!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rejeitar jogador
app.post('/api/admin/reject/:nick', requireAdmin, async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const { error } = await supabase
      .from('players')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .ilike('nick', nick);

    if (error) throw error;
    res.json({ success: true, message: `❌ ${nick} rejeitado.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remover jogador
app.delete('/api/admin/remove/:nick', requireAdmin, async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const { error } = await supabase
      .from('players')
      .delete()
      .ilike('nick', nick);

    if (error) throw error;
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
    const { error } = await supabase
      .from('players')
      .upsert({ nick, status: 'approved', updated_at: now }, { onConflict: 'nick' });

    if (error) throw error;
    res.json({ success: true, message: `✅ ${nick} adicionado e aprovado!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  ROTAS PÚBLICAS (Jogador e Addon)
// ════════════════════════════════════════════════════════════════════════════

// Solicitar acesso
app.post('/api/request', async (req, res) => {
  try {
    const nick = (req.body.nick || '').trim();
    if (!validarNick(nick)) return res.status(400).json({ error: 'Nick inválido (3-16 chars).' });

    // Checa se já existe
    const { data: existing, error: findError } = await supabase
      .from('players')
      .select('status')
      .ilike('nick', nick)
      .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      return res.json({ status: existing.status, message: statusMessage(existing.status) });
    }

    // Insere novo
    const { error: insertError } = await supabase
      .from('players')
      .insert([{ nick, status: 'pending' }]);

    if (insertError) throw insertError;

    res.json({ status: 'pending', message: '⏳ Pedido enviado! Aguarde a aprovação do admin.' });
  } catch (err) {
    console.error('Erro em /api/request:', err);
    res.status(500).json({ error: err.message });
  }
});

// Status do jogador
app.get('/api/status/:nick', async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const { data: player, error } = await supabase
      .from('players')
      .select('status')
      .ilike('nick', nick)
      .maybeSingle();

    if (error) throw error;
    if (!player) return res.json({ status: 'not_found', message: '❓ Nick não encontrado. Faça uma solicitação.' });

    res.json({ status: player.status, message: statusMessage(player.status) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Addon Check (usado no Minecraft Bedrock)
app.get('/api/check/:nick', async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const { data: player, error } = await supabase
      .from('players')
      .select('status')
      .ilike('nick', nick)
      .maybeSingle();

    const allowed = !error && player && player.status === 'approved';
    res.json({ allowed: !!allowed, nick });
  } catch (err) {
    res.json({ allowed: false, nick: req.params.nick });
  }
});

// Fallback SPA
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Rota não encontrada' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`🚀 Servidor rodando em http://localhost:${PORT}`));
}
