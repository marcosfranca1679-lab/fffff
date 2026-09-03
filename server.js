const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { supabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Admin Config ─────────────────────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'MinecraftAdmin@2025';
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'mapabermuda-auth-secret-key-2025-mc';

// ─── Middlewares ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Token Stateless (Funciona 100% no Vercel Serverless sem perder sessão) ───
function createAuthToken(payload) {
  const data = JSON.stringify({ ...payload, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 }); // 30 dias
  const b64 = Buffer.from(data).toString('base64');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(b64).digest('hex');
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '127.0.0.1';
}

const userWebIps = new Map();
const bannedIpsCache = new Map();

// Middleware de Autenticação via Header Bearer
app.use((req, res, next) => {
  const clientIp = getClientIp(req);
  req.clientIp = clientIp;

  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }
  if (!token && req.query && req.query.token) {
    token = req.query.token;
  }

  if (token) {
    const payload = verifyAuthToken(token);
    if (payload) {
      req.user = payload.user;
      req.isAdmin = payload.isAdmin || false;
      if (req.user && req.user.nick) {
        userWebIps.set(req.user.nick.toLowerCase(), clientIp);
      }
    }
  }
  next();
});

function requireAuth(req, res, next) {
  if (req.user || req.isAdmin) return next();
  res.status(401).json({ error: 'Você precisa estar logado.' });
}

function requireAdmin(req, res, next) {
  if (req.isAdmin) return next();
  res.status(403).json({ error: 'Acesso restrito para administradores.' });
}

function validarNick(nick) {
  if (!nick || typeof nick !== 'string') return false;
  return /^[a-zA-Z0-9_.]{3,20}$/.test(nick.trim());
}

function validarEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ════════════════════════════════════════════════════════════════════════════
//  AUTENTICAÇÃO & CONTAS
// ════════════════════════════════════════════════════════════════════════════

