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
const TOKEN_SECRET = process.env.TOKEN_SECRET || '5daymc-auth-secret-key-2026-mc';
const LEGACY_TOKEN_SECRET = 'mapabermuda-auth-secret-key-2025-mc';

// ─── Mercado Pago ─────────────────────────────────────────────────────────────
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || 'APP_USR-7322103170597733-041213-494e0ff2a4789bdb62f82e3fabf32e18-292784019';
const MP_PUBLIC_KEY   = process.env.MP_PUBLIC_KEY   || 'APP_USR-27b07c49-7c02-437a-b955-f0781758eb74';
const SUBSCRIPTION_PRICE = 19.99;
const PROFILE_VIP_PRICE  = 9.99;
const SUBSCRIPTION_DAYS  = 30;
const SITE_URL = 'https://fffff-autoforge.vercel.app';

// ─── Middlewares ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '6mb' }));
app.use(express.urlencoded({ limit: '6mb', extended: true }));
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
  const legacyExpectedSig = crypto.createHmac('sha256', LEGACY_TOKEN_SECRET).update(b64).digest('hex');
  if (sig !== expectedSig && sig !== legacyExpectedSig) return null;
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

// ─── Cache em memória de tags de reinos (declarado aqui para uso global antes de /api/chat) ───
const kingdomTagsCache = new Map(); // lower_nick -> { tag, kingdomName, kingdomId, role }
let lastKingdomCacheSync = 0;

async function syncKingdomsCache(force = false) {
  const now = Date.now();
  if (!force && now - lastKingdomCacheSync < 30000 && kingdomTagsCache.size > 0) return;
  lastKingdomCacheSync = now;
  try {
    const { data: members } = await supabase
      .from('kingdom_members')
      .select('user_nick, role, kingdoms ( * )');
    if (members) {
      kingdomTagsCache.clear();
      for (const m of members) {
        if (m.kingdoms && m.kingdoms.tag) {
          kingdomTagsCache.set(m.user_nick.toLowerCase().trim(), {
            tag: m.kingdoms.tag.toUpperCase(),
            logo: m.kingdoms.logo || '👑',
            cor: m.kingdoms.cor || '#f59e0b',
            kingdomName: m.kingdoms.nome,
            kingdomId: m.kingdoms.id,
            role: m.role || 'membro'
          });
        }
      }
    }
  } catch (_) {}
}

// ─── Cache em memória de Perfis VIP (Foto & Molduras Animadas de Minecraft) ───
const vipProfilesCache = new Map(); // lower_nick -> { avatar_url, frame_id, status, expires_at }
let lastVipProfilesSync = 0;

const VALID_VIP_FRAMES = [
  'portal_nether',
  'chama_blaze',
  'redstone_eletrica',
  'esmeralda_lendaria',
  'diamante_encantado',
  'coracao_do_mar',
  'estrela_do_nether',
  'totem_imortal'
];

async function syncVipProfilesCache(force = false) {
  const now = Date.now();
  if (!force && now - lastVipProfilesSync < 20000 && vipProfilesCache.size > 0) return;
  lastVipProfilesSync = now;
  try {
    const { data: vips } = await supabase
      .from('user_vip_profiles')
      .select('*')
      .eq('status', 'active');
    if (vips) {
      vipProfilesCache.clear();
      for (const v of vips) {
        if (v.expires_at && new Date(v.expires_at).getTime() < now) {
          safeDb(supabase.from('user_vip_profiles').update({ status: 'expired' }).eq('id', v.id));
          continue;
        }
        vipProfilesCache.set(v.user_nick.toLowerCase().trim(), {
          avatar_url: v.avatar_url,
          frame_id: v.frame_id || 'portal_nether',
          status: 'active',
          expires_at: v.expires_at
        });
      }
    }
  } catch (_) {}
}

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
        email: 'admin@5daymc.com',
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

    // Lookup kingdom tag from in-memory cache (zero Supabase cost)
    const kInfo = kingdomTagsCache.get((user.nick || '').toLowerCase().trim());

    return res.json({
      authenticated: true,
      isAdmin: false,
      user,
      whitelistStatus: status,
      banReason,
      kingdom_tag: kInfo ? kInfo.tag : null,
      kingdom_logo: kInfo ? (kInfo.logo || '👑') : null,
      kingdom_color: kInfo ? (kInfo.cor || '#f59e0b') : null,
      kingdom: kInfo || null
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
        email: 'admin@5daymc.com',
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
    await safeDb(supabase.from('player_deaths').delete().lt('created_at', limite3Dias));
    await safeDb(supabase.from('player_sessions').delete().lt('created_at', limite3Dias));
    await safeDb(supabase.from('messages').delete().lt('created_at', limite3Dias).in('author_role', ['death_log', 'session_log']));
  } catch (err) {
    // Silencioso
  }
}

let lastChatCleanupsTime = 0;

// Listar mensagens (consulta super rápida, com cache Edge CDN Vercel)
app.get('/api/chat', async (req, res) => {
  res.setHeader('Cache-Control', 'public, s-maxage=2, stale-while-revalidate=8');
  try {
    // Limpezas periódicas automáticas espaçadas (máximo 1x a cada 6 horas para não sobrecarregar o banco)
    const now = Date.now();
    if (now - lastChatCleanupsTime > 6 * 3600 * 1000) {
      lastChatCleanupsTime = now;
      limparMensagens30Dias().catch(() => {});
      limparLogsMortesESessoes3Dias().catch(() => {});
    }

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .not('author_role', 'in', '("telemetry","ban_log","ip_ban","death_log","session_log","console_log","playtime_rank","player_lives","system_lives","kingdom_member_baseline")')
      .order('created_at', { ascending: false })
      .limit(60);

    if (error) throw error;
    await syncVipProfilesCache();
    const msgs = (data || []).reverse().map(m => {
      const lowerNick = (m.author_nick || '').toLowerCase().trim();
      const kInfo = kingdomTagsCache.get(lowerNick);
      const vipInfo = vipProfilesCache.get(lowerNick);
      return {
        ...m,
        kingdom_tag: kInfo ? kInfo.tag : null,
        kingdom_logo: kInfo ? (kInfo.logo || '👑') : null,
        kingdom_color: kInfo ? (kInfo.cor || '#f59e0b') : null,
        vip_avatar: vipInfo ? vipInfo.avatar_url : null,
        vip_frame: vipInfo ? vipInfo.frame_id : null
      };
    });
    res.json(msgs);
  } catch (err) {
    res.json([]);
  }
});

