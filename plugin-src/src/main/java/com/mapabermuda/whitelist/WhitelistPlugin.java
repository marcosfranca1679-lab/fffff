package com.mapabermuda.whitelist;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Collection;
import java.util.Set;
import java.util.logging.Logger;

public class WhitelistPlugin extends JavaPlugin implements Listener {

    private static final String API_URL   = "https://fffff-autoforge.vercel.app/api/check/";
    private static final String TELEM_URL = "https://fffff-autoforge.vercel.app/api/telemetry/";
    private static final String PLUGIN_SECRET = "MapaBermuda2025Plugin";

    // Intervalo de verificação dos jogadores online (em ticks). 200 ticks = 10 segundos.
    private static final long CHECK_INTERVAL_TICKS  = 200L;
    // Intervalo de envio de telemetria periódica (em ticks). 1200 ticks = 60 segundos.
    private static final long TELEM_INTERVAL_TICKS  = 1200L;

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
            .connectTimeout(Duration.ofSeconds(6))
            .build();
        getServer().getPluginManager().registerEvents(this, this);

        // ── Task: verifica jogadores online a cada 10s ──────────────────────
        getServer().getScheduler().runTaskTimerAsynchronously(this, () -> {
            for (Player player : getServer().getOnlinePlayers()) {
                String cleanName = cleanNick(player.getName());
                if (BYPASS.contains(cleanName.toLowerCase())) continue;

                try {
                    String body = callApi(API_URL + URLEncoder.encode(cleanName, StandardCharsets.UTF_8));
                    boolean banned = body.contains("\"banned\":true");

                    if (banned) {
                        final String banBody = body;
                        log.info("[Whitelist] 🔨 '" + cleanName + "' banido online! Expulsando...");
                        getServer().getScheduler().runTask(this, () -> {
                            if (player.isOnline()) {
                                player.kick(buildBanMessage(cleanName, banBody));
                            }
                        });
                    }
                } catch (Exception e) {
                    log.fine("[Whitelist] Erro verificando '" + cleanName + "': " + e.getMessage());
                }
            }
        }, CHECK_INTERVAL_TICKS, CHECK_INTERVAL_TICKS);

        // ── Task: telemetria periódica a cada 60s ───────────────────────────
        getServer().getScheduler().runTaskTimerAsynchronously(this, () -> {
            for (Player player : getServer().getOnlinePlayers()) {
                String cleanName = cleanNick(player.getName());
                if (BYPASS.contains(cleanName.toLowerCase())) continue;
                enviarTelemetria(player, cleanName, "update");
            }
        }, TELEM_INTERVAL_TICKS, TELEM_INTERVAL_TICKS);