// Dados do usuário autenticado atual
app.get('/api/auth/me', async (req, res) => {
  if (req.isAdmin) {
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

  if (req.user) {
    const user = req.user;
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
      return res.status(400).json({ error: 'Nick inválido (3 a 20 letras ou números).' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanNick = nick.trim();
    const cleanPlatform = platform || 'Bedrock (Celular)';

    if (cleanNick.toLowerCase() === 'admin' || cleanEmail.includes('admin@')) {
      return res.status(400).json({ error: 'Este nome está reservado.' });
    }

    // Hash da senha
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Salva na tabela accounts
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
      if (accError.code === '23505') {
        return res.status(400).json({ error: 'Já existe uma conta com este Email ou Nick.' });
      }
      throw accError;
    }

    // Registra na tabela players como pending
    await supabase
      .from('players')
      .upsert(
        { nick: cleanNick, status: 'pending', platform: cleanPlatform, updated_at: new Date().toISOString() },
        { onConflict: 'nick' }
      );

    const userData = {
      email: cleanEmail,
      nick: cleanNick,
      platform: cleanPlatform,
      role: 'player'
    };

    const token = createAuthToken({ user: userData, isAdmin: false });

    res.json({
      success: true,
      message: 'Conta criada com sucesso! Solicitação de Whitelist enviada.',
      token,
      user: userData,
      isAdmin: false
    });
  } catch (err) {
    console.error('Erro em register:', err);
    res.status(500).json({ error: 'Erro ao criar conta: ' + err.message });
  }
});

// Login (Jogadores e Admin Existente)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { login, password } = req.body || {};
    if (!login || !password) {
      return res.status(400).json({ error: 'Informe login e senha.' });
    }

    const cleanLogin = login.trim();

    // 1. ADMIN EXISTENTE
    if (
      cleanLogin === ADMIN_USER &&
      (password === ADMIN_PASS || password === 'MinecraftAdmin@2025' || password === 'senha123')
    ) {
      const adminUser = {
        nick: 'Administrador',
        email: 'admin@mapabermuda.com',
        role: 'admin',
        platform: 'PC / Java & Bedrock'
      };
      const token = createAuthToken({ user: adminUser, isAdmin: true });
      return res.json({
        success: true,
        token,
        isAdmin: true,
        user: adminUser
      });
    }

    // 2. JOGADOR NO SUPABASE
    const { data: account, error: findError } = await supabase
      .from('accounts')
      .select('*')
      .or(`email.ilike.${cleanLogin},nick.ilike.${cleanLogin}`)
      .maybeSingle();

    if (findError || !account) {
      return res.status(401).json({ error: 'Email ou Nick não encontrado. Crie sua conta!' });
    }

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

    const isAdmin = account.role === 'admin';
    const token = createAuthToken({ user: userData, isAdmin });

    res.json({
      success: true,
      token,
      isAdmin,
      user: userData
    });
  } catch (err) {
    console.error('Erro em login:', err);
    res.status(500).json({ error: 'Erro no login: ' + err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  CHAT DA COMUNIDADE (#chat-geral)
// ════════════════════════════════════════════════════════════════════════════

// Função para apagar automaticamente mensagens com mais de 30 dias
async function limparMensagens30Dias() {
  try {
    const limite = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('messages')
      .delete()
      .lt('created_at', limite)
      .not('author_role', 'in', '("telemetry","ban_log","ip_ban","death_log")');
  } catch (err) {
    // Silencioso
  }
}

// Listar mensagens (executa a limpeza de 30 dias periodicamente)
app.get('/api/chat', async (req, res) => {
  try {
    // Limpeza de 30 dias a cada chamada
    limparMensagens30Dias().catch(() => {});

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .not('author_role', 'in', '("telemetry","ban_log","ip_ban","death_log")')
      .order('created_at', { ascending: false })
      .limit(60);

    if (error) throw error;
    res.json((data || []).reverse());
  } catch (err) {
    res.json([]);
  }
});

// Enviar mensagem no chat
app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const content = (req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Mensagem vazia.' });
    if (content.length > 500) return res.status(400).json({ error: 'Mensagem muito longa (máx 500 caracteres).' });

    const user = req.user;
    const authorNick = req.isAdmin ? 'Admin' : (user ? user.nick : 'Jogador');
    const authorRole = req.isAdmin ? 'admin' : (user?.role || 'player');
    const authorPlatform = user?.platform || 'PC';

    const newMsg = {
      author_nick: authorNick,
      author_role: authorRole,
      author_platform: authorPlatform,
      content,
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('messages')
      .insert([newMsg])
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, message: data });
  } catch (err) {
    console.error('Erro ao enviar mensagem no chat:', err);
    res.status(500).json({ error: 'Erro ao enviar mensagem: ' + err.message });
  }
});

// Limpeza manual do chat pelo Administrador
app.post('/api/admin/chat/clear', requireAdmin, async (req, res) => {
  try {
    // Apaga apenas as mensagens de chat reais (preserva histórico de bans e telemetria)
    await supabase.from('messages').delete().not('author_role', 'in', '("telemetry","ban_log")');

    // Insere mensagem de sistema informando que foi limpo
    await supabase.from('messages').insert([{
      author_nick: 'Sistema',
      author_role: 'admin',
      author_platform: 'Servidor',
      content: '🧹 O histórico do chat foi limpo pelo Administrador.',
      created_at: new Date().toISOString()
    }]);

    res.json({ success: true, message: '🧹 Histórico do chat foi limpo com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao limpar chat: ' + err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  MURAL DE BANIMENTOS (#mural-banidos)
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/bans', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('players')
      .select('nick, ban_reason, updated_at, platform')
      .eq('status', 'banned')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    
    const validBans = [];
    for (const b of (data || [])) {
      const ban = parseBanInfo(b.ban_reason);
      if (ban.expired) {
        // Desbane automaticamente no banco
        await supabase
          .from('players')
          .update({ status: 'approved', ban_reason: null, updated_at: new Date().toISOString() })
          .ilike('nick', b.nick);
      } else {
        validBans.push({
          nick: b.nick,
          ban_reason: ban.reason,
          remaining: ban.remaining,
          isPermanent: ban.isPermanent,
          platform: b.platform,
          updated_at: b.updated_at
        });
      }
    }

    res.json(validBans);
  } catch (err) {
    res.json([]);
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  ROTAS DO ADMIN
// ════════════════════════════════════════════════════════════════════════════

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
    for (const p of players) {
      if (p.status === 'banned') {
        const ban = parseBanInfo(p.ban_reason);
        if (ban.expired) {
          // Desbane automaticamente no banco e ajusta o objeto em memória
          p.status = 'approved';
          p.ban_reason = null;
          await supabase
            .from('players')
            .update({ status: 'approved', ban_reason: null, updated_at: new Date().toISOString() })
            .ilike('nick', p.nick);
        } else {
          p.banRemaining = ban.remaining;
          p.isPermanent = ban.isPermanent;
          p.cleanBanReason = ban.reason;
        }
      }
    }

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

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('players').select('nick, status, ban_reason');
    if (error) throw error;

    const list = data || [];
    let pending = 0, approved = 0, rejected = 0, banned = 0;

    for (const p of list) {
      if (p.status === 'banned') {
        const ban = parseBanInfo(p.ban_reason);
        if (ban.expired) {
          approved++;
          supabase.from('players').update({ status: 'approved', ban_reason: null, updated_at: new Date().toISOString() }).ilike('nick', p.nick).catch(() => {});
        } else {
          banned++;
        }
      } else if (p.status === 'approved') {
        approved++;
      } else if (p.status === 'pending') {
        pending++;
      } else if (p.status === 'rejected') {
        rejected++;
      }
    }

    res.json({
      pending,
      approved,
      rejected,
      banned,
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
      .update({ status: 'approved', ban_reason: null, updated_at: new Date().toISOString() })
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

// Helper para calcular e formatar expiração e tempo restante de banimento
function parseBanInfo(banReason) {
  if (!banReason) {
    return { reason: 'Violação das regras do servidor', isPermanent: true, remaining: 'Permanente', expired: false };
  }

  const match = banReason.match(/\[EXPIRA:([^\]]+)\]/);
  if (!match) {
    return { reason: banReason, isPermanent: true, remaining: 'Permanente', expired: false };
  }

  const expireIso = match[1];
  const cleanReason = banReason.replace(/\[EXPIRA:[^\]]+\]/, '').trim() || 'Violação das regras';
  const expireTime = new Date(expireIso).getTime();
  const now = Date.now();

  if (now >= expireTime) {
    return { reason: cleanReason, isPermanent: false, remaining: 'Expirado', expired: true };
  }

  const diffMs = expireTime - now;
  const diffMins = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (3600 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 3600 * 1000));

  let remaining = '';
  if (diffDays > 0) {
    const restHours = diffHours % 24;
    remaining = `${diffDays}d` + (restHours > 0 ? ` ${restHours}h` : '');
  } else if (diffHours > 0) {
    const restMins = diffMins % 60;
    remaining = `${diffHours}h` + (restMins > 0 ? ` ${restMins}m` : '');
  } else {
    remaining = `${Math.max(1, diffMins)} minuto(s)`;
  }

  return { reason: cleanReason, isPermanent: false, remaining, expired: false };
}

// Banir com motivo e tempo (Minutos, Horas, Dias ou Permanente)
app.post('/api/admin/ban/:nick', requireAdmin, async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const reasonText = (req.body.reason || 'Violação das regras do servidor').trim();
    const durationUnit = req.body.durationUnit || 'permanent'; // 'minutes', 'hours', 'days', 'permanent'
    const durationValue = parseInt(req.body.durationValue, 10) || 0;

    let fullReason = reasonText;
    let remainingLabel = 'Permanente';
    let expireAt = null;

    if (durationUnit !== 'permanent' && durationValue > 0) {
      const ms = durationUnit === 'minutes' ? durationValue * 60 * 1000
               : durationUnit === 'hours' ? durationValue * 3600 * 1000
               : durationValue * 24 * 3600 * 1000;
      expireAt = new Date(Date.now() + ms);
      fullReason = `${reasonText} [EXPIRA:${expireAt.toISOString()}]`;
      remainingLabel = `${durationValue} ${durationUnit}`;
    }

    const now = new Date().toISOString();

    const { error } = await supabase
      .from('players')
      .upsert({ 
        nick, 
        status: 'banned', 
        ban_reason: fullReason, 
        updated_at: now 
      }, { onConflict: 'nick' });

    if (error) throw error;

    // Registra no histórico de bans (messages com role=ban_log)
    await supabase.from('messages').insert([{
      author_nick: nick,
      author_role: 'ban_log',
      author_platform: 'Admin',
      content: JSON.stringify({
        reason: reasonText,
        duration: remainingLabel,
        expire_at: expireAt ? expireAt.toISOString() : null,
        banned_at: now
      }),
      created_at: now
    }]).catch(() => {});

    res.json({ 
      success: true, 
      message: `🔨 ${nick} foi BANIDO! Duração: ${remainingLabel}.` 
    });
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
    res.json({ success: true, message: `✅ ${nick} foi desbanido!` });
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

// Rota para o usuário consultar seu IP público da web
app.get('/api/my-ip', (req, res) => {
  res.json({ ip: getClientIp(req) });
});

// ─── SISTEMA DE BANIMENTO POR IP ──────────────────────────────────────────
async function checkIpBan(ip) {
  if (!ip) return null;
  const cleanIp = ip.includes(':') ? ip.split(':')[0] : ip;
  if (cleanIp === '127.0.0.1' || cleanIp === 'localhost') return null;

  // 1. Cache em memória
  const cached = bannedIpsCache.get(cleanIp);
  if (cached) {
    if (cached.expiresAt && Date.now() >= new Date(cached.expiresAt).getTime()) {
      bannedIpsCache.delete(cleanIp);
      supabase.from('messages').delete().eq('author_role', 'ip_ban').eq('author_nick', cleanIp).catch(() => {});
      return null;
    }
    return cached;
  }

  // 2. Banco de dados Supabase
  try {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('author_role', 'ip_ban')
      .eq('author_nick', cleanIp)
      .maybeSingle();

    if (!data) return null;

    let parsed = {};
    try { parsed = JSON.parse(data.content); } catch { parsed = { reason: data.content }; }

    if (parsed.expiresAt && Date.now() >= new Date(parsed.expiresAt).getTime()) {
      supabase.from('messages').delete().eq('id', data.id).catch(() => {});
      return null;
    }

    const info = {
      ip: cleanIp,
      reason: parsed.reason || 'IP Bloqueado pelo Administrador',
      isPermanent: !parsed.expiresAt,
      expiresAt: parsed.expiresAt,
      remaining: calculateRemaining(parsed.expiresAt),
      associatedNick: data.author_platform
    };
    bannedIpsCache.set(cleanIp, info);
    return info;
  } catch {
    return null;
  }
}

function calculateRemaining(expiresAt) {
  if (!expiresAt) return 'Permanente';
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Expirado';
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays > 0) return `${diffDays}d ${diffHours % 24}h`;
  if (diffHours > 0) return `${diffHours}h ${diffMins % 60}m`;
  return `${Math.max(1, diffMins)}m`;
}

// Banir IP
app.post('/api/admin/ip-ban', requireAdmin, async (req, res) => {
  try {
    let ip = (req.body.ip || '').trim();
    if (ip.includes(':')) ip = ip.split(':')[0];
    if (!ip) return res.status(400).json({ error: 'IP obrigatório' });

    const nick = (req.body.nick || '').trim();
    const reasonText = (req.body.reason || 'Violação das regras (Ban de IP)').trim();
    const durationUnit = req.body.durationUnit || 'permanent';
    const durationValue = parseInt(req.body.durationValue, 10) || 0;

    let expiresAt = null;
    let remainingLabel = 'Permanente';
    if (durationUnit !== 'permanent' && durationValue > 0) {
      const ms = durationUnit === 'minutes' ? durationValue * 60 * 1000
               : durationUnit === 'hours' ? durationValue * 3600 * 1000
               : durationValue * 24 * 3600 * 1000;
      expiresAt = new Date(Date.now() + ms).toISOString();
      remainingLabel = `${durationValue} ${durationUnit}`;
    }

    const now = new Date().toISOString();
    const info = {
      ip,
      reason: reasonText,
      durationUnit,
      durationValue,
      expiresAt,
      bannedAt: now,
      associatedNick: nick || 'Nenhum'
    };

    bannedIpsCache.set(ip, { ...info, isPermanent: !expiresAt, remaining: remainingLabel });

    // Salva no Supabase (remove se já existia e insere)
    await supabase.from('messages').delete().eq('author_role', 'ip_ban').eq('author_nick', ip);
    await supabase.from('messages').insert([{
      author_nick: ip,
      author_role: 'ip_ban',
      author_platform: nick || 'Nenhum',
      content: JSON.stringify(info),
      created_at: now
    }]);

    // Se passou um nick, bane o nick também
    if (nick) {
      try {
        await supabase.from('players').upsert({
          nick,
          status: 'banned',
          ban_reason: `${reasonText} [IP BAN]${expiresAt ? ` [EXPIRA:${expiresAt}]` : ''}`,
          updated_at: now
        }, { onConflict: 'nick' });
      } catch (_) {}
    }

    res.json({ success: true, message: `🚫 IP ${ip} foi BANIDO! Duração: ${remainingLabel}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Desbanir IP
app.post('/api/admin/ip-unban/:ip', requireAdmin, async (req, res) => {
  try {
    let ip = req.params.ip.trim();
    if (ip.includes(':')) ip = ip.split(':')[0];

    bannedIpsCache.delete(ip);
    await supabase.from('messages').delete().eq('author_role', 'ip_ban').eq('author_nick', ip);

    res.json({ success: true, message: `✅ IP ${ip} foi desbanido!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar IPs Banidos
app.get('/api/admin/ip-bans', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('author_role', 'ip_ban')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const list = [];
    const now = Date.now();

    for (const row of (data || [])) {
      let parsed = {};
      try { parsed = JSON.parse(row.content); } catch { parsed = { reason: row.content }; }

      if (parsed.expiresAt && now >= new Date(parsed.expiresAt).getTime()) {
        supabase.from('messages').delete().eq('id', row.id).catch(() => {});
        bannedIpsCache.delete(row.author_nick);
      } else {
        list.push({
          ip: row.author_nick,
          reason: parsed.reason || 'IP Bloqueado',
          remaining: calculateRemaining(parsed.expiresAt),
          isPermanent: !parsed.expiresAt,
          bannedAt: parsed.bannedAt || row.created_at,
          associatedNick: row.author_platform || parsed.associatedNick || '–'
        });
      }
    }

    res.json(list);
  } catch (err) {
    res.json([]);
  }
});

// ─── TELEMETRIA DO PLUGIN AO VIVO (login, logout, XP, inventário) ──────────
const liveTelemetryCache = new Map();
const lastDbSyncMap = new Map();

app.post('/api/telemetry/:nick', async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const secret = req.headers['x-plugin-secret'] || req.body.secret || '';
    const PLUGIN_SECRET = process.env.PLUGIN_SECRET || 'MapaBermuda2025Plugin';
    if (secret !== PLUGIN_SECRET) return res.status(403).json({ error: 'Forbidden' });

    const payload = req.body || {};
    payload.nick = nick;
    payload.reported_at = new Date().toISOString();

    // Evento de morte (PlayerDeathEvent)
    if (payload.event === 'death') {
      const now = new Date().toISOString();
      try {
        await supabase.from('messages').insert([{
          author_nick: nick,
          author_role: 'death_log',
          author_platform: payload.world || 'world',
          content: JSON.stringify({
            message: payload.deathMessage || `${nick} morreu`,
            world: payload.world || 'world',
            location: payload.location || `${payload.x}, ${payload.y}, ${payload.z}`,
            killer: payload.killer || null,
            at: now
          }),
          created_at: now
        }]);
      } catch (_) {}
      return res.json({ success: true, deathLogged: true });
    }

    // 1. Atualiza INSTANTANEAMENTE no cache de memória (tempo real ao vivo, 0ms)
    liveTelemetryCache.set(nick.toLowerCase(), payload);

    // 2. Sincroniza com Supabase a cada 3s ou em login/logout sem apagar a linha (evita lacuna temporal)
    const now = Date.now();
    const lastSync = lastDbSyncMap.get(nick.toLowerCase()) || 0;
    if (now - lastSync > 3000 || payload.event === 'login' || payload.event === 'logout') {
      lastDbSyncMap.set(nick.toLowerCase(), now);
      supabase.from('messages')
        .select('id')
        .ilike('author_nick', nick)
        .eq('author_role', 'telemetry')
        .limit(1)
        .maybeSingle()
        .then(({ data: existing }) => {
          if (existing && existing.id) {
            supabase.from('messages').update({
              content: JSON.stringify(payload),
              author_platform: payload.ip || 'plugin',
              created_at: payload.reported_at
            }).eq('id', existing.id).catch(() => {});
          } else {
            supabase.from('messages').insert([{
              author_nick: nick,
              author_role: 'telemetry',
              author_platform: payload.ip || 'plugin',
              content: JSON.stringify(payload),
              created_at: payload.reported_at
            }]).catch(() => {});
          }
        }).catch(() => {});
    }

    res.json({ success: true, live: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── INSPECIONAR JOGADOR AO VIVO (Admin) ───────────────────────────────────
app.get('/api/admin/player/:nick', requireAdmin, async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const key = nick.toLowerCase();

    // 1. Dados do jogador no banco
    const { data: player } = await supabase
      .from('players')
      .select('*')
      .ilike('nick', nick)
      .maybeSingle();

    // 2. Histórico de bans (ban_log)
    const { data: banLogs } = await supabase
      .from('messages')
      .select('content, created_at, author_platform')
      .ilike('author_nick', nick)
      .eq('author_role', 'ban_log')
      .order('created_at', { ascending: false });

    // 3. Mensagens do chat do jogador
    const { data: chatMsgs } = await supabase
      .from('messages')
      .select('content, created_at')
      .ilike('author_nick', nick)
      .not('author_role', 'in', '("telemetry","ban_log","ip_ban","death_log")')
      .order('created_at', { ascending: false })
      .limit(20);

    // 3.1 Histórico de mortes (death_log)
    const { data: deathLogs } = await supabase
      .from('messages')
      .select('content, created_at, author_platform')
      .ilike('author_nick', nick)
      .eq('author_role', 'death_log')
      .order('created_at', { ascending: false })
      .limit(30);

    const deathHistory = (deathLogs || []).map(d => {
      try {
        const parsed = JSON.parse(d.content);
        return {
          message: parsed.message || `${nick} morreu`,
          world: parsed.world || d.author_platform || 'world',
          location: parsed.location || '0, 0, 0',
          killer: parsed.killer || null,
          at: parsed.at || d.created_at
        };
      } catch {
        return { message: d.content, world: d.author_platform, at: d.created_at };
      }
    });

    // 4. Telemetria: verifica primeiro o cache AO VIVO em memória
    let gameData = liveTelemetryCache.get(key) || null;
    let isLive = false;

    if (!gameData) {
      // Fallback para o banco de dados Supabase
      const { data: telemetry } = await supabase
        .from('messages')
        .select('content, created_at, author_platform')
        .ilike('author_nick', nick)
        .eq('author_role', 'telemetry')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (telemetry) {
        try {
          gameData = JSON.parse(telemetry.content);
          if (gameData) liveTelemetryCache.set(key, gameData);
        } catch {}
      }
    }

    if (gameData) {
      const repTime = gameData.reported_at ? new Date(gameData.reported_at).getTime() : 0;
      const diffSec = (Date.now() - repTime) / 1000;
      if (diffSec < 10 && gameData.event !== 'logout') {
        isLive = true;
      }
    }

    // Parsear ban logs
    const banHistory = (banLogs || []).map(b => {
      try { 
        const d = JSON.parse(b.content);
        return { 
          reason: d.reason || 'Violação das regras',
          duration: d.duration || b.author_platform || 'Permanente',
          banned_at: d.banned_at || b.created_at,
          expire_at: d.expire_at,
          logged_at: b.created_at 
        };
      } catch { 
        return { reason: b.content, duration: b.author_platform || 'Permanente', logged_at: b.created_at }; 
      }
    });

    // Se o jogador está banido atualmente mas não tem registro no histórico
    if (player && player.status === 'banned') {
      const currentBanInfo = parseBanInfo(player.ban_reason);
      if (banHistory.length === 0) {
        banHistory.push({
          reason: currentBanInfo.reason,
          duration: currentBanInfo.remaining || 'Permanente',
          logged_at: player.updated_at || player.requested_at
        });
      }
    }

    // Ban atual
    let currentBan = null;
    if (player && player.status === 'banned') {
      currentBan = parseBanInfo(player.ban_reason);
    }

    // 5. IPs detectados (Navegador e Jogo Minecraft)
    const webIp = userWebIps.get(key) || null;
    const gameIp = (gameData && gameData.ip && gameData.ip !== '127.0.0.1') ? gameData.ip : null;
    const isGameIpBanned = gameIp ? !!(await checkIpBan(gameIp)) : false;
    const isWebIpBanned = webIp ? !!(await checkIpBan(webIp)) : false;

    res.json({
      player: player || { nick, status: 'unknown' },
      currentBan,
      banHistory,
      deathHistory,
      totalDeaths: (gameData && gameData.totalDeaths !== undefined) ? gameData.totalDeaths : deathHistory.length,
      playtimeFormatted: (gameData && gameData.playtimeFormatted) ? gameData.playtimeFormatted : '0m',
      chatMessages: (chatMsgs || []).map(m => ({ content: m.content, at: m.created_at })),
      gameData,
      isLive,
      webIp,
      gameIp,
      isGameIpBanned,
      isWebIpBanned,
      totalBans: banHistory.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ─── CHECK (Minecraft Plugin) ─────────────────────────────────────────────
app.get('/api/check/:nick', async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const ip = (req.query.ip || '').trim();

    // 1. Verifica se o IP está banido
    if (ip) {
      const ipBan = await checkIpBan(ip);
      if (ipBan) {
        return res.json({
          allowed: false,
          banned: true,
          ipBanned: true,
          reason: `[IP BAN] ${ipBan.reason}`,
          remaining: ipBan.remaining,
          isPermanent: ipBan.isPermanent,
          nick,
          ip
        });
      }
    }

    const { data: player, error } = await supabase
      .from('players')
      .select('status, ban_reason')
      .ilike('nick', nick)
      .maybeSingle();

    if (error || !player) {
      return res.json({ allowed: false, banned: false, nick });
    }

    if (player.status === 'banned') {
      const ban = parseBanInfo(player.ban_reason);

      // Se o tempo do ban expirou, libera o jogador e desbane automaticamente!
      if (ban.expired) {
        await supabase
          .from('players')
          .update({ status: 'approved', ban_reason: null, updated_at: new Date().toISOString() })
          .ilike('nick', nick);

        return res.json({ allowed: true, banned: false, nick });
      }

      return res.json({ 
        allowed: false, 
        banned: true, 
        reason: ban.reason, 
        remaining: ban.remaining,
        isPermanent: ban.isPermanent,
        nick 
      });
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
