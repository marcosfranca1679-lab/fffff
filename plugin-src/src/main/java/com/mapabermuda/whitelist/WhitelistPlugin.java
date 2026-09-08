package com.mapabermuda.whitelist;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Location;
import org.bukkit.Statistic;
import org.bukkit.block.Block;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
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
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

public class WhitelistPlugin extends JavaPlugin implements Listener {

    private static final String API_URL   = "https://fffff-autoforge.vercel.app/api/check/";
    private static final String TELEM_URL = "https://fffff-autoforge.vercel.app/api/telemetry/";
    private static final String SYNC_URL  = "https://fffff-autoforge.vercel.app/api/plugin/sync";
    private static final String PLUGIN_SECRET = "MapaBermuda2025Plugin";

    // 1200 ticks = 60s (telemetria de inventário e estatísticas)
    private static final long TELEM_INTERVAL_TICKS = 1200L;
    // 300 ticks = 15s (sync rápido de whitelist, bans, vidas e comandos com jogadores online)
    private static final long SYNC_ONLINE_TICKS = 300L;
    // 1200 ticks = 60s (sync em repouso quando o servidor estiver sem jogadores)
    private static final long SYNC_EMPTY_TICKS = 1200L;

    private static final Set<String> BYPASS = Set.of(
        "admin",
        "marcos",
        "marcosfranca1679"
    );

    // ── Proteção de Terreno de Reino ─────────────────────────────────────────
    public static class KingdomArea {
        public final String id;
        public final String nome;
        public final String tag;
        public final String world;
        public final int centerX;
        public final int centerZ;
        public final int radius;
        public final Set<String> members = ConcurrentHashMap.newKeySet();

        public KingdomArea(String id, String nome, String tag, String world, int centerX, int centerZ, int radius, Set<String> members) {
            this.id = id;
            this.nome = nome != null ? nome : "Reino";
            this.tag = tag != null ? tag : "REI";
            this.world = world != null ? world : "world";
            this.centerX = centerX;
            this.centerZ = centerZ;
            this.radius = Math.min(200, Math.max(1, radius));
            if (members != null) {
                for (String m : members) {
                    if (m != null && !m.isBlank()) {
                        this.members.add(m.toLowerCase().trim());
                    }
                }
            }
        }

        public boolean isInside(Location loc) {
            if (loc == null || loc.getWorld() == null) return false;
            String wName = loc.getWorld().getName().toLowerCase();
            String targetW = this.world.toLowerCase();
            if (!wName.equals(targetW) && !wName.contains(targetW) && !targetW.contains(wName)) {
                return false;
            }
            int x = loc.getBlockX();
            int z = loc.getBlockZ();
            return Math.abs(x - centerX) <= radius && Math.abs(z - centerZ) <= radius;
        }

        public boolean isMember(String nick) {
            if (nick == null) return false;
            return members.contains(nick.toLowerCase().trim());
        }
    }

    // ── Dados Locais em Memória (Sincronizados com o dados.yml) ──────────────
    private final Set<String> localWhitelist = ConcurrentHashMap.newKeySet();
    private final Map<String, BanEntry> localBans = new ConcurrentHashMap<>();
    private final Map<String, String> localIpBans = new ConcurrentHashMap<>();
    private final Map<String, Integer> localLives = new ConcurrentHashMap<>();
    private final Map<String, KingdomArea> kingdomProtections = new ConcurrentHashMap<>();
    private final Map<UUID, Long> lastProtectionNotice = new ConcurrentHashMap<>();

    public record BanEntry(String reason, String remaining) {}

    private HttpClient httpClient;
    private Logger log;
    private volatile long lastSyncTime = 0L;

    @Override
    public void onEnable() {
        this.log = getLogger();
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(4))
            .build();

        getServer().getPluginManager().registerEvents(this, this);

        // 1. Carrega dados salvos do dados.yml
        loadLocalData();

        // 2. Faz primeira sincronização com o site
        getServer().getScheduler().runTaskAsynchronously(this, this::syncWithWeb);

