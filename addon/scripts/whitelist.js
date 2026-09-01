import { world, system } from "@minecraft/server";
import { http, HttpRequest, HttpRequestMethod } from "@minecraft/server-net";

// ─── Configuração ─────────────────────────────────────────────────────────────
const API_URL = "https://fffff-autoforge.vercel.app/api/check";

// Admins que nunca são bloqueados
const ADMINS_BYPASS = ["admin", "marcos", "marcosfranca1679"];

// Cache de jogadores aprovados (para não consultar a API a cada segundo)
const approvedNicks = new Set();
// Jogadores sendo verificados no momento
const checkingNicks = new Set();
// Jogadores não autorizados
const blockedNicks = new Set();

// ─── Função de punição e bloqueio imediato ────────────────────────────────────
function punirJogador(player, motivo) {
  try {
    // 1. Trava controles e câmera
    if (player.inputPermissions) {
      player.inputPermissions.movementEnabled = false;
      player.inputPermissions.cameraEnabled = false;
    }

    // 2. Aplica cegueira e lentidão
    player.addEffect("blindness", 200, { amplifier: 255, showParticles: false });
    player.addEffect("slowness", 200, { amplifier: 255, showParticles: false });

    // 3. Título gigante na tela
    player.onScreenDisplay.setTitle("§c§lACESSO NEGADO", {
      stayDuration: 60,
      fadeInDuration: 0,
      fadeOutDuration: 10,
      subtitle: `§e${motivo}`
    });

    // 4. Mata o jogador / joga no void para não interagir com o mapa
    player.teleport({ x: 0, y: -100, z: 0 });

    // 5. Tenta kick
    const overworld = world.getDimension("overworld");
    overworld.runCommandAsync(`kick "${player.name}" §c${motivo}`).catch(() => {});
  } catch (e) {
    console.error(`[Whitelist] Erro ao punir ${player.name}:`, e);
  }
}

// ─── Verificador principal para um jogador ───────────────────────────────────
async function checarJogador(player) {
  if (!player || !player.isValid()) return;

  const nick = player.name;
  const lowerNick = nick.toLowerCase();

  // Admin bypass
  if (ADMINS_BYPASS.includes(lowerNick)) {
    approvedNicks.add(lowerNick);
    return;
  }

  // Já aprovado nesta sessão
  if (approvedNicks.has(lowerNick)) {
    return;
  }

  // Já bloqueado
  if (blockedNicks.has(lowerNick)) {
    punirJogador(player, "Nao esta na Whitelist!");
    return;
  }

  // Evita checagens duplicadas simultâneas
  if (checkingNicks.has(lowerNick)) return;
  checkingNicks.add(lowerNick);

  player.sendMessage("§e⏳ [Whitelist] Consultando permissão no servidor...");

  let allowed = false;
  let errorMsg = "Acesso nao liberado pelo Admin";

  try {
    const url = `${API_URL}/${encodeURIComponent(nick)}`;
    const request = new HttpRequest(url);
    request.method = HttpRequestMethod.Get;
    request.headers = [
      { key: "Content-Type", value: "application/json" },
      { key: "User-Agent",   value: "MinecraftBedrock-Whitelist/3.0" }
    ];
    request.timeout = 5;

    const response = await http.request(request);

    if (response.status === 200) {
      const data = JSON.parse(response.body);
      allowed = data.allowed === true;
    } else {
      errorMsg = `API retornou status ${response.status}`;
    }
  } catch (err) {
    console.error(`[Whitelist] Erro de rede para ${nick}:`, err);
    errorMsg = `Erro na API: ${err.message || 'Sem conexao'}`;
    allowed = false;
  } finally {
    checkingNicks.delete(lowerNick);
  }

  if (!player.isValid()) return;

  if (allowed) {
    approvedNicks.add(lowerNick);
    blockedNicks.delete(lowerNick);
    if (player.inputPermissions) {
      player.inputPermissions.movementEnabled = true;
      player.inputPermissions.cameraEnabled = true;
    }
    player.sendMessage("§a✅ [Whitelist] Acesso confirmado! Bem-vindo ao servidor.");
  } else {
    blockedNicks.add(lowerNick);
    player.sendMessage(`§c❌ [Whitelist] Acesso negado! (${errorMsg})`);
    player.sendMessage("§ePeça permissão em: fffff-autoforge.vercel.app");
    punirJogador(player, errorMsg);
  }
}

// ─── 1. Monitora quando qualquer jogador nasce/entra ─────────────────────────
world.afterEvents.playerSpawn.subscribe((event) => {
  const player = event.player;
  if (player && player.isValid()) {
    checarJogador(player);
  }
});

// ─── 2. Loop de segurança a cada 2 segundos (pega todos os online) ────────────
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    if (player && player.isValid()) {
      const lowerNick = player.name.toLowerCase();
      if (blockedNicks.has(lowerNick)) {
        punirJogador(player, "Nao esta na Whitelist!");
      } else if (!approvedNicks.has(lowerNick) && !ADMINS_BYPASS.includes(lowerNick)) {
        checarJogador(player);
      }
    }
  }
}, 40); // 40 ticks = 2 segundos

// ─── Comando Admin: /scriptevent whitelist:check <nick> ────────────────────────
system.afterEvents.scriptEventReceive.subscribe(async (event) => {
  if (event.id !== "whitelist:check") return;

  const nick = event.message ? event.message.trim() : "";
  if (!nick) {
    event.sourceEntity?.sendMessage("§cUso: /scriptevent whitelist:check <nick>");
    return;
  }

  try {
    const url = `${API_URL}/${encodeURIComponent(nick)}`;
    const request = new HttpRequest(url);
    request.method = HttpRequestMethod.Get;
    const response = await http.request(request);
    const data = JSON.parse(response.body);
    const msg = data.allowed
      ? `§a✅ [Whitelist] '${nick}' ESTÁ aprovado!`
      : `§c❌ [Whitelist] '${nick}' NÃO está aprovado.`;
    event.sourceEntity?.sendMessage(msg);
  } catch (err) {
    event.sourceEntity?.sendMessage(`§c[Whitelist] Erro: ${err.message}`);
  }
});

console.log("[Whitelist] ✅ Sistema de Whitelist v3.0 Ativo!");
