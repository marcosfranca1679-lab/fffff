import { world, system } from "@minecraft/server";

// ─── Whitelist Local 100% Compatível ──────────────────────────────────────────
const WHITELIST_PERMITIDOS = new Set([
  "admin",
  "marcos",
  "marcosfranca1679"
]);

// ─── Bloqueio de Invasores ───────────────────────────────────────────────────
function bloquear(player) {
  try {
    const nick = player.name;
    world.sendMessage(`§c§l[Whitelist] §e'${nick}' §cnão tem permissão e foi bloqueado!`);

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
      subtitle: "§eVocê não está na Whitelist!"
    });

    player.kill();

    const overworld = world.getDimension("overworld");
    overworld.runCommandAsync(`kick "${nick}" §cVocê não está na Whitelist!`).catch(() => {});
  } catch (err) {}
}

function checar(player) {
  if (!player || !player.isValid()) return;
  const lower = player.name.toLowerCase();

  if (WHITELIST_PERMITIDOS.has(lower)) {
    if (player.inputPermissions) {
      player.inputPermissions.movementEnabled = true;
      player.inputPermissions.cameraEnabled = true;
    }
    player.sendMessage(`§a✅ [Whitelist] Bem-vindo(a), ${player.name}!`);
    return;
  }

  bloquear(player);
}

// ─── Evento de entrada ────────────────────────────────────────────────────────
world.afterEvents.playerSpawn.subscribe((e) => {
  if (e.player && e.player.isValid()) {
    checar(e.player);
  }
});

// ─── Varredura a cada 1 segundo ───────────────────────────────────────────────
system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    if (p && p.isValid()) {
      if (!WHITELIST_PERMITIDOS.has(p.name.toLowerCase())) {
        bloquear(p);
      }
    }
  }
}, 20);

// ─── Comandos de Gerenciamento ────────────────────────────────────────────────
// /scriptevent whitelist:add <Nick>
// /scriptevent whitelist:remove <Nick>
// /scriptevent whitelist:list
system.afterEvents.scriptEventReceive.subscribe((e) => {
  const msg = (e.message || "").trim();

  if (e.id === "whitelist:add" && msg) {
    WHITELIST_PERMITIDOS.add(msg.toLowerCase());
    world.sendMessage(`§a✅ [Whitelist] '${msg}' ADICIONADO com sucesso!`);
  } else if (e.id === "whitelist:remove" && msg) {
    WHITELIST_PERMITIDOS.delete(msg.toLowerCase());
    world.sendMessage(`§c🗑️ [Whitelist] '${msg}' REMOVIDO!`);
  } else if (e.id === "whitelist:list") {
    const list = Array.from(WHITELIST_PERMITIDOS).join(", ");
    world.sendMessage(`§e📋 [Whitelist] Permitidos: §a${list}`);
  }
});

console.warn("[Whitelist] ✅ Addon carregado com sucesso sem dependências de rede!");