        // ── Task: Telemetria Periódica (a cada 60s se houver jogadores online) ──
        getServer().getScheduler().runTaskTimer(this, () -> {
            if (getServer().getOnlinePlayers().isEmpty()) return;
            for (Player player : getServer().getOnlinePlayers()) {
                String cleanName = cleanNick(player.getName());
                if (BYPASS.contains(cleanName.toLowerCase())) continue;
                String payload = buildTelemetryJson(player, cleanName, "live");
                getServer().getScheduler().runTaskAsynchronously(this, () -> postTelemetria(cleanName, payload));
            }
        }, TELEM_INTERVAL_TICKS, TELEM_INTERVAL_TICKS);

        // ── Task: Sincronização Geral Unificada ──────────────────────────────────
        // 15s com jogadores online (para bans e vidas do site refletirem rápido).
        // 60s quando vazio (para não gastar a Vercel e ainda assim puxar mudanças).
        getServer().getScheduler().runTaskTimerAsynchronously(this, () -> {
            boolean hasPlayers = !getServer().getOnlinePlayers().isEmpty();
            long now = System.currentTimeMillis();
            long requiredInterval = hasPlayers ? (SYNC_ONLINE_TICKS * 50L) : (SYNC_EMPTY_TICKS * 50L);
            if (now - lastSyncTime >= requiredInterval) {
                lastSyncTime = now;
                syncWithWeb();
            }
        }, 100L, 100L);

