import { world, system } from "@minecraft/server";

// ─── Lista de Jogadores com Acesso ────────────────────────────────────────────
// Nicks que podem jogar (letras minúsculas)
const whitelist = new Set([
  "admin",
  "marcos",
  "marcosfranca1679"
]);

// ─── Função de Punição Imediata ───────────────────────────────────────────────
function bloquearJogador(player) {
  try {
    const nick = player.name;

    // 1. Alerta público no chat
    world.sendMessage(`§c§l[Whitelist] §e'${nick}' §cnão tem permissão e foi bloqueado!`);

    // 2. Trava controles e câmera
    if (player.inputPermissions) {
      player.inputPermissions.movementEnabled = false;
      player.inputPermissions.cameraEnabled = false;
    }

    // 3. Efeitos de cegueira e fraqueza
    player.addEffect("blindness", 1000, { amplifier: 255, showParticles: false });
    player.addEffect("slowness", 1000, { amplifier: 255, showParticles: false });

    // 4. Mensagem gigante no meio da tela
    player.onScreenDisplay.setTitle("§c§lACESSO NEGADO", {
      stayDuration: 100,
      fadeInDuration: 0,
      fadeOutDuration: 10,
      subtitle: "§eVocê não está na Whitelist!"
    });

    // 5. Mata o jogador imediatamente para não mexer em nada
    player.kill();

    // 6. Tenta expulsar do servidor
    const overworld = world.getDimension("overworld");
    overworld.runCommandAsync(`kick "${nick}" §cVocê não está na Whitelist!`).catch(() => {});
  } catch (err) {
    console.error("Erro ao bloquear:", err);
  }
}

// ─── Verificador de Jogador ───────────────────────────────────────────────────
function verificar(player) {
  if (!player || !player.isValid()) return;

  const nick = player.name;
  const lower = nick.toLowerCase();

  // Se está na lista permitida
  if (whitelist.has(lower)) {
    if (player.inputPermissions) {
      player.inputPermissions.movementEnabled = true;
      player.inputPermissions.cameraEnabled = true;
    }
    return;
  }

  // Se NÃO está na lista -> BLOQUEIA!
  bloquearJogador(player);
}

// ─── 1. Quando qualquer jogador nasce ou entra no mundo ──────────────────────
world.afterEvents.playerSpawn.subscribe((event) => {
  const player = event.player;
  if (player && player.isValid()) {
    verificar(player);
  }
});

// ─── 2. Varredura a cada 1 segundo em todos os jogadores online ───────────────
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    if (player && player.isValid()) {
      verificar(player);
    }
  }
}, 20);

// ─── 3. Comandos de Administrador via Chat / Console ──────────────────────────
system.afterEvents.scriptEventReceive.subscribe((e) => {
  const msg = (e.message || "").trim();

  // Comando: /scriptevent whitelist:add NickDoJogador
  if (e.id === "whitelist:add") {
    if (!msg) {
      world.sendMessage("§cUso: /scriptevent whitelist:add <Nick>");
      return;
    }
    whitelist.add(msg.toLowerCase());
    world.sendMessage(`§a✅ [Whitelist] '${msg}' ADICIONADO com sucesso!`);
  }

  // Comando: /scriptevent whitelist:remove NickDoJogador
  else if (e.id === "whitelist:remove") {
    if (!msg) {
      world.sendMessage("§cUso: /scriptevent whitelist:remove <Nick>");
      return;
    }
    whitelist.delete(msg.toLowerCase());
    world.sendMessage(`§c🗑️ [Whitelist] '${msg}' REMOVIDO da lista!`);
  }

  // Comando: /scriptevent whitelist:list
  else if (e.id === "whitelist:list") {
    const permitidos = Array.from(whitelist).join(", ");
    world.sendMessage(`§e📋 [Whitelist] Jogadores Permitidos: §a${permitidos || 'Nenhum'}`);
  }
});

console.log("[Whitelist] ✅ Sistema v5.5 ativo e pronto!");
