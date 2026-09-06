package com.mapabermuda.whitelist;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Statistic;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.File;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

public class WhitelistPlugin extends JavaPlugin implements Listener {

    private static final String API_URL   = "https://fffff-autoforge.vercel.app/api/check/";
    private static final String TELEM_URL = "https://fffff-autoforge.vercel.app/api/telemetry/";
    private static final String SYNC_URL  = "https://fffff-autoforge.vercel.app/api/plugin/sync";
    private static final String PLUGIN_SECRET = "MapaBermuda2025Plugin";

    // 1200 ticks = 60s (telemetria periódica ao vivo)
    private static final long TELEM_INTERVAL_TICKS = 1200L;
    // 600 ticks = 30s (sync unificado quando houver jogadores online)
    private static final long SYNC_INTERVAL_TICKS = 600L;

    private static final Set<String> BYPASS = Set.of(
        "admin",
        "marcos",
        "marcosfranca1679"
    );

    // ── Dados locais em memória (Cache Ultra-Rápido e Autônomo) ──────────────
    private final Set<String> localWhitelist = ConcurrentHashMap.newKeySet();
    private final Map<String, BanEntry> localBans = new ConcurrentHashMap<>();
    private final Map<String, String> localIpBans = new ConcurrentHashMap<>();
    private final Map<String, Integer> localLives = new ConcurrentHashMap<>();

    public record BanEntry(String reason, String remaining) {}

    private HttpClient httpClient;
    private Logger log;

    @Override
    public void onEnable() {
        this.log = getLogger();
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(4))
            .build();

        getServer().getPluginManager().registerEvents(this, this);

        // 1. Carrega dados salvos localmente do disco (dados.yml)
        loadLocalData();

        // 2. Faz uma primeira sincronização inicial com o site
        getServer().getScheduler().runTaskAsynchronously(this, this::syncWithWeb);

        // ── Task: Telemetria periódica (a cada 60s se houver jogadores online) ──
        getServer().getScheduler().runTaskTimer(this, () -> {
            if (getServer().getOnlinePlayers().isEmpty()) return;
            for (Player player : getServer().getOnlinePlayers()) {
                String cleanName = cleanNick(player.getName());
                if (BYPASS.contains(cleanName.toLowerCase())) continue;
                String payload = buildTelemetryJson(player, cleanName, "live");
                getServer().getScheduler().runTaskAsynchronously(this, () -> postTelemetria(cleanName, payload));
            }
        }, TELEM_INTERVAL_TICKS, TELEM_INTERVAL_TICKS);

        // ── Task: Sincronização Geral Unificada (a cada 30s se houver jogadores) ──
        // ZERA 100% de requisições se o servidor estiver vazio (repouso total).
        getServer().getScheduler().runTaskTimerAsynchronously(this, () -> {
            if (getServer().getOnlinePlayers().isEmpty()) return;
            syncWithWeb();
        }, SYNC_INTERVAL_TICKS, SYNC_INTERVAL_TICKS);