        log.info("Mapa Bermuda Whitelist & Ban v1.5 - ATIVA! Conectada em: " + API_URL);
    }

    @Override
    public void onDisable() {
        log.info("[Whitelist] Plugin desativado.");
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        String cleanName = cleanNick(player.getName());
        if (BYPASS.contains(cleanName.toLowerCase())) return;
        getServer().getScheduler().runTaskAsynchronously(this, () -> enviarTelemetria(player, cleanName, "login"));
    }

    @EventHandler
    public void onPlayerQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        String cleanName = cleanNick(player.getName());
        if (BYPASS.contains(cleanName.toLowerCase())) return;
        // Captura dados antes de sair (sincronamente para garantir acesso)
        int xp = player.getTotalExperience();
        int level = player.getLevel();
        double health = player.getHealth();
        int food = player.getFoodLevel();
        String world = player.getWorld().getName();
        String loc = (int)player.getLocation().getX() + "," + (int)player.getLocation().getY() + "," + (int)player.getLocation().getZ();
        String gamemode = player.getGameMode().name();
        String ip = getPlayerIp(player);

        getServer().getScheduler().runTaskAsynchronously(this, () -> {
            try {
                String payload = "{\"secret\":\"" + PLUGIN_SECRET + "\","
                    + "\"event\":\"logout\","
                    + "\"xp\":" + xp + ","
                    + "\"level\":" + level + ","
                    + "\"health\":" + String.format("%.1f", health) + ","
                    + "\"food\":" + food + ","
                    + "\"world\":\"" + escJson(world) + "\","
                    + "\"location\":\"" + escJson(loc) + "\","
                    + "\"gamemode\":\"" + escJson(gamemode) + "\","
                    + "\"ip\":\"" + escJson(ip) + "\"}";

                postTelemetria(cleanName, payload);
            } catch (Exception ignored) {}
        });
    }

    private void enviarTelemetria(Player player, String cleanName, String event) {
        try {
            int xp = player.getTotalExperience();
            int level = player.getLevel();
            double health = player.getHealth();
            int food = player.getFoodLevel();
            String world = player.getWorld().getName();
            String loc = (int)player.getLocation().getX() + "," + (int)player.getLocation().getY() + "," + (int)player.getLocation().getZ();
            String gamemode = player.getGameMode().name();
            String ip = getPlayerIp(player);
            int invSlots = countInventoryItems(player);

            String payload = "{\"secret\":\"" + PLUGIN_SECRET + "\","
                + "\"event\":\"" + escJson(event) + "\","
                + "\"xp\":" + xp + ","
                + "\"level\":" + level + ","
                + "\"health\":" + String.format("%.1f", health) + ","
                + "\"food\":" + food + ","
                + "\"world\":\"" + escJson(world) + "\","
                + "\"location\":\"" + escJson(loc) + "\","
                + "\"gamemode\":\"" + escJson(gamemode) + "\","
                + "\"ip\":\"" + escJson(ip) + "\","
                + "\"inventory_slots\":" + invSlots + "}";

            postTelemetria(cleanName, payload);
        } catch (Exception ignored) {}
    }

    private void postTelemetria(String nick, String json) {
        try {
            String encodedNick = URLEncoder.encode(nick, StandardCharsets.UTF_8);
            HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(TELEM_URL + encodedNick))
                .timeout(Duration.ofSeconds(5))
                .header("Content-Type", "application/json")
                .header("User-Agent", "MapaBermuda-Plugin/1.5")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();
            httpClient.send(req, HttpResponse.BodyHandlers.ofString());
        } catch (Exception ignored) {}
    }

    private String callApi(String url) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .timeout(Duration.ofSeconds(5))
            .header("User-Agent", "MapaBermuda-Plugin/1.5")
            .GET()
            .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        return response.body() != null ? response.body() : "";
    }

    private String getPlayerIp(Player player) {
        try {
            InetSocketAddress addr = player.getAddress();
            return addr != null ? addr.getAddress().getHostAddress() : "unknown";
        } catch (Exception e) { return "unknown"; }
    }

    private int countInventoryItems(Player player) {
        try {
            int count = 0;
            for (var item : player.getInventory().getContents()) {
                if (item != null && !item.getType().isAir()) count++;
            }
            return count;
        } catch (Exception e) { return 0; }
    }

    private String cleanNick(String name) {
        return name.startsWith(".") ? name.substring(1) : name;
    }

    private String escJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
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
        String reason = extractJsonField(body, "reason");
        String remaining = extractJsonField(body, "remaining");
        if (reason == null || reason.isBlank()) reason = "Violacao das regras do servidor";
        if (remaining == null || remaining.isBlank()) remaining = "Permanente";

        return Component.text()
            .append(Component.text("VOCE ESTA BANIDO DO SERVIDOR!\n\n", NamedTextColor.DARK_RED, TextDecoration.BOLD))
            .append(Component.text("Nick: ", NamedTextColor.GRAY))
            .append(Component.text(cleanName + "\n", NamedTextColor.WHITE, TextDecoration.BOLD))
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

        log.info("[Whitelist] Verificando '" + cleanName + "' na API...");

        try {
            String body = callApi(API_URL + URLEncoder.encode(cleanName, StandardCharsets.UTF_8));

            boolean banned  = body.contains("\"banned\":true");
            boolean allowed = body.contains("\"allowed\":true");

            if (banned) {
                log.info("[Whitelist] 🔨 '" + cleanName + "' BANIDO! Bloqueando...");
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
