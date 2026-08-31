import { world, system } from "@minecraft/server";
import { http, HttpRequest, HttpRequestMethod } from "@minecraft/server-net";

// ─── Configuração ─────────────────────────────────────────────────────────────
const API_URL = "https://fffff-autoforge.vercel.app/api/check";

// Mensagem exibida ao jogador kickado (§c = vermelho, §e = amarelo, §f = branco)
const KICK_MESSAGE = [
  "§c§lVocê não está na Whitelist!",
  "§r",
  "§eSolicite acesso em:",
  "§ffffff-autoforge.vercel.app",
  "§7(Aguarde aprovação do Admin)"
].join("\n");

// Admins que nunca são kickados (nicknames exatos)
const ADMINS_BYPASS = ["admin", "Marcos"];

// Tempo de espera antes de checar (ticks) — 60 ticks = 3 segundos
const CHECK_DELAY_TICKS = 60;

// ─── Lógica principal ─────────────────────────────────────────────────────────

world.afterEvents.playerSpawn.subscribe(async (event) => {
  // Só executa na primeira vez que o jogador entra (não ao respawnar)
  if (!event.initialSpawn) return;

  const player = event.player;
  const nick = player.name;

  // Admins do bypass nunca são kickados
  if (ADMINS_BYPASS.includes(nick)) {
    player.sendMessage("§a✅ Whitelist: Admin detectado, acesso liberado!");
    return;
  }

  // Aguarda alguns ticks para o jogador carregar completamente
  await delay(CHECK_DELAY_TICKS);

  // Re-verifica se o jogador ainda está online
  const onlinePlayers = world.getAllPlayers();
  const stillOnline = onlinePlayers.find(p => p.name === nick);
  if (!stillOnline) return;

  // Avisa que está verificando
  player.sendMessage("§e⏳ Verificando whitelist...");

  try {
    const allowed = await verificarWhitelist(nick);

    if (allowed) {
      player.sendMessage("§a✅ Whitelist confirmada! Bem-vindo ao Mapa Bermuda!");
    } else {
      // Aguarda 2 segundos para o jogador ler a mensagem
      player.sendMessage(KICK_MESSAGE);
      await delay(40);
      player.runCommand(`kick "${nick}" ${KICK_MESSAGE}`);
    }
  } catch (err) {
    // Se a API falhar, mantém o jogador mas avisa o admin
    world.sendMessage(`§c[Whitelist] §eErro ao verificar ${nick}: API indisponível.`);
    console.error(`[Whitelist] Erro ao verificar ${nick}:`, err);
  }
});

// ─── Função que chama a API ───────────────────────────────────────────────────
async function verificarWhitelist(nick) {
  const url = `${API_URL}/${encodeURIComponent(nick)}`;

  const request = new HttpRequest(url);
  request.method = HttpRequestMethod.Get;
  request.headers = [
    { key: "Content-Type", value: "application/json" },
    { key: "User-Agent",   value: "MinecraftBedrock-Whitelist/1.0" }
  ];
  request.timeout = 10; // 10 segundos de timeout

  const response = await http.request(request);

  if (response.status !== 200) {
    throw new Error(`API retornou status ${response.status}`);
  }

  const data = JSON.parse(response.body);
  return data.allowed === true;
}

// ─── Helper: delay em ticks ───────────────────────────────────────────────────
function delay(ticks) {
  return new Promise(resolve => system.runTimeout(resolve, ticks));
}

// ─── Comando de admin: /scriptevent whitelist:check <nick> ────────────────────
system.afterEvents.scriptEventReceive.subscribe(async (event) => {
  if (event.id !== "whitelist:check") return;

  const nick = event.message.trim();
  if (!nick) {
    event.sourceEntity?.sendMessage("§cUso: /scriptevent whitelist:check <nick>");
    return;
  }

  try {
    const allowed = await verificarWhitelist(nick);
    const msg = allowed
      ? `§a✅ ${nick} está na whitelist.`
      : `§c❌ ${nick} NÃO está na whitelist.`;
    event.sourceEntity?.sendMessage(msg);
    world.sendMessage(msg);
  } catch (err) {
    event.sourceEntity?.sendMessage(`§cErro ao verificar: ${err.message}`);
  }
});

console.log("[Whitelist] ✅ Addon carregado! API: " + API_URL);
