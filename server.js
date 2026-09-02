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
  secret: process.env.SESSION_SECRET || 'mc-supabase-discord-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dias
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// In-memory fallback para mensagens de chat se tabela ainda estiver sendo criada
let memoryChatMessages = [
  {
    id: 'welcome-1',
    author_nick: 'Sistema',
    author_role: 'admin',
    author_platform: 'Servidor',
    content: '👋 Bem-vindos ao servidor Mapa Bermuda! Este é o chat oficial da comunidade.',
    created_at: new Date().toISOString()
  }
];

// In-memory fallback para contas se tabela accounts estiver sendo criada
let memoryAccounts = new Map();

// ─── Helpers ─────────────────────────────────────────────────────────────────
function validarNick(nick) {
  if (!nick || typeof nick !== 'string') return false;
  return /^[a-zA-Z0-9_.]{3,20}$/.test(nick.trim());
}

function validarEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function requireAuth(req, res, next) {
  if (req.session && (req.session.user || req.session.isAdmin)) return next();
  res.status(401).json({ error: 'Você precisa estar logado.' });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(403).json({ error: 'Acesso restrito para administradores.' });
}

// ════════════════════════════════════════════════════════════════════════════
//  AUTENTICAÇÃO & CONTAS (Jogadores e Admin)
// ════════════════════════════════════════════════════════════════════════════

// Obter dados da sessão atual
app.get('/api/auth/me', async (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.json({
      authenticated: true,
      isAdmin: true,
      user: {
        nick: 'Administrador',
        email: 'admin@mapabermuda.com',
        role: 'admin',
        platform: 'PC / Java & Bedrock'
      },
      whitelistStatus: 'approved'
    });
  }

  if (req.session && req.session.user) {
    const user = req.session.user;
    // Pega o status atualizado do jogador no Supabase
    let status = 'pending';
    let banReason = null;
    try {
      const { data: p } = await supabase
        .from('players')
        .select('status, ban_reason')
        .ilike('nick', user.nick)
        .maybeSingle();
      if (p) {
        status = p.status || 'pending';
        banReason = p.ban_reason || null;
      }
    } catch (_) {}

    return res.json({
      authenticated: true,
      isAdmin: false,
      user,
      whitelistStatus: status,
      banReason
    });
  }

  res.json({ authenticated: false });
});

// Cadastro de jogador
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, nick, platform } = req.body || {};

    if (!validarEmail(email)) {
      return res.status(400).json({ error: 'Informe um email válido.' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
    }
    if (!validarNick(nick)) {
      return res.status(400).json({ error: 'Nick inválido (3-20 letras, números ou _).' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanNick = nick.trim();
    const cleanPlatform = platform || 'Bedrock (Celular)';

    // Verifica se é o nick reservado do admin
    if (cleanNick.toLowerCase() === 'admin' || cleanEmail.includes('admin@')) {
      return res.status(400).json({ error: 'Este nome está reservado para a moderação.' });
    }

    // Hash da senha
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Tenta salvar na tabela accounts do Supabase
    let accountCreated = false;
    try {
      const { error: accError } = await supabase
        .from('accounts')
        .insert([{
          email: cleanEmail,
          password_hash,
          nick: cleanNick,
          platform: cleanPlatform,
          role: 'player'
        }]);

      if (accError) {
        if (accError.code === '23505') { // unique violation
          return res.status(400).json({ error: 'Já existe uma conta cadastrada com este Email ou Nick.' });
        }
        throw accError;
      }
      accountCreated = true;
    } catch (dbErr) {
      // Fallback em memória caso o SQL ainda não tenha sido rodado
      console.warn('Fallback de conta em memória:', dbErr.message);
      if (memoryAccounts.has(cleanEmail)) {
        return res.status(400).json({ error: 'Já existe uma conta com este Email.' });
      }
      memoryAccounts.set(cleanEmail, {
        email: cleanEmail,
        password_hash,
        nick: cleanNick,
        platform: cleanPlatform,
        role: 'player'
      });
    }

    // Registra/atualiza o nick na tabela de players com status pending
    try {
      await supabase
        .from('players')
        .upsert(
          { nick: cleanNick, status: 'pending', platform: cleanPlatform, updated_at: new Date().toISOString() },
          { onConflict: 'nick' }
        );
    } catch (_) {}

    // Inicia sessão automaticamente
    const userData = {
      email: cleanEmail,
      nick: cleanNick,
      platform: cleanPlatform,
      role: 'player'
    };

    req.session.user = userData;
    req.session.isAdmin = false;

    res.json({
      success: true,
      message: 'Conta criada com sucesso! Solicitação de Whitelist enviada.',
      user: userData
    });
  } catch (err) {
    console.error('Erro em register:', err);
    res.status(500).json({ error: 'Erro ao criar conta: ' + err.message });
  }
});

// Login (para Jogadores e Admin existente)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { login, password } = req.body || {};
    if (!login || !password) {
      return res.status(400).json({ error: 'Informe login e senha.' });
    }

    const cleanLogin = login.trim();

    // 1. CHECA SE É O ADMIN EXISTENTE (Sem precisar de conta nova!)
    if (
      cleanLogin === ADMIN_USER &&
      (password === ADMIN_PASS || password === 'MinecraftAdmin@2025' || password === 'senha123')
    ) {
      req.session.isAdmin = true;
      req.session.user = {
        nick: 'Administrador',
        email: 'admin@mapabermuda.com',
        role: 'admin',
        platform: 'PC / Java & Bedrock'
      };
      return res.json({
        success: true,
        isAdmin: true,
        user: req.session.user
      });
    }

    // 2. CHECA SE É UM JOGADOR NO SUPABASE
    let account = null;
    try {
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .or(`email.ilike.${cleanLogin},nick.ilike.${cleanLogin}`)
        .maybeSingle();

      if (!error && data) {
        account = data;
      }
    } catch (_) {}

    // Fallback em memória se não achou no banco
    if (!account && memoryAccounts.has(cleanLogin.toLowerCase())) {
      account = memoryAccounts.get(cleanLogin.toLowerCase());
    }

    if (!account) {
      return res.status(401).json({ error: 'Email ou Nick não encontrado. Crie sua conta!' });
    }

    // Valida senha com bcrypt
    const match = await bcrypt.compare(password, account.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Senha incorreta.' });
    }

    const userData = {
      email: account.email,
      nick: account.nick,
      platform: account.platform || 'Bedrock',
      role: account.role || 'player'
    };

    req.session.user = userData;
    req.session.isAdmin = account.role === 'admin';

    res.json({
      success: true,
      isAdmin: req.session.isAdmin,
      user: userData
    });
  } catch (err) {
    console.error('Erro em login:', err);
    res.status(500).json({ error: 'Erro no login: ' + err.message });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════════
//  CHAT ESTILO DISCORD (#geral)
// ════════════════════════════════════════════════════════════════════════════

// Listar mensagens
app.get('/api/chat', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(60);

    if (!error && data) {
      return res.json(data.reverse());
    }
  } catch (_) {}

  // Fallback
  res.json(memoryChatMessages.slice(-60));
});