        log.info("Mapa Bermuda Whitelist v3.1 (Sincronização Gson + Persistência Local) - ATIVA!");
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
                    localBans.put(nick.toLowerCase().trim(), new BanEntry(r, rem));
                }
            }

            localIpBans.clear();
            ConfigurationSection ipSec = yaml.getConfigurationSection("ip_bans");
            if (ipSec != null) {
                for (String key : ipSec.getKeys(false)) {
                    String ip = key.replace("_", ".");
                    String r = ipSec.getString(key, "IP Bloqueado");
                    localIpBans.put(ip.trim(), r);
                }
            }

            localLives.clear();
            ConfigurationSection livesSec = yaml.getConfigurationSection("lives");
            if (livesSec != null) {
                for (String nick : livesSec.getKeys(false)) {
                    int l = livesSec.getInt(nick, 5);
                    localLives.put(nick.toLowerCase().trim(), l);
                }
            }

            kingdomProtections.clear();
            ConfigurationSection landsSec = yaml.getConfigurationSection("kingdom_protections");
            if (landsSec != null) {
                for (String kid : landsSec.getKeys(false)) {
                    String nome = landsSec.getString(kid + ".nome", "Reino");
                    String tag = landsSec.getString(kid + ".tag", "REI");
                    String world = landsSec.getString(kid + ".world", "world");
                    int cx = landsSec.getInt(kid + ".centerX", 0);
                    int cz = landsSec.getInt(kid + ".centerZ", 0);
                    int r = landsSec.getInt(kid + ".radius", 50);
                    List<String> memList = landsSec.getStringList(kid + ".members");
                    Set<String> memSet = ConcurrentHashMap.newKeySet();
                    if (memList != null) {
                        for (String m : memList) {
                            if (m != null && !m.isBlank()) memSet.add(m.toLowerCase().trim());
                        }
                    }
                    kingdomProtections.put(kid, new KingdomArea(kid, nome, tag, world, cx, cz, r, memSet));
                }
            }

            log.info("[LocalData] Carregados do disco: " + localWhitelist.size() + " whitelist, " 
                + localBans.size() + " bans, " + localIpBans.size() + " bans IP, " + localLives.size() + " vidas, "
                + kingdomProtections.size() + " proteções de reino.");
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

            for (Map.Entry<String, KingdomArea> e : kingdomProtections.entrySet()) {
                KingdomArea a = e.getValue();
                String path = "kingdom_protections." + e.getKey();
                yaml.set(path + ".nome", a.nome);
                yaml.set(path + ".tag", a.tag);
                yaml.set(path + ".world", a.world);
                yaml.set(path + ".centerX", a.centerX);
                yaml.set(path + ".centerZ", a.centerZ);
                yaml.set(path + ".radius", a.radius);
                yaml.set(path + ".members", new ArrayList<>(a.members));
            }

            yaml.save(file);
        } catch (Exception e) {
            log.warning("[LocalData] Erro ao salvar dados.yml: " + e.getMessage());
        }
    }

    // ── Login Inteligente: Cache Local + Consulta Imediata ao Site em caso de Bloqueio ──
    @EventHandler(priority = EventPriority.HIGHEST)
    public void onAsyncPreLogin(AsyncPlayerPreLoginEvent event) {
        String cleanName = cleanNick(event.getName());
        String lowerName = cleanName.toLowerCase().trim();

        if (BYPASS.contains(lowerName)) {
            log.info("[Whitelist] Admin: " + cleanName + " - Liberado!");
            return;
        }

        String clientIp = event.getAddress().getHostAddress().trim();

        // Se localmente o jogador já é aprovado, não está banido e tem vidas > 0:
        // ENTRADA INSTANTÂNEA (0ms, 0 Vercel)
        boolean locallyAllowed = localWhitelist.contains(lowerName) 
            && !localBans.containsKey(lowerName) 
            && !localIpBans.containsKey(clientIp) 
            && localLives.getOrDefault(lowerName, 5) > 0;

        if (locallyAllowed) {
            log.info("[Whitelist] ✅ '" + cleanName + "' liberado pelo cache local (0ms)!");
            return;
        }

        // Se o jogador está bloqueado localmente (0 vidas ou banido) ou ausente na whitelist,
        // consulta a API na hora para ver se o Admin acabou de aprovar ou dar vidas pelo site!
        log.info("[Whitelist] 🔍 Verificando status atualizado de '" + cleanName + "' no site...");
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
                String remainingReset = extractJsonField(body, "remainingReset");
                if (remainingReset == null || remainingReset.isBlank()) remainingReset = "em breve";
                event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_OTHER, buildNoLivesMessage(cleanName, remainingReset));
            } else if (allowed) {
                // Aprovado e liberado pelo site!
                localBans.remove(lowerName);
                localWhitelist.add(lowerName);

                // Sincroniza vidas informadas pela API (ex: se o admin deu vidas no site)
                String livesStr = extractJsonField(body, "lives");
                int lv = 5;
                if (livesStr != null && !livesStr.isBlank()) {
                    try { lv = Integer.parseInt(livesStr); } catch (Exception ignored) {}
                }
                localLives.put(lowerName, lv);
                saveLocalData();
                log.info("[Whitelist] ✅ '" + cleanName + "' liberado pelo site! (Vidas: " + lv + ")");
            } else {
                log.info("[Whitelist] ❌ '" + cleanName + "' não está na whitelist.");
                event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_WHITELIST, buildKickMessage(cleanName));
            }
        } catch (Exception e) {
            log.warning("[Whitelist] ⚠️ Falha ao consultar site para '" + cleanName + "': " + e.getMessage());
            // Fallback usando o estado local
            if (localBans.containsKey(lowerName)) {
                BanEntry be = localBans.get(lowerName);
                event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_BANNED, buildBanMessageDirect(cleanName, be.reason(), be.remaining(), null, false));
            } else if (localLives.getOrDefault(lowerName, 5) <= 0) {
                event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_OTHER, buildNoLivesMessage(cleanName, "em breve"));
            } else if (!localWhitelist.contains(lowerName)) {
                event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_WHITELIST, buildKickMessage(cleanName));
            }
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

    // ── Evento de Morte: Desconta Vidas Localmente e Sincroniza com o Site ──
    @EventHandler(priority = EventPriority.MONITOR)
    public void onPlayerDeath(PlayerDeathEvent event) {
        Player player = event.getEntity();
        String cleanName = cleanNick(player.getName());
        String lowerName = cleanName.toLowerCase().trim();
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

        // Notifica o site com as vidas calculadas (atualiza o painel do site e ranking)
        String world = player.getWorld() != null ? player.getWorld().getName() : "world";
        int x = (int) player.getLocation().getX();
        int y = (int) player.getLocation().getY();
        int z = (int) player.getLocation().getZ();
        String killer = player.getKiller() != null ? cleanNick(player.getKiller().getName()) : null;

        String payload = "{"
            + "\"secret\":\"" + PLUGIN_SECRET + "\","
            + "\"event\":\"death\","
            + "\"lives\":" + newLives + ","
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

    // ── Sistema de Proteção de Terreno de Reino ───────────────────────────────
    public KingdomArea getProtectedAreaAt(Location loc) {
        if (loc == null || loc.getWorld() == null) return null;
        for (KingdomArea area : kingdomProtections.values()) {
            if (area.isInside(loc)) {
                return area;
            }
        }
        return null;
    }

    public boolean canPlayerInteractAt(Player player, Location loc, KingdomArea[] matchedArea) {
        if (player == null || loc == null) return true;
        String lower = cleanNick(player.getName()).toLowerCase().trim();
        if (BYPASS.contains(lower) || player.isOp()) return true;

        KingdomArea area = getProtectedAreaAt(loc);
        if (area == null) return true;
        if (matchedArea != null && matchedArea.length > 0) matchedArea[0] = area;

        return area.isMember(lower);
    }

    private void sendProtectionNotice(Player player, KingdomArea area) {
        if (player == null || area == null) return;
        long now = System.currentTimeMillis();
        Long last = lastProtectionNotice.get(player.getUniqueId());
        if (last != null && (now - last) < 2000L) return; // Evita spam
        lastProtectionNotice.put(player.getUniqueId(), now);

        player.sendActionBar(Component.text("§c❌ Terreno protegido pelo Reino [" + area.tag + "] (" + area.nome + ")!"));
        player.sendMessage(Component.text("§c❌ [Reinos] Área protegida pelo Reino §e[" + area.tag + "]§c. Apenas membros podem interagir!"));
    }

    // Bloqueia quebrar blocos na área de outro reino
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onBlockBreak(BlockBreakEvent event) {
        Player player = event.getPlayer();
        KingdomArea[] matched = new KingdomArea[1];
        if (!canPlayerInteractAt(player, event.getBlock().getLocation(), matched)) {
            event.setCancelled(true);
            sendProtectionNotice(player, matched[0]);
        }
    }

    // Bloqueia colocar blocos na área de outro reino
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onBlockPlace(BlockPlaceEvent event) {
        Player player = event.getPlayer();
        KingdomArea[] matched = new KingdomArea[1];
        if (!canPlayerInteractAt(player, event.getBlock().getLocation(), matched)) {
            event.setCancelled(true);
            sendProtectionNotice(player, matched[0]);
        }
    }

    // Bloqueia interagir com portas, baús, alavancas, botões, alçapões, barris, fornalhas, etc.
    @EventHandler(priority = EventPriority.HIGHEST)
    public void onPlayerInteract(PlayerInteractEvent event) {
        Player player = event.getPlayer();
        Block clicked = event.getClickedBlock();
        Location targetLoc = clicked != null ? clicked.getLocation() : player.getLocation();

        if (clicked != null || event.getAction() == Action.PHYSICAL) {
            KingdomArea[] matched = new KingdomArea[1];
            if (!canPlayerInteractAt(player, targetLoc, matched)) {
                event.setCancelled(true);
                sendProtectionNotice(player, matched[0]);
            }
        }
    }

    // Bloqueia abertura de baús, funis, fornalhas e inventários em território de outro reino
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onInventoryOpen(InventoryOpenEvent event) {
        if (!(event.getPlayer() instanceof Player player)) return;
        Location invLoc = event.getInventory().getLocation();
        if (invLoc != null) {
            KingdomArea[] matched = new KingdomArea[1];
            if (!canPlayerInteractAt(player, invLoc, matched)) {
                event.setCancelled(true);
                sendProtectionNotice(player, matched[0]);
            }
        }
    }

    // Bloqueia interagir com entidades (molduras, suportes de armaduras, barcos com baú)
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onPlayerInteractEntity(PlayerInteractEntityEvent event) {
        Player player = event.getPlayer();
        Entity entity = event.getRightClicked();
        KingdomArea[] matched = new KingdomArea[1];
        if (!canPlayerInteractAt(player, entity.getLocation(), matched)) {
            event.setCancelled(true);
            sendProtectionNotice(player, matched[0]);
        }
    }

    // Bloqueia danificar entidades no território (molduras, suportes de armaduras, animais)
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onEntityDamageByEntity(EntityDamageByEntityEvent event) {
        Player damager = null;
        if (event.getDamager() instanceof Player p) {
            damager = p;
        } else if (event.getDamager() instanceof Projectile proj && proj.getShooter() instanceof Player p) {
            damager = p;
        }
        if (damager == null) return;

        KingdomArea[] matched = new KingdomArea[1];
        if (!canPlayerInteractAt(damager, event.getEntity().getLocation(), matched)) {
            event.setCancelled(true);
            sendProtectionNotice(damager, matched[0]);
        }
    }


    // ── Sincronização Robusta com o Site (Usando GSON) ────────────────────────
    public void syncWithWeb() {
        try {
            String url = SYNC_URL + "?secret=" + PLUGIN_SECRET;
            HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(5))
                .header("x-plugin-secret", PLUGIN_SECRET)
                .header("User-Agent", "MapaBermuda-Plugin/3.1")
                .GET()
                .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            String body = resp.body();
            if (body == null || body.isBlank()) return;

            JsonObject root = JsonParser.parseString(body).getAsJsonObject();
            if (!root.has("success") || !root.get("success").getAsBoolean()) return;

            // 1. Sincroniza Whitelist
            if (root.has("approved") && root.get("approved").isJsonArray()) {
                JsonArray appArr = root.getAsJsonArray("approved");
                localWhitelist.clear();
                for (JsonElement el : appArr) {
                    String n = el.getAsString().toLowerCase().trim();
                    if (!n.isEmpty()) localWhitelist.add(n);
                }
            }

            // 2. Sincroniza Bans de Nick aplicados no site
            if (root.has("bans") && root.get("bans").isJsonArray()) {
                JsonArray bansArr = root.getAsJsonArray("bans");
                localBans.clear();
                for (JsonElement el : bansArr) {
                    if (el.isJsonObject()) {
                        JsonObject bObj = el.getAsJsonObject();
                        String n = bObj.has("nick") ? bObj.get("nick").getAsString().toLowerCase().trim() : "";
                        String r = bObj.has("reason") ? bObj.get("reason").getAsString() : "Violação das regras";
                        String rem = bObj.has("remaining") ? bObj.get("remaining").getAsString() : "Permanente";
                        if (!n.isEmpty()) {
                            localBans.put(n, new BanEntry(r, rem));
                        }
                    }
                }
            }

            // 3. Sincroniza IP Bans aplicados no site
            if (root.has("ipBans") && root.get("ipBans").isJsonArray()) {
                JsonArray ipArr = root.getAsJsonArray("ipBans");
                localIpBans.clear();
                for (JsonElement el : ipArr) {
                    if (el.isJsonObject()) {
                        JsonObject ipObj = el.getAsJsonObject();
                        String ip = ipObj.has("ip") ? ipObj.get("ip").getAsString().trim() : "";
                        String r = ipObj.has("reason") ? ipObj.get("reason").getAsString() : "IP Bloqueado";
                        if (!ip.isEmpty()) {
                            localIpBans.put(ip, r);
                        }
                    }
                }
            }

            // 4. Sincroniza Vidas ajustadas pelo Administrador no site
            if (root.has("lives") && root.get("lives").isJsonObject()) {
                JsonObject livesObj = root.getAsJsonObject("lives");
                for (String nickKey : livesObj.keySet()) {
                    JsonElement entry = livesObj.get(nickKey);
                    if (entry.isJsonObject()) {
                        JsonObject pLives = entry.getAsJsonObject();
                        int lv = pLives.has("lives") ? pLives.get("lives").getAsInt() : 5;
                        localLives.put(nickKey.toLowerCase().trim(), lv);
                    }
                }
            }

            // 5. Executa Comandos Remotos do Console Web
            if (root.has("commands") && root.get("commands").isJsonArray()) {
                processCommandsJson(body);
            }

            // 6. Sincroniza Proteções de Terreno dos Reinos
            if (root.has("kingdomProtections") && root.get("kingdomProtections").isJsonArray()) {
                JsonArray kpArr = root.getAsJsonArray("kingdomProtections");
                Map<String, KingdomArea> updatedAreas = new ConcurrentHashMap<>();
                for (JsonElement el : kpArr) {
                    if (el.isJsonObject()) {
                        JsonObject o = el.getAsJsonObject();
                        String kid = o.has("id") ? o.get("id").getAsString() : "";
                        if (kid.isEmpty()) continue;
                        String nome = o.has("nome") ? o.get("nome").getAsString() : "Reino";
                        String tag = o.has("tag") ? o.get("tag").getAsString() : "REI";
                        String world = o.has("world") ? o.get("world").getAsString() : "world";
                        int cx = o.has("centerX") ? o.get("centerX").getAsInt() : 0;
                        int cz = o.has("centerZ") ? o.get("centerZ").getAsInt() : 0;
                        int r = o.has("radius") ? o.get("radius").getAsInt() : 50;

                        Set<String> mSet = ConcurrentHashMap.newKeySet();
                        if (o.has("members") && o.get("members").isJsonArray()) {
                            for (JsonElement mel : o.getAsJsonArray("members")) {
                                String mn = mel.getAsString().toLowerCase().trim();
                                if (!mn.isEmpty()) mSet.add(mn);
                            }
                        }
                        updatedAreas.put(kid, new KingdomArea(kid, nome, tag, world, cx, cz, r, mSet));
                    }
                }
                kingdomProtections.clear();
                kingdomProtections.putAll(updatedAreas);
                log.info("[Sync] 🏰 " + kingdomProtections.size() + " áreas de proteção de reinos sincronizadas.");
            }

            // Salva dados atualizados no dados.yml
            saveLocalData();

            // 6. Expulsa jogadores online que foram banidos ou zeraram vidas no site
            getServer().getScheduler().runTask(this, () -> {
                for (Player p : getServer().getOnlinePlayers()) {
                    String lower = cleanNick(p.getName()).toLowerCase().trim();
                    if (BYPASS.contains(lower)) continue;

                    if (localBans.containsKey(lower)) {
                        BanEntry be = localBans.get(lower);
                        log.info("[Sync] 🔨 Expulsando jogador banido no site: " + p.getName());
                        p.kick(buildBanMessageDirect(p.getName(), be.reason(), be.remaining(), null, false));
                    } else if (localLives.getOrDefault(lower, 5) <= 0) {
                        log.info("[Sync] 💀 Expulsando jogador sem vidas no site: " + p.getName());
                        p.kick(buildNoLivesMessage(p.getName(), "em breve"));
                    }
                }
            });

        } catch (Exception e) {
            log.warning("[Sync] Erro na sincronização: " + e.getMessage());
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
                .header("User-Agent", "MapaBermuda-Plugin/3.1")
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
                .header("User-Agent", "MapaBermuda-Plugin/3.1")
                .POST(HttpRequest.BodyPublishers.ofString(payload))
                .build();
            httpClient.send(req, HttpResponse.BodyHandlers.discarding());
        } catch (Exception ignored) {}
    }

    private String callApi(String url) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .timeout(Duration.ofSeconds(4))
            .header("User-Agent", "MapaBermuda-Plugin/3.1")
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