        log.info("Mapa Bermuda Whitelist v3.0 (Armazenamento Local + Sincronização Unificada) - ATIVA!");
    }

    @Override
    public void onDisable() {
        saveLocalData();
        log.info("[Whitelist] Dados salvos localmente. Plugin desativado.");
    }

    // ── Persistência em Disco (dados.yml no ReiHosting) ──────────────────────
    private void loadLocalData() {
        try {
            if (!getDataFolder().exists()) getDataFolder().mkdirs();
            File file = new File(getDataFolder(), "dados.yml");
            if (!file.exists()) {
                file.createNewFile();
                return;
            }
            YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);

            localWhitelist.clear();
            for (String w : yaml.getStringList("whitelist")) {
                if (w != null && !w.isBlank()) localWhitelist.add(w.toLowerCase().trim());
            }

            localBans.clear();
            ConfigurationSection bansSec = yaml.getConfigurationSection("bans");
            if (bansSec != null) {
                for (String nick : bansSec.getKeys(false)) {
                    String r = bansSec.getString(nick + ".reason", "Violação das regras");
                    String rem = bansSec.getString(nick + ".remaining", "Permanente");
                    localBans.put(nick.toLowerCase(), new BanEntry(r, rem));
                }
            }

            localIpBans.clear();
            ConfigurationSection ipSec = yaml.getConfigurationSection("ip_bans");
            if (ipSec != null) {
                for (String key : ipSec.getKeys(false)) {
                    String ip = key.replace("_", ".");
                    String r = ipSec.getString(key, "IP Bloqueado");
                    localIpBans.put(ip, r);
                }
            }

            localLives.clear();
            ConfigurationSection livesSec = yaml.getConfigurationSection("lives");
            if (livesSec != null) {
                for (String nick : livesSec.getKeys(false)) {
                    int l = livesSec.getInt(nick, 5);
                    localLives.put(nick.toLowerCase(), l);
                }
            }

            log.info("[LocalData] Carregados localmente: " + localWhitelist.size() + " whitelist, " 
                + localBans.size() + " bans, " + localIpBans.size() + " bans IP, " + localLives.size() + " vidas.");
        } catch (Exception e) {
            log.warning("[LocalData] Erro ao carregar dados.yml: " + e.getMessage());
        }
    }

    private synchronized void saveLocalData() {
        try {
            if (!getDataFolder().exists()) getDataFolder().mkdirs();
            File file = new File(getDataFolder(), "dados.yml");
            YamlConfiguration yaml = new YamlConfiguration();

            yaml.set("whitelist", new ArrayList<>(localWhitelist));

            for (Map.Entry<String, BanEntry> e : localBans.entrySet()) {
                yaml.set("bans." + e.getKey() + ".reason", e.getValue().reason());
                yaml.set("bans." + e.getKey() + ".remaining", e.getValue().remaining());
            }

            for (Map.Entry<String, String> e : localIpBans.entrySet()) {
                yaml.set("ip_bans." + e.getKey().replace(".", "_"), e.getValue());
            }

            for (Map.Entry<String, Integer> e : localLives.entrySet()) {
                yaml.set("lives." + e.getKey(), e.getValue());
            }

            yaml.save(file);
        } catch (Exception e) {
            log.warning("[LocalData] Erro ao salvar dados.yml: " + e.getMessage());
        }
    }

    // ── Login Instantâneo: Validação Local Primária + Fallback no Site ───────
    @EventHandler(priority = EventPriority.HIGHEST)
    public void onAsyncPreLogin(AsyncPlayerPreLoginEvent event) {
        String cleanName = cleanNick(event.getName());
        String lowerName = cleanName.toLowerCase();

        if (BYPASS.contains(lowerName)) {
            log.info("[Whitelist] Admin: " + cleanName + " - Liberado!");
            return;
        }

        String clientIp = event.getAddress().getHostAddress();

        // 1. Checa IP Ban localmente (0ms, 0 requisições)
        if (localIpBans.containsKey(clientIp)) {
            String reason = localIpBans.get(clientIp);
            log.info("[Whitelist] 🚫 IP '" + clientIp + "' (" + cleanName + ") BANIDO LOCALMENTE!");
            event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_BANNED, buildBanMessageDirect(cleanName, reason, "Permanente", clientIp, true));
            return;
        }

        // 2. Checa Ban de Nick localmente (0ms, 0 requisições)
        if (localBans.containsKey(lowerName)) {
            BanEntry be = localBans.get(lowerName);
            log.info("[Whitelist] 🔨 '" + cleanName + "' BANIDO LOCALMENTE!");
            event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_BANNED, buildBanMessageDirect(cleanName, be.reason(), be.remaining(), null, false));
            return;
        }

        // 3. Checa Vidas localmente (0ms, 0 requisições)
        Integer lives = localLives.get(lowerName);
        if (lives != null && lives <= 0) {
            log.info("[Whitelist] 💀 '" + cleanName + "' sem vidas localmente. Bloqueando...");
            event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_OTHER, buildNoLivesMessage(cleanName, "em breve"));
            return;
        }

        // 4. Checa Whitelist localmente (0ms, 0 requisições)
        if (localWhitelist.contains(lowerName)) {
            log.info("[Whitelist] ✅ '" + cleanName + "' aprovado na memória local! Acesso imediato.");
            return;
        }

        // 5. Jogador NÃO está no cache local: consulta o site para ver se foi aprovado recentemente
        log.info("[Whitelist] 🔍 '" + cleanName + "' não encontrado localmente. Consultando site...");
        try {
            String url = API_URL + URLEncoder.encode(cleanName, StandardCharsets.UTF_8)
                + "?ip=" + URLEncoder.encode(clientIp, StandardCharsets.UTF_8);
            String body = callApi(url);

            boolean banned     = body.contains("\"banned\":true");
            boolean ipBanned   = body.contains("\"ipBanned\":true");
            boolean allowed    = body.contains("\"allowed\":true");
            boolean outOfLives = body.contains("\"outOfLives\":true");

            if (banned) {
                String reason = extractJsonField(body, "reason");
                String remaining = extractJsonField(body, "remaining");
                if (reason == null || reason.isBlank()) reason = "Violação das regras";
                if (remaining == null || remaining.isBlank()) remaining = "Permanente";
                localBans.put(lowerName, new BanEntry(reason, remaining));
                if (ipBanned) localIpBans.put(clientIp, reason);
                saveLocalData();
                event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_BANNED, buildBanMessage(cleanName, body));
            } else if (outOfLives) {
                localLives.put(lowerName, 0);
                saveLocalData();
                event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_OTHER, buildNoLivesMessage(cleanName, "em breve"));
            } else if (allowed) {
                // Aprovado no site! Adiciona à memória local e salva
                localWhitelist.add(lowerName);
                saveLocalData();
                log.info("[Whitelist] ✅ '" + cleanName + "' aprovado pelo site! Salvo nos dados locais.");
            } else {
                log.info("[Whitelist] ❌ '" + cleanName + "' não aprovado no site. Expulsando...");
                event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_WHITELIST, buildKickMessage(cleanName));
            }
        } catch (Exception e) {
            log.warning("[Whitelist] ⚠️ Erro ao consultar site para '" + cleanName + "': " + e.getMessage());
            log.warning("[Whitelist] 🔓 Permitindo entrada por segurança (fail-open).");
        }
    }

    // ── Evento de Conexão ──
    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        String cleanName = cleanNick(player.getName());
        if (BYPASS.contains(cleanName.toLowerCase())) return;

        getServer().getScheduler().runTaskLater(this, () -> {
            if (!player.isOnline()) return;
            log.info("[Whitelist] 🟢 Conexão: " + cleanName + " (IP: " + getPlayerIp(player) + ")");
            String payload = buildTelemetryJson(player, cleanName, "login");
            getServer().getScheduler().runTaskAsynchronously(this, () -> postTelemetria(cleanName, payload));
        }, 20L);
    }

    // ── Evento de Desconexão ──
    @EventHandler
    public void onPlayerQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        String cleanName = cleanNick(player.getName());
        if (BYPASS.contains(cleanName.toLowerCase())) return;

        log.info("[Whitelist] 🔴 Desconexão: " + cleanName);
        String payload = buildTelemetryJson(player, cleanName, "logout");
        getServer().getScheduler().runTaskAsynchronously(this, () -> postTelemetria(cleanName, payload));
    }

    // ── Evento de Morte: Gestão 100% Local de Vidas ──
    @EventHandler(priority = EventPriority.MONITOR)
    public void onPlayerDeath(PlayerDeathEvent event) {
        Player player = event.getEntity();
        String cleanName = cleanNick(player.getName());
        String lowerName = cleanName.toLowerCase();
        if (BYPASS.contains(lowerName)) return;

        // Desconta vida localmente
        int curLives = localLives.getOrDefault(lowerName, 5);
        int newLives = Math.max(0, curLives - 1);
        localLives.put(lowerName, newLives);
        saveLocalData();

        String deathMsg = event.getDeathMessage() != null ? event.getDeathMessage() : (cleanName + " morreu.");
        log.info("[Lives] 💀 " + cleanName + " morreu! Vidas restantes: " + newLives + "/5");

        // Mensagem na tela do jogador
        getServer().getScheduler().runTask(this, () -> {
            String hearts = "❤".repeat(newLives) + "♡".repeat(Math.max(0, 5 - newLives));
            String color = newLives <= 1 ? "§c" : newLives <= 3 ? "§6" : "§a";
            player.sendMessage(Component.text("§c❤ Você perdeu 1 vida! " + color + "Vidas: [" + hearts + "] " + newLives + "/5"));
        });

        // Se zerou vidas, expulsa do servidor
        if (newLives <= 0) {
            getServer().getScheduler().runTaskLater(this, () -> {
                if (player.isOnline()) {
                    player.kick(buildNoLivesMessage(cleanName, "em breve"));
                }
            }, 40L); // 2 segundos após morrer
        }

        // Notifica o site de forma assíncrona (1 chamada para ranking e histórico)
        String world = player.getWorld() != null ? player.getWorld().getName() : "world";
        int x = (int) player.getLocation().getX();
        int y = (int) player.getLocation().getY();
        int z = (int) player.getLocation().getZ();
        String killer = player.getKiller() != null ? cleanNick(player.getKiller().getName()) : null;

        String payload = "{"
            + "\"secret\":\"" + PLUGIN_SECRET + "\","
            + "\"event\":\"death\","
            + "\"deathMessage\":\"" + escJson(deathMsg) + "\","
            + "\"world\":\"" + escJson(world) + "\","
            + "\"x\":" + x + ",\"y\":" + y + ",\"z\":" + z + ","
            + "\"location\":\"" + x + ", " + y + ", " + z + "\","
            + "\"killer\":" + (killer == null ? "null" : "\"" + escJson(killer) + "\"")
            + "}";

        getServer().getScheduler().runTaskAsynchronously(this, () -> postTelemetria(cleanName, payload));
    }

    // ── Envia chat dos jogadores in-game para o console do admin ──────────────
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlayerChat(AsyncPlayerChatEvent event) {
        try {
            String nick = cleanNick(event.getPlayer().getName());
            String msg = event.getMessage();
            enviarLogConsole("💬 [CHAT] " + nick + ": " + msg);
        } catch (Exception ignored) {}
    }

    // ── Sincronização Geral Unificada com o Site ─────────────────────────────
    public void syncWithWeb() {
        try {
            String url = SYNC_URL + "?secret=" + PLUGIN_SECRET;
            HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(4))
                .header("x-plugin-secret", PLUGIN_SECRET)
                .header("User-Agent", "MapaBermuda-Plugin/3.0")
                .GET()
                .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            String body = resp.body();
            if (body == null || !body.contains("\"success\":true")) return;

            // 1. Atualiza Whitelist de aprovados
            int appStart = body.indexOf("\"approved\":[");
            if (appStart != -1) {
                int appEnd = body.indexOf("]", appStart);
                if (appEnd != -1) {
                    String arr = body.substring(appStart + 12, appEnd);
                    for (String part : arr.split(",")) {
                        String clean = part.replace("\"", "").trim().toLowerCase();
                        if (!clean.isEmpty()) localWhitelist.add(clean);
                    }
                }
            }

            // 2. Atualiza Vidas modificadas pelo Administrador no site
            int livesStart = body.indexOf("\"lives\":{");
            if (livesStart != -1) {
                int livesEnd = body.indexOf("}", livesStart);
                if (livesEnd != -1) {
                    String sub = body.substring(livesStart + 9, livesEnd);
                    for (String item : sub.split("},")) {
                        int colon = item.indexOf(":");
                        if (colon != -1) {
                            String n = item.substring(0, colon).replace("\"", "").trim().toLowerCase();
                            int lvIdx = item.indexOf("\"lives\":");
                            if (lvIdx != -1) {
                                int comma = item.indexOf(",", lvIdx);
                                if (comma == -1) comma = item.indexOf("}", lvIdx);
                                if (comma != -1) {
                                    String livesStr = item.substring(lvIdx + 8, comma).replaceAll("[^0-9]", "");
                                    if (!livesStr.isEmpty()) {
                                        try {
                                            localLives.put(n, Integer.parseInt(livesStr));
                                        } catch (Exception ignored) {}
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // 3. Executa comandos pendentes enviados pelo console web
            if (body.contains("\"commands\":[")) {
                processCommandsJson(body);
            }

            // Salva dados atualizados
            saveLocalData();

            // 4. Se algum jogador online estiver com 0 vidas ou banido, expulsa
            getServer().getScheduler().runTask(this, () -> {
                for (Player p : getServer().getOnlinePlayers()) {
                    String lower = cleanNick(p.getName()).toLowerCase();
                    if (BYPASS.contains(lower)) continue;

                    if (localBans.containsKey(lower)) {
                        BanEntry be = localBans.get(lower);
                        p.kick(buildBanMessageDirect(p.getName(), be.reason(), be.remaining(), null, false));
                    } else if (localLives.getOrDefault(lower, 5) <= 0) {
                        p.kick(buildNoLivesMessage(p.getName(), "em breve"));
                    }
                }
            });

        } catch (Exception e) {
            log.fine("[Sync] Erro na sincronização: " + e.getMessage());
        }
    }

    // ── Execução de comandos recebidos do console web & broadcast in-game ─────
    private boolean processCommandsJson(String json) {
        if (json == null || !json.contains("\"commands\":[")) return false;
        int startArr = json.indexOf("\"commands\":[");
        if (startArr == -1) return false;
        int endArr = json.indexOf("]", startArr);
        if (endArr == -1) return false;
        String arrContent = json.substring(startArr + 12, endArr).trim();
        if (arrContent.isEmpty() || arrContent.equals("[]")) return false;

        boolean executedAny = false;
        int idx = 0;
        while ((idx = arrContent.indexOf("{", idx)) != -1) {
            int close = arrContent.indexOf("}", idx);
            if (close == -1) break;
            String obj = arrContent.substring(idx + 1, close);
            idx = close + 1;

            String type = extractJsonField("{" + obj + "}", "type");
            String command = extractJsonField("{" + obj + "}", "command");
            String message = extractJsonField("{" + obj + "}", "message");
            String sender = extractJsonField("{" + obj + "}", "sender");
            if (sender == null || sender.isBlank()) sender = "Admin";

            if ("kick".equalsIgnoreCase(type)) {
                final String target = extractJsonField("{" + obj + "}", "target");
                if (target != null && !target.isBlank()) {
                    executedAny = true;
                    getServer().getScheduler().runTask(this, () -> {
                        Player p = getServer().getPlayerExact(target);
                        if (p == null) p = getServer().getPlayer(target);
                        if (p != null && p.isOnline()) {
                            log.info("[Lives] Expulsando jogador: " + p.getName());
                            p.kick(buildNoLivesMessage(p.getName(), "em breve"));
                        }
                    });
                }
            } else if ("broadcast".equalsIgnoreCase(type) || message != null) {
                final String broadcastMsg = message != null ? message : command;
                final String finalSender = sender;
                executedAny = true;
                getServer().getScheduler().runTask(this, () -> {
                    Component comp = Component.text()
                        .append(Component.text("[ADMIN] ", NamedTextColor.GOLD, TextDecoration.BOLD))
                        .append(Component.text(broadcastMsg, NamedTextColor.WHITE, TextDecoration.BOLD))
                        .build();
                    for (Player p : getServer().getOnlinePlayers()) {
                        p.sendMessage(comp);
                    }
                    log.info("[Console/Broadcast] " + finalSender + ": " + broadcastMsg);
                });
            } else if (command != null && !command.isBlank()) {
                final String cmdToRun = command.startsWith("/") ? command.substring(1) : command;
                executedAny = true;
                getServer().getScheduler().runTask(this, () -> {
                    log.info("[Console/Exec] Executando: /" + cmdToRun);
                    try {
                        getServer().dispatchCommand(getServer().getConsoleSender(), cmdToRun);
                    } catch (Exception e) {
                        log.warning("[Console/Exec] Erro: " + e.getMessage());
                    }
                });
            }
        }
        return executedAny;
    }

    private void enviarLogConsole(String text) {
        try {
            String url = API_URL.replace("/api/check/", "/api/plugin/console-logs?secret=" + PLUGIN_SECRET);
            String payload = "{\"logs\":[\"" + escJson(text) + "\"]}";
            HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(3))
                .header("Content-Type", "application/json")
                .header("x-plugin-secret", PLUGIN_SECRET)
                .header("User-Agent", "MapaBermuda-Plugin/3.0")
                .POST(HttpRequest.BodyPublishers.ofString(payload))
                .build();
            httpClient.send(req, HttpResponse.BodyHandlers.discarding());
        } catch (Exception ignored) {}
    }

    private void postTelemetria(String nick, String payload) {
        try {
            HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(TELEM_URL + URLEncoder.encode(nick, StandardCharsets.UTF_8)))
                .timeout(Duration.ofSeconds(4))
                .header("Content-Type", "application/json")
                .header("User-Agent", "MapaBermuda-Plugin/3.0")
                .POST(HttpRequest.BodyPublishers.ofString(payload))
                .build();
            httpClient.send(req, HttpResponse.BodyHandlers.discarding());
        } catch (Exception ignored) {}
    }

    private String callApi(String url) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .timeout(Duration.ofSeconds(4))
            .header("User-Agent", "MapaBermuda-Plugin/3.0")
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

    private Component buildBanMessageDirect(String cleanName, String reason, String remaining, String ip, boolean ipBanned) {
        if (reason == null || reason.isBlank()) reason = "Violação das regras do servidor";
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

    private Component buildBanMessage(String cleanName, String body) {
        boolean ipBanned = body.contains("\"ipBanned\":true");
        String reason = extractJsonField(body, "reason");
        String remaining = extractJsonField(body, "remaining");
        String ip = extractJsonField(body, "ip");
        return buildBanMessageDirect(cleanName, reason, remaining, ip, ipBanned);
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

    private Component buildNoLivesMessage(String cleanName, String resetIn) {
        return Component.text()
            .append(Component.text("SUAS VIDAS ACABARAM!\n\n", NamedTextColor.DARK_RED, TextDecoration.BOLD))
            .append(Component.text("Nick: ", NamedTextColor.GRAY))
            .append(Component.text(cleanName + "\n\n", NamedTextColor.WHITE, TextDecoration.BOLD))
            .append(Component.text("Voce usou todas as suas 5 vidas.\n", NamedTextColor.RED))
            .append(Component.text("Aguarde o proximo reset para voltar a jogar.\n\n", NamedTextColor.YELLOW))
            .append(Component.text("Proximo reset em: ", NamedTextColor.GRAY))
            .append(Component.text(resetIn + "\n\n", NamedTextColor.GOLD, TextDecoration.BOLD))
            .append(Component.text("Mais informacoes no site:\n", NamedTextColor.GRAY))
            .append(Component.text("fffff-autoforge.vercel.app", NamedTextColor.AQUA))
            .build();
    }

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

    private String prettyName(String raw) {
        if (raw == null) return "";
        String[] parts = raw.toLowerCase().split("_");
        StringBuilder sb = new StringBuilder();
        for (String p : parts) {
            if (!p.isEmpty()) {
                sb.append(Character.toUpperCase(p.charAt(0))).append(p.substring(1)).append(" ");
            }
        }
        return sb.toString().trim();
    }
}
