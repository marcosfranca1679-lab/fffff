import { world, system } from "@minecraft/server";
import { http, HttpRequest, HttpRequestMethod } from "@minecraft/server-net";

// ─── Configuração ─────────────────────────────────────────────────────────────
const API_URL = "https://fffff-autoforge.vercel.app/api/check";

// Admins que nunca são bloqueados (seu nick exato aqui)
const ADMINS_BYPASS = ["admin", "Marcos", "marcosfranca1679"];

// Jogadores não autorizados bloqueados
const blockedPlayers = new Set();

// ─── Bloqueio contínuo para não autorizados ───────────────────────────────────
system.runInterval(() => {
  if (blockedPlayers.size === 0) return;

  for (const player of world.getAllPlayers()) {
    if (blockedPlayers.has(player.name.toLowerCase())) {
      try {
        // Trava controles, câmera e movimento
        if (player.inputPermissions) {
          player.inputPermissions.movementEnabled = false;
          player.inputPermissions.cameraEnabled = false;
        }

        // Aplica cegueira total e lentidão máxima
        player.addEffect("blindness", 200, { amplifier: 255, showParticles: false });
        player.addEffect("slowness", 200, { amplifier: 255, showParticles: false });
        player.addEffect("weakness", 200, { amplifier: 255, showParticles: false });

        // Mensagem na tela grande
        player.onScreenDisplay.setTitle("§c§lACESSO NEGADO", {
          stayDuration: 40,
          fadeInDuration: 0,
          fadeOutDuration: 10,
          subtitle: "§eSolicite acesso no site do servidor!"
        });

        // Teleporta para o limbo/vazio para não interagir com o mapa
        player.teleport({ x: 0, y: -100, z: 0 });
      } catch (e) {}
    }
  }
}, 10); // Executa a cada meio segundo

// ─── Evento quando jogador entra ──────────────────────────────────────────────
world.afterEvents.playerSpawn.subscribe(async (event) => {
  if (!event.initialSpawn) return;

  const player = event.player;
  if (!player || !player.isValid()) return;

  const nick = player.name;

  // Bypass de admin
  if (ADMINS_BYPASS.some(a => a.toLowerCase() === nick.toLowerCase())) {
    player.sendMessage("§a✅ [Whitelist] Admin detectado! Acesso liberado.");
    blockedPlayers.delete(nick.toLowerCase());
    return;
  }

  player.sendMessage("§e⏳ [Whitelist] Verificando sua permissão...");

  // Aguarda 1.5s
  await delay(30);
  if (!player.isValid()) return;

  let isAllowed = false;
  try {
    const res = await verificarWhitelist(nick);
    isAllowed = res.allowed === true;
  } catch (err) {
    console.error(`[Whitelist] Erro API para ${nick}:`, err);
    isAllowed = false;
  }

  if (!player.isValid()) return;

  if (isAllowed) {
    blockedPlayers.delete(nick.toLowerCase());
    if (player.inputPermissions) {
      player.inputPermissions.movementEnabled = true;
      player.inputPermissions.cameraEnabled = true;
    }
    player.sendMessage("§a✅ [Whitelist] Acesso liberado! Bom jogo.");
  } else {
    // Adiciona à lista de bloqueio imediato
    blockedPlayers.add(nick.toLowerCase());

    player.sendMessage("§c❌ [Whitelist] Acesso negado! Seu nick não está na Whitelist.");
    player.sendMessage("§ePeça permissão em: fffff-autoforge.vercel.app");

    // Tenta expulsar via comando /kick
    system.run(() => {
      try {
        const overworld = world.getDimension("overworld");
        overworld.runCommandAsync(`kick "${nick}" §cVoce nao esta na Whitelist!`);
      } catch (e) {}
    });
  }
});

// ─── Requisição HTTP para API ─────────────────────────────────────────────────
async function verificarWhitelist(nick) {
  const url = `${API_URL}/${encodeURIComponent(nick)}`;
  const request = new HttpRequest(url);
  request.method = HttpRequestMethod.Get;
  request.headers = [
    { key: "Content-Type", value: "application/json" },
    { key: "User-Agent",   value: "MinecraftBedrock-Whitelist/2.1" }
  ];
  request.timeout = 5;

  const response = await http.request(request);
  if (response.status !== 200) {
    throw new Error(`Status ${response.status}`);
  }
  return JSON.parse(response.body);
}

function delay(ticks) {
  return new Promise(resolve => system.runTimeout(resolve, ticks));
}

// ─── Comando Admin: /scriptevent whitelist:check <nick> ────────────────────────
system.afterEvents.scriptEventReceive.subscribe(async (event) => {
  if (event.id !== "whitelist:check") return;

  const nick = event.message ? event.message.trim() : "";
  if (!nick) {
    event.sourceEntity?.sendMessage("§cUso: /scriptevent whitelist:check <nick>");
    return;
  }

  try {
    const res = await verificarWhitelist(nick);
    const msg = res.allowed
      ? `§a✅ [Whitelist] '${nick}' ESTÁ na whitelist!`
      : `§c❌ [Whitelist] '${nick}' NÃO está na whitelist.`;
    event.sourceEntity?.sendMessage(msg);
  } catch (err) {
    event.sourceEntity?.sendMessage(`§c[Whitelist] Erro API: ${err.message}`);
  }
});

console.log("[Whitelist] ✅ Addon v2.1 (Anti-Bypass + Input Lock) Ativo!");