// Limpeza Manual de Logs (Admin) - Mortes e Conexões
app.post('/api/admin/clean-logs', requireAdmin, async (req, res) => {
  try {
    const mode = req.body.mode || 'all'; // '3days' ou 'all'
    if (mode === '3days') {
      const limite = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      await safeDb(supabase.from('player_deaths').delete().lt('created_at', limite));
      await safeDb(supabase.from('player_sessions').delete().lt('created_at', limite));
      await safeDb(supabase.from('messages').delete().lt('created_at', limite).in('author_role', ['death_log', 'session_log']));
    } else {
      await safeDb(supabase.from('player_deaths').delete().neq('id', 0));
      await safeDb(supabase.from('player_sessions').delete().neq('id', 0));
      await safeDb(supabase.from('messages').delete().in('author_role', ['death_log', 'session_log']));
    }

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
    // Apaga ESTRITAMENTE as conversas reais dos jogadores no chat (preserva vidas, telemetria, bans e logs)
    await supabase
      .from('messages')
      .delete()
      .in('author_role', ['player', 'user'])
      .not('content', 'like', '{"%');

    // Apaga mensagens de bate-papo enviadas pelo Admin (preserva mensagens oficiais do Sistema)
    await supabase
      .from('messages')
      .delete()
      .eq('author_role', 'admin')
      .neq('author_nick', 'Sistema')
      .not('content', 'like', '{"%');

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
  res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
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
      // Adiciona tag do reino a partir do cache (custo zero)
      const kp = kingdomTagsCache.get((p.nick || '').toLowerCase().trim());
      p.kingdom_tag = kp ? kp.tag : null;
      p.kingdom_logo = kp ? (kp.logo || '👑') : null;
      p.kingdom_color = kp ? (kp.cor || '#f59e0b') : null;
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

    // Adiciona kingdom_tag, kingdom_logo e kingdom_color também na lista de online
    const enrichedOnline = onlineList.map(o => {
      const ko = kingdomTagsCache.get((o.nick || '').toLowerCase().trim());
      return {
        ...o,
        kingdom_tag: ko ? ko.tag : null,
        kingdom_logo: ko ? (ko.logo || '👑') : null,
        kingdom_color: ko ? (ko.cor || '#f59e0b') : null
      };
    });

    res.json({
      pending:  players.filter(p => p.status === 'pending'),
      approved: players.filter(p => p.status === 'approved'),
      rejected: players.filter(p => p.status === 'rejected'),
      banned:   players.filter(p => p.status === 'banned'),
      online:   enrichedOnline,
      totalOnline: enrichedOnline.length
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

// Rejeitar — apaga conta + todos os dados (nenhum registro fantasma)
app.post('/api/admin/reject/:nick', requireAdmin, async (req, res) => {
  try {
    const nick = req.params.nick.trim();
    const key  = nick.toLowerCase();

    // 1. Remove de players
    await safeDb(supabase.from('players').delete().ilike('nick', nick));

    // 2. Remove conta de accounts
    await safeDb(supabase.from('accounts').delete().ilike('nick', nick));

    // 3. Remove de auth_users (caso exista)
    await safeDb(supabase.from('auth_users').delete().ilike('nick', nick));

    // 4. Remove mensagens do chat
    await safeDb(supabase.from('messages').delete().ilike('author_nick', nick));

    // 5. Remove de kingdom_members e kingdom_invites
    await safeDb(supabase.from('kingdom_members').delete().ilike('user_nick', nick));
    await safeDb(supabase.from('kingdom_invites').delete().ilike('invited_nick', nick));

    // 6. Limpa caches de memória
    liveTelemetryCache.delete(key);
    userWebIps.delete(key);
    lastDbSyncMap.delete(key);
    kingdomTagsCache.delete(key);

    res.json({ success: true, message: `🗑️ ${nick} — conta e todos os dados excluídos permanentemente.` });
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
      .update({ status: 'approved', ban_reason: null, updated_at: now })
      .ilike('nick', nick);

    if (error) throw error;

    // Limpa ban de IP associado ao nick se houver
    safeDb(supabase.from('messages').delete().eq('author_role', 'ip_ban').ilike('author_platform', nick));
    for (const [ip, item] of bannedIpsCache.entries()) {
      if (item.associatedNick && item.associatedNick.toLowerCase() === nick.toLowerCase()) {
        bannedIpsCache.delete(ip);
        safeDb(supabase.from('messages').delete().eq('author_role', 'ip_ban').eq('author_nick', ip));
      }
    }

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

    res.json({ success: true, message: `✅ ${nick} foi desbanido e liberado na Whitelist!` });
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

    // Remove qualquer duplicata existente antes (case-insensitive) para evitar conflitos de maiúsculas/minúsculas
    await safeDb(
      supabase.from('players').delete().ilike('nick', nick)
    );

    const { error } = await supabase
      .from('players')
      .insert([{ nick, status: 'approved', platform, updated_at: now, requested_at: now }]);

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

// Limpeza automática de logs com mais de 24 horas
async function limparServerLogs24Horas() {
  try {
    const limite24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await safeDb(
      supabase
        .from('server_logs')
        .delete()
        .lt('created_at', limite24h)
    );
  } catch (_) {}
}

function registrarConsoleLog(type, content, sender = 'Sistema') {
  const now = new Date().toISOString();
  const logEntry = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    type, // 'command' | 'broadcast' | 'info' | 'error'
    content,
    sender,
    time: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
    created_at: now
  };
  liveConsoleLogs.push(logEntry);
  if (liveConsoleLogs.length > 200) liveConsoleLogs.shift();

  // 1. Persiste na tabela dedicada server_logs (isolada de messages)
  safeDb(supabase.from('server_logs').insert([{
    type,
    content,
    sender,
    created_at: now
  }]));

  return logEntry;
}

// ─── SISTEMA DE VIDAS (5 VIDAS + RESET A CADA 8 HORAS) ──────────────────────
const LIVES_CYCLE_MS = 8 * 60 * 60 * 1000; // 8 horas em ms
const playerLivesCache = new Map(); // nick.toLowerCase() -> { lives: 5, max_lives: 5, ... }

function getLivesCycleInfo() {
  const now = Date.now();
  // Ciclo universal de 8 horas fixo (00h, 08h, 16h UTC)
  const cycleIndex = Math.floor(now / LIVES_CYCLE_MS);
  const currentCycleStart = cycleIndex * LIVES_CYCLE_MS;
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
    currentCycleStart,
    nextCycleTimestamp,
    remainingMs,
    remainingFormatted: parts.join(' ')
  };
}

let lastCheckTime = 0;
async function checkAndRunLivesCycleReset() {
  const cycle = getLivesCycleInfo();
  const now = Date.now();

  // Throttle da checagem para evitar chamadas excessivas ao banco (máx 1 a cada 10s)
  if (now - lastCheckTime < 10000) {
    return cycle;
  }
  lastCheckTime = now;

  try {
    // 1. Verifica lives_config no Supabase
    const { data: cfg } = await supabase
      .from('lives_config')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    let needsReset = false;
    if (!cfg || !cfg.last_global_reset) {
      needsReset = true;
    } else {
      const lastResetMs = new Date(cfg.last_global_reset).getTime();
      // Se o último reset foi ANTES do início do ciclo atual, ou se passaram >= 8 horas
      if (lastResetMs < cycle.currentCycleStart || (now - lastResetMs) >= LIVES_CYCLE_MS) {
        needsReset = true;
      }
    }

    if (needsReset) {
      await executarResetGlobalVidas('Ciclo Automático de 8 Horas');
    }
  } catch (err) {
    console.error('Erro em checkAndRunLivesCycleReset:', err);
  }

  return cycle;
}

// Executa verificação de ciclo de 8h imediatamente na inicialização e a cada 1 minuto
checkAndRunLivesCycleReset().catch(() => {});
setInterval(() => checkAndRunLivesCycleReset().catch(() => {}), 60000);

// ─── PERSISTÊNCIA DEDICADA DE VIDAS (player_lives + contingência) ─────────────
async function salvarVidasNoBanco(nick, livesObj) {
  const now = new Date().toISOString();
  const payload = {
    lives: livesObj.lives,
    max_lives: 5,
    cycleIndex: livesObj.cycleIndex,
    last_death_at: livesObj.last_death_at || null,
    updated_at: now
  };

  // 1. Tenta salvar na tabela dedicada player_lives evitando duplicatas de maiúsculas/minúsculas
  try {
    const { data: existingRows } = await supabase
      .from('player_lives')
      .select('id, nick')
      .ilike('nick', nick);

    if (existingRows && existingRows.length > 0) {
      const primaryId = existingRows[0].id;
      await safeDb(
        supabase
          .from('player_lives')
          .update({
            nick,
            lives: livesObj.lives,
            max_lives: 5,
            last_death_at: livesObj.last_death_at || null,
            updated_at: now
          })
          .eq('id', primaryId)
      );
      if (existingRows.length > 1) {
        const extraIds = existingRows.slice(1).map(r => r.id);
        await safeDb(supabase.from('player_lives').delete().in('id', extraIds));
      }
    } else {
      await safeDb(
        supabase
          .from('player_lives')
          .insert([{
            nick,
            lives: livesObj.lives,
            max_lives: 5,
            last_death_at: livesObj.last_death_at || null,
            updated_at: now
          }])
      );
    }
  } catch (_) {}

  // 2. Contingência garantida (tabela messages com role system_lives — nunca falha)
  try {
    const { data: records } = await supabase
      .from('messages')
      .select('id, author_nick')
      .eq('author_role', 'system_lives');

    const matched = (records || []).find(r => r.author_nick && r.author_nick.toLowerCase() === nick.toLowerCase());
    if (matched && matched.id) {
      await safeDb(
        supabase.from('messages').update({
          content: JSON.stringify(payload),
          author_platform: String(livesObj.lives),
          created_at: now
        }).eq('id', matched.id)
      );
    } else {
      await safeDb(
        supabase.from('messages').insert([{
          author_nick: nick,
          author_role: 'system_lives',
          author_platform: String(livesObj.lives),
          content: JSON.stringify(payload),
          created_at: now
        }])
      );
    }
  } catch (_) {}
}

async function carregarVidasDoBanco(nick, cycle) {
  if (!cycle) cycle = getLivesCycleInfo();
  const now = Date.now();

  // 1. Tenta ler da tabela dedicada player_lives (sem maybeSingle para evitar erro caso haja registros duplicados)
  try {
    const { data: rows } = await supabase
      .from('player_lives')
      .select('*')
      .ilike('nick', nick)
      .order('updated_at', { ascending: false })
      .limit(1);

    const pl = rows && rows.length > 0 ? rows[0] : null;

    if (pl && pl.lives !== undefined) {
      // VERIFICAÇÃO AUTOMÁTICA DE 8 HORAS POR JOGADOR:
      // Se a última morte/atualização ocorreu em um ciclo anterior ou há mais de 8h, restaura para 5 vidas!
      const updatedAtMs = pl.updated_at ? new Date(pl.updated_at).getTime() : 0;
      const lastDeathMs = pl.last_death_at ? new Date(pl.last_death_at).getTime() : 0;
      const latestActivityMs = Math.max(updatedAtMs, lastDeathMs);

      if (pl.lives < 5 && latestActivityMs > 0 && (latestActivityMs < cycle.currentCycleStart || (now - latestActivityMs) >= LIVES_CYCLE_MS)) {
        const resetObj = {
          lives: 5,
          max_lives: 5,
          last_death_at: null,
          cycleIndex: cycle.cycleIndex
        };
        await salvarVidasNoBanco(nick, resetObj);
        return { lives: 5, last_death_at: null };
      }

      return {
        lives: Math.max(0, Math.min(5, pl.lives)),
        last_death_at: pl.last_death_at || null
      };
    }
  } catch (_) {}

  // 2. Contingência em system_lives
  try {
    const { data: records } = await supabase
      .from('messages')
      .select('author_nick, content, created_at')
      .eq('author_role', 'system_lives')
      .order('created_at', { ascending: false });

    const matched = (records || []).find(r => r.author_nick && r.author_nick.toLowerCase() === nick.toLowerCase());
    if (matched && matched.content) {
      const parsed = typeof matched.content === 'string' ? JSON.parse(matched.content) : matched.content;
      const parsedLives = parsed.lives !== undefined ? parsed.lives : 5;
      const msgTimeMs = matched.created_at ? new Date(matched.created_at).getTime() : 0;

      if (parsedLives < 5 && msgTimeMs > 0 && (msgTimeMs < cycle.currentCycleStart || (now - msgTimeMs) >= LIVES_CYCLE_MS)) {
        return { lives: 5, last_death_at: null };
      }

      return {
        lives: Math.max(0, Math.min(5, parsedLives)),
        last_death_at: parsed.last_death_at || null
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

  await safeDb(
    supabase
      .from('player_lives')
      .update({ lives: 5, last_death_at: null, updated_at: now })
      .neq('lives', 5)
  );

  await safeDb(
    supabase
      .from('lives_config')
      .upsert({ id: 1, cycle_hours: 8, last_global_reset: now, updated_at: now }, { onConflict: 'id' })
  );

  await safeDb(
    supabase
      .from('messages')
      .delete()
      .eq('author_role', 'system_lives')
  );

  registrarConsoleLog('info', `❤️ As vidas de todos os jogadores foram restauradas para 5! (${origem})`, 'Sistema');
}

async function obterVidasJogador(nick) {
  if (!nick) return { nick: '', lives: 5, max_lives: 5, isEliminated: false };
  const key = nick.toLowerCase();
  
  // Executa checagem de ciclo automático (se 8 horas passaram, reseta o banco)
  const cycle = await checkAndRunLivesCycleReset();

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

    // Evento de morte (PlayerDeathEvent) — salva em player_deaths e deduz 1 vida
    if (payload.event === 'death') {
      const now = new Date().toISOString();
      safeDb(supabase.from('player_deaths').insert([{
        nick,
        message: payload.deathMessage || `${nick} morreu`,
        killer: payload.killer || null,
        world: payload.world || 'world',
        location: payload.location || (payload.x !== undefined ? `${payload.x}, ${payload.y}, ${payload.z}` : '0, 0, 0'),
        created_at: now
      }]));

      // Deduz 1 vida do jogador no sistema de vidas (ou sincroniza as vidas enviadas pelo plugin)
      const livesData = (payload.lives !== undefined)
        ? await definirVidasJogador(nick, payload.lives)
        : await descontarVidaJogador(nick);
      const livesRemaining = livesData ? livesData.lives : null;

      // Se houve killer e o killer pertence a um reino, incrementa kills e pontos do reino com await direto no banco
      if (payload.killer) {
        const killerNick = String(payload.killer).trim();
        const cleanKiller = killerNick.replace(/^[._]/, '');
        try {
          let targetKingdomId = null;
          const { data: memberRows } = await supabase
            .from('kingdom_members')
            .select('kingdom_id')
            .or(`user_nick.ilike.${killerNick},user_nick.ilike.${cleanKiller}`)
            .limit(1);

          if (memberRows && memberRows.length > 0) {
            targetKingdomId = memberRows[0].kingdom_id;
          } else {
            const { data: ownerRows } = await supabase
              .from('kingdoms')
              .select('id')
              .or(`owner_nick.ilike.${killerNick},owner_nick.ilike.${cleanKiller}`)
              .limit(1);
            if (ownerRows && ownerRows.length > 0) {
              targetKingdomId = ownerRows[0].id;
            }
          }

          if (targetKingdomId) {
            const { data: kd } = await supabase
              .from('kingdoms')
              .select('kills, pontos, tag, nome')
              .eq('id', targetKingdomId)
              .single();

            if (kd) {
              const currentKills = (Number(kd.kills) || 0) + 1;
              const currentPontos = (Number(kd.pontos) || 0) + 50;
              await supabase
                .from('kingdoms')
                .update({ kills: currentKills, pontos: currentPontos })
                .eq('id', targetKingdomId);

              registrarConsoleLog('info', `⚔️ [Reino ${kd.tag}] ${killerNick} abateu ${nick}! (+1 Kill PvP, +50 Pontos)`, 'Reinos');
            }
          }
        } catch (kErr) {
          console.error('Erro ao processar kill de reino:', kErr);
        }
      }

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

    // Evento de login ou logout no Minecraft — salva em player_sessions
    if (payload.event === 'login' || payload.event === 'logout') {
      const now = new Date().toISOString();
      safeDb(supabase.from('player_sessions').insert([{
        nick,
        event: payload.event,
        ip: payload.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '–',
        world: payload.world || 'world',
        location: payload.location || (payload.x !== undefined ? `${payload.x}, ${payload.y}, ${payload.z}` : '0, 0, 0'),
        gamemode: payload.gamemode || 'SURVIVAL',
        created_at: now
      }]));

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

      // 3. Atualiza tabela dedicada player_rankings (isolada do chat)
      if (payload.playtimeSeconds !== undefined || payload.playtimeFormatted) {
        let sec = Number(payload.playtimeSeconds) || 0;
        if (!sec && payload.playtimeFormatted) {
          sec = parseFormattedPlaytimeToSeconds(payload.playtimeFormatted);
        }
        safeDb(
          supabase.from('player_rankings').upsert({
            nick,
            playtime_seconds: sec,
            playtime_formatted: payload.playtimeFormatted || formatPlaytimeFromSeconds(sec),
            total_deaths: Number(payload.totalDeaths) || 0,
            level: Number(payload.level) || 0,
            last_seen_at: payload.reported_at || new Date().toISOString(),
            updated_at: new Date().toISOString()
          }, { onConflict: 'nick' })
        );
      }
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
    // 3.1 Histórico de mortes (tabela dedicada player_deaths)
    const { data: dbDeaths } = await supabase
      .from('player_deaths')
      .select('*')
      .ilike('nick', nick)
      .order('created_at', { ascending: false })
      .limit(30);

    const deathHistory = (dbDeaths || []).map(d => ({
      message: d.message || `${nick} morreu`,
      world: d.world || 'world',
      location: d.location || '0, 0, 0',
      killer: d.killer || null,
      at: d.created_at
    }));

    // 3.2 Histórico de entrada e saída (tabela dedicada player_sessions)
    const { data: dbSessions } = await supabase
      .from('player_sessions')
      .select('*')
      .ilike('nick', nick)
      .order('created_at', { ascending: false })
      .limit(50);

    const sessionHistory = (dbSessions || []).map(s => ({
      event: s.event || 'login',
      ip: s.ip || '–',
      world: s.world || 'world',
      location: s.location || '0, 0, 0',
      gamemode: s.gamemode || 'SURVIVAL',
      at: s.created_at
    }));

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

    const { data: players, error } = await supabase
      .from('players')
      .select('status, ban_reason')
      .ilike('nick', nick)
      .order('updated_at', { ascending: false })
      .limit(1);

    const player = (players && players.length > 0) ? players[0] : null;

    if (error || !player) {
      return res.json({ allowed: false, banned: false, notFound: true, nick });
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
    if (!allowed) return res.json({ allowed: false, banned: false, notFound: true, nick });

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
    res.json({ allowed: false, banned: false, apiError: true, nick: req.params.nick });
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
    // Limpa automaticamente logs com mais de 24 horas
    limparServerLogs24Horas().catch(() => {});

    if (liveConsoleLogs.length > 0) {
      return res.json(liveConsoleLogs);
    }

    // Busca os últimos da tabela dedicada server_logs
    const { data } = await supabase
      .from('server_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(80);

    const logs = (data || []).reverse().map(row => ({
      id: row.id,
      type: row.type || 'info',
      content: row.content,
      sender: row.sender || 'Sistema',
      time: new Date(row.created_at).toLocaleTimeString('pt-BR', { hour12: false }),
      created_at: row.created_at
    }));

    res.json(logs);
  } catch (err) {
    res.json(liveConsoleLogs);
  }
});

// 3. Admin limpa logs do console
app.post('/api/admin/console/clear', requireAdmin, async (req, res) => {
  try {
    liveConsoleLogs.length = 0;
    await safeDb(supabase.from('server_logs').delete().neq('id', 0));
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

// 6. Sincronização Geral Unificada com o Plugin (Ultra-Econômico)
app.get('/api/plugin/sync', async (req, res) => {
  const secret = req.headers['x-plugin-secret'] || req.query.secret || '';
  const PLUGIN_SECRET = process.env.PLUGIN_SECRET || 'MapaBermuda2025Plugin';
  if (secret !== PLUGIN_SECRET) return res.status(403).json({ error: 'Forbidden' });

  try {
    // 1. Whitelist e Bans da tabela players
    const { data: players } = await supabase
      .from('players')
      .select('nick, status, ban_reason');

    const approved = [];
    const bans = [];

    for (const p of (players || [])) {
      if (p.status === 'approved') {
        approved.push(p.nick.toLowerCase());
      } else if (p.status === 'banned') {
        const banInfo = parseBanInfo(p.ban_reason);
        if (banInfo.expired) {
          approved.push(p.nick.toLowerCase());
          safeDb(supabase.from('players').update({ status: 'approved', ban_reason: null, updated_at: new Date().toISOString() }).ilike('nick', p.nick));
        } else {
          bans.push({
            nick: p.nick.toLowerCase(),
            reason: banInfo.reason,
            remaining: banInfo.remaining,
            isPermanent: banInfo.isPermanent
          });
        }
      }
    }

    // 2. IP Bans ativos (busca do banco messages e do cache)
    const { data: dbIpBans } = await supabase
      .from('messages')
      .select('author_nick, author_platform, content, created_at')
      .eq('author_role', 'ip_ban');

    const ipBans = [];
    const seenIps = new Set();
    for (const row of (dbIpBans || [])) {
      let parsed = {};
      try { parsed = JSON.parse(row.content); } catch { parsed = { reason: row.content }; }
      if (!parsed.expiresAt || Date.now() < new Date(parsed.expiresAt).getTime()) {
        seenIps.add(row.author_nick);
        ipBans.push({
          ip: row.author_nick,
          reason: parsed.reason || 'IP Bloqueado',
          associatedNick: row.author_platform || ''
        });
      }
    }
    for (const [ip, item] of bannedIpsCache.entries()) {
      if (!seenIps.has(ip) && (!item.expiresAt || Date.now() < new Date(item.expiresAt).getTime())) {
        ipBans.push({
          ip,
          reason: item.reason,
          associatedNick: item.associatedNick || ''
        });
      }
    }

    // 3. Vidas dos jogadores (tabela player_lives)
    const { data: livesData } = await supabase
      .from('player_lives')
      .select('nick, lives, last_death_at');

    const livesMap = {};
    for (const row of (livesData || [])) {
      if (row.nick) {
        livesMap[row.nick.toLowerCase()] = {
          lives: row.lives !== undefined ? row.lives : 5,
          lastDeathAt: row.last_death_at || null
        };
      }
    }

    // Garante que todos os jogadores aprovados estejam no livesMap com pelo menos 5 vidas
    for (const appNick of approved) {
      if (!livesMap[appNick]) {
        livesMap[appNick] = { lives: 5, lastDeathAt: null };
      }
    }

    // 4. Comandos de console pendentes
    const commandsToRun = pendingConsoleCommands.splice(0);

    res.json({
      success: true,
      timestamp: Date.now(),
      approved,
      bans,
      ipBans,
      lives: livesMap,
      commands: commandsToRun
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=45');
  try {
    // 1. Busca todos os registros da tabela dedicada player_rankings
    const { data: dbRanks } = await supabase
      .from('player_rankings')
      .select('*')
      .order('playtime_seconds', { ascending: false });

    // Fallback de telemetria se player_rankings ainda estiver sendo populada
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

    // Carrega dados da tabela dedicada player_rankings
    for (const row of (dbRanks || [])) {
      const nick = (row.nick || '').trim();
      if (!nick) continue;
      const key = nick.toLowerCase();
      const sec = Number(row.playtime_seconds) || 0;
      playersMap.set(key, {
        nick: row.nick,
        playtimeSeconds: sec,
        playtimeFormatted: row.playtime_formatted || formatPlaytimeFromSeconds(sec),
        totalDeaths: Number(row.total_deaths) || 0,
        level: Number(row.level) || 0,
        isOnline: false,
        lastReported: row.updated_at || row.last_seen_at
      });
    }

    // Carrega também do banco de telemetria como contingência
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
//  SISTEMA DE VOZ EM TEMPO REAL ESTILO DISCORD (WEBRTC — 100% SEM SUPABASE)
// ════════════════════════════════════════════════════════════════════════════
const voiceRoomPeers = new Map(); // peerId -> { nick, platform, avatar, isMuted, isDeafened, lastSeen, joinedAt }
const recentlyLeftPeers = new Map(); // peerId or nick_lower -> timestamp

function isPeerRecentlyLeft(peerId, nick) {
  const now = Date.now();
  for (const [key, leftAt] of recentlyLeftPeers.entries()) {
    if (now - leftAt > 30000) {
      recentlyLeftPeers.delete(key);
    }
  }
  if (peerId && recentlyLeftPeers.has(peerId)) return true;
  if (nick && recentlyLeftPeers.has('nick_' + String(nick).toLowerCase())) return true;
  return false;
}

function cleanupVoicePeers() {
  const now = Date.now();

  // 1. Remove peers sem heartbeat por mais de 10 segundos
  for (const [peerId, peer] of voiceRoomPeers.entries()) {
    if (now - peer.lastSeen > 10000) {
      voiceRoomPeers.delete(peerId);
    }
  }

  // 2. Garante desduplicação por nickname na lista ativa
  const byNick = new Map();
  for (const [peerId, peer] of voiceRoomPeers.entries()) {
    const nickLower = String(peer.nick || '').toLowerCase();
    if (!byNick.has(nickLower) || peer.lastSeen > byNick.get(nickLower).lastSeen) {
      byNick.set(nickLower, { peerId, peer });
    }
  }

  // Deleta do mapa qualquer peerId antigo que foi sobrescrito por uma sessão mais recente do mesmo nick
  const activeIds = new Set(Array.from(byNick.values()).map(x => x.peerId));
  for (const [pId] of voiceRoomPeers.entries()) {
    if (!activeIds.has(pId)) {
      voiceRoomPeers.delete(pId);
    }
  }
}

function cleanupDuplicateNicks(activePeerId, nick) {
  if (!nick) return;
  const targetNick = String(nick).toLowerCase();
  for (const [pId, peer] of voiceRoomPeers.entries()) {
    if (peer.nick && String(peer.nick).toLowerCase() === targetNick && pId !== activePeerId) {
      voiceRoomPeers.delete(pId);
    }
  }
}

function mergeKnownPeers(knownPeers) {
  if (!Array.isArray(knownPeers)) return;
  const now = Date.now();
  knownPeers.forEach(p => {
    if (p && p.peerId && p.nick) {
      if (isPeerRecentlyLeft(p.peerId, p.nick)) {
        return; // IGNORA membros que saíram da sala
      }

      // Se já existe uma entrada com esse nick mas peerId diferente, ignora a antiga
      let existsNick = false;
      for (const [, existing] of voiceRoomPeers.entries()) {
        if (existing.nick && String(existing.nick).toLowerCase() === String(p.nick).toLowerCase() && existing.peerId !== p.peerId) {
          existsNick = true;
          break;
        }
      }
      if (!existsNick) {
        if (!voiceRoomPeers.has(p.peerId)) {
          voiceRoomPeers.set(p.peerId, {
            peerId: p.peerId,
            nick: p.nick,
            platform: p.platform || 'Minecraft',
            avatar: p.avatar || `https://mc-heads.net/avatar/${encodeURIComponent(p.nick)}/64`,
            isMuted: !!p.isMuted,
            isDeafened: !!p.isDeafened,
            lastSeen: now,
            joinedAt: now
          });
        } else {
          const existing = voiceRoomPeers.get(p.peerId);
          existing.lastSeen = now;
          if (p.isMuted !== undefined) existing.isMuted = !!p.isMuted;
          if (p.isDeafened !== undefined) existing.isDeafened = !!p.isDeafened;
        }
      }
    }
  });
}

// Entrar ou registrar presença na sala de voz
app.post('/api/voice/join', (req, res) => {
  cleanupVoicePeers();
  const { peerId, nick, platform, isMuted, isDeafened, knownPeers } = req.body || {};
  if (!peerId || !nick) {
    return res.status(400).json({ error: 'peerId e nick são obrigatórios.' });
  }

  // Remove dos recém saídos caso esteja reentrando
  if (peerId) recentlyLeftPeers.delete(peerId);
  if (nick) recentlyLeftPeers.delete('nick_' + String(nick).toLowerCase());

  // Remove qualquer sessão antiga deste mesmo nickname
  cleanupDuplicateNicks(peerId, nick);

  const now = Date.now();
  voiceRoomPeers.set(peerId, {
    peerId,
    nick,
    platform: platform || 'Minecraft',
    avatar: `https://mc-heads.net/avatar/${encodeURIComponent(nick)}/64`,
    isMuted: !!isMuted,
    isDeafened: !!isDeafened,
    lastSeen: now,
    joinedAt: voiceRoomPeers.has(peerId) ? voiceRoomPeers.get(peerId).joinedAt : now
  });

  mergeKnownPeers(knownPeers);

  const activePeers = Array.from(voiceRoomPeers.values());
  res.json({ success: true, count: activePeers.length, peers: activePeers });
});

// Listar peers ativos na chamada de voz
app.get('/api/voice/peers', (req, res) => {
  cleanupVoicePeers();
  const activePeers = Array.from(voiceRoomPeers.values());
  res.json({ success: true, count: activePeers.length, peers: activePeers });
});

// Heartbeat periódico (mantém o peer vivo e sincroniza status de mute)
app.post('/api/voice/heartbeat', (req, res) => {
  cleanupVoicePeers();
  const { peerId, isMuted, isDeafened, knownPeers, nick } = req.body || {};
  if (peerId) {
    if (nick) cleanupDuplicateNicks(peerId, nick);

    const now = Date.now();
    if (voiceRoomPeers.has(peerId)) {
      const peer = voiceRoomPeers.get(peerId);
      peer.lastSeen = now;
      if (isMuted !== undefined) peer.isMuted = !!isMuted;
      if (isDeafened !== undefined) peer.isDeafened = !!isDeafened;
    }
  }

  mergeKnownPeers(knownPeers);

  const activePeers = Array.from(voiceRoomPeers.values());
  res.json({ success: true, count: activePeers.length, peers: activePeers });
});

// Sair da chamada de voz
app.post('/api/voice/leave', (req, res) => {
  const { peerId, nick } = req.body || {};
  const now = Date.now();
  if (peerId) {
    recentlyLeftPeers.set(peerId, now);
    const peer = voiceRoomPeers.get(peerId);
    if (peer && peer.nick) {
      recentlyLeftPeers.set('nick_' + String(peer.nick).toLowerCase(), now);
    }
    voiceRoomPeers.delete(peerId);
  }
  if (nick) {
    recentlyLeftPeers.set('nick_' + String(nick).toLowerCase(), now);
    cleanupDuplicateNicks(null, nick);
  }
  cleanupVoicePeers();
  res.json({ success: true });
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

    // Busca de dados da tabela dedicada player_lives e contingência
    const { data: dbLives } = await supabase
      .from('player_lives')
      .select('*');

    const { data: msgLives } = await supabase
      .from('messages')
      .select('author_nick, content')
      .eq('author_role', 'system_lives');

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

    // Mescla: todos os jogadores aprovados com suas vidas
    const result = (players || []).map(p => {
      const key = p.nick.toLowerCase();
      const liveEntry = livesMap.get(key);
      const msgEntry = msgMap.get(key);

      let lives = 5;
      if (liveEntry && liveEntry.lives !== undefined) {
        const updatedAtMs = liveEntry.updated_at ? new Date(liveEntry.updated_at).getTime() : 0;
        const lastDeathMs = liveEntry.last_death_at ? new Date(liveEntry.last_death_at).getTime() : 0;
        const actMs = Math.max(updatedAtMs, lastDeathMs);
        if (liveEntry.lives < 5 && actMs > 0 && (actMs < cycle.currentCycleStart || (Date.now() - actMs) >= LIVES_CYCLE_MS)) {
          lives = 5;
        } else {
          lives = liveEntry.lives;
        }
      } else if (msgEntry && msgEntry.lives !== undefined) {
        lives = msgEntry.lives;
      }

      const isOnline = !!(liveTelemetryCache.get(key) && liveTelemetryCache.get(key).event !== 'logout');
      return {
        nick: p.nick,
        platform: p.platform || 'MC',
        lives: Math.max(0, Math.min(5, lives)),
        max_lives: 5,
        isEliminated: lives <= 0,
        isOnline,
        last_death_at: liveEntry ? liveEntry.last_death_at : (msgEntry ? msgEntry.last_death_at : null)
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

// ═══════════════════════════════════════════════════════════════
//  SISTEMA DE TICKETS / DENÚNCIAS
// ═══════════════════════════════════════════════════════════════

// GET /api/tickets — lista tickets do usuário logado (admin vê todos)
app.get('/api/tickets', requireAuth, async (req, res) => {
  try {
    let query = supabase.from('tickets').select('*').order('created_at', { ascending: false });
    if (!req.isAdmin) {
      query = query.eq('user_id', req.user.id || req.user.nick);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ tickets: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tickets — abre novo ticket
app.post('/api/tickets', requireAuth, async (req, res) => {
  try {
    const { titulo, descricao, denunciado } = req.body;
    if (!titulo || !descricao) return res.status(400).json({ error: 'Título e descrição são obrigatórios.' });
    const userId = req.user.id || req.user.nick;
    // verifica se já tem ticket aberto
    const { data: existing } = await supabase.from('tickets')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'aberto')
      .limit(1);
    if (existing && existing.length > 0) {
      return res.status(400).json({ error: 'Você já tem um ticket aberto. Aguarde o admin responder ou fechar o atual.' });
    }
    const { data, error } = await supabase.from('tickets').insert([{
      user_nick: req.user.nick,
      user_id: userId,
      tipo: 'denuncia',
      titulo: titulo.trim().slice(0, 120),
      descricao: descricao.trim().slice(0, 2000),
      denunciado: (denunciado || '').trim().slice(0, 50) || null,
      status: 'aberto'
    }]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, ticket: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tickets/:id — detalhes + mensagens do ticket
app.get('/api/tickets/:id', requireAuth, async (req, res) => {
  try {
    const { data: ticket, error } = await supabase.from('tickets')
      .select('*').eq('id', req.params.id).single();
    if (error || !ticket) return res.status(404).json({ error: 'Ticket não encontrado.' });
    const userId = req.user.id || req.user.nick;
    if (!req.isAdmin && ticket.user_id !== userId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    const { data: messages } = await supabase.from('ticket_messages')
      .select('*').eq('ticket_id', ticket.id).order('created_at', { ascending: true });
    res.json({ ticket, messages: messages || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tickets/:id/messages — enviar mensagem no ticket
app.post('/api/tickets/:id/messages', requireAuth, async (req, res) => {
  try {
    const { mensagem } = req.body;
    if (!mensagem || !mensagem.trim()) return res.status(400).json({ error: 'Mensagem vazia.' });
    const { data: ticket, error: tErr } = await supabase.from('tickets')
      .select('id, user_id, status').eq('id', req.params.id).single();
    if (tErr || !ticket) return res.status(404).json({ error: 'Ticket não encontrado.' });
    if (ticket.status === 'fechado') return res.status(400).json({ error: 'Ticket já foi fechado.' });
    const userId = req.user.id || req.user.nick;
    if (!req.isAdmin && ticket.user_id !== userId) {
      return res.status(403).json({ error: 'Acesso negado.' });
    }
    const { data, error } = await supabase.from('ticket_messages').insert([{
      ticket_id: ticket.id,
      autor_nick: req.user.nick,
      is_admin: req.isAdmin || false,
      mensagem: mensagem.trim().slice(0, 1000)
    }]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    // atualiza updated_at do ticket
    await supabase.from('tickets').update({ updated_at: new Date().toISOString() }).eq('id', ticket.id);
    res.json({ success: true, message: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tickets/:id — fecha e apaga ticket (somente admin)
app.delete('/api/tickets/:id', requireAdmin, async (req, res) => {
  try {
    const { data: ticket, error: tErr } = await supabase.from('tickets')
      .select('id').eq('id', req.params.id).single();
    if (tErr || !ticket) return res.status(404).json({ error: 'Ticket não encontrado.' });
    // ON DELETE CASCADE apaga ticket_messages automaticamente
    const { error } = await supabase.from('tickets').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, message: '✅ Ticket encerrado e excluído com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  SISTEMA DE REINOS & GUILDAS (ECONÔMICO & TEMPO REAL)
// ════════════════════════════════════════════════════════════════════════════

// Inicializa cache de reinos na inicialização do servidor
syncKingdomsCache(true).catch(() => {});

// Salva o snapshot inicial de estatísticas quando um membro entra no reino
async function salvarBaselineMembroReino(nick, kingdomId) {
  try {
    const clean = (nick || '').toLowerCase().trim();
    const { data: rank } = await supabase.from('player_rankings').select('playtime_seconds').ilike('nick', clean).maybeSingle();
    const { data: telem } = await supabase.from('messages').select('content').ilike('author_nick', clean).eq('author_role', 'telemetry').order('created_at', { ascending: false }).limit(1).maybeSingle();

    let initSec = rank ? (Number(rank.playtime_seconds) || 0) : 0;
    let initPk = 0, initMk = 0;
    if (telem && telem.content) {
      try {
        const j = JSON.parse(telem.content);
        initSec = Math.max(initSec, Number(j.playtimeSeconds) || 0);
        initPk = Number(j.playerKills) || 0;
        initMk = Number(j.mobKills) || 0;
      } catch (_) {}
    }

    // Remove baseline anterior se existisse
    await safeDb(
      supabase.from('messages')
        .delete()
        .eq('author_role', 'kingdom_member_baseline')
        .ilike('author_nick', clean)
    );

    // Registra baseline de entrada no reino
    await supabase.from('messages').insert([{
      author_nick: nick,
      author_role: 'kingdom_member_baseline',
      content: JSON.stringify({
        kingdom_id: kingdomId,
        initialPlaytime: initSec,
        initialPvp: initPk,
        initialMob: initMk,
        joined_at: new Date().toISOString()
      }),
      created_at: new Date().toISOString()
    }]);
  } catch (err) {
    console.error('Erro ao salvar baseline de membro:', err);
  }
}

// GET /api/kingdoms/status — Obter status do usuário (permissão de criação, reino atual, membro)
app.get('/api/kingdoms/status', requireAuth, async (req, res) => {
  try {
    const nick = (req.user.nick || '').trim();
    const lowerNick = nick.toLowerCase();

    // 1. Verifica se tem permissão do Administrador para criar GRATUITAMENTE (sem pagar taxa)
    let hasFreePermission = !!req.isAdmin;

    if (!hasFreePermission) {
      const { data: perm } = await supabase
        .from('kingdom_permissions')
        .select('allowed')
        .ilike('user_nick', nick)
        .maybeSingle();
      if (perm && perm.allowed) hasFreePermission = true;
    }

    // Qualquer jogador pode criar pagando pelo Mercado Pago, a menos que já tenha reino ou limite atingido
    const isAllowedToCreate = true;

    // 2. Busca convites pendentes recebidos por este jogador (com fallback seguro se a tabela ainda não existir no Supabase)
    let myInvites = [];
    try {
      const { data: invData, error: invErr } = await supabase
        .from('kingdom_invites')
        .select('id, kingdom_id, invited_by, created_at, kingdoms ( * )')
        .ilike('invited_nick', nick)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (!invErr && invData) myInvites = invData;
    } catch (_) {
      myInvites = [];
    }

    // 3. Busca reino atual do jogador
    const { data: member } = await supabase
      .from('kingdom_members')
      .select('role, kingdom_id, kingdoms ( * )')
      .ilike('user_nick', nick)
      .maybeSingle();

    let myKingdom = null;
    let members = [];
    let candidates = [];
    let sentInvites = [];

    if (member && member.kingdoms) {
      myKingdom = {
        ...member.kingdoms,
        myRole: member.role
      };
      // Busca membros do reino
      const { data: mList } = await supabase
        .from('kingdom_members')
        .select('id, user_nick, role, joined_at')
        .eq('kingdom_id', member.kingdom_id)
        .order('joined_at', { ascending: true });

      const isLiderOrAdmin = (member.role === 'lider' || req.isAdmin);

      if (isLiderOrAdmin && mList && mList.length > 0) {
        // Apenas o líder e admin recebem os dados detalhados do que cada membro fez enquanto esteve no reino
        const { data: baselines } = await supabase
          .from('messages')
          .select('author_nick, content')
          .eq('author_role', 'kingdom_member_baseline');

        const baselineMap = new Map();
        (baselines || []).forEach(b => {
          try {
            const j = JSON.parse(b.content);
            if (j.kingdom_id === member.kingdom_id) {
              baselineMap.set((b.author_nick || '').toLowerCase().trim(), j);
            }
          } catch (_) {}
        });

        const { data: rankRows } = await supabase
          .from('player_rankings')
          .select('nick, playtime_seconds');

        const { data: dbTelemetry } = await supabase
          .from('messages')
          .select('author_nick, content, created_at')
          .eq('author_role', 'telemetry')
          .order('created_at', { ascending: false });

        const playtimeMap = new Map();
        const pvpMap = new Map();
        const mobMap = new Map();
        const lastSeenMap = new Map();

        (rankRows || []).forEach(r => {
          const k = (r.nick || '').toLowerCase().trim();
          const sec = Number(r.playtime_seconds) || 0;
          playtimeMap.set(k, Math.max(playtimeMap.get(k) || 0, sec));
        });

        (dbTelemetry || []).forEach(t => {
          const k = (t.author_nick || '').toLowerCase().trim();
          try {
            const j = JSON.parse(t.content);
            const sec = Number(j.playtimeSeconds) || 0;
            if (sec > 0) playtimeMap.set(k, Math.max(playtimeMap.get(k) || 0, sec));
            const pk = Number(j.playerKills) || 0;
            if (pk > 0) pvpMap.set(k, Math.max(pvpMap.get(k) || 0, pk));
            const mk = Number(j.mobKills) || 0;
            if (mk > 0) mobMap.set(k, Math.max(mobMap.get(k) || 0, mk));
            if (!lastSeenMap.has(k) && t.created_at) {
              lastSeenMap.set(k, new Date(t.created_at).getTime());
            }
          } catch (_) {}
        });

        const { data: msgRows } = await supabase
          .from('kingdom_messages')
          .select('author_nick')
          .eq('kingdom_id', member.kingdom_id);

        const msgCountMap = new Map();
        (msgRows || []).forEach(mr => {
          const k = (mr.author_nick || '').toLowerCase().trim();
          msgCountMap.set(k, (msgCountMap.get(k) || 0) + 1);
        });

        const now = Date.now();
        members = mList.map(m => {
          const k = (m.user_nick || '').toLowerCase().trim();
          const clean = k.replace(/^[._]/, '');
          const curSec = Math.max(playtimeMap.get(k) || 0, playtimeMap.get(clean) || 0);
          const curPvp = Math.max(pvpMap.get(k) || 0, pvpMap.get(clean) || 0);
          const curMob = Math.max(mobMap.get(k) || 0, mobMap.get(clean) || 0);
          const base = baselineMap.get(k) || baselineMap.get(clean);

          // Subtrai o baseline inicial: conta exatamente o que foi feito enquanto esteve no reino
          const kSec = base ? Math.max(0, curSec - (Number(base.initialPlaytime) || 0)) : curSec;
          const kPvp = base ? Math.max(0, curPvp - (Number(base.initialPvp) || 0)) : curPvp;
          const kMob = base ? Math.max(0, curMob - (Number(base.initialMob) || 0)) : curMob;
          const kTotalKills = kPvp + kMob;
          const kPoints = (kPvp * 50) + (kMob * 1) + Math.floor(kSec / 360);

          let playtimeFormatted = '0m';
          const hrs = Math.floor(kSec / 3600);
          const mins = Math.floor((kSec % 3600) / 60);
          if (hrs > 0) {
            playtimeFormatted = `${hrs}h ${mins}m`;
          } else {
            playtimeFormatted = `${mins}m`;
          }

          const lastSeen = Math.max(lastSeenMap.get(k) || 0, lastSeenMap.get(clean) || 0);
          const isOnline = (now - lastSeen < 60000);

          return {
            ...m,
            stats: {
              playtimeSeconds: kSec,
              playtimeFormatted,
              pvpKills: kPvp,
              mobKills: kMob,
              totalKills: kTotalKills,
              pointsGenerated: kPoints,
              messagesCount: msgCountMap.get(k) || 0,
              isOnline
            }
          };
        });
      } else {
        // Membro comum: não recebe dados de produtividade privada
        members = mList || [];
      }

      // Se for líder ou admin, busca jogadores com Whitelist aprovada para convidar
      if (member.role === 'lider' || req.isAdmin) {
        const { data: appPlayers } = await supabase
          .from('players')
          .select('nick, platform')
          .eq('status', 'approved')
          .order('nick', { ascending: true });

        // Busca todos que já têm reino
        const { data: allMembers } = await supabase
          .from('kingdom_members')
          .select('user_nick');

        const memberNicksSet = new Set((allMembers || []).map(m => (m.user_nick || '').toLowerCase().trim()));

        // Busca convites pendentes já enviados por este reino (com fallback seguro)
        try {
          const { data: outInvites, error: outErr } = await supabase
            .from('kingdom_invites')
            .select('id, invited_nick, created_at')
            .eq('kingdom_id', member.kingdom_id)
            .eq('status', 'pending');
          if (!outErr && outInvites) sentInvites = outInvites;
        } catch (_) {
          sentInvites = [];
        }

        const pendingNicksSet = new Set(sentInvites.map(i => (i.invited_nick || '').toLowerCase().trim()));

        // Candidatos elegíveis: aprovados na whitelist que NÃO têm reino
        candidates = (appPlayers || [])
          .filter(p => {
            const low = (p.nick || '').toLowerCase().trim();
            return !memberNicksSet.has(low);
          })
          .map(p => ({
            nick: p.nick,
            platform: p.platform,
            isInvited: pendingNicksSet.has((p.nick || '').toLowerCase().trim())
          }));
      }

      // Informações detalhadas da assinatura/plano do reino
      const expiresAt = myKingdom.subscription_expires_at ? new Date(myKingdom.subscription_expires_at) : null;
      const nowMs = Date.now();
      const isExpired = expiresAt ? (expiresAt.getTime() < nowMs) : false;
      const daysRemaining = expiresAt ? Math.max(0, Math.ceil((expiresAt.getTime() - nowMs) / (1000 * 60 * 60 * 24))) : 0;
      const monthsRemaining = (daysRemaining / 30).toFixed(1);

      myKingdom.subscription = {
        status: myKingdom.subscription_status || (isExpired ? 'expired' : 'active'),
        expiresAt: myKingdom.subscription_expires_at,
        renewedAt: myKingdom.subscription_renewed_at,
        isExpired,
        daysRemaining,
        monthsRemaining: Number(monthsRemaining),
        formattedExpiresAt: expiresAt ? expiresAt.toLocaleDateString('pt-BR') : 'Indeterminado'
      };
    }

    // 4. Busca reinos existentes para calcular limite (máx 12) e listas de logos/cores já em uso
    let totalKingdoms = 0;
    let usedLogos = [];
    let usedColors = [];
    try {
      const { data: allKingdomsList } = await supabase
        .from('kingdoms')
        .select('id, logo, cor');
      if (allKingdomsList) {
        totalKingdoms = allKingdomsList.length;
        usedLogos = allKingdomsList.map(k => k.logo).filter(Boolean);
        usedColors = allKingdomsList.map(k => (k.cor || '').toLowerCase()).filter(Boolean);
      }
    } catch (_) {}

    const maxKingdoms = 12;
    const isLimitReached = totalKingdoms >= maxKingdoms;

    res.json({
      success: true,
      allowedToCreate: isAllowedToCreate,
      hasFreePermission,
      totalKingdoms,
      maxKingdoms,
      isLimitReached,
      usedLogos,
      usedColors,
      myKingdom,
      members,
      candidates,
      myInvites: myInvites || [],
      sentInvites,
      taxaCriacao: 19.99,
      taxaMensal: 19.99
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MERCADO PAGO: Iniciar pagamento para criação de reino ────────────────────
app.post('/api/kingdoms/payment/initiate', requireAuth, async (req, res) => {
  try {
    const nick = (req.user.nick || '').trim();

    // Verifica se já está num reino
    const { data: existing } = await supabase
      .from('kingdom_members').select('kingdom_id').ilike('user_nick', nick).maybeSingle();
    if (existing) return res.status(400).json({ error: 'Você já pertence a um reino.' });

    const { nome, tag, logo, cor, descricao } = req.body || {};
    if (!nome || !tag || !descricao) return res.status(400).json({ error: 'Nome, TAG e descrição são obrigatórios.' });

    const trimmedNome = (nome || '').trim();
    if (trimmedNome.length > 16) {
      return res.status(400).json({ error: 'O nome do reino/clã deve ter no máximo 16 caracteres.' });
    }
    const cleanNome = trimmedNome.substring(0, 16);
    const cleanTag  = (tag  || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 3);
    const cleanLogo = (logo || '👑').trim();
    let   cleanCor  = (cor  || '#f59e0b').trim();
    const cleanDesc = (descricao || '').trim().substring(0, 300);
    if (cleanTag.length !== 3) return res.status(400).json({ error: 'TAG deve ter exatamente 3 letras.' });
    if (!/^#[0-9A-Fa-f]{6}$/.test(cleanCor)) cleanCor = '#f59e0b';

    // Verifica duplicatas
    const { data: dup } = await supabase.from('kingdoms').select('id').or(`nome.ilike.${cleanNome},tag.ilike.${cleanTag}`).maybeSingle();
    if (dup) return res.status(400).json({ error: 'Já existe um Reino com esse Nome ou TAG.' });

    // Remove pagamentos pendentes anteriores deste nick
    await safeDb(supabase.from('kingdom_pending_payments').delete().ilike('owner_nick', nick).eq('status', 'pending'));

    // ID único e exclusivo desta tentativa de pagamento
    const pendingId = crypto.randomUUID();

    // Cria preferência no Mercado Pago com external_reference vinculada ao ID único
    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
      body: JSON.stringify({
        items: [{ title: `Assinatura de Reino [${cleanTag}] ${cleanNome} - 5DAY MC`, quantity: 1, currency_id: 'BRL', unit_price: SUBSCRIPTION_PRICE }],
        external_reference: pendingId,
        back_urls: {
          success: `${SITE_URL}/#criar-reinos`,
          failure: `${SITE_URL}/#criar-reinos`,
          pending: `${SITE_URL}/#criar-reinos`
        },
        notification_url: `${SITE_URL}/api/mercadopago/webhook`,
        auto_return: 'approved',
        statement_descriptor: '5DAY MC'
      })
    });

    if (!mpRes.ok) {
      const txt = await mpRes.text();
      console.error('[MP] Erro ao criar preferência:', txt);
      return res.status(500).json({ error: 'Erro ao gerar link de pagamento. Tente novamente.' });
    }

    const mpData = await mpRes.json();

    // Salva pagamento pendente com o ID único
    const { data: pending } = await supabase.from('kingdom_pending_payments').insert([{
      id: pendingId,
      owner_nick: nick, mp_preference_id: mpData.id,
      nome: cleanNome, tag: cleanTag, logo: cleanLogo, cor: cleanCor, descricao: cleanDesc,
      status: 'pending', amount: SUBSCRIPTION_PRICE
    }]).select().single();

    res.json({ success: true, preferenceId: mpData.id, paymentUrl: mpData.init_point, pendingId: pending?.id || pendingId });
  } catch (err) {
    console.error('[MP initiate]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── MERCADO PAGO: Webhook de confirmação de pagamento ───────────────────────
app.post('/api/mercadopago/webhook', async (req, res) => {
  res.status(200).send('OK'); // Responde imediatamente para o MP não retentar

  try {
    const { type, data } = req.body || {};
    if (type !== 'payment' || !data?.id) return;

    // Consulta detalhes do pagamento no MP
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
    });
    if (!mpRes.ok) return;
    const payment = await mpRes.json();
    if (payment.status !== 'approved') return;

    const preferenceId = payment.preference_id;
    const externalRef  = payment.external_reference;
    const paymentId    = String(data.id);

    // CASO 1: Criação de reino (kingdom_pending_payments)
    let pending = null;
    if (externalRef) {
      const { data: p } = await supabase
        .from('kingdom_pending_payments').select('*')
        .eq('id', externalRef).eq('status', 'pending').maybeSingle();
      if (p) pending = p;
    }
    if (!pending && preferenceId) {
      const { data: p } = await supabase
        .from('kingdom_pending_payments').select('*')
        .eq('mp_preference_id', preferenceId).eq('status', 'pending').maybeSingle();
      if (p) pending = p;
    }

    if (pending) {
      const expiresAt = new Date(Date.now() + SUBSCRIPTION_DAYS * 86400000).toISOString();
      const insertPayload = {
        nome: pending.nome, tag: pending.tag, descricao: pending.descricao,
        owner_nick: pending.owner_nick, taxa_paga: SUBSCRIPTION_PRICE,
        pontos: 0, kills: 0, logo: pending.logo, cor: pending.cor,
        subscription_status: 'active',
        subscription_expires_at: expiresAt,
        subscription_renewed_at: new Date().toISOString()
      };

      const { data: newKingdom, error: kErr } = await supabase.from('kingdoms').insert([insertPayload]).select().single();
      if (kErr) { console.error('[MP Webhook] Erro ao criar reino:', kErr); return; }

      await supabase.from('kingdom_members').insert([{ kingdom_id: newKingdom.id, user_nick: pending.owner_nick, role: 'lider' }]);
      await salvarBaselineMembroReino(pending.owner_nick, newKingdom.id);
      await supabase.from('kingdom_messages').insert([{ kingdom_id: newKingdom.id, author_nick: 'Sistema', author_role: 'system', content: `🏰 Reino [${pending.tag}] ${pending.nome} fundado por ${pending.owner_nick}! Plano ativo até ${new Date(expiresAt).toLocaleDateString('pt-BR')}.` }]);
      await supabase.from('kingdom_payments').insert([{ kingdom_id: newKingdom.id, owner_nick: pending.owner_nick, mp_payment_id: paymentId, mp_preference_id: preferenceId || pending.mp_preference_id, status: 'approved', amount: SUBSCRIPTION_PRICE, tipo: 'assinatura' }]);
      await supabase.from('kingdom_pending_payments').update({ status: 'approved', mp_payment_id: paymentId }).eq('id', pending.id);
      syncKingdomsCache(true).catch(() => {});
      console.log(`✅ [MP] Reino [${pending.tag}] criado para ${pending.owner_nick} após pagamento ${paymentId}`);
      return;
    }

    // CASO 2: Renovação de plano (kingdom_payments com status pending)
    const { data: renewRec } = await supabase
      .from('kingdom_payments').select('kingdom_id, owner_nick')
      .eq('mp_preference_id', preferenceId).eq('status', 'pending').maybeSingle();

    if (renewRec) {
      const { data: kingdom } = await supabase.from('kingdoms').select('subscription_expires_at').eq('id', renewRec.kingdom_id).single();
      const currentExpiry = kingdom?.subscription_expires_at ? new Date(kingdom.subscription_expires_at) : new Date();
      const base = currentExpiry > new Date() ? currentExpiry : new Date();
      const newExpiry = new Date(base.getTime() + SUBSCRIPTION_DAYS * 86400000).toISOString();

      await supabase.from('kingdoms').update({
        subscription_status: 'active',
        subscription_expires_at: newExpiry,
        subscription_renewed_at: new Date().toISOString()
      }).eq('id', renewRec.kingdom_id);

      await supabase.from('kingdom_payments').update({ status: 'approved', mp_payment_id: paymentId }).eq('mp_preference_id', preferenceId);
      await supabase.from('kingdom_messages').insert([{ kingdom_id: renewRec.kingdom_id, author_nick: 'Sistema', author_role: 'system', content: `✅ Plano do Reino renovado! Válido até ${new Date(newExpiry).toLocaleDateString('pt-BR')}.` }]);
      syncKingdomsCache(true).catch(() => {});
      console.log(`✅ [MP] Reino renovado para ${renewRec.owner_nick} até ${newExpiry}`);
      return;
    }

    // CASO 3: Perfil VIP (Foto & Moldura de Minecraft)
    let profilePending = null;
    if (externalRef) {
      const { data: pp } = await supabase
        .from('profile_pending_payments').select('*')
        .eq('id', externalRef).eq('status', 'pending').maybeSingle();
      if (pp) profilePending = pp;
    }
    if (!profilePending && preferenceId) {
      const { data: pp } = await supabase
        .from('profile_pending_payments').select('*')
        .eq('mp_preference_id', preferenceId).eq('status', 'pending').maybeSingle();
      if (pp) profilePending = pp;
    }

    if (profilePending) {
      const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
      await supabase.from('user_vip_profiles').upsert([{
        user_nick: profilePending.user_nick,
        avatar_url: profilePending.avatar_url,
        frame_id: profilePending.frame_id,
        status: 'active',
        expires_at: expiresAt,
        renewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }], { onConflict: 'user_nick' });

      await supabase.from('profile_payments').insert([{
        user_nick: profilePending.user_nick,
        mp_payment_id: paymentId,
        mp_preference_id: preferenceId || profilePending.mp_preference_id,
        frame_id: profilePending.frame_id,
        status: 'approved',
        amount: PROFILE_VIP_PRICE,
        tipo: 'assinatura'
      }]);

      await supabase.from('profile_pending_payments').update({
        status: 'approved',
        mp_payment_id: paymentId
      }).eq('id', profilePending.id);

      syncVipProfilesCache(true).catch(() => {});
      console.log(`✨ [MP] Perfil VIP ativado para ${profilePending.user_nick} após pagamento ${paymentId}`);
      return;
    }
  } catch (err) {
    console.error('[MP Webhook] Erro:', err);
  }
});

// ── MERCADO PAGO: Poll de status do pagamento pendente ───────────────────────
app.get('/api/kingdoms/payment/status', requireAuth, async (req, res) => {
  try {
    const nick = (req.user.nick || '').trim();
    const { preferenceId } = req.query;
    if (!preferenceId) return res.status(400).json({ error: 'preferenceId obrigatório.' });

    // 1. Busca registro local
    let { data: pending } = await supabase
      .from('kingdom_pending_payments').select('*')
      .eq('mp_preference_id', preferenceId).ilike('owner_nick', nick).maybeSingle();

    if (!pending) {
      const { data: altPending } = await supabase
        .from('kingdom_pending_payments').select('*')
        .eq('mp_preference_id', preferenceId).maybeSingle();
      if (altPending) pending = altPending;
    }

    if (!pending) return res.status(404).json({ error: 'Pagamento não encontrado.' });

    // Se já estiver aprovado no banco, retorna imediatamente
    if (pending.status === 'approved') {
      return res.json({ status: 'approved', nome: pending.nome, tag: pending.tag });
    }

    // 2. Se ainda estiver pendente, consulta a API do Mercado Pago diretamente!
    try {
      let approvedPayment = null;

      // 2.1 Busca por external_reference (ID exclusivo gerado nesta tentativa)
      const mpExtRes = await fetch(`https://api.mercadopago.com/v1/payments/search?external_reference=${pending.id}&sort=date_created&criteria=desc`, {
        headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
      });
      if (mpExtRes.ok) {
        const extData = await mpExtRes.json();
        const payments = extData.results || [];
        approvedPayment = payments.find(p => p.status === 'approved');
      }

      // 2.2 Se não encontrou por external_reference, busca por preference_id
      if (!approvedPayment) {
        const mpSearchRes = await fetch(`https://api.mercadopago.com/v1/payments/search?preference_id=${preferenceId}&sort=date_created&criteria=desc`, {
          headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
        });
        if (mpSearchRes.ok) {
          const mpSearchData = await mpSearchRes.json();
          const payments = mpSearchData.results || [];
          approvedPayment = payments.find(p => p.status === 'approved');
        }
      }

      // 2.3 Fallback ULTRA-ESTRITO (Proteção contra reuso de pagamentos antigos ou não pagos)
      if (!approvedPayment) {
        const pendingCreated = new Date(pending.created_at).getTime();
        const mpRecentRes = await fetch(`https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&limit=10`, {
          headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
        });

        if (mpRecentRes.ok) {
          const recentData = await mpRecentRes.json();
          const recentList = recentData.results || [];

          for (const p of recentList) {
            if (p.status !== 'approved') continue;

            // REGRA 1: O pagamento DEVE ter sido criado DEPOIS do pedido pendente (bloqueia pagamentos de minutos/horas atrás)
            const payTime = new Date(p.date_created || p.date_approved).getTime();
            if (payTime < pendingCreated - 30000) continue;

            // REGRA 2: O pagamento NUNCA pode ter sido registrado antes em kingdom_payments
            const { data: alreadyUsed } = await supabase
              .from('kingdom_payments')
              .select('id')
              .eq('mp_payment_id', String(p.id))
              .maybeSingle();
            if (alreadyUsed) continue;

            // REGRA 3: O pagamento não pode já ter sido consumido por outro registro pendente
            const { data: alreadyPending } = await supabase
              .from('kingdom_pending_payments')
              .select('id')
              .eq('mp_payment_id', String(p.id))
              .neq('id', pending.id)
              .maybeSingle();
            if (alreadyPending) continue;

            // REGRA 4: Validação da TAG exata entre colchetes no título
            const desc = (p.description || '').toLowerCase();
            const tagExact = `[${pending.tag.toLowerCase()}]`;
            const matchesRef = p.external_reference === pending.id;
            const matchesDesc = desc.includes(tagExact);

            if (matchesRef || matchesDesc) {
              approvedPayment = p;
              break;
            }
          }
        }
      }

      if (approvedPayment) {
        const paymentId = String(approvedPayment.id);
        const expiresAt = new Date(Date.now() + SUBSCRIPTION_DAYS * 86400000).toISOString();

        // Verifica se o reino já foi criado
        const { data: existingK } = await supabase.from('kingdoms').select('id').or(`nome.ilike.${pending.nome},tag.ilike.${pending.tag}`).maybeSingle();
        let kingdomId = existingK?.id;

        if (!kingdomId) {
          const insertPayload = {
            nome: pending.nome, tag: pending.tag, descricao: pending.descricao,
            owner_nick: pending.owner_nick, taxa_paga: SUBSCRIPTION_PRICE,
            pontos: 0, kills: 0, logo: pending.logo, cor: pending.cor,
            subscription_status: 'active',
            subscription_expires_at: expiresAt,
            subscription_renewed_at: new Date().toISOString()
          };

          const { data: newKingdom } = await supabase.from('kingdoms').insert([insertPayload]).select().single();
          if (newKingdom) {
            kingdomId = newKingdom.id;
            await supabase.from('kingdom_members').insert([{ kingdom_id: kingdomId, user_nick: pending.owner_nick, role: 'lider' }]);
            await salvarBaselineMembroReino(pending.owner_nick, kingdomId);
            await supabase.from('kingdom_messages').insert([{ kingdom_id: kingdomId, author_nick: 'Sistema', author_role: 'system', content: `🏰 Reino [${pending.tag}] ${pending.nome} fundado por ${pending.owner_nick}! Plano ativo até ${new Date(expiresAt).toLocaleDateString('pt-BR')}.` }]);
            await supabase.from('kingdom_payments').insert([{ kingdom_id: kingdomId, owner_nick: pending.owner_nick, mp_payment_id: paymentId, mp_preference_id: preferenceId, status: 'approved', amount: SUBSCRIPTION_PRICE, tipo: 'assinatura' }]);
          }
        }

        await supabase.from('kingdom_pending_payments').update({ status: 'approved', mp_payment_id: paymentId }).eq('id', pending.id);
        syncKingdomsCache(true).catch(() => {});

        return res.json({ status: 'approved', nome: pending.nome, tag: pending.tag });
      }
    } catch (mpErr) {
      console.warn('[MP direct check warn]', mpErr.message);
    }

    res.json({ status: pending.status, nome: pending.nome, tag: pending.tag });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MERCADO PAGO: Renovar plano do reino (Líder ou Admin) ───────────────────
app.post('/api/kingdoms/payment/renew', requireAuth, async (req, res) => {
  try {
    const nick = (req.user.nick || '').trim();

    const { data: myMember } = await supabase
      .from('kingdom_members').select('kingdom_id, role, kingdoms(id, nome, tag, subscription_expires_at)')
      .ilike('user_nick', nick).maybeSingle();

    if (!myMember || (myMember.role !== 'lider' && !req.isAdmin)) {
      return res.status(403).json({ error: 'Apenas o líder pode renovar o plano.' });
    }

    const kingdom = myMember.kingdoms;
    const expiry = kingdom?.subscription_expires_at ? new Date(kingdom.subscription_expires_at) : new Date();
    const expLabel = expiry.toLocaleDateString('pt-BR');

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
      body: JSON.stringify({
        items: [{ title: `Renovação do Reino [${kingdom.tag}] ${kingdom.nome} - 5DAY MC`, quantity: 1, currency_id: 'BRL', unit_price: SUBSCRIPTION_PRICE }],
        back_urls: { success: `${SITE_URL}/#criar-reinos`, failure: `${SITE_URL}/#criar-reinos`, pending: `${SITE_URL}/#criar-reinos` },
        notification_url: `${SITE_URL}/api/mercadopago/webhook`,
        auto_return: 'approved',
        statement_descriptor: '5DAY MC'
      })
    });

    if (!mpRes.ok) return res.status(500).json({ error: 'Erro ao gerar link de renovação.' });
    const mpData = await mpRes.json();

    await supabase.from('kingdom_payments').insert([{
      kingdom_id: myMember.kingdom_id, owner_nick: nick,
      mp_preference_id: mpData.id, status: 'pending',
      amount: SUBSCRIPTION_PRICE, tipo: 'renovacao'
    }]);

    res.json({ success: true, paymentUrl: mpData.init_point, preferenceId: mpData.id, currentExpiry: expLabel });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN: Renovar plano manualmente (sem pagamento) ────────────────────────
app.post('/api/admin/kingdoms/renew-manual', requireAdmin, async (req, res) => {
  try {
    const { kingdomId, days } = req.body;
    if (!kingdomId) return res.status(400).json({ error: 'kingdomId obrigatório.' });
    const extraDays = Math.max(1, Math.min(Number(days) || 30, 365));

    const { data: kingdom } = await supabase.from('kingdoms').select('subscription_expires_at, nome, tag').eq('id', kingdomId).single();
    if (!kingdom) return res.status(404).json({ error: 'Reino não encontrado.' });

    const base = kingdom.subscription_expires_at && new Date(kingdom.subscription_expires_at) > new Date()
      ? new Date(kingdom.subscription_expires_at) : new Date();
    const newExpiry = new Date(base.getTime() + extraDays * 86400000).toISOString();

    await supabase.from('kingdoms').update({
      subscription_status: 'active',
      subscription_expires_at: newExpiry,
      subscription_renewed_at: new Date().toISOString()
    }).eq('id', kingdomId);

    await supabase.from('kingdom_messages').insert([{ kingdom_id: kingdomId, author_nick: 'Admin', author_role: 'system', content: `🛡️ Plano do Reino renovado pelo Administrador por +${extraDays} dias. Válido até ${new Date(newExpiry).toLocaleDateString('pt-BR')}.` }]);
    syncKingdomsCache(true).catch(() => {});
    res.json({ success: true, newExpiry, message: `Plano do reino [${kingdom.tag}] renovado por +${extraDays} dias.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── ROTAS DE PERFIL VIP (Foto de Perfil até 3MB & Molduras Minecraft) ─────────
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/profile/vip — Consulta status VIP do jogador logado
app.get('/api/profile/vip', requireAuth, async (req, res) => {
  try {
    const nick = (req.user.nick || '').trim();
    await syncVipProfilesCache();
    const lowerNick = nick.toLowerCase();
    const vip = vipProfilesCache.get(lowerNick);

    const { data: profile } = await supabase
      .from('user_vip_profiles')
      .select('*')
      .ilike('user_nick', nick)
      .maybeSingle();

    const isVip = !!(vip && vip.status === 'active');
    const now = Date.now();
    let daysRemaining = 0;
    if (profile?.expires_at) {
      const expTime = new Date(profile.expires_at).getTime();
      daysRemaining = Math.max(0, Math.ceil((expTime - now) / (1000 * 60 * 60 * 24)));
    }

    res.json({
      success: true,
      is_vip: isVip,
      avatar_url: profile?.avatar_url || null,
      frame_id: profile?.frame_id || 'portal_nether',
      status: profile?.status || 'inactive',
      expires_at: profile?.expires_at || null,
      days_remaining: daysRemaining,
      price: PROFILE_VIP_PRICE
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile/vip/create-payment — Iniciar assinatura VIP de R$ 9,99/mês
app.post('/api/profile/vip/create-payment', requireAuth, async (req, res) => {
  try {
    const nick = (req.user.nick || '').trim();
    if (!nick) return res.status(401).json({ error: 'Não autorizado.' });

    const rawAvatar = req.body.avatar_url || req.body.avatar_data || null;
    const { frame_id } = req.body || {};
    const chosenFrame = VALID_VIP_FRAMES.includes(frame_id) ? frame_id : 'portal_nether';

    // Validação da imagem (máximo 3MB / ~4.5MB base64)
    if (rawAvatar && typeof rawAvatar === 'string') {
      if (rawAvatar.length > 4.5 * 1024 * 1024) {
        return res.status(400).json({ error: 'A foto de perfil excede o limite máximo permitido de 3MB.' });
      }
    }

    // Remove pagamentos pendentes anteriores deste nick
    await safeDb(supabase.from('profile_pending_payments').delete().ilike('user_nick', nick).eq('status', 'pending'));

    const pendingId = crypto.randomUUID();

    // Cria preferência no Mercado Pago (R$ 9,99)
    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
      body: JSON.stringify({
        items: [{
          title: `Perfil VIP (Foto & Moldura Minecraft) - 5DAY MC`,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: PROFILE_VIP_PRICE
        }],
        external_reference: pendingId,
        back_urls: {
          success: `${SITE_URL}/#geral`,
          failure: `${SITE_URL}/#geral`,
          pending: `${SITE_URL}/#geral`
        },
        notification_url: `${SITE_URL}/api/mercadopago/webhook`,
        auto_return: 'approved',
        statement_descriptor: '5DAY MC'
      })
    });

    if (!mpRes.ok) {
      const txt = await mpRes.text();
      console.error('[MP VIP] Erro ao criar preferência:', txt);
      return res.status(500).json({ error: 'Erro ao gerar link de pagamento do Perfil VIP.' });
    }

    const mpData = await mpRes.json();

    // Salva o registro pendente
    const { data: pending } = await supabase.from('profile_pending_payments').insert([{
      id: pendingId,
      user_nick: nick,
      mp_preference_id: mpData.id,
      avatar_url: rawAvatar || null,
      frame_id: chosenFrame,
      status: 'pending',
      amount: PROFILE_VIP_PRICE
    }]).select().single();

    res.json({
      success: true,
      preferenceId: mpData.id,
      preference_id: mpData.id,
      paymentUrl: mpData.init_point,
      payment_url: mpData.init_point,
      pendingId: pending?.id || pendingId,
      pending_id: pending?.id || pendingId
    });
  } catch (err) {
    console.error('[MP VIP initiate]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/profile/vip/payment/status — Verificar se o pagamento do Perfil VIP foi aprovado
app.get('/api/profile/vip/payment/status', requireAuth, async (req, res) => {
  try {
    const nick = (req.user.nick || '').trim();
    const preferenceId = req.query.preferenceId || req.query.preference_id;
    if (!preferenceId) return res.status(400).json({ error: 'preferenceId obrigatório.' });

    let { data: pending } = await supabase
      .from('profile_pending_payments')
      .select('*')
      .eq('mp_preference_id', preferenceId)
      .ilike('user_nick', nick)
      .maybeSingle();

    if (!pending) {
      const { data: altPending } = await supabase
        .from('profile_pending_payments')
        .select('*')
        .eq('mp_preference_id', preferenceId)
        .maybeSingle();
      if (altPending) pending = altPending;
    }

    if (!pending) return res.status(404).json({ error: 'Pagamento não encontrado.' });

    if (pending.status === 'approved') {
      return res.json({ status: 'approved', avatar_url: pending.avatar_url, frame_id: pending.frame_id });
    }

    try {
      let approvedPayment = null;

      // 1. Busca por external_reference
      const mpExtRes = await fetch(`https://api.mercadopago.com/v1/payments/search?external_reference=${pending.id}&sort=date_created&criteria=desc`, {
        headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
      });
      if (mpExtRes.ok) {
        const extData = await mpExtRes.json();
        const payments = extData.results || [];
        approvedPayment = payments.find(p => p.status === 'approved');
      }

      // 2. Busca por preference_id
      if (!approvedPayment) {
        const mpSearchRes = await fetch(`https://api.mercadopago.com/v1/payments/search?preference_id=${preferenceId}&sort=date_created&criteria=desc`, {
          headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
        });
        if (mpSearchRes.ok) {
          const mpSearchData = await mpSearchRes.json();
          const payments = mpSearchData.results || [];
          approvedPayment = payments.find(p => p.status === 'approved');
        }
      }

      // 3. Fallback ultra-criterioso antifraude
      if (!approvedPayment) {
        const pendingCreated = new Date(pending.created_at).getTime();
        const mpRecentRes = await fetch(`https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&limit=10`, {
          headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
        });

        if (mpRecentRes.ok) {
          const recentData = await mpRecentRes.json();
          const recentList = recentData.results || [];

          for (const p of recentList) {
            if (p.status !== 'approved') continue;
            const payTime = new Date(p.date_created || p.date_approved).getTime();
            if (payTime < pendingCreated - 30000) continue;

            const { data: alreadyUsed } = await supabase
              .from('profile_payments')
              .select('id')
              .eq('mp_payment_id', String(p.id))
              .maybeSingle();
            if (alreadyUsed) continue;

            const matchesRef = p.external_reference === pending.id;
            const desc = (p.description || '').toLowerCase();
            const matchesDesc = desc.includes('perfil vip') && Math.abs(Number(p.transaction_amount) - PROFILE_VIP_PRICE) < 0.1;

            if (matchesRef || matchesDesc) {
              approvedPayment = p;
              break;
            }
          }
        }
      }

      if (approvedPayment) {
        const paymentId = String(approvedPayment.id);
        const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();

        await supabase.from('user_vip_profiles').upsert([{
          user_nick: pending.user_nick,
          avatar_url: pending.avatar_url,
          frame_id: pending.frame_id,
          status: 'active',
          expires_at: expiresAt,
          renewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }], { onConflict: 'user_nick' });

        await supabase.from('profile_payments').insert([{
          user_nick: pending.user_nick,
          mp_payment_id: paymentId,
          mp_preference_id: preferenceId || pending.mp_preference_id,
          frame_id: pending.frame_id,
          status: 'approved',
          amount: PROFILE_VIP_PRICE,
          tipo: 'assinatura'
        }]);

        await supabase.from('profile_pending_payments').update({
          status: 'approved',
          mp_payment_id: paymentId
        }).eq('id', pending.id);

        syncVipProfilesCache(true).catch(() => {});

        return res.json({ status: 'approved', avatar_url: pending.avatar_url, frame_id: pending.frame_id });
      }
    } catch (mpErr) {
      console.warn('[MP VIP check err]', mpErr.message);
    }

    res.json({ status: pending.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile/vip/update — Atualizar foto ou moldura (para quem já tem assinatura ativa)
app.post('/api/profile/vip/update', requireAuth, async (req, res) => {
  try {
    const nick = (req.user.nick || '').trim();
    const rawAvatar = req.body.avatar_url !== undefined ? req.body.avatar_url : req.body.avatar_data;
    const { frame_id } = req.body || {};

    const { data: profile } = await supabase
      .from('user_vip_profiles')
      .select('*')
      .ilike('user_nick', nick)
      .maybeSingle();

    const now = Date.now();
    const isVip = profile && profile.status === 'active' && (!profile.expires_at || new Date(profile.expires_at).getTime() > now);

    if (!isVip && !req.isAdmin) {
      return res.status(403).json({ error: 'Você precisa de uma assinatura VIP ativa para personalizar seu perfil.' });
    }

    if (rawAvatar && typeof rawAvatar === 'string') {
      if (rawAvatar.length > 4.5 * 1024 * 1024) {
        return res.status(400).json({ error: 'A foto excede o limite de 3MB.' });
      }
    }

    const updates = {
      updated_at: new Date().toISOString()
    };
    if (rawAvatar !== undefined) updates.avatar_url = rawAvatar;
    if (frame_id && VALID_VIP_FRAMES.includes(frame_id)) updates.frame_id = frame_id;

    const { error: upErr } = await supabase
      .from('user_vip_profiles')
      .update(updates)
      .ilike('user_nick', nick);

    if (upErr) return res.status(500).json({ error: upErr.message });

    syncVipProfilesCache(true).catch(() => {});
    res.json({ success: true, message: 'Perfil VIP atualizado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kingdoms/create — Criar um reino
app.post('/api/kingdoms/create', requireAuth, async (req, res) => {
  try {
    const nick = (req.user.nick || '').trim();
    const { nome, tag, descricao, logo, cor } = req.body || {};

    if (!nome || !tag || !descricao) {
      return res.status(400).json({ error: 'Nome, TAG de 3 letras e descrição são obrigatórios.' });
    }

    const trimmedNome = (nome || '').trim();
    if (trimmedNome.length > 16) {
      return res.status(400).json({ error: 'O nome do reino/clã deve ter no máximo 16 caracteres.' });
    }

    const cleanTag = tag.trim().toUpperCase();
    if (!/^[A-Z0-9]{3}$/.test(cleanTag)) {
      return res.status(400).json({ error: 'A TAG do reino deve conter exatamente 3 letras ou números (Ex: IMP, LEO, REI).' });
    }

    const cleanNome = trimmedNome.slice(0, 16);
    const cleanDesc = descricao.trim().slice(0, 300);
    const cleanLogo = (logo || '👑').trim().slice(0, 10);
    let cleanCor = (cor || '#f59e0b').trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(cleanCor)) {
      cleanCor = '#f59e0b';
    }

    // 1. Verifica permissão concedida pelo Admin
    let allowed = !!req.isAdmin;
    if (!allowed) {
      const { data: perm } = await supabase
        .from('kingdom_permissions')
        .select('allowed')
        .ilike('user_nick', nick)
        .maybeSingle();
      if (perm && perm.allowed) allowed = true;
    }

    if (!allowed) {
      return res.status(403).json({ error: 'Você não tem permissão do Administrador para criar um Reino.' });
    }

    // 2. Verifica se o jogador já possui um reino ou participa de algum
    const { data: existingMember } = await supabase
      .from('kingdom_members')
      .select('id')
      .ilike('user_nick', nick)
      .maybeSingle();

    if (existingMember) {
      return res.status(400).json({ error: 'Você já faz parte de um Reino. Saia do reino atual antes de criar um novo.' });
    }

    // 2.5. Valida o limite de no máximo 12 reinos no servidor
    const { count: currentKingdomsCount, error: countErr } = await supabase
      .from('kingdoms')
      .select('id', { count: 'exact', head: true });

    if (!countErr && (currentKingdomsCount || 0) >= 12) {
      return res.status(400).json({ 
        error: 'Limite máximo de 12 reinos atingido no servidor! Não é possível fundar novos clãs.' 
      });
    }

    // 2.6. Garante que o Logo 3D não seja repetido (cada reino possui um logo exclusivo)
    const { data: logoExists } = await supabase
      .from('kingdoms')
      .select('id, nome')
      .eq('logo', cleanLogo)
      .maybeSingle();

    if (logoExists) {
      return res.status(400).json({ 
        error: `O emblema 3D "${cleanLogo}" já pertence ao reino "${logoExists.nome}"! Cada um dos 12 reinos deve possuir um logo exclusivo.` 
      });
    }

    // 2.7. Garante que a Cor da TAG não seja repetida (cada reino possui uma cor exclusiva)
    const { data: corExists } = await supabase
      .from('kingdoms')
      .select('id, nome')
      .ilike('cor', cleanCor)
      .maybeSingle();

    if (corExists) {
      return res.status(400).json({ 
        error: `A cor da TAG "${cleanCor}" já pertence ao reino "${corExists.nome}"! Cada um dos 12 reinos deve possuir uma cor exclusiva.` 
      });
    }

    // 3. Cria o reino no Supabase (com logo, cor e fallback seguro)
    const initialExpiresAt = new Date(Date.now() + SUBSCRIPTION_DAYS * 86400000).toISOString();
    const insertPayload = {
      nome: cleanNome,
      tag: cleanTag,
      descricao: cleanDesc,
      owner_nick: nick,
      taxa_paga: 19.99,
      pontos: 0,
      kills: 0,
      logo: cleanLogo,
      cor: cleanCor,
      subscription_status: 'active',
      subscription_expires_at: initialExpiresAt,
      subscription_renewed_at: new Date().toISOString()
    };

    let { data: newKingdom, error: kErr } = await supabase
      .from('kingdoms')
      .insert([insertPayload])
      .select()
      .single();

    if (kErr && (kErr.message.includes('cor') || kErr.code === '42703')) {
      delete insertPayload.cor;
      const retry = await supabase.from('kingdoms').insert([insertPayload]).select().single();
      newKingdom = retry.data;
      kErr = retry.error;
    }

    if (kErr && (kErr.message.includes('logo') || kErr.code === '42703')) {
      delete insertPayload.logo;
      const retry = await supabase.from('kingdoms').insert([insertPayload]).select().single();
      newKingdom = retry.data;
      kErr = retry.error;
    }

    if (kErr) {
      if (kErr.message.includes('unique') || kErr.code === '23505') {
        return res.status(400).json({ error: 'Já existe um Reino com esse Nome ou essa TAG!' });
      }
      return res.status(500).json({ error: kErr.message });
    }

    // 4. Adiciona o criador como Líder
    await supabase.from('kingdom_members').insert([{
      kingdom_id: newKingdom.id,
      user_nick: nick,
      role: 'lider'
    }]);

    // Salva baseline inicial do líder no reino
    await salvarBaselineMembroReino(nick, newKingdom.id);

    // Mensagem de boas-vindas no chat do reino
    await supabase.from('kingdom_messages').insert([{
      kingdom_id: newKingdom.id,
      author_nick: 'Sistema',
      author_role: 'system',
      content: `🏰 Reino [${cleanTag}] ${cleanNome} criado com sucesso por ${nick}!`
    }]);

    // Atualiza cache em memória
    syncKingdomsCache(true).catch(() => {});

    res.json({
      success: true,
      message: `🎉 Reino [${cleanTag}] ${cleanNome} fundado com sucesso!`,
      kingdom: newKingdom
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kingdoms/invites/send — Líder envia convite para jogador aprovado na whitelist
app.post('/api/kingdoms/invites/send', requireAuth, async (req, res) => {
  try {
    const nick = (req.user.nick || '').trim();
    const { targetNick } = req.body || {};

    if (!targetNick || !targetNick.trim()) {
      return res.status(400).json({ error: 'Informe o nick do jogador a ser convidado.' });
    }
    const cleanTarget = targetNick.trim();

    if (cleanTarget.toLowerCase() === nick.toLowerCase()) {
      return res.status(400).json({ error: 'Você não pode convidar a si mesmo.' });
    }

    // 1. Obtém o reino do solicitante e confirma se é o líder
    const { data: member } = await supabase
      .from('kingdom_members')
      .select('kingdom_id, role, kingdoms ( id, nome, tag, owner_nick )')
      .ilike('user_nick', nick)
      .maybeSingle();

    if (!member || (member.role !== 'lider' && !req.isAdmin)) {
      return res.status(403).json({ error: 'Apenas o Dono/Líder do reino pode convidar membros.' });
    }

    // 2. Verifica se o jogador alvo é aprovado na Whitelist
    const { data: targetPlayer } = await supabase
      .from('players')
      .select('nick, status')
      .ilike('nick', cleanTarget)
      .maybeSingle();

    if (!targetPlayer || targetPlayer.status !== 'approved') {
      return res.status(400).json({ error: `O jogador "${cleanTarget}" não possui Whitelist aprovada.` });
    }

    // 3. Verifica se o jogador alvo já tem reino
    const { data: targetExist } = await supabase
      .from('kingdom_members')
      .select('id, kingdoms ( nome, tag )')
      .ilike('user_nick', cleanTarget)
      .maybeSingle();

    if (targetExist) {
      return res.status(400).json({ error: `O jogador "${cleanTarget}" já faz parte de um Reino.` });
    }

    // 4. Verifica se já existe um convite pendente para este jogador deste reino
    const { data: existingInvite } = await supabase
      .from('kingdom_invites')
      .select('id')
      .eq('kingdom_id', member.kingdom_id)
      .ilike('invited_nick', cleanTarget)
      .eq('status', 'pending')
      .maybeSingle();

    if (existingInvite) {
      return res.status(400).json({ error: `Já existe um convite pendente para "${cleanTarget}".` });
    }

    // 5. Cria convite
    const { data: newInvite, error: invErr } = await supabase
      .from('kingdom_invites')
      .insert([{
        kingdom_id: member.kingdom_id,
        invited_nick: targetPlayer.nick,
        invited_by: nick,
        status: 'pending'
      }])
      .select()
      .single();

    if (invErr) {
      if (invErr.code === 'PGRST205' || (invErr.message && invErr.message.includes('schema cache'))) {
        return res.status(500).json({
          error: 'A tabela de convites (kingdom_invites) ainda não foi criada no Supabase. Execute o script SQL no SQL Editor.'
        });
      }
      return res.status(500).json({ error: invErr.message });
    }

    res.json({
      success: true,
      message: `📩 Convite enviado com sucesso para "${targetPlayer.nick}"!`,
      invite: newInvite
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kingdoms/invites/cancel — Líder cancela convite enviado
app.post('/api/kingdoms/invites/cancel', requireAuth, async (req, res) => {
  try {
    const nick = (req.user.nick || '').trim();
    const { inviteId } = req.body || {};

    if (!inviteId) return res.status(400).json({ error: 'ID do convite obrigatório.' });

    const { data: member } = await supabase
      .from('kingdom_members')
      .select('kingdom_id, role')
      .ilike('user_nick', nick)
      .maybeSingle();

    if (!member || (member.role !== 'lider' && !req.isAdmin)) {
      return res.status(403).json({ error: 'Apenas o líder pode cancelar convites.' });
    }

    await supabase
      .from('kingdom_invites')
      .delete()
      .eq('id', inviteId)
      .eq('kingdom_id', member.kingdom_id);

    res.json({ success: true, message: 'Convite cancelado.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kingdoms/invites/respond — Jogador aceita ou recusa convite
app.post('/api/kingdoms/invites/respond', requireAuth, async (req, res) => {
  try {
    const nick = (req.user.nick || '').trim();
    const { inviteId, action } = req.body || {}; // action: 'accept' ou 'reject'

    if (!inviteId || !action) {
      return res.status(400).json({ error: 'ID do convite e ação são obrigatórios.' });
    }

    // 1. Busca o convite
    const { data: invite, error: iErr } = await supabase
      .from('kingdom_invites')
      .select('id, kingdom_id, invited_nick, status, kingdoms ( id, nome, tag )')
      .eq('id', inviteId)
      .ilike('invited_nick', nick)
      .maybeSingle();

    if (iErr || !invite) {
      return res.status(404).json({ error: 'Convite não encontrado ou não pertence a você.' });
    }

    if (invite.status !== 'pending') {
      return res.status(400).json({ error: 'Este convite já foi respondido anteriormente.' });
    }

    if (action === 'reject') {
      // Atualiza status para rejected
      await supabase
        .from('kingdom_invites')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', inviteId);

      return res.json({ success: true, message: `Você recusou o convite para o reino [${invite.kingdoms?.tag}] ${invite.kingdoms?.nome}.` });
    }

    if (action === 'accept') {
      // Verifica se o jogador já pertence a algum reino
      const { data: existingMember } = await supabase
        .from('kingdom_members')
        .select('id')
        .ilike('user_nick', nick)
        .maybeSingle();

      if (existingMember) {
        return res.status(400).json({ error: 'Você já faz parte de um Reino. Saia do atual antes de aceitar outro convite.' });
      }

      // Adiciona como membro
      const { error: insErr } = await supabase
        .from('kingdom_members')
        .insert([{
          kingdom_id: invite.kingdom_id,
          user_nick: nick,
          role: 'membro'
        }]);

      if (insErr) return res.status(500).json({ error: insErr.message });

      // Salva baseline inicial de estatísticas deste membro no reino
      await salvarBaselineMembroReino(nick, invite.kingdom_id);

      // Atualiza convite para accepted
      await supabase
        .from('kingdom_invites')
        .update({ status: 'accepted', updated_at: new Date().toISOString() })
        .eq('id', inviteId);

      // Cancela outros convites pendentes que este jogador possa ter recebido
      await supabase
        .from('kingdom_invites')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .ilike('invited_nick', nick)
        .eq('status', 'pending');

      // Mensagem no chat do reino
      await supabase.from('kingdom_messages').insert([{
        kingdom_id: invite.kingdom_id,
        author_nick: 'Sistema',
        author_role: 'system',
        content: `⚔️ ${nick} aceitou o convite e agora faz parte do reino!`
      }]);

      syncKingdomsCache(true).catch(() => {});

      return res.json({
        success: true,
        message: `🎉 Parabéns! Você agora é membro do reino [${invite.kingdoms?.tag}] ${invite.kingdoms?.nome}!`
      });
    }

    res.status(400).json({ error: 'Ação inválida.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kingdoms/members/remove — Líder remove membro ou membro sai
app.post('/api/kingdoms/members/remove', requireAuth, async (req, res) => {
  try {
    const nick = (req.user.nick || '').trim();
    const { targetNick } = req.body || {};
    const cleanTarget = (targetNick || nick).trim();

    const { data: myMember } = await supabase
      .from('kingdom_members')
      .select('kingdom_id, role')
      .ilike('user_nick', nick)
      .maybeSingle();

    if (!myMember) return res.status(400).json({ error: 'Você não faz parte de nenhum reino.' });

    // Se estiver removendo outra pessoa, tem que ser líder ou admin
    const isRemovingSelf = cleanTarget.toLowerCase() === nick.toLowerCase();
    if (!isRemovingSelf && myMember.role !== 'lider' && !req.isAdmin) {
      return res.status(403).json({ error: 'Apenas o líder pode expulsar membros.' });
    }

    if (isRemovingSelf && myMember.role === 'lider') {
      return res.status(400).json({ error: 'O Dono/Líder não pode simplesmente sair. Use a opção de dissolver o reino.' });
    }

    // 1. Remove da tabela de membros do reino
    await supabase.from('kingdom_members')
      .delete()
      .eq('kingdom_id', myMember.kingdom_id)
      .ilike('user_nick', cleanTarget);

    // 2. Apaga as informações e baseline gerados enquanto o jogador esteve no reino
    // (As horas e kills globais do jogador no servidor continuam 100% preservadas e intactas!)
    await safeDb(
      supabase.from('messages')
        .delete()
        .eq('author_role', 'kingdom_member_baseline')
        .ilike('author_nick', cleanTarget)
    );

    // 3. Mensagem no chat do reino
    const exitMsg = isRemovingSelf
      ? `🚪 ${cleanTarget} saiu do reino.`
      : `⛔ ${cleanTarget} foi expulso do reino por ${nick}.`;

    await supabase.from('kingdom_messages').insert([{
      kingdom_id: myMember.kingdom_id,
      author_nick: 'Sistema',
      author_role: 'system',
      content: exitMsg
    }]);

    syncKingdomsCache(true).catch(() => {});

    res.json({ 
      success: true, 
      message: isRemovingSelf ? 'Você saiu do reino com sucesso.' : `Membro ${cleanTarget} foi expulso do reino.` 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/kingdoms — Dissolver reino (Líder ou Admin)
app.delete('/api/kingdoms', requireAuth, async (req, res) => {
  try {
    const nick = (req.user.nick || '').trim();
    const { data: myMember } = await supabase
      .from('kingdom_members')
      .select('kingdom_id, role, kingdoms ( id, nome )')
      .ilike('user_nick', nick)
      .maybeSingle();

    if (!myMember || (myMember.role !== 'lider' && !req.isAdmin)) {
      return res.status(403).json({ error: 'Apenas o líder pode dissolver o reino.' });
    }

    await supabase.from('kingdoms').delete().eq('id', myMember.kingdom_id);
    await safeDb(supabase.from('messages').delete().eq('author_role', 'kingdom_member_baseline').like('content', `%"kingdom_id":"${myMember.kingdom_id}"%`));
    syncKingdomsCache(true).catch(() => {});

    res.json({ success: true, message: 'Reino dissolvido com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/kingdoms/messages — Bate-papo exclusivo do Reino
app.get('/api/kingdoms/messages', requireAuth, async (req, res) => {
  try {
    const nick = (req.user.nick || '').trim();
    const { data: member } = await supabase
      .from('kingdom_members')
      .select('kingdom_id')
      .ilike('user_nick', nick)
      .maybeSingle();

    if (!member) {
      return res.status(403).json({ error: 'Apenas membros de um reino têm acesso a este bate-papo.' });
    }

    const { data: messages } = await supabase
      .from('kingdom_messages')
      .select('*')
      .eq('kingdom_id', member.kingdom_id)
      .order('created_at', { ascending: false })
      .limit(60);

    await syncVipProfilesCache();
    const mapped = (messages || []).reverse().map(m => {
      const lowerNick = (m.author_nick || '').toLowerCase().trim();
      const vip = vipProfilesCache.get(lowerNick);
      return {
        ...m,
        vip_avatar: vip ? vip.avatar_url : null,
        vip_frame: vip ? vip.frame_id : null
      };
    });

    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/kingdoms/messages — Enviar mensagem no Bate-papo do Reino
app.post('/api/kingdoms/messages', requireAuth, async (req, res) => {
  try {
    const nick = (req.user.nick || '').trim();
    const content = (req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Mensagem vazia.' });

    const { data: member } = await supabase
      .from('kingdom_members')
      .select('kingdom_id, role')
      .ilike('user_nick', nick)
      .maybeSingle();

    if (!member) {
      return res.status(403).json({ error: 'Você precisa pertencer a um reino para conversar aqui.' });
    }

    const { data: msg, error } = await supabase
      .from('kingdom_messages')
      .insert([{
        kingdom_id: member.kingdom_id,
        author_nick: nick,
        author_role: member.role || 'membro',
        content: content.slice(0, 500)
      }])
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, message: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ranking/kingdoms — Ranking de pontos por reinos (Kills + Tempo de jogo)
app.get('/api/ranking/kingdoms', async (req, res) => {
  res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=15');
  try {
    // 1. Busca todos os reinos
    const { data: kingdomsList } = await supabase
      .from('kingdoms')
      .select('*');

    if (!kingdomsList || kingdomsList.length === 0) {
      return res.json({ success: true, ranking: [] });
    }

    // 2. Busca todos os membros de todos os reinos
    const { data: allMembers } = await supabase
      .from('kingdom_members')
      .select('kingdom_id, user_nick');

    // 3. Busca registros da tabela player_rankings
    const { data: rankRows } = await supabase
      .from('player_rankings')
      .select('nick, playtime_seconds, playtime_formatted');

    // 4. Busca telemetria recente para tempo real ao vivo de playtime e kills
    const { data: dbTelemetry } = await supabase
      .from('messages')
      .select('author_nick, content, created_at')
      .eq('author_role', 'telemetry')
      .order('created_at', { ascending: false });

    // 5. Busca baselines de todos os membros (para descontar stats pré-entrada no reino)
    const { data: allBaselines } = await supabase
      .from('messages')
      .select('author_nick, content')
      .eq('author_role', 'kingdom_member_baseline');

    // Mapa de baseline por nick em minúsculo: { initialPlaytime, initialPvp, initialMob }
    const baselineMap = new Map();
    (allBaselines || []).forEach(b => {
      const nickKey = (b.author_nick || '').toLowerCase().trim();
      if (!nickKey) return;
      try {
        const json = JSON.parse(b.content);
        baselineMap.set(nickKey, {
          initialPlaytime: Number(json.initialPlaytime) || 0,
          initialPvp: Number(json.initialPvp) || 0,
          initialMob: Number(json.initialMob) || 0
        });
      } catch (_) {}
    });

    // Mapas de agregação por nick em minúsculo
    const playtimeMap = new Map();
    const playerKillsMap = new Map();
    const mobKillsMap = new Map();

    // Popula a partir de player_rankings (usando Math.max para evitar que duplicatas zerem o tempo)
    (rankRows || []).forEach(r => {
      const nickKey = (r.nick || '').toLowerCase().trim();
      if (!nickKey) return;
      const sec = Number(r.playtime_seconds) || 0;
      const current = playtimeMap.get(nickKey) || 0;
      playtimeMap.set(nickKey, Math.max(current, sec));
    });

    // Popula a partir da telemetria do plugin (tempo real)
    (dbTelemetry || []).forEach(t => {
      const nickKey = (t.author_nick || '').toLowerCase().trim();
      if (!nickKey) return;
      try {
        const json = JSON.parse(t.content);
        const sec = Number(json.playtimeSeconds) || 0;
        if (sec > 0) {
          const current = playtimeMap.get(nickKey) || 0;
          playtimeMap.set(nickKey, Math.max(current, sec));
        }
        const pk = Number(json.playerKills) || 0;
        if (pk > 0) {
          const curPk = playerKillsMap.get(nickKey) || 0;
          playerKillsMap.set(nickKey, Math.max(curPk, pk));
        }
        const mk = Number(json.mobKills) || 0;
        if (mk > 0) {
          const curMk = mobKillsMap.get(nickKey) || 0;
          mobKillsMap.set(nickKey, Math.max(curMk, mk));
        }
      } catch (_) {}
    });

    const kingdomStats = kingdomsList.map(k => {
      const members = (allMembers || []).filter(m => m.kingdom_id === k.id);
      const memberNicksSet = new Set();
      members.forEach(m => {
        if (m.user_nick) memberNicksSet.add(m.user_nick.toLowerCase().trim());
      });
      if (k.owner_nick) memberNicksSet.add(k.owner_nick.toLowerCase().trim());

      let totalSeconds = 0;
      let totalPk = 0;
      let totalMk = 0;

      memberNicksSet.forEach(nickKey => {
        const clean = nickKey.replace(/^[._]/, '');
        const rawSec = Math.max(playtimeMap.get(nickKey) || 0, playtimeMap.get(clean) || 0);
        const rawPk  = Math.max(playerKillsMap.get(nickKey) || 0, playerKillsMap.get(clean) || 0);
        const rawMk  = Math.max(mobKillsMap.get(nickKey) || 0, mobKillsMap.get(clean) || 0);

        // Desconta o baseline (stats que o jogador já tinha ANTES de entrar no reino)
        const base = baselineMap.get(nickKey) || baselineMap.get(clean) || {};
        const sec = Math.max(0, rawSec - (base.initialPlaytime || 0));
        const pk  = Math.max(0, rawPk  - (base.initialPvp      || 0));
        const mk  = Math.max(0, rawMk  - (base.initialMob      || 0));

        totalSeconds += sec;
        totalPk += pk;
        totalMk += mk;
      });

      // Kills PvP: usa apenas a soma calculada com baseline (expulsos não contam mais)
      const totalKills = totalPk + totalMk;

      // Cálculo de pontos dinâmico:
      // 50 pts por PvP Kill + 1 pt por Mob Kill + 1 pt a cada 6 min jogados (10 pts/h)
      const pointsFromTime = Math.floor(totalSeconds / 360);
      const pointsFromKills = (totalPk * 50) + (totalMk * 1);
      const totalPoints = pointsFromKills + pointsFromTime;

      // Formatação de tempo de jogo
      let playtimeFormatted = '0m';
      const hours = Math.floor(totalSeconds / 3600);
      const mins = Math.floor((totalSeconds % 3600) / 60);
      if (hours > 0) {
        playtimeFormatted = `${hours}h ${mins}m`;
      } else {
        playtimeFormatted = `${mins}m`;
      }

      return {
        id: k.id,
        nome: k.nome,
        tag: k.tag,
        logo: k.logo || '👑',
        cor: k.cor || '#f59e0b',
        owner_nick: k.owner_nick,
        membersCount: memberNicksSet.size,
        kills: totalKills,
        pvpKills: totalPk,
        mobKills: totalMk,
        totalSeconds,
        hoursPlayed: hours,
        playtimeFormatted,
        totalPoints
      };
    });

    // Ordena do maior para o menor
    kingdomStats.sort((a, b) => b.totalPoints - a.totalPoints);

    res.json({
      success: true,
      ranking: kingdomStats
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ROTAS ADMIN: Gerenciar Permissões de Criação de Reino ──────────────────
app.get('/api/admin/kingdoms/permissions', requireAdmin, async (req, res) => {
  try {
    const { data } = await supabase
      .from('kingdom_permissions')
      .select('*')
      .order('created_at', { ascending: false });
    res.json({ success: true, permissions: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/kingdoms/permissions', requireAdmin, async (req, res) => {
  try {
    const { nick, allowed } = req.body || {};
    if (!nick || !nick.trim()) return res.status(400).json({ error: 'Nick obrigatório.' });
    const cleanNick = nick.trim();
    const isAllowed = allowed !== false;

    const { error } = await supabase
      .from('kingdom_permissions')
      .upsert({ user_nick: cleanNick, allowed: isAllowed }, { onConflict: 'user_nick' });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, message: `Permissão para "${cleanNick}" atualizada: ${isAllowed ? 'PERMITIDO' : 'BLOQUEADO'}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/kingdoms/permissions/:nick', requireAdmin, async (req, res) => {
  try {
    await supabase.from('kingdom_permissions').delete().ilike('user_nick', req.params.nick);
    res.json({ success: true, message: 'Permissão removida.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ROTAS ADMIN: Listar e Excluir Reinos com todos os dados vinculados ─────
app.get('/api/admin/kingdoms/all', requireAdmin, async (req, res) => {
  try {
    const { data: kingdoms, error } = await supabase
      .from('kingdoms')
      .select('*, kingdom_members(id, user_nick, role)')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, kingdoms: kingdoms || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/kingdoms/:id', requireAdmin, async (req, res) => {
  try {
    const kingdomId = req.params.id;
    if (!kingdomId) return res.status(400).json({ error: 'ID do reino obrigatório.' });

    const { data: k } = await supabase.from('kingdoms').select('id, nome, tag').eq('id', kingdomId).maybeSingle();
    if (!k) return res.status(404).json({ error: 'Reino não encontrado.' });

    // 1. Apaga todos os baselines dos membros gerados para esse reino
    await safeDb(supabase.from('messages').delete().eq('author_role', 'kingdom_member_baseline').like('content', `%"kingdom_id":"${kingdomId}"%`));

    // 2. Apaga mensagens privadas do chat do reino
    await safeDb(supabase.from('kingdom_messages').delete().eq('kingdom_id', kingdomId));

    // 3. Apaga convites pendentes do reino
    await safeDb(supabase.from('kingdom_invites').delete().eq('kingdom_id', kingdomId));

    // 4. Apaga pagamentos pendentes ou concluídos vinculados
    await safeDb(supabase.from('kingdom_payments').delete().eq('kingdom_id', kingdomId));
    await safeDb(supabase.from('kingdom_pending_payments').delete().ilike('tag', k.tag));

    // 5. Apaga os membros do reino
    await safeDb(supabase.from('kingdom_members').delete().eq('kingdom_id', kingdomId));

    // 6. Apaga o reino definitivamente
    const { error: delErr } = await supabase.from('kingdoms').delete().eq('id', kingdomId);
    if (delErr) return res.status(500).json({ error: delErr.message });

    syncKingdomsCache(true).catch(() => {});
    console.log(`🗑️ [ADMIN] Reino [${k.tag}] ${k.nome} (${kingdomId}) excluído permanentemente com todos os dados.`);

    res.json({ success: true, message: `Reino [${k.tag}] ${k.nome} e todos os seus dados foram excluídos com sucesso do Supabase!` });
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
