import { world, system } from "@minecraft/server";

// ─── Configuração ─────────────────────────────────────────────────────────────
const API_URL = "https://fffff-autoforge.vercel.app/api/check";

// Admins supremos (nunca bloqueados)
const ADMINS_BYPASS = ["admin", "marcos", "marcosfranca1679"];

// Lista local de jogadores aprovados
const approvedNicks = new Set(["admin", "marcos", "marcosfranca1679"]);
const blockedNicks = new Set();

// ─── 1. TESTE VISUAL: Mensagem no chat assim que alguém entra ────────────────
world.afterEvents.playerSpawn.subscribe((event) => {
  const player = event.player;
  if (!player || !player.isValid()) return;

  const nick = player.name;
  const lower = nick.toLowerCase();

  // Avisa no chat que o addon está rodando
  player.sendMessage(`§e[Whitelist] Verificando jogador: §f${nick}...`);

  // Se for Admin
  if (ADMINS_BYPASS.includes(lower) || approvedNicks.has(lower)) {
    player.sendMessage(`§a✅ [Whitelist] '${nick}' tem permissão! Acesso liberado.`);
    if (player.inputPermissions) {
      player.inputPermissions.movementEnabled = true;
      player.inputPermissions.cameraEnabled = true;
    }
    return;
  }

  // Se NÃO for aprovado -> BLOQUEIO IMEDIATO
  blockedNicks.add(lower);
  punirJogador(player, "Você não está na Whitelist!");
});

// ─── 2. Punição (Trava controles + Cegueira + Kick) ───────────────────────────
function punirJogador(player, motivo) {
  try {
    if (player.inputPermissions) {
      player.inputPermissions.movementEnabled = false;
      player.inputPermissions.cameraEnabled = false;
    }
    player.addEffect("blindness", 600, { amplifier: 255, showParticles: false });
    player.addEffect("slowness", 600, { amplifier: 255, showParticles: false });

    player.onScreenDisplay.setTitle("§c§lACESSO NEGADO", {
      stayDuration: 80,
      fadeInDuration: 0,
      fadeOutDuration: 10,
      subtitle: `§e${motivo}`
    });

    player.teleport({ x: 0, y: -100, z: 0 });

    const overworld = world.getDimension("overworld");
    overworld.runCommandAsync(`kick "${player.name}" §c${motivo}`).catch(() => {});
  } catch (e) {}
}

// ─── 3. Monitoramento contínuo a cada 1 segundo ──────────────────────────────
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    if (player && player.isValid()) {
      const lower = player.name.toLowerCase();
      if (!ADMINS_BYPASS.includes(lower) && !approvedNicks.has(lower)) {
        punirJogador(player, "Acesso não autorizado!");
      }
    }
  }
}, 20);

// ─── 4. Comandos no chat/console para gerenciar Whitelist ─────────────────────
// Uso no chat: /scriptevent whitelist:add Steve123
// Uso no chat: /scriptevent whitelist:remove Steve123
// Uso no chat: /scriptevent whitelist:list
system.afterEvents.scriptEventReceive.subscribe((e) => {
  const sender = e.sourceEntity;
  const msg = (e.message || "").trim();

  if (e.id === "whitelist:add") {
    if (!msg) return sender?.sendMessage("§cUso: /scriptevent whitelist:add <Nick>");
    approvedNicks.add(msg.toLowerCase());
    blockedNicks.delete(msg.toLowerCase());
    world.sendMessage(`§a✅ [Whitelist] Jogador '${msg}' adicionado e liberado!`);
  }

  else if (e.id === "whitelist:remove") {
    if (!msg) return sender?.sendMessage("§cUso: /scriptevent whitelist:remove <Nick>");
    approvedNicks.delete(msg.toLowerCase());
    blockedNicks.add(msg.toLowerCase());
    world.sendMessage(`§c🗑️ [Whitelist] Jogador '${msg}' removido da whitelist!`);
  }

  else if (e.id === "whitelist:list") {
    const list = Array.from(approvedNicks).join(", ");
    sender?.sendMessage(`§e📋 Jogadores aprovados: §f${list || 'Nenhum'}`);
  }
});

console.log("[Whitelist] ✅ Addon v5.0 carregado com sucesso!");
