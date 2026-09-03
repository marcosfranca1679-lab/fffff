package com.mapabermuda.whitelist;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Statistic;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.FoodLevelChangeEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.event.player.PlayerExpChangeEvent;
import org.bukkit.event.player.PlayerItemHeldEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.plugin.java.JavaPlugin;

import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Set;
import java.util.logging.Logger;

public class WhitelistPlugin extends JavaPlugin implements Listener {

    private static final String API_URL   = "https://fffff-autoforge.vercel.app/api/check/";
    private static final String TELEM_URL = "https://fffff-autoforge.vercel.app/api/telemetry/";
    private static final String PLUGIN_SECRET = "MapaBermuda2025Plugin";

    // 200 ticks = 10s (checagem de ban)
    private static final long CHECK_INTERVAL_TICKS = 200L;
    // 40 ticks = 2s (telemetria AO VIVO contínua)
    private static final long TELEM_INTERVAL_TICKS = 40L;

    private static final Set<String> BYPASS = Set.of(
        "admin",
        "marcos",
        "marcosfranca1679"
    );

    private HttpClient httpClient;
    private Logger log;

    @Override
    public void onEnable() {
        this.log = getLogger();
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(4))
            .build();
        getServer().getPluginManager().registerEvents(this, this);

        // ── Task: checagem de ban & IP ban a cada 10s ────────────────────────
        getServer().getScheduler().runTaskTimerAsynchronously(this, () -> {
            for (Player player : getServer().getOnlinePlayers()) {
                String cleanName = cleanNick(player.getName());
                if (BYPASS.contains(cleanName.toLowerCase())) continue;

                try {
                    String playerIp = getPlayerIp(player);
                    String url = API_URL + URLEncoder.encode(cleanName, StandardCharsets.UTF_8)
                        + "?ip=" + URLEncoder.encode(playerIp, StandardCharsets.UTF_8);
                    String body = callApi(url);
                    boolean banned = body.contains("\"banned\":true");

                    if (banned) {
                        final String banBody = body;
                        log.info("[Whitelist] 🔨 '" + cleanName + "' (IP: " + playerIp + ") foi BANIDO! Expulsando...");
                        getServer().getScheduler().runTask(this, () -> {
                            if (player.isOnline()) {
                                player.kick(buildBanMessage(cleanName, banBody));
                            }
                        });
                    }
                } catch (Exception e) {
                    log.fine("[Whitelist] Erro checando ban de '" + cleanName + "': " + e.getMessage());
                }
            }
        }, CHECK_INTERVAL_TICKS, CHECK_INTERVAL_TICKS);

        // ── Task: telemetria AO VIVO a cada 2s ───────────────────────────────
        getServer().getScheduler().runTaskTimer(this, () -> {
            for (Player player : getServer().getOnlinePlayers()) {
                String cleanName = cleanNick(player.getName());
                if (BYPASS.contains(cleanName.toLowerCase())) continue;
                String payload = buildTelemetryJson(player, cleanName, "live");
                getServer().getScheduler().runTaskAsynchronously(this, () -> postTelemetria(cleanName, payload));
            }
        }, TELEM_INTERVAL_TICKS, TELEM_INTERVAL_TICKS);

