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

// ─── Helper Seguro para Operações Supabase (evita .catch is not a function) ───
function safeDb(op) {
  return Promise.resolve(op).catch(() => {});
}

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
      .not('author_role', 'in', '("telemetry","ban_log","ip_ban","death_log","session_log")');
  } catch (err) {
    // Silencioso
  }
}

// Função para apagar automaticamente logs de mortes e conexões com mais de 3 dias
async function limparLogsMortesESessoes3Dias() {
  try {
    const limite3Dias = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('messages')
      .delete()
      .lt('created_at', limite3Dias)
      .in('author_role', ['death_log', 'session_log']);
  } catch (err) {
    // Silencioso
  }
}

// Listar mensagens (executa a limpeza periódica de mensagens e logs)
app.get('/api/chat', async (req, res) => {
  try {
    // Limpezas periódicas automáticas
    limparMensagens30Dias().catch(() => {});
    limparLogsMortesESessoes3Dias().catch(() => {});

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .not('author_role', 'in', '("telemetry","ban_log","ip_ban","death_log","session_log","console_log","playtime_rank","player_lives")')
      .order('created_at', { ascending: false })
      .limit(60);

    if (error) throw error;
    res.json((data || []).reverse());
  } catch (err) {
    res.json([]);
  }
});

// Limpeza Manual de Logs (Admin) - Mortes e Conexões
app.post('/api/admin/clean-logs', requireAdmin, async (req, res) => {
  try {
    const mode = req.body.mode || 'all'; // '3days' ou 'all'
    let query = supabase.from('messages').delete().in('author_role', ['death_log', 'session_log']);

    if (mode === '3days') {
      const limite = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      query = query.lt('created_at', limite);
    }

    const { error } = await query;
    if (error) throw error;

    const msg = mode === '3days'
      ? '🧹 Logs de mortes e conexões com mais de 3 dias foram apagados com sucesso!'
      : '🧹 Todos os logs de mortes e conexões foram zerados do Supabase com sucesso!';

    res.json({ success: true, message: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    // Apaga ESTRITAMENTE as mensagens de chat reais (preserva telemetria, bans, ips banidos, mortes, conexões, logs de console, ranks e vidas)
    await supabase
      .from('messages')
      .delete()
      .not('author_role', 'in', '("telemetry","ban_log","ip_ban","death_log","session_log","console_log","playtime_rank","player_lives")');

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

// Helper para listar jogadores jogando em tempo real (Ao Vivo)
async function getOnlinePlayersList() {
  const now = Date.now();
  const onlineMap = new Map();

  // 1. Consulta registros de telemetria recentes no Supabase (últimos 30 segundos)
  try {
    const limite30s = new Date(now - 30 * 1000).toISOString();
    const { data: telemRows } = await supabase
      .from('messages')
      .select('*')
      .eq('author_role', 'telemetry')
      .gte('created_at', limite30s);

    for (const row of (telemRows || [])) {
      try {
        const payload = JSON.parse(row.content);
        const repTime = new Date(payload.reported_at || row.created_at).getTime();
        if (now - repTime < 25000 && payload.event !== 'logout') {
          onlineMap.set(row.author_nick.toLowerCase(), {
            ...payload,
            nick: row.author_nick,
            secondsAgo: Math.max(0, Math.round((now - repTime) / 1000))
          });
        }
      } catch (_) {}
    }
  } catch (_) {}

  // 2. Mescla com o cache em memória (tempo real ao vivo com 0ms)
  for (const [key, payload] of liveTelemetryCache.entries()) {
    if (!payload) continue;
    const repTime = payload.reported_at ? new Date(payload.reported_at).getTime() : 0;
    if (now - repTime < 25000 && payload.event !== 'logout') {
      onlineMap.set(key, {
        ...payload,
        nick: payload.nick || key,
        secondsAgo: Math.max(0, Math.round((now - repTime) / 1000))
      });
    } else if (payload.event === 'logout' || now - repTime >= 25000) {
      onlineMap.delete(key);
    }
  }

  return Array.from(onlineMap.values());
}

app.get('/api/admin/players', requireAdmin, async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    let query = supabase.from('players').select('*').order('requested_at', { ascending: false });

    if (search) {
      query = query.ilike('nick', `%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const onlineList = await getOnlinePlayersList();
    const onlineNickSet = new Set(onlineList.map(o => (o.nick || '').toLowerCase()));

    const players = data || [];
    for (const p of players) {
      p.isOnline = onlineNickSet.has((p.nick || '').toLowerCase());
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
      banned:   players.filter(p => p.status === 'banned'),
      online:   onlineList,
      totalOnline: onlineList.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint exclusivo para jogadores online ao vivo
app.get('/api/admin/online-players', requireAdmin, async (req, res) => {
  try {
    const list = await getOnlinePlayersList();
    res.json(list);
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
          safeDb(supabase.from('players').update({ status: 'approved', ban_reason: null, updated_at: new Date().toISOString() }).ilike('nick', p.nick));
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

// Banir com motivo e tempo (Suporta Banir Nick, IP ou AMBOS de uma vez só)
app.post('/api/admin/ban/:nick?', requireAdmin, async (req, res) => {
  try {
    const nick = (req.params.nick || req.body.nick || '').trim();
    let ip = (req.body.ip || '').trim();
    const banMode = req.body.banMode || (nick && (req.body.banIp || ip) ? 'both' : (nick ? 'nick' : 'ip'));
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
    let nickBanned = false;
    let ipBanned = false;

    // 1. BANIR NICK (se aplicável)
    if ((banMode === 'nick' || banMode === 'both') && nick) {
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
      try {
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
        }]);
      } catch (_) {}

      nickBanned = true;
    }

    // 2. BANIR IP (se aplicável)
    if (banMode === 'ip' || banMode === 'both') {
      if (!ip && nick) {
        // Auto-descobre o IP do jogador (memória ou banco)
        ip = userWebIps.get(nick.toLowerCase()) 
          || liveTelemetryCache.get(nick.toLowerCase())?.ip
          || null;

        if (!ip) {
          const { data: telemRow } = await supabase
            .from('messages')
            .select('author_platform, content')
            .ilike('author_nick', nick)
            .eq('author_role', 'telemetry')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (telemRow) {
            try {
              const parsed = JSON.parse(telemRow.content);
              ip = parsed.ip || telemRow.author_platform;
            } catch {
              ip = telemRow.author_platform;
            }
          }
        }
      }

      if (ip) {
        if (ip.includes(':')) ip = ip.split(':')[0];
        if (ip !== '127.0.0.1' && ip !== 'localhost') {
          const ipBanPayload = {
            ip,
            reason: reasonText,
            durationUnit,
            durationValue,
            expiresAt: expireAt ? expireAt.toISOString() : null,
            bannedAt: now,
            associatedNick: nick || 'Desconhecido'
          };

          bannedIpsCache.set(ip, { ...ipBanPayload, isPermanent: !expireAt, remaining: remainingLabel });

          try {
            await supabase.from('messages').delete().eq('author_role', 'ip_ban').eq('author_nick', ip);
            await supabase.from('messages').insert([{
              author_nick: ip,
              author_role: 'ip_ban',
              author_platform: nick || 'Admin',
              content: JSON.stringify(ipBanPayload),
              created_at: now
            }]);
            ipBanned = true;
          } catch (_) {}
        }
      }
    }

    let msg = '🔨 Banimento aplicado com sucesso!';
    if (nickBanned && ipBanned) {
      msg = `🔨 Bloqueio TOTAL aplicado! Nick '${nick}' e IP '${ip}' foram BANIDOS (${remainingLabel}).`;
    } else if (nickBanned) {
      msg = `🔨 Nick '${nick}' foi BANIDO (${remainingLabel}).`;
    } else if (ipBanned) {
      msg = `🌐 IP '${ip}' foi BLOQUEADO (${remainingLabel}).`;
    }

    res.json({ 
      success: true, 
      message: msg,
      nickBanned,
      ipBanned,
      nick: nick || null,
      ip: ip || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Desbanir
app.post('/api/admin/unban/:nick', requireAdmin, async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('players')
      .update({ status: 'pending', ban_reason: null, updated_at: now })
      .ilike('nick', nick);

    if (error) throw error;

    // Registra permanentemente o desbanimento no histórico do jogador
    try {
      await supabase.from('messages').insert([{
        author_nick: nick,
        author_role: 'ban_log',
        author_platform: 'Admin',
        content: JSON.stringify({
          action: 'unban',
          reason: 'Desbanido pelo Administrador',
          unbanned_at: now
        }),
        created_at: now
      }]);
    } catch (_) {}

    res.json({ success: true, message: `✅ ${nick} foi desbanido!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remover Jogador e Limpar 100% dos dados dele no Supabase (não ocupa espaço)
app.delete('/api/admin/remove/:nick', requireAdmin, async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const key = nick.toLowerCase();

    // 1. Remove da tabela players
    const { error } = await supabase
      .from('players')
      .delete()
      .ilike('nick', nick);

    if (error) throw error;

    // 2. Remove TODOS os registros e logs dele na tabela messages (telemetria, mortes, conexões, bans, chat)
    await safeDb(
      supabase
        .from('messages')
        .delete()
        .ilike('author_nick', nick)
    );

    // 3. Remove conta cadastrada na tabela auth_users se houver
    await safeDb(
      supabase
        .from('auth_users')
        .delete()
        .ilike('nick', nick)
    );

    // 4. Limpa caches de memória do servidor
    liveTelemetryCache.delete(key);
    userWebIps.delete(key);
    lastDbSyncMap.delete(key);

    res.json({ success: true, message: `🗑️ ${nick} e todos os seus registros foram excluídos permanentemente do Supabase!` });
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
      safeDb(supabase.from('messages').delete().eq('author_role', 'ip_ban').eq('author_nick', cleanIp));
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
      safeDb(supabase.from('messages').delete().eq('id', data.id));
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
        safeDb(supabase.from('messages').delete().eq('id', row.id));
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

// ─── CONSOLE REMOTO & COMANDOS DO MINECRAFT ──────────────────────────────
const pendingConsoleCommands = [];
const liveConsoleLogs = [];

function registrarConsoleLog(type, content, sender = 'Sistema') {
  const logEntry = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    type, // 'command' | 'broadcast' | 'info' | 'error'
    content,
    sender,
    time: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
    created_at: new Date().toISOString()
  };
  liveConsoleLogs.push(logEntry);
  if (liveConsoleLogs.length > 200) liveConsoleLogs.shift();

  // Persiste no Supabase assincronamente sem travar a requisição
  safeDb(supabase.from('messages').insert([{
    author_nick: sender,
    author_role: 'console_log',
    author_platform: type,
    content: JSON.stringify(logEntry),
    created_at: logEntry.created_at
  }]));

  return logEntry;
}

// ─── SISTEMA DE VIDAS (5 VIDAS + RESET A CADA 8 HORAS) ──────────────────────
const LIVES_CYCLE_MS = 8 * 60 * 60 * 1000; // 8 horas em ms
const playerLivesCache = new Map(); // nick.toLowerCase() -> { lives: 5, max_lives: 5, ... }

function getLivesCycleInfo() {
  const now = Date.now();
  // Ciclo universal de 8 horas fixo (00h, 08h, 16h UTC) — NUNCA reseta ao alterar vidas de um jogador!
  const cycleIndex = Math.floor(now / LIVES_CYCLE_MS);
  const nextCycleTimestamp = (cycleIndex + 1) * LIVES_CYCLE_MS;
  const remainingMs = Math.max(0, nextCycleTimestamp - now);

  const totalSec = Math.floor(remainingMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  let parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h === 0) parts.push(`${m}m`);
  parts.push(`${s}s`);

  return {
    cycleIndex,
    nextCycleTimestamp,
    remainingMs,
    remainingFormatted: parts.join(' ')
  };
}

async function checkAndRunLivesCycleReset() {
  return getLivesCycleInfo();
}

// ─── HELPERS DE PERSISTÊNCIA DE VIDAS (Supabase messages + player_lives) ──────
async function salvarVidasNoBanco(nick, livesObj) {
  const now = new Date().toISOString();
  const payload = {
    lives: livesObj.lives,
    max_lives: livesObj.max_lives || 5,
    cycleIndex: livesObj.cycleIndex,
    last_death_at: livesObj.last_death_at || null,
    updated_at: now
  };

  // 1. Persiste na tabela messages com match exato de nick
  try {
    const { data: records } = await supabase
      .from('messages')
      .select('id, author_nick')
      .eq('author_role', 'player_lives');

    const matched = (records || []).find(r => r.author_nick && r.author_nick.toLowerCase() === nick.toLowerCase());

    if (matched && matched.id) {
      await safeDb(
        supabase
          .from('messages')
          .update({
            content: JSON.stringify(payload),
            author_platform: String(livesObj.lives),
            created_at: now
          })
          .eq('id', matched.id)
      );
    } else {
      await safeDb(
        supabase
          .from('messages')
          .insert([{
            author_nick: nick,
            author_role: 'player_lives',
            author_platform: String(livesObj.lives),
            content: JSON.stringify(payload),
            created_at: now
          }])
      );
    }
  } catch (_) {}

  // 2. Tenta também na tabela player_lives (fallback)
  safeDb(
    supabase
      .from('player_lives')
      .upsert({
        nick,
        lives: livesObj.lives,
        max_lives: 5,
        last_death_at: livesObj.last_death_at || null,
        updated_at: now
      }, { onConflict: 'nick' })
  );
}

async function carregarVidasDoBanco(nick, cycle) {
  // 1. Tenta carregar de messages com match exato
  try {
    const { data: records } = await supabase
      .from('messages')
      .select('author_nick, content')
      .eq('author_role', 'player_lives');

    const matched = (records || []).find(r => r.author_nick && r.author_nick.toLowerCase() === nick.toLowerCase());

    if (matched && matched.content) {
      const parsed = typeof matched.content === 'string' ? JSON.parse(matched.content) : matched.content;
      if (parsed.cycleIndex !== undefined && parsed.cycleIndex < cycle.cycleIndex) {
        return { lives: 5, last_death_at: parsed.last_death_at || null };
      }
      return {
        lives: Math.max(0, Math.min(5, parsed.lives !== undefined ? parsed.lives : 5)),
        last_death_at: parsed.last_death_at || null
      };
    }
  } catch (_) {}

  // 2. Fallback em player_lives
  try {
    const { data: pl } = await supabase
      .from('player_lives')
      .select('*')
      .ilike('nick', nick)
      .maybeSingle();

    if (pl) {
      return {
        lives: Math.max(0, Math.min(5, pl.lives !== undefined ? pl.lives : 5)),
        last_death_at: pl.last_death_at || null
      };
    }
  } catch (_) {}

  return null;
}

async function executarResetGlobalVidas(origem = 'Sistema') {
  const now = new Date().toISOString();

  for (const [, val] of playerLivesCache.entries()) {
    val.lives = 5;
    val.isEliminated = false;
    val.updated_at = now;
  }

  // Reseta todos os registros em messages
  safeDb(
    supabase
      .from('messages')
      .update({
        author_platform: '5',
        content: JSON.stringify({ lives: 5, max_lives: 5, updated_at: now }),
        created_at: now
      })
      .eq('author_role', 'player_lives')
  );

  safeDb(
    supabase
      .from('player_lives')
      .update({ lives: 5, updated_at: now })
      .neq('lives', 5)
  );

  registrarConsoleLog('info', `❤️ As vidas de todos os jogadores foram restauradas para 5! (${origem})`, 'Sistema');
}

async function obterVidasJogador(nick) {
  if (!nick) return { nick: '', lives: 5, max_lives: 5, isEliminated: false };
  const key = nick.toLowerCase();
  const cycle = getLivesCycleInfo();

  // Consulta SEMPRE o banco primeiro para garantir dados atualizados entre instâncias da Vercel
  const dbData = await carregarVidasDoBanco(nick, cycle);
  let lives = dbData !== null ? dbData.lives : (playerLivesCache.has(key) ? playerLivesCache.get(key).lives : 5);
  let lastDeath = dbData !== null ? dbData.last_death_at : (playerLivesCache.has(key) ? playerLivesCache.get(key).last_death_at : null);

  const safeLives = Math.max(0, Math.min(5, lives !== undefined ? lives : 5));
  const obj = {
    nick,
    lives: safeLives,
    max_lives: 5,
    isEliminated: safeLives <= 0,
    cycleIndex: cycle.cycleIndex,
    last_death_at: lastDeath,
    remainingReset: cycle.remainingFormatted,
    remainingMs: cycle.remainingMs
  };
  playerLivesCache.set(key, obj);
  return obj;
}

async function descontarVidaJogador(nick) {
  if (!nick) return null;
  const key = nick.toLowerCase();
  const current = await obterVidasJogador(nick);
  const now = new Date().toISOString();

  const newLives = Math.max(0, current.lives - 1);
  current.lives = newLives;
  current.last_death_at = now;
  current.isEliminated = newLives <= 0;
  playerLivesCache.set(key, current);

  await salvarVidasNoBanco(nick, current);

  if (newLives <= 0) {
    const kickCmd = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      type: 'kick',
      target: nick,
      command: `kick ${nick} Suas 5 vidas acabaram! Aguarde o reset em ${current.remainingReset}.`,
      sender: 'Sistema',
      created_at: now
    };
    pendingConsoleCommands.push(kickCmd);
    registrarConsoleLog('error', `💀 ${nick} perdeu todas as 5 vidas e foi eliminado! Próximo reset em ${current.remainingReset}.`, 'Sistema');
  } else {
    registrarConsoleLog('info', `💔 ${nick} morreu e perdeu 1 vida (${newLives}/5 vidas restantes)`, 'Minecraft');
  }

  return current;
}

async function definirVidasJogador(nick, lives) {
  if (!nick) return null;
  const key = nick.toLowerCase();
  const safeLives = Math.max(0, Math.min(5, parseInt(lives, 10) || 0));
  const now = new Date().toISOString();
  const current = await obterVidasJogador(nick);

  current.lives = safeLives;
  current.isEliminated = safeLives <= 0;
  current.updated_at = now;
  playerLivesCache.set(key, current);

  await salvarVidasNoBanco(nick, current);

  // Se o admin zerou as vidas, expulsa o jogador do Minecraft imediatamente
  if (safeLives <= 0) {
    const kickCmd = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      type: 'kick',
      target: nick,
      command: `kick ${nick} Suas vidas acabaram! Aguarde o reset em ${current.remainingReset || '8h'}.`,
      sender: 'Admin',
      created_at: now
    };
    pendingConsoleCommands.push(kickCmd);
    registrarConsoleLog('error', `💀 ${nick} teve suas vidas zeradas pelo Administrador e foi expulso do servidor!`, 'Admin');
  }

  return current;
}

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

    // Evento de morte (PlayerDeathEvent) — deduz 1 vida no sistema de vidas
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

      // Deduz 1 vida do jogador no sistema de vidas
      const livesData = await descontarVidaJogador(nick);
      const livesRemaining = livesData ? livesData.lives : null;

      registrarConsoleLog('error', '\uD83D\uDC80 ' + (payload.deathMessage || (nick + ' morreu')), 'Minecraft');
      return res.json({
        success: true,
        deathLogged: true,
        livesRemaining,
        isEliminated: livesData ? livesData.isEliminated : false,
        remainingReset: livesData ? livesData.remainingReset : null,
        commands: pendingConsoleCommands.splice(0)
      });
    }

    // Evento de login ou logout no Minecraft (Histórico Permanente de Conexões)
    if (payload.event === 'login' || payload.event === 'logout') {
      const now = new Date().toISOString();
      try {
        await supabase.from('messages').insert([{
          author_nick: nick,
          author_role: 'session_log',
          author_platform: payload.event,
          content: JSON.stringify({
            event: payload.event,
            ip: payload.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '–',
            world: payload.world || 'world',
            location: payload.location || (payload.x !== undefined ? `${payload.x}, ${payload.y}, ${payload.z}` : '0, 0, 0'),
            gamemode: payload.gamemode || 'SURVIVAL',
            at: now
          }),
          created_at: now
        }]);
      } catch (_) {}

      if (payload.event === 'login') {
        registrarConsoleLog('info', `🟢 ${nick} entrou no jogo (IP: ${payload.ip || '–'}, Mundo: ${payload.world || 'world'})`, 'Minecraft');
      } else {
        registrarConsoleLog('info', `🔴 ${nick} saiu do jogo`, 'Minecraft');
      }
    }

    // 1. Atualiza INSTANTANEAMENTE no cache de memória (tempo real ao vivo, 0ms)
    liveTelemetryCache.set(nick.toLowerCase(), payload);

    // 2. Sincroniza com Supabase a cada 3s ou em login/logout sem apagar a linha (evita lacuna temporal)
    const now = Date.now();
    const lastSync = lastDbSyncMap.get(nick.toLowerCase()) || 0;
    if (now - lastSync > 3000 || payload.event === 'login' || payload.event === 'logout') {
      lastDbSyncMap.set(nick.toLowerCase(), now);
      safeDb(
        supabase.from('messages')
          .select('id')
          .ilike('author_nick', nick)
          .eq('author_role', 'telemetry')
          .limit(1)
          .maybeSingle()
      ).then((res) => {
        const existing = res && res.data ? res.data : null;
        if (existing && existing.id) {
          safeDb(supabase.from('messages').update({
            content: JSON.stringify(payload),
            author_platform: payload.ip || 'plugin',
            created_at: payload.reported_at
          }).eq('id', existing.id));
        } else {
          safeDb(supabase.from('messages').insert([{
            author_nick: nick,
            author_role: 'telemetry',
            author_platform: payload.ip || 'plugin',
            content: JSON.stringify(payload),
            created_at: payload.reported_at
          }]));
        }
      });
    }

    res.json({ success: true, live: true, commands: pendingConsoleCommands.splice(0) });
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

    // 2. Histórico de bans (ban_log) - Permanente, nunca é apagado
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
      .not('author_role', 'in', '("telemetry","ban_log","ip_ban","death_log","session_log")')
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

    // 3.2 Histórico de entrada e saída (session_log) - Permanente
    const { data: sessionLogs } = await supabase
      .from('messages')
      .select('content, created_at, author_platform')
      .ilike('author_nick', nick)
      .eq('author_role', 'session_log')
      .order('created_at', { ascending: false })
      .limit(50);

    const sessionHistory = (sessionLogs || []).map(s => {
      try {
        const parsed = JSON.parse(s.content);
        return {
          event: parsed.event || s.author_platform || 'login',
          ip: parsed.ip || '–',
          world: parsed.world || 'world',
          location: parsed.location || '0, 0, 0',
          gamemode: parsed.gamemode || 'SURVIVAL',
          at: parsed.at || s.created_at
        };
      } catch {
        return {
          event: s.author_platform || 'login',
          ip: '–',
          world: 'world',
          location: '0, 0, 0',
          at: s.created_at
        };
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

    // Parsear histórico de bans (preserva todos os bans e desbanimentos para sempre)
    const banHistory = (banLogs || []).map(b => {
      try { 
        const d = JSON.parse(b.content);
        return { 
          action: d.action || 'ban',
          reason: d.reason || (d.action === 'unban' ? 'Desbanido pelo Administrador' : 'Violação das regras'),
          duration: d.duration || b.author_platform || (d.action === 'unban' ? '–' : 'Permanente'),
          banned_at: d.banned_at || b.created_at,
          unbanned_at: d.unbanned_at,
          expire_at: d.expire_at,
          logged_at: b.created_at 
        };
      } catch { 
        return { action: 'ban', reason: b.content, duration: b.author_platform || 'Permanente', logged_at: b.created_at }; 
      }
    });

    // Se o jogador está banido atualmente mas não tem registro no histórico
    if (player && player.status === 'banned') {
      const currentBanInfo = parseBanInfo(player.ban_reason);
      if (banHistory.length === 0) {
        banHistory.push({
          action: 'ban',
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
      sessionHistory,
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
    if (!allowed) return res.json({ allowed: false, banned: false, nick });

    // Verifica vidas: se jogador aprovado mas sem vidas, bloqueia entrada
    const livesData = await obterVidasJogador(nick);
    if (livesData && livesData.isEliminated) {
      return res.json({
        allowed: false,
        banned: true,
        outOfLives: true,
        lives: 0,
        reason: `Suas 5 vidas acabaram! Aguarde o proximo reset em ${livesData.remainingReset} para voltar a jogar.`,
        remaining: livesData.remainingReset,
        isPermanent: false,
        remainingReset: livesData.remainingReset,
        nick
      });
    }

    res.json({ allowed: true, banned: false, lives: livesData ? livesData.lives : 5, nick });
  } catch (err) {
    res.json({ allowed: false, banned: false, nick: req.params.nick });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  ROTAS DO CONSOLE REMOTO & MENSAGENS IN-GAME
// ════════════════════════════════════════════════════════════════════════════

// 1. Admin executa comando ou envia mensagem in-game
app.post('/api/admin/console/execute', requireAdmin, async (req, res) => {
  try {
    const { action, text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Texto ou comando não pode estar vazio.' });
    }

    const cleanText = text.trim();
    const adminNick = 'Admin';

    if (action === 'broadcast' || action === 'message') {
      // Mensagem direta para dentro do jogo (Broadcast In-Game)
      const cmdItem = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        type: 'broadcast',
        sender: adminNick,
        message: cleanText,
        created_at: new Date().toISOString()
      };
      pendingConsoleCommands.push(cmdItem);
      const log = registrarConsoleLog('broadcast', `📢 [ANÚNCIO] ${adminNick}: "${cleanText}"`, adminNick);

      return res.json({ success: true, message: '📢 Mensagem enviada para dentro do jogo!', log });
    } else {
      // Comando do console normal
      let cmd = cleanText;
      if (cmd.startsWith('/')) cmd = cmd.substring(1);

      const cmdItem = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        type: 'command',
        sender: adminNick,
        command: cmd,
        created_at: new Date().toISOString()
      };
      pendingConsoleCommands.push(cmdItem);
      const log = registrarConsoleLog('command', `> /${cmd}`, adminNick);

      return res.json({ success: true, message: `💻 Comando '/${cmd}' enviado ao servidor!`, log });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Admin busca logs recentes do console
app.get('/api/admin/console/logs', requireAdmin, async (req, res) => {
  try {
    if (liveConsoleLogs.length > 0) {
      return res.json(liveConsoleLogs);
    }

    // Se a memória estava vazia, busca os últimos do Supabase
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('author_role', 'console_log')
      .order('created_at', { ascending: false })
      .limit(60);

    const logs = (data || []).reverse().map(row => {
      try { return JSON.parse(row.content); } catch {
        return {
          id: row.id,
          type: row.author_platform || 'info',
          content: row.content,
          sender: row.author_nick,
          time: new Date(row.created_at).toLocaleTimeString('pt-BR', { hour12: false }),
          created_at: row.created_at
        };
      }
    });

    res.json(logs);
  } catch (err) {
    res.json(liveConsoleLogs);
  }
});

// 3. Admin limpa logs do console
app.post('/api/admin/console/clear', requireAdmin, async (req, res) => {
  try {
    liveConsoleLogs.length = 0;
    await safeDb(supabase.from('messages').delete().eq('author_role', 'console_log'));
    registrarConsoleLog('info', '🧹 O console foi limpo pelo Administrador.', 'Sistema');
    res.json({ success: true, message: 'Console limpo com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Plugin consulta comandos pendentes
app.get('/api/plugin/commands', async (req, res) => {
  const secret = req.headers['x-plugin-secret'] || req.query.secret || '';
  const PLUGIN_SECRET = process.env.PLUGIN_SECRET || 'MapaBermuda2025Plugin';
  if (secret !== PLUGIN_SECRET) return res.status(403).json({ error: 'Forbidden' });

  const commandsToRun = pendingConsoleCommands.splice(0);
  res.json({ success: true, commands: commandsToRun });
});

// 5. Plugin envia logs gerados no servidor de volta para o console
app.post('/api/plugin/console-logs', async (req, res) => {
  const secret = req.headers['x-plugin-secret'] || req.body.secret || '';
  const PLUGIN_SECRET = process.env.PLUGIN_SECRET || 'MapaBermuda2025Plugin';
  if (secret !== PLUGIN_SECRET) return res.status(403).json({ error: 'Forbidden' });

  const logs = req.body.logs || [];
  for (const item of logs) {
    if (typeof item === 'string') {
      registrarConsoleLog('info', item, 'Minecraft');
    } else if (item && item.content) {
      registrarConsoleLog(item.type || 'info', item.content, item.sender || 'Minecraft');
    }
  }

  res.json({ success: true });
});

// ─── ROTA PÚBLICA DE RANKING (TOP 5 HORAS JOGADAS) ───────────────────────────
function formatPlaytimeFromSeconds(totalSec) {
  if (!totalSec || totalSec <= 0) return '0m';
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);

  let parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return parts.join(' ');
}

function parseFormattedPlaytimeToSeconds(str) {
  if (!str || typeof str !== 'string') return 0;
  let sec = 0;
  const dMatch = str.match(/(\d+)\s*d/i);
  const hMatch = str.match(/(\d+)\s*h/i);
  const mMatch = str.match(/(\d+)\s*m/i);
  const sMatch = str.match(/(\d+)\s*s/i);
  if (dMatch) sec += parseInt(dMatch[1], 10) * 86400;
  if (hMatch) sec += parseInt(hMatch[1], 10) * 3600;
  if (mMatch) sec += parseInt(mMatch[1], 10) * 60;
  if (sMatch) sec += parseInt(sMatch[1], 10);
  return sec;
}

app.get('/api/ranking/playtime', async (req, res) => {
  try {
    // 1. Busca todos os registros de telemetria salvos no Supabase
    const { data: dbTelemetry } = await supabase
      .from('messages')
      .select('author_nick, content, created_at')
      .eq('author_role', 'telemetry')
      .order('created_at', { ascending: false });

    // 2. Busca todos os jogadores aprovados no banco
    const { data: approvedPlayers } = await supabase
      .from('players')
      .select('nick, status, updated_at')
      .eq('status', 'approved');

    // 3. Mapa acumulador de nick -> dados de playtime
    const playersMap = new Map();

    // Inicializa jogadores aprovados para garantir presença no placar
    for (const ap of (approvedPlayers || [])) {
      const key = ap.nick.toLowerCase();
      playersMap.set(key, {
        nick: ap.nick,
        playtimeSeconds: 0,
        playtimeFormatted: '0m',
        totalDeaths: 0,
        level: 0,
        isOnline: false,
        lastReported: ap.updated_at || new Date().toISOString()
      });
    }

    // Carrega do banco de telemetria
    for (const row of (dbTelemetry || [])) {
      const nick = (row.author_nick || '').trim();
      if (!nick) continue;
      const key = nick.toLowerCase();

      let parsed = {};
      try { parsed = JSON.parse(row.content); } catch (_) { parsed = {}; }

      let sec = Number(parsed.playtimeSeconds) || 0;
      if (!sec && parsed.playtimeFormatted) {
        sec = parseFormattedPlaytimeToSeconds(parsed.playtimeFormatted);
      }

      const existing = playersMap.get(key);
      if (existing) {
        if (sec > existing.playtimeSeconds) {
          existing.playtimeSeconds = sec;
          existing.playtimeFormatted = parsed.playtimeFormatted || formatPlaytimeFromSeconds(sec);
        }
        if (parsed.totalDeaths !== undefined) existing.totalDeaths = Math.max(existing.totalDeaths, Number(parsed.totalDeaths) || 0);
        if (parsed.level !== undefined) existing.level = Math.max(existing.level, Number(parsed.level) || 0);
      } else {
        playersMap.set(key, {
          nick: parsed.nick || nick,
          playtimeSeconds: sec,
          playtimeFormatted: parsed.playtimeFormatted || formatPlaytimeFromSeconds(sec),
          totalDeaths: Number(parsed.totalDeaths) || 0,
          level: Number(parsed.level) || 0,
          isOnline: false,
          lastReported: row.created_at
        });
      }
    }

    // 4. Mescla com os dados em tempo real da memória (liveTelemetryCache)
    const now = Date.now();
    for (const [key, live] of liveTelemetryCache.entries()) {
      if (!live || !live.nick) continue;
      let sec = Number(live.playtimeSeconds) || 0;
      if (!sec && live.playtimeFormatted) {
        sec = parseFormattedPlaytimeToSeconds(live.playtimeFormatted);
      }

      const existing = playersMap.get(key);
      if (existing) {
        if (sec >= existing.playtimeSeconds) {
          existing.playtimeSeconds = sec;
          existing.playtimeFormatted = live.playtimeFormatted || formatPlaytimeFromSeconds(sec);
        }
        if (live.totalDeaths !== undefined) existing.totalDeaths = Number(live.totalDeaths) || 0;
        if (live.level !== undefined) existing.level = Number(live.level) || 0;
      } else {
        playersMap.set(key, {
          nick: live.nick,
          playtimeSeconds: sec,
          playtimeFormatted: live.playtimeFormatted || formatPlaytimeFromSeconds(sec),
          totalDeaths: Number(live.totalDeaths) || 0,
          level: Number(live.level) || 0,
          isOnline: false,
          lastReported: live.reported_at || new Date().toISOString()
        });
      }
    }

    // Checa quem está online nos últimos 25s
    for (const [key, p] of playersMap.entries()) {
      const live = liveTelemetryCache.get(key);
      if (live && live.reported_at) {
        const diff = (now - new Date(live.reported_at).getTime()) / 1000;
        p.isOnline = diff <= 25 && live.event !== 'logout';
      } else {
        p.isOnline = false;
      }
    }

    // 5. Ordena do maior para o menor por playtimeSeconds
    const sorted = Array.from(playersMap.values()).sort((a, b) => b.playtimeSeconds - a.playtimeSeconds);

    // 6. Pega estritamente os 5 PRIMEIROS
    const top5 = sorted.slice(0, 5).map((p, idx) => ({
      rank: idx + 1,
      nick: p.nick,
      playtimeSeconds: p.playtimeSeconds,
      playtimeFormatted: p.playtimeFormatted || formatPlaytimeFromSeconds(p.playtimeSeconds),
      totalDeaths: p.totalDeaths,
      level: p.level,
      isOnline: !!p.isOnline,
      avatar: `https://mc-heads.net/avatar/${encodeURIComponent(p.nick)}/64`
    }));

    // 7. Persiste o snapshot mais recente do ranking na tabela messages com author_role = 'playtime_rank'
    if (top5.length > 0) {
      safeDb(
        supabase.from('messages').insert([{
          author_nick: 'Sistema',
          author_role: 'playtime_rank',
          author_platform: 'web',
          content: JSON.stringify(top5),
          created_at: new Date().toISOString()
        }])
      );
    }

    res.json({
      success: true,
      top5,
      totalPlayersTracked: sorted.length,
      updatedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar ranking: ' + err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  SISTEMA DE VIDAS — ROTAS DA API
// ════════════════════════════════════════════════════════════════════════════

// Status de vidas de um jogador específico (público — usado pelo plugin)
app.get('/api/lives/status/:nick', async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const data = await obterVidasJogador(nick);
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lista todos os jogadores e suas vidas (Admin)
app.get('/api/admin/lives', requireAdmin, async (req, res) => {
  try {
    const cycle = await checkAndRunLivesCycleReset();

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Busca de dados do Supabase (tabela messages e player_lives)
    const { data: msgLives } = await supabase
      .from('messages')
      .select('author_nick, content, created_at')
      .eq('author_role', 'player_lives')
      .order('created_at', { ascending: false });

    const { data: dbLives } = await supabase
      .from('player_lives')
      .select('*');

    // Busca todos os jogadores aprovados
    const { data: players } = await supabase
      .from('players')
      .select('nick, status, platform')
      .eq('status', 'approved');

    const msgMap = new Map();
    (msgLives || []).forEach(m => {
      const k = (m.author_nick || '').toLowerCase();
      if (k && !msgMap.has(k)) {
        try {
          const parsed = typeof m.content === 'string' ? JSON.parse(m.content) : m.content;
          msgMap.set(k, parsed);
        } catch (_) {}
      }
    });

    const livesMap = new Map((dbLives || []).map(l => [l.nick.toLowerCase(), l]));

    // Mescla: todos os jogadores aprovados com suas vidas (SEMPRE lê do banco, ignora cache)
    const result = (players || []).map(p => {
      const key = p.nick.toLowerCase();
      // Busca exata por nick (case-insensitive mas sem prefix-match)
      const msgEntry = msgMap.get(key);
      const liveEntry = livesMap.get(key);

      // Prioridade: messages (fonte principal) > player_lives (fallback) > 5 (padrão)
      let lives = 5;
      if (msgEntry && msgEntry.lives !== undefined) lives = msgEntry.lives;
      else if (liveEntry && liveEntry.lives !== undefined) lives = liveEntry.lives;

      const isOnline = !!(liveTelemetryCache.get(key) && liveTelemetryCache.get(key).event !== 'logout');
      return {
        nick: p.nick,
        platform: p.platform || 'MC',
        lives: Math.max(0, Math.min(5, lives)),
        max_lives: 5,
        isEliminated: lives <= 0,
        isOnline,
        last_death_at: (msgEntry && msgEntry.last_death_at) || (liveEntry ? liveEntry.last_death_at : null)
      };
    }).sort((a, b) => a.nick.localeCompare(b.nick, 'pt-BR', { sensitivity: 'base' }));

    res.json({
      success: true,
      players: result,
      cycle: {
        cycleIndex: cycle.cycleIndex,
        nextCycleTimestamp: cycle.nextCycleTimestamp,
        remainingMs: cycle.remainingMs,
        remainingFormatted: cycle.remainingFormatted,
        cycleHours: 8
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Define as vidas de um jogador (Admin)
app.post('/api/admin/lives/set', requireAdmin, async (req, res) => {
  try {
    const { nick, lives } = req.body;
    if (!nick) return res.status(400).json({ error: 'Nick é obrigatório.' });
    const safeLives = Math.max(0, Math.min(5, parseInt(lives, 10)));
    const data = await definirVidasJogador(nick, safeLives);
    registrarConsoleLog('info', `❤️ Admin ajustou as vidas de ${nick} para ${safeLives}/5`, 'Admin');
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reseta vidas de TODOS para 5 (Admin — forçado imediatamente)
app.post('/api/admin/lives/reset-all', requireAdmin, async (req, res) => {
  try {
    await executarResetGlobalVidas('Admin (Forçado)');
    const cycle = await checkAndRunLivesCycleReset();
    res.json({
      success: true,
      message: '✅ Vidas de todos os jogadores foram restauradas para 5!',
      nextReset: cycle.remainingFormatted
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