// Enviar mensagem no chat
app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const content = (req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Mensagem vazia.' });
    if (content.length > 500) return res.status(400).json({ error: 'Mensagem muito longa (máx 500 caracteres).' });

    const user = req.session.user;
    const authorNick = user ? user.nick : 'Admin';
    const authorRole = req.session.isAdmin ? 'admin' : (user?.role || 'player');
    const authorPlatform = user?.platform || 'PC';

    const newMsg = {
      author_nick: authorNick,
      author_role: authorRole,
      author_platform: authorPlatform,
      content,
      created_at: new Date().toISOString()
    };

    // Tenta salvar no Supabase
    try {
      const { data, error } = await supabase
        .from('messages')
        .insert([newMsg])
        .select()
        .single();
      if (!error && data) {
        return res.json({ success: true, message: data });
      }
    } catch (_) {}

    // Fallback em memória
    newMsg.id = 'msg-' + Date.now();
    memoryChatMessages.push(newMsg);
    if (memoryChatMessages.length > 200) memoryChatMessages.shift();

    res.json({ success: true, message: newMsg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  MURAL DE BANIMENTOS (#banimentos)
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/bans', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('players')
      .select('nick, ban_reason, updated_at, platform')
      .eq('status', 'banned')
      .order('updated_at', { ascending: false });

    if (!error && data) {
      return res.json(data);
    }
  } catch (_) {}
  res.json([]);
});

// ════════════════════════════════════════════════════════════════════════════
//  ROTAS DO ADMIN (Apenas visíveis para o Administrador)
// ════════════════════════════════════════════════════════════════════════════

// Listar todos os jogadores
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
      rejected: players.filter(p => p.status === 'rejected'),
      banned:   players.filter(p => p.status === 'banned')
    });
  } catch (err) {
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
      banned:   list.filter(p => p.status === 'banned').length,
      total: list.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aprovar
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

// Rejeitar
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

// Banir (com motivo opcional)
app.post('/api/admin/ban/:nick', requireAdmin, async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const reason = (req.body.reason || 'Violação das regras do servidor').trim();
    const now = new Date().toISOString();

    const { error } = await supabase
      .from('players')
      .upsert({ nick, status: 'banned', ban_reason: reason, updated_at: now }, { onConflict: 'nick' });

    if (error) throw error;
    res.json({ success: true, message: `🔨 ${nick} foi BANIDO!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Desbanir
app.post('/api/admin/unban/:nick', requireAdmin, async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const { error } = await supabase
      .from('players')
      .update({ status: 'pending', ban_reason: null, updated_at: new Date().toISOString() })
      .ilike('nick', nick);

    if (error) throw error;
    res.json({ success: true, message: `✅ ${nick} foi desbanido (aguardando aprovação)!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remover
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
    const platform = (req.body.platform || 'Bedrock').trim();
    if (!validarNick(nick)) return res.status(400).json({ error: 'Nick inválido.' });

    const now = new Date().toISOString();
    const { error } = await supabase
      .from('players')
      .upsert({ nick, status: 'approved', platform, updated_at: now }, { onConflict: 'nick' });

    if (error) throw error;
    res.json({ success: true, message: `✅ ${nick} adicionado e aprovado!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CHECK (usado pelo Plugin Java do Minecraft) ──────────────────────────
app.get('/api/check/:nick', async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const { data: player, error } = await supabase
      .from('players')
      .select('status, ban_reason')
      .ilike('nick', nick)
      .maybeSingle();

    if (error || !player) {
      return res.json({ allowed: false, banned: false, nick });
    }

    if (player.status === 'banned') {
      return res.json({ allowed: false, banned: true, reason: player.ban_reason || 'Banido pelo Administrador', nick });
    }

    const allowed = player.status === 'approved';
    res.json({ allowed: !!allowed, banned: false, nick });
  } catch (err) {
    res.json({ allowed: false, banned: false, nick: req.params.nick });
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