        log.info("Mapa Bermuda Whitelist, IP Ban, Horas & Mortes v1.9 - ATIVA!");
    }

    @Override
    public void onDisable() {
        log.info("[Whitelist] Plugin desativado.");
    }

    // ── Login ──
    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        String cleanName = cleanNick(player.getName());
        if (BYPASS.contains(cleanName.toLowerCase())) return;

        getServer().getScheduler().runTaskLater(this, () -> {
            if (!player.isOnline()) return;
            log.info("[Whitelist] 🟢 Conexao: " + cleanName + " (IP: " + getPlayerIp(player) + ")");
            String payload = buildTelemetryJson(player, cleanName, "login");
            getServer().getScheduler().runTaskAsynchronously(this, () -> postTelemetria(cleanName, payload));
        }, 15L);
    }

    // ── Logout ──
    @EventHandler
    public void onPlayerQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        String cleanName = cleanNick(player.getName());
        if (BYPASS.contains(cleanName.toLowerCase())) return;

        log.info("[Whitelist] 🔴 Desconexao: " + cleanName);
        String payload = buildTelemetryJson(player, cleanName, "logout");
        getServer().getScheduler().runTaskAsynchronously(this, () -> postTelemetria(cleanName, payload));
    }

    // ── Evento de Morte (PlayerDeathEvent) ──
    @EventHandler(priority = EventPriority.MONITOR)
    public void onPlayerDeath(PlayerDeathEvent event) {
        Player player = event.getEntity();
        String cleanName = cleanNick(player.getName());
        if (BYPASS.contains(cleanName.toLowerCase())) return;

        String deathMsg = event.getDeathMessage();
        if (deathMsg == null || deathMsg.isBlank()) {
            deathMsg = cleanName + " morreu.";
        }

        String world = player.getWorld() != null ? player.getWorld().getName() : "world";
        int x = (int) player.getLocation().getX();
        int y = (int) player.getLocation().getY();
        int z = (int) player.getLocation().getZ();

        String killerName = null;
        if (player.getKiller() != null) {
            killerName = cleanNick(player.getKiller().getName());
        }

        log.info("[Whitelist] 💀 Morte registrada: " + deathMsg + " [" + world + " " + x + "," + y + "," + z + "]");

        String payload = "{"
            + "\"secret\":\"" + PLUGIN_SECRET + "\","
            + "\"event\":\"death\","
            + "\"deathMessage\":\"" + escJson(deathMsg) + "\","
            + "\"world\":\"" + escJson(world) + "\","
            + "\"x\":" + x + ","
            + "\"y\":" + y + ","
            + "\"z\":" + z + ","
            + "\"location\":\"" + x + ", " + y + ", " + z + "\","
            + "\"killer\":" + (killerName == null ? "null" : "\"" + escJson(killerName) + "\"")
            + "}";

        getServer().getScheduler().runTaskAsynchronously(this, () -> postTelemetria(cleanName, payload));
    }

    // ── Eventos imediatos de jogo ──
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDamage(EntityDamageEvent event) {
        if (event.getEntity() instanceof Player player) {
            String cleanName = cleanNick(player.getName());
            if (BYPASS.contains(cleanName.toLowerCase())) return;
            getServer().getScheduler().runTaskLater(this, () -> {
                if (!player.isOnline()) return;
                String payload = buildTelemetryJson(player, cleanName, "damage");
                getServer().getScheduler().runTaskAsynchronously(this, () -> postTelemetria(cleanName, payload));
            }, 1L);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onFoodChange(FoodLevelChangeEvent event) {
        if (event.getEntity() instanceof Player player) {
            String cleanName = cleanNick(player.getName());
            if (BYPASS.contains(cleanName.toLowerCase())) return;
            getServer().getScheduler().runTaskLater(this, () -> {
                if (!player.isOnline()) return;
                String payload = buildTelemetryJson(player, cleanName, "food");
                getServer().getScheduler().runTaskAsynchronously(this, () -> postTelemetria(cleanName, payload));
            }, 1L);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onExpChange(PlayerExpChangeEvent event) {
        Player player = event.getPlayer();
        String cleanName = cleanNick(player.getName());
        if (BYPASS.contains(cleanName.toLowerCase())) return;
        getServer().getScheduler().runTaskLater(this, () -> {
            if (!player.isOnline()) return;
            String payload = buildTelemetryJson(player, cleanName, "exp");
            getServer().getScheduler().runTaskAsynchronously(this, () -> postTelemetria(cleanName, payload));
        }, 1L);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onItemHeld(PlayerItemHeldEvent event) {
        Player player = event.getPlayer();
        String cleanName = cleanNick(player.getName());
        if (BYPASS.contains(cleanName.toLowerCase())) return;
        getServer().getScheduler().runTaskLater(this, () -> {
            if (!player.isOnline()) return;
            String payload = buildTelemetryJson(player, cleanName, "item_held");
            getServer().getScheduler().runTaskAsynchronously(this, () -> postTelemetria(cleanName, payload));
        }, 1L);
    }

    // ── Constrói JSON completo com Estatísticas (Roda na Main Thread) ──
    private String buildTelemetryJson(Player player, String cleanName, String event) {
        try {
            int xp = player.getTotalExperience();
            int level = player.getLevel();
            int health = (int) Math.round(player.getHealth());
            int food = player.getFoodLevel();
            String world = player.getWorld() != null ? player.getWorld().getName() : "world";
            int x = (int) player.getLocation().getX();
            int y = (int) player.getLocation().getY();
            int z = (int) player.getLocation().getZ();
            String gamemode = player.getGameMode().name();
            String ip = getPlayerIp(player);

            // Estatísticas nativas do Minecraft (Tempo jogado, Mortes, Kills)
            int playTicks = 0;
            int totalDeaths = 0;
            int mobKills = 0;
            int playerKills = 0;
            try {
                playTicks = player.getStatistic(Statistic.PLAY_ONE_MINUTE);
                totalDeaths = player.getStatistic(Statistic.DEATHS);
                mobKills = player.getStatistic(Statistic.MOB_KILLS);
                playerKills = player.getStatistic(Statistic.PLAYER_KILLS);
            } catch (Exception ignored) {}

            long totalSeconds = playTicks / 20L;
            long hours = totalSeconds / 3600;
            long minutes = (totalSeconds % 3600) / 60;
            String playtimeFormatted = (hours > 0 ? hours + "h " : "") + minutes + "m";

            PlayerInventory inv = player.getInventory();
            String helmet = formatItem(inv.getHelmet());
            String chestplate = formatItem(inv.getChestplate());
            String leggings = formatItem(inv.getLeggings());
            String boots = formatItem(inv.getBoots());
            String mainHand = formatItem(inv.getItemInMainHand());
            String offHand = formatItem(inv.getItemInOffHand());

            StringBuilder itemsJson = new StringBuilder("[");
            boolean first = true;
            for (ItemStack is : inv.getStorageContents()) {
                if (is != null && !is.getType().isAir()) {
                    String itemStr = formatItemObj(is);
                    if (itemStr != null) {
                        if (!first) itemsJson.append(",");
                        itemsJson.append(itemStr);
                        first = false;
                    }
                }
            }
            itemsJson.append("]");

            return "{"
                + "\"secret\":\"" + PLUGIN_SECRET + "\","
                + "\"event\":\"" + escJson(event) + "\","
                + "\"xp\":" + xp + ","
                + "\"level\":" + level + ","
                + "\"health\":" + health + ","
                + "\"food\":" + food + ","
                + "\"world\":\"" + escJson(world) + "\","
                + "\"x\":" + x + ","
                + "\"y\":" + y + ","
                + "\"z\":" + z + ","
                + "\"location\":\"" + x + ", " + y + ", " + z + "\","
                + "\"gamemode\":\"" + escJson(gamemode) + "\","
                + "\"ip\":\"" + escJson(ip) + "\","
                + "\"playtimeSeconds\":" + totalSeconds + ","
                + "\"playtimeFormatted\":\"" + escJson(playtimeFormatted) + "\","
                + "\"totalDeaths\":" + totalDeaths + ","
                + "\"mobKills\":" + mobKills + ","
                + "\"playerKills\":" + playerKills + ","
                + "\"armor\":{"
                +   "\"helmet\":" + (helmet == null ? "null" : "\"" + escJson(helmet) + "\"") + ","
                +   "\"chestplate\":" + (chestplate == null ? "null" : "\"" + escJson(chestplate) + "\"") + ","
                +   "\"leggings\":" + (leggings == null ? "null" : "\"" + escJson(leggings) + "\"") + ","
                +   "\"boots\":" + (boots == null ? "null" : "\"" + escJson(boots) + "\"")
                + "},"
                + "\"hand\":{"
                +   "\"main\":" + (mainHand == null ? "null" : "\"" + escJson(mainHand) + "\"") + ","
                +   "\"off\":" + (offHand == null ? "null" : "\"" + escJson(offHand) + "\"")
                + "},"
                + "\"items\":" + itemsJson.toString()
                + "}";
        } catch (Exception e) {
            log.warning("[Whitelist] Erro ao construir telemetria: " + e.getMessage());
            return "{\"secret\":\"" + PLUGIN_SECRET + "\",\"event\":\"" + escJson(event) + "\"}";
        }
    }

    private String formatItem(ItemStack item) {
        if (item == null || item.getType().isAir()) return null;
        String name = prettyName(item.getType().name());
        return item.getAmount() > 1 ? name + " x" + item.getAmount() : name;
    }

    private String formatItemObj(ItemStack item) {
        if (item == null || item.getType().isAir()) return null;
        String name = prettyName(item.getType().name());
        int amount = item.getAmount();
        return "{\"name\":\"" + escJson(name) + "\",\"amount\":" + amount + ",\"type\":\"" + escJson(item.getType().name()) + "\"}";
    }

    private String prettyName(String type) {
        String[] parts = type.toLowerCase().split("_");
        StringBuilder sb = new StringBuilder();
        for (String p : parts) {
            if (!p.isEmpty()) {
                sb.append(Character.toUpperCase(p.charAt(0))).append(p.substring(1)).append(" ");
            }
        }
        return sb.toString().trim();
    }

    private void postTelemetria(String nick, String json) {
        try {
            String encodedNick = URLEncoder.encode(nick, StandardCharsets.UTF_8);
            HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(TELEM_URL + encodedNick))
                .timeout(Duration.ofSeconds(4))
                .header("Content-Type", "application/json")
                .header("User-Agent", "MapaBermuda-Plugin/1.9")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();
            httpClient.send(req, HttpResponse.BodyHandlers.discarding());
        } catch (Exception ignored) {}
    }

    private String callApi(String url) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .timeout(Duration.ofSeconds(4))
            .header("User-Agent", "MapaBermuda-Plugin/1.9")
            .GET()
            .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        return response.body() != null ? response.body() : "";
    }

    private String getPlayerIp(Player player) {
        try {
            InetSocketAddress addr = player.getAddress();
            return addr != null ? addr.getAddress().getHostAddress() : "127.0.0.1";
        } catch (Exception e) { return "127.0.0.1"; }
    }

    private String cleanNick(String name) {
        if (name == null) return "";
        if (name.startsWith(".") || name.startsWith("*") || name.startsWith("_")) {
            return name.substring(1);
        }
        return name;
    }

    private String escJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").replace("\r", " ");
    }

    private String extractJsonField(String json, String field) {
        try {
            String search = "\"" + field + "\":\"";
            int start = json.indexOf(search);
            if (start != -1) {
                start += search.length();
                int end = json.indexOf("\"", start);
                if (end != -1) return json.substring(start, end);
            }
        } catch (Exception ignored) {}
        return null;
    }

    private Component buildBanMessage(String cleanName, String body) {
        boolean ipBanned = body.contains("\"ipBanned\":true");
        String reason = extractJsonField(body, "reason");
        String remaining = extractJsonField(body, "remaining");
        String ip = extractJsonField(body, "ip");
        if (reason == null || reason.isBlank()) reason = "Violacao das regras do servidor";
        if (remaining == null || remaining.isBlank()) remaining = "Permanente";

        String title = ipBanned ? "SEU IP ESTA BANIDO DO SERVIDOR!\n\n" : "VOCE ESTA BANIDO DO SERVIDOR!\n\n";

        var builder = Component.text()
            .append(Component.text(title, NamedTextColor.DARK_RED, TextDecoration.BOLD))
            .append(Component.text("Nick: ", NamedTextColor.GRAY))
            .append(Component.text(cleanName + "\n", NamedTextColor.WHITE, TextDecoration.BOLD));

        if (ipBanned && ip != null) {
            builder.append(Component.text("IP Banido: ", NamedTextColor.RED))
                   .append(Component.text(ip + "\n", NamedTextColor.YELLOW));
        }

        return builder
            .append(Component.text("Motivo: ", NamedTextColor.RED))
            .append(Component.text(reason + "\n", NamedTextColor.YELLOW))
            .append(Component.text("Tempo Restante: ", NamedTextColor.RED))
            .append(Component.text(remaining + "\n\n", NamedTextColor.GOLD, TextDecoration.BOLD))
            .append(Component.text("Mais informacoes no site:\n", NamedTextColor.GRAY))
            .append(Component.text("fffff-autoforge.vercel.app", NamedTextColor.AQUA))
            .build();
    }

    private Component buildKickMessage(String cleanName) {
        return Component.text()
            .append(Component.text("ACESSO NEGADO!\n\n", NamedTextColor.RED, TextDecoration.BOLD))
            .append(Component.text("O nick '", NamedTextColor.YELLOW))
            .append(Component.text(cleanName, NamedTextColor.WHITE, TextDecoration.BOLD))
            .append(Component.text("' nao esta na Whitelist.\n\n", NamedTextColor.YELLOW))
            .append(Component.text("Solicite acesso em:\n", NamedTextColor.WHITE))
            .append(Component.text("fffff-autoforge.vercel.app", NamedTextColor.GREEN))
            .build();
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onAsyncPreLogin(AsyncPlayerPreLoginEvent event) {
        String cleanName = cleanNick(event.getName());

        if (BYPASS.contains(cleanName.toLowerCase())) {
            log.info("[Whitelist] Admin: " + cleanName + " - Liberado!");
            return;
        }

        String clientIp = event.getAddress().getHostAddress();
        log.info("[Whitelist] Verificando '" + cleanName + "' (IP: " + clientIp + ") na API...");

        try {
            String url = API_URL + URLEncoder.encode(cleanName, StandardCharsets.UTF_8)
                + "?ip=" + URLEncoder.encode(clientIp, StandardCharsets.UTF_8);
            String body = callApi(url);

            boolean banned   = body.contains("\"banned\":true");
            boolean ipBanned = body.contains("\"ipBanned\":true");
            boolean allowed  = body.contains("\"allowed\":true");

            if (banned) {
                if (ipBanned) {
                    log.info("[Whitelist] 🚫 IP '" + clientIp + "' (" + cleanName + ") BANIDO! Bloqueando...");
                } else {
                    log.info("[Whitelist] 🔨 '" + cleanName + "' BANIDO! Bloqueando...");
                }
                event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_BANNED, buildBanMessage(cleanName, body));
            } else if (!allowed) {
                log.info("[Whitelist] ❌ '" + cleanName + "' NAO aprovado. Expulsando...");
                event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_WHITELIST, buildKickMessage(cleanName));
            } else {
                log.info("[Whitelist] ✅ '" + cleanName + "' aprovado! Acesso liberado.");
            }

        } catch (Exception e) {
            log.warning("[Whitelist] Erro na API para '" + cleanName + "': " + e.getMessage());
            event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_OTHER,
                Component.text("Erro ao verificar whitelist. Tente novamente.", NamedTextColor.RED)
            );
        }
    }
}
