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
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockDamageEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockFromToEvent;
import org.bukkit.event.block.BlockIgniteEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.event.player.PlayerBucketEmptyEvent;
import org.bukkit.event.player.PlayerBucketFillEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.block.SignChangeEvent;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.event.inventory.InventoryCreativeEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.potion.PotionEffectType;
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
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.logging.Logger;

public class WhitelistPlugin extends JavaPlugin implements Listener {

    private static final String API_URL   = "https://fffff-autoforge.vercel.app/api/check/";
    private static final String TELEM_URL = "https://fffff-autoforge.vercel.app/api/telemetry/";
    private static final String SYNC_URL  = "https://fffff-autoforge.vercel.app/api/plugin/sync";
    private static final String PLUGIN_SECRET = "MapaBermuda2025Plugin";

    // 1200 ticks = 60s (sync unificado de whitelist, bans, vidas e proteções com jogadores online)
    private static final long SYNC_ONLINE_TICKS = 1200L;

    private static final Set<String> BYPASS = Set.of(
        "admin",
        "marcos",
        "marcosfranca1679"
    );

    // ── Proteção de Terreno (Reinos e Administrador) ─────────────────────────
    public static class KingdomArea {
        public final String id;
        public final String nome;
        public final String tag;
        public final String world;
        public final int centerX;
        public final int centerZ;
        public final int radius;
        public final boolean isAdminZone;
        public final String ownerNick;
        public final Set<String> members = ConcurrentHashMap.newKeySet();

        public KingdomArea(String id, String nome, String tag, String world, int centerX, int centerZ, int radius, Set<String> members, boolean isAdminZone, String ownerNick) {
            this.id = id;
            this.nome = nome != null ? nome : (isAdminZone ? "Proteção Admin" : "Reino");
            this.tag = tag != null ? tag : (isAdminZone ? "ADMIN" : "REI");
            this.world = world != null ? world : "world";
            this.centerX = centerX;
            this.centerZ = centerZ;
            this.radius = Math.max(1, radius);
            this.isAdminZone = isAdminZone;
            this.ownerNick = (ownerNick != null && !ownerNick.isBlank()) ? ownerNick.trim() : null;

            if (this.ownerNick != null) {
                this.members.add(this.ownerNick.toLowerCase().trim());
            }

            if (members != null) {
                for (String m : members) {
                    if (m != null && !m.isBlank()) {
                        this.members.add(m.toLowerCase().trim());
                    }
                }
            }
        }

        public KingdomArea(String id, String nome, String tag, String world, int centerX, int centerZ, int radius, Set<String> members, boolean isAdminZone) {
            this(id, nome, tag, world, centerX, centerZ, radius, members, isAdminZone, null);
        }

        public KingdomArea(String id, String nome, String tag, String world, int centerX, int centerZ, int radius, Set<String> members) {
            this(id, nome, tag, world, centerX, centerZ, radius, members, false, null);
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
            String lower = nick.toLowerCase().trim();
            if (ownerNick != null && ownerNick.toLowerCase().trim().equals(lower)) return true;
            return members.contains(lower);
        }

        public int getMinX() { return centerX - radius; }
        public int getMaxX() { return centerX + radius; }
        public int getMinZ() { return centerZ - radius; }
        public int getMaxZ() { return centerZ + radius; }

        public boolean overlapsWith(KingdomArea other) {
            if (other == null || other.id.equals(this.id)) return false;
            String w1 = this.world.toLowerCase();
            String w2 = other.world.toLowerCase();
            if (!w1.equals(w2) && !w1.contains(w2) && !w2.contains(w1)) return false;

            return (this.getMinX() <= other.getMaxX()) && (this.getMaxX() >= other.getMinX())
                && (this.getMinZ() <= other.getMaxZ()) && (this.getMaxZ() >= other.getMinZ());
        }
    }

    // ── Dados Locais em Memória (Sincronizados com o dados.yml) ──────────────
    private final Set<String> localWhitelist = ConcurrentHashMap.newKeySet();
    private final Map<String, BanEntry> localBans = new ConcurrentHashMap<>();
    private final Map<String, String> localIpBans = new ConcurrentHashMap<>();
    private final Map<String, Integer> localLives = new ConcurrentHashMap<>();
    private final Map<String, KingdomArea> kingdomProtections = new ConcurrentHashMap<>();
    private final Map<String, KingdomArea> adminProtections = new ConcurrentHashMap<>();
    private final Map<UUID, Long> lastProtectionNotice = new ConcurrentHashMap<>();

    public record BanEntry(String reason, String remaining) {}
    public record LogEntry(String nick, String action, String target, String details, String world, int x, int y, int z, long createdAt) {}

    private final ConcurrentLinkedQueue<LogEntry> logQueue = new ConcurrentLinkedQueue<>();
    private File dbFile;

    private HttpClient httpClient;
    private Logger log;
    private volatile long lastSyncTime = 0L;

    // ── Anti-Cheat Integrado (Fly, X-Ray, Item Hack) ─────────────────────────
    private volatile boolean anticheatEnabled = true;
    private final Map<UUID, Integer> flyAirTicks = new ConcurrentHashMap<>();
    private final Map<UUID, Integer> flyViolations = new ConcurrentHashMap<>();
    private final Map<UUID, Location> lastSafeGround = new ConcurrentHashMap<>();
    private final Map<UUID, Long> lastDamageTime = new ConcurrentHashMap<>();
    private final Map<UUID, List<Long>> rareOreMinedTimes = new ConcurrentHashMap<>();
    private final Map<UUID, Integer> totalMinedCounter = new ConcurrentHashMap<>();


    @Override
    public void onEnable() {
        this.log = getLogger();
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(4))
            .build();

        getServer().getPluginManager().registerEvents(this, this);

        // 1. Carrega dados salvos do dados.yml
        loadLocalData();

        // 2. Inicializa SQLite local de auditoria forense e limpa logs > 7 dias
        initDatabase();

        // 3. Faz primeira sincronização com o site
        getServer().getScheduler().runTaskAsynchronously(this, this::syncWithWeb);

        // ── Task: Gravação em lote de logs forenses no SQLite (a cada 5s, sem lag) ──
        getServer().getScheduler().runTaskTimerAsynchronously(this, this::flushLogQueue, 100L, 100L);

        // ── Task: Auto-limpeza de logs com mais de 7 dias (a cada 6 horas) ─────────
        getServer().getScheduler().runTaskTimerAsynchronously(this, this::cleanOldLogs, 72000L, 432000L);

        // ── Task: Sync Combinado (telemetria + whitelist/bans em 1 único POST) ─────
        // Sempre 1 req/min independente do número de jogadores. 0 req quando vazio.
        getServer().getScheduler().runTaskTimerAsynchronously(this, () -> {
            if (getServer().getOnlinePlayers().isEmpty()) return;
            syncAll();
        }, 1200L, 1200L); // 60 segundos

        log.info("Mapa Bermuda Whitelist v3.3 (Logs Forenses + Sync Combinado 1-req/min) - ATIVA!");
    }

    @Override
    public void onDisable() {
        flushLogQueue();
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

            adminProtections.clear();
            ConfigurationSection adminLandsSec = yaml.getConfigurationSection("admin_protections");
            if (adminLandsSec != null) {
                for (String zid : adminLandsSec.getKeys(false)) {
                    String nome = adminLandsSec.getString(zid + ".nome", "Proteção Admin");
                    String world = adminLandsSec.getString(zid + ".world", "world");
                    int cx = adminLandsSec.getInt(zid + ".centerX", 0);
                    int cz = adminLandsSec.getInt(zid + ".centerZ", 0);
                    int r = adminLandsSec.getInt(zid + ".radius", 50);
                    String owner = adminLandsSec.getString(zid + ".owner", "");
                    List<String> memList = adminLandsSec.getStringList(zid + ".members");
                    Set<String> memSet = ConcurrentHashMap.newKeySet();
                    if (memList != null) {
                        for (String m : memList) {
                            if (m != null && !m.isBlank()) memSet.add(m.toLowerCase().trim());
                        }
                    }
                    adminProtections.put(zid, new KingdomArea(zid, nome, "ADMIN", world, cx, cz, r, memSet, true, owner));
                }
            }

            log.info("[LocalData] Carregados do disco: " + localWhitelist.size() + " whitelist, " 
                + localBans.size() + " bans, " + localIpBans.size() + " bans IP, " + localLives.size() + " vidas, "
                + kingdomProtections.size() + " proteções de reino, "
                + adminProtections.size() + " proteções admin.");
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

            for (Map.Entry<String, KingdomArea> e : adminProtections.entrySet()) {
                KingdomArea a = e.getValue();
                String path = "admin_protections." + e.getKey();
                yaml.set(path + ".nome", a.nome);
                yaml.set(path + ".world", a.world);
                yaml.set(path + ".centerX", a.centerX);
                yaml.set(path + ".centerZ", a.centerZ);
                yaml.set(path + ".radius", a.radius);
                yaml.set(path + ".owner", a.ownerNick != null ? a.ownerNick : "");
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

    // ── Evento de Conexão (Registra Entrada no Histórico de Sessões) ──
    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        String cleanName = cleanNick(player.getName());

        getServer().getScheduler().runTaskLater(this, () -> {
            if (!player.isOnline()) return;

            // Anti-Cheat: Detecção de Client Modificado / Cheat Brand
            if (anticheatEnabled && !player.isOp()) {
                String brand = null;
                try {
                    brand = player.getClientBrandName();
                } catch (Throwable ignored) {}

                if (brand != null) {
                    String bLower = brand.toLowerCase();
                    if (bLower.contains("wurst") || bLower.contains("meteor") || bLower.contains("aristois")
                            || bLower.contains("liquidbounce") || bLower.contains("xray") || bLower.contains("cheat")
                            || bLower.contains("hack") || bLower.contains("sigma") || bLower.contains("ares")
                            || bLower.contains("inertia") || bLower.contains("impact")) {
                        punirAntiCheat(player, "CLIENT_MOD_HACK", "Cliente/Mod hacker detectado via handshake de marca: " + brand, player.getLocation());
                        return;
                    }
                }
            }

            String ip = getPlayerIp(player);
            String world = player.getWorld() != null ? player.getWorld().getName() : "world";
            int x = player.getLocation().getBlockX();
            int y = player.getLocation().getBlockY();
            int z = player.getLocation().getBlockZ();
            log.info("[Whitelist] 🟢 Conexão: " + cleanName + " (IP: " + ip + ")");

            String payload = "{"
                + "\"secret\":\"" + PLUGIN_SECRET + "\","
                + "\"event\":\"login\","
                + "\"ip\":\"" + escJson(ip) + "\","
                + "\"world\":\"" + escJson(world) + "\","
                + "\"location\":\"" + x + ", " + y + ", " + z + "\""
                + "}";
            getServer().getScheduler().runTaskAsynchronously(this, () -> {
                postTelemetria(cleanName, payload);
                // Sincroniza dados frescos na hora que o primeiro/qualquer jogador entrar
                syncWithWeb();
            });
        }, 20L);
    }

    // ── Evento de Desconexão (Registra Saída + Stats de Jogo) ──
    @EventHandler
    public void onPlayerQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        String cleanName = cleanNick(player.getName());

        String world = player.getWorld() != null ? player.getWorld().getName() : "world";
        int x = player.getLocation().getBlockX();
        int y = player.getLocation().getBlockY();
        int z = player.getLocation().getBlockZ();
        log.info("[Whitelist] 🔴 Desconexão: " + cleanName);

        // Coleta stats de jogo (horas, kills) para atualizar reinos
        int playTicks = 0, mobKills = 0, pvpKills = 0;
        try {
            playTicks = player.getStatistic(Statistic.PLAY_ONE_MINUTE);
            mobKills  = player.getStatistic(Statistic.MOB_KILLS);
            pvpKills  = player.getStatistic(Statistic.PLAYER_KILLS);
        } catch (Exception ignored) {}
        long totalSeconds = playTicks / 20L;
        long hours = totalSeconds / 3600;
        long minutes = (totalSeconds % 3600) / 60;
        String playtimeFormatted = (hours > 0 ? hours + "h " : "") + minutes + "m";

        String payload = "{"
            + "\"secret\":\"" + PLUGIN_SECRET + "\","
            + "\"event\":\"logout\","
            + "\"world\":\"" + escJson(world) + "\","
            + "\"location\":\"" + x + ", " + y + ", " + z + "\","
            + "\"playtimeSeconds\":" + totalSeconds + ","
            + "\"playtimeFormatted\":\"" + escJson(playtimeFormatted) + "\","
            + "\"mobKills\":" + mobKills + ","
            + "\"pvpKills\":" + pvpKills
            + "}";
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

    // ── Sistema de Proteção de Terreno (Reinos e Administrador) ─────────────
    public KingdomArea getProtectedAreaAt(Location loc) {
        if (loc == null || loc.getWorld() == null) return null;
        for (KingdomArea area : adminProtections.values()) {
            if (area.isInside(loc)) {
                return area;
            }
        }
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

        if (area.isAdminZone) {
            player.sendActionBar(Component.text("§c❌ Terreno protegido: Proteção de \"" + area.nome + "\"!"));
            player.sendMessage(Component.text("§c❌ [Proteção] Terreno protegido: Proteção de §e\"" + area.nome + "\"§c!"));
        } else {
            player.sendActionBar(Component.text("§c❌ Terreno protegido pelo Reino [" + area.tag + "] (" + area.nome + ")!"));
            player.sendMessage(Component.text("§c❌ [Reinos] Área protegida pelo Reino §e[" + area.tag + "]§c. Apenas membros podem interagir!"));
        }
    }

    // 1. Bloqueia quebrar blocos na área protegida e registra ação forense se permitido
    @EventHandler(priority = EventPriority.HIGHEST)
    public void onBlockBreak(BlockBreakEvent event) {
        Player player = event.getPlayer();
        KingdomArea[] matched = new KingdomArea[1];
        if (!canPlayerInteractAt(player, event.getBlock().getLocation(), matched)) {
            event.setCancelled(true);
            sendProtectionNotice(player, matched[0]);
            return;
        }
        // Registra log forense de quebra
        if (!event.isCancelled()) {
            String cleanName = cleanNick(player.getName());
            String mat = event.getBlock().getType().name();
            Location bLoc = event.getBlock().getLocation();
            logAction(cleanName, "BREAK", mat, null, bLoc);

            // ── Anti-Cheat: Detecção de X-Ray Heurístico ────────────────────────
            if (anticheatEnabled && !player.isOp() && !BYPASS.contains(cleanName.toLowerCase())) {
                UUID pUuid = player.getUniqueId();
                totalMinedCounter.merge(pUuid, 1, Integer::sum);

                if (mat.contains("DIAMOND_ORE") || mat.contains("ANCIENT_DEBRIS") || mat.contains("EMERALD_ORE")) {
                    long now = System.currentTimeMillis();
                    List<Long> times = rareOreMinedTimes.computeIfAbsent(pUuid, k -> new ArrayList<>());
                    times.add(now);
                    // Mantém apenas minérios minerados nos últimos 3 minutos (180.000 ms)
                    times.removeIf(t -> (now - t) > 180000L);

                    if (times.size() >= 14) {
                        int count = times.size();
                        times.clear();
                        String details = "Minerou " + count + " minérios de " + prettyName(mat) + " em menos de 3 minutos (Y=" + bLoc.getBlockY() + ")";
                        punirAntiCheat(player, "XRAY_MINING", details, bLoc);
                    }
                }
            }
        }
    }

    // 2. Bloqueia dano inicial ao bloco (o bloco nem sequer trinca para quem não tem permissão)
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onBlockDamage(BlockDamageEvent event) {
        Player player = event.getPlayer();
        KingdomArea[] matched = new KingdomArea[1];
        if (!canPlayerInteractAt(player, event.getBlock().getLocation(), matched)) {
            event.setCancelled(true);
            sendProtectionNotice(player, matched[0]);
        }
    }

    // 3. Bloqueia colocar blocos na área protegida e registra ação forense se permitido
    @EventHandler(priority = EventPriority.HIGHEST)
    public void onBlockPlace(BlockPlaceEvent event) {
        Player player = event.getPlayer();
        KingdomArea[] matched = new KingdomArea[1];
        if (!canPlayerInteractAt(player, event.getBlock().getLocation(), matched)) {
            event.setCancelled(true);
            sendProtectionNotice(player, matched[0]);
            return;
        }
        // Registra log forense de colocação
        if (!event.isCancelled()) {
            String cleanName = cleanNick(player.getName());
            String mat = event.getBlockPlaced().getType().name();
            logAction(cleanName, "PLACE", mat, null, event.getBlockPlaced().getLocation());
        }
    }

    // 4. Bloqueia interagir com blocos, portas, baús, alavancas, botões, alçapões, etc.
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
                return;
            }
        }

        // Registra log forense de interação com portas, botões, alavancas, baús, etc.
        if (!event.isCancelled() && clicked != null && event.getAction() == Action.RIGHT_CLICK_BLOCK) {
            String mat = clicked.getType().name();
            if (mat.contains("DOOR") || mat.contains("TRAPDOOR") || mat.contains("GATE")) {
                logAction(cleanNick(player.getName()), "DOOR", mat, "Interagiu com porta/alçapão", clicked.getLocation());
            } else if (mat.contains("BUTTON") || mat.contains("LEVER")) {
                logAction(cleanNick(player.getName()), "INTERACT", mat, "Acionou botão/alavanca", clicked.getLocation());
            } else if (mat.contains("CHEST") || mat.contains("BARREL") || mat.contains("SHULKER_BOX")) {
                logAction(cleanNick(player.getName()), "OPEN_CONTAINER", mat, "Abriu container", clicked.getLocation());
            }
        }
    }

    // 5. Bloqueia despejar baldes de água, lava ou peixe dentro da proteção
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onPlayerBucketEmpty(PlayerBucketEmptyEvent event) {
        Player player = event.getPlayer();
        Block clicked = event.getBlockClicked();
        Block target = clicked.getRelative(event.getBlockFace());
        KingdomArea[] matched = new KingdomArea[1];

        if (!canPlayerInteractAt(player, target.getLocation(), matched) || !canPlayerInteractAt(player, clicked.getLocation(), matched)) {
            event.setCancelled(true);
            sendProtectionNotice(player, matched[0]);
        }
    }

    // 6. Bloqueia recolher líquidos com balde dentro da proteção
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onPlayerBucketFill(PlayerBucketFillEvent event) {
        Player player = event.getPlayer();
        Block clicked = event.getBlockClicked();
        KingdomArea[] matched = new KingdomArea[1];

        if (!canPlayerInteractAt(player, clicked.getLocation(), matched)) {
            event.setCancelled(true);
            sendProtectionNotice(player, matched[0]);
        }
    }

    // 7. Impede pistões (de dentro ou de fora) de empurrar blocos protegidos
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onBlockPistonExtend(BlockPistonExtendEvent event) {
        for (Block b : event.getBlocks()) {
            if (getProtectedAreaAt(b.getLocation()) != null) {
                event.setCancelled(true);
                return;
            }
        }
        // Bloco final onde o pistão vai empurrar
        Block target = event.getBlock().getRelative(event.getDirection(), event.getBlocks().size() + 1);
        if (getProtectedAreaAt(target.getLocation()) != null) {
            event.setCancelled(true);
        }
    }

    // 8. Impede pistões de puxar blocos protegidos
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onBlockPistonRetract(BlockPistonRetractEvent event) {
        for (Block b : event.getBlocks()) {
            if (getProtectedAreaAt(b.getLocation()) != null) {
                event.setCancelled(true);
                return;
            }
        }
    }

    // 9. Impede explosões de entidades (TNT, Creeper, Wither, Respawn Anchor) de quebrar blocos na proteção
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onEntityExplode(EntityExplodeEvent event) {
        event.blockList().removeIf(b -> getProtectedAreaAt(b.getLocation()) != null);
    }

    // 10. Impede explosões de blocos (Bed no Nether, TNT Block) de quebrar blocos na proteção
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onBlockExplode(BlockExplodeEvent event) {
        event.blockList().removeIf(b -> getProtectedAreaAt(b.getLocation()) != null);
    }

    // 11. Impede fogo de queimar blocos dentro da área protegida
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onBlockBurn(BlockBurnEvent event) {
        if (getProtectedAreaAt(event.getBlock().getLocation()) != null) {
            event.setCancelled(true);
        }
    }

    // 12. Impede fogo de ser ateado ou se espalhar para blocos protegidos
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onBlockIgnite(BlockIgniteEvent event) {
        if (getProtectedAreaAt(event.getBlock().getLocation()) != null) {
            if (event.getPlayer() != null) {
                KingdomArea[] matched = new KingdomArea[1];
                if (!canPlayerInteractAt(event.getPlayer(), event.getBlock().getLocation(), matched)) {
                    event.setCancelled(true);
                    sendProtectionNotice(event.getPlayer(), matched[0]);
                    return;
                }
            } else {
                event.setCancelled(true);
            }
        }
    }

    // 13. Impede água e lava de escorrer para dentro de áreas protegidas
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onBlockFromTo(BlockFromToEvent event) {
        KingdomArea toArea = getProtectedAreaAt(event.getToBlock().getLocation());
        if (toArea != null) {
            KingdomArea fromArea = getProtectedAreaAt(event.getBlock().getLocation());
            if (fromArea == null || !fromArea.id.equals(toArea.id)) {
                event.setCancelled(true);
            }
        }
    }

    // 14. Impede monstros de modificar blocos (Enderman roubar bloco, Silverfish entrar na pedra, etc.)
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onEntityChangeBlock(EntityChangeBlockEvent event) {
        if (getProtectedAreaAt(event.getBlock().getLocation()) != null) {
            if (event.getEntity() instanceof Player p) {
                KingdomArea[] matched = new KingdomArea[1];
                if (!canPlayerInteractAt(p, event.getBlock().getLocation(), matched)) {
                    event.setCancelled(true);
                    sendProtectionNotice(p, matched[0]);
                }
            } else {
                event.setCancelled(true);
            }
        }
    }

    // 15. Bloqueia abertura de baús, funis, fornalhas e inventários em território protegido
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

    // ── LISTENERS FORENSES (DROP DE ITENS, COLETA, BAÚS E PLACAS) ───────────

    // Registra quando jogador joga itens no chão
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlayerDropItem(PlayerDropItemEvent event) {
        Player player = event.getPlayer();
        ItemStack item = event.getItemDrop().getItemStack();
        String details = item.getAmount() + "x " + prettyName(item.getType().name());
        logAction(cleanNick(player.getName()), "DROP_ITEM", item.getType().name(), details, event.getItemDrop().getLocation());
    }

    // Registra quando jogador pega itens do chão
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onEntityPickupItem(EntityPickupItemEvent event) {
        if (event.getEntity() instanceof Player player) {
            ItemStack item = event.getItem().getItemStack();
            String details = item.getAmount() + "x " + prettyName(item.getType().name());
            logAction(cleanNick(player.getName()), "PICKUP_ITEM", item.getType().name(), details, player.getLocation());
        }
    }

    // Registra texto digitado em placas
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onSignChange(SignChangeEvent event) {
        Player player = event.getPlayer();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 4; i++) {
            Component c = event.line(i);
            if (c != null) {
                String line = net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer.plainText().serialize(c);
                if (!line.isBlank()) {
                    if (sb.length() > 0) sb.append(" | ");
                    sb.append(line.trim());
                }
            }
        }
        String txt = sb.length() > 0 ? sb.toString() : "[Vazia]";
        logAction(cleanNick(player.getName()), "SIGN", event.getBlock().getType().name(), "Texto: " + txt, event.getBlock().getLocation());
    }

    // Registra pegar ou colocar itens dentro de containers (baús, barris, fornalhas)
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onInventoryClick(InventoryClickEvent event) {
        if (event.getWhoClicked() instanceof Player player) {
            if (event.getClickedInventory() != null && event.getClickedInventory().getLocation() != null) {
                Location loc = event.getClickedInventory().getLocation();
                ItemStack curr = event.getCurrentItem();
                ItemStack cursor = event.getCursor();
                if (curr != null && !curr.getType().isAir()) {
                    logAction(cleanNick(player.getName()), "CONTAINER_TAKE", curr.getType().name(), curr.getAmount() + "x " + prettyName(curr.getType().name()), loc);
                } else if (cursor != null && !cursor.getType().isAir()) {
                    logAction(cleanNick(player.getName()), "CONTAINER_PUT", cursor.getType().name(), cursor.getAmount() + "x " + prettyName(cursor.getType().name()), loc);
                }
            }
        }
    }

    // ── SISTEMA ANTI-CHEAT (FLY, ITEM HACK, X-RAY & PROVAS) ───────────────────

    // Registra dano para tolerância de recuo/knockback no Anti-Fly
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onEntityDamage(EntityDamageEvent event) {
        if (event.getEntity() instanceof Player player) {
            lastDamageTime.put(player.getUniqueId(), System.currentTimeMillis());
        }
    }

    // Bloqueia e pune jogadores que tentam usar pacote Creative para puxar itens do nada
    @EventHandler(priority = EventPriority.HIGHEST)
    public void onInventoryCreative(InventoryCreativeEvent event) {
        if (!anticheatEnabled) return;
        if (!(event.getWhoClicked() instanceof Player player)) return;

        String clean = cleanNick(player.getName()).toLowerCase();
        if (player.isOp() || BYPASS.contains(clean) || player.getGameMode() == GameMode.CREATIVE) {
            return;
        }

        event.setCancelled(true);
        ItemStack item = event.getCursor();
        String itemDesc = (item != null && !item.getType().isAir()) ? item.getAmount() + "x " + item.getType().name() : "Item desconhecido";
        punirAntiCheat(player, "ITEM_HACK", "Tentou puxar item via pacote Creative sem permissão: " + itemDesc, player.getLocation());
    }

    // Monitora e bloqueia Fly Hack (apenas OPs, Criativo, Elytra ou poções podem voar)
    @EventHandler(priority = EventPriority.HIGHEST)
    public void onPlayerMove(PlayerMoveEvent event) {
        if (!anticheatEnabled) return;
        Player player = event.getPlayer();
        String clean = cleanNick(player.getName()).toLowerCase();

        // Isenções oficiais: OPs, Criativo, Espectador, Bypass
        if (player.isOp() || BYPASS.contains(clean)) return;
        if (player.getGameMode() == GameMode.CREATIVE || player.getGameMode() == GameMode.SPECTATOR) return;

        // Isenção legítima de voo planado com Elytra
        if (player.isGliding()) {
            flyAirTicks.remove(player.getUniqueId());
            return;
        }

        // Isenção de veículos (barcos, cavalos, etc.) e líquidos
        if (player.isInsideVehicle() || player.isInWater() || player.isInLava()) {
            flyAirTicks.remove(player.getUniqueId());
            return;
        }

        // Isenção de efeitos de poção de Levitação ou Queda Lenta
        if (player.hasPotionEffect(PotionEffectType.LEVITATION) || player.hasPotionEffect(PotionEffectType.SLOW_FALLING)) {
            flyAirTicks.remove(player.getUniqueId());
            return;
        }

        Location from = event.getFrom();
        Location to = event.getTo();
        if (to == null) return;

        // Tolerância de knockback por explosão/dano recente (1.5 segundos)
        long now = System.currentTimeMillis();
        Long lastDmg = lastDamageTime.get(player.getUniqueId());
        if (lastDmg != null && (now - lastDmg) < 1500L) {
            return;
        }

        // Verifica se há bloco de apoio ou se o jogador está no chão
        boolean onGround = player.isOnGround();
        if (!onGround) {
            // Checa bloco imediatamente abaixo e ao redor (raio de 1 bloco)
            Block bBelow = to.getBlock().getRelative(0, -1, 0);
            if (bBelow.getType().isSolid() || bBelow.getType() == Material.COBWEB || bBelow.getType() == Material.LADDER || bBelow.getType() == Material.VINE || bBelow.getType() == Material.SCAFFOLDING) {
                onGround = true;
            }
        }

        UUID uuid = player.getUniqueId();
        if (onGround) {
            flyAirTicks.remove(uuid);
            lastSafeGround.put(uuid, to.clone());
            return;
        }

        // Jogador está no ar sem blocos por perto:
        double deltaY = to.getY() - from.getY();
        double distHoriz = Math.hypot(to.getX() - from.getX(), to.getZ() - from.getZ());

        // Se deltaY >= -0.05, significa que ele NÃO está caindo normalmente (está flutuando, subindo ou pairando no ar)
        if (deltaY >= -0.05 && distHoriz > 0.1) {
            int ticks = flyAirTicks.merge(uuid, 1, Integer::sum);

            // Após ~1.5 segundos no ar sem cair
            if (ticks > 30) {
                // Puxa o jogador de volta para o último chão seguro
                Location ground = lastSafeGround.getOrDefault(uuid, from);
                event.setTo(ground);

                int viols = flyViolations.merge(uuid, 1, Integer::sum);
                if (viols < 3) {
                    player.sendMessage(Component.text("§c[Anti-Cheat] Voo não permitido detectado! Retornando ao chão..."));
                } else {
                    // 3ª violação confirmada -> Aplica banimento com provas
                    flyViolations.remove(uuid);
                    flyAirTicks.remove(uuid);
                    String details = "Flutuou no ar por " + ticks + " ticks com deltaY=" + String.format("%.2f", deltaY) + " em Y=" + Math.round(to.getY()) + " sem Elytra.";
                    punirAntiCheat(player, "FLY_HACK", details, to);
                }
            }
        } else {
            // Em queda livre normal
            if (deltaY < -0.2) {
                flyAirTicks.remove(uuid);
            }
        }
    }

    // Executa a punição e envia as provas técnicas para a Vercel (1 chamada única!)
    public void punirAntiCheat(Player player, String cheatType, String details, Location loc) {
        String name = cleanNick(player.getName());
        log.warning("[AntiCheat] 🚨 INFRATOR DETECTADO: " + name + " (" + cheatType + ") - " + details);

        // 1. Grava no SQLite local como registro forense
        logAction(name, "ANTICHEAT_BAN", cheatType, details, loc);

        // 2. Envia POST com provas técnicas para a Vercel de forma assíncrona (chamada única)
        getServer().getScheduler().runTaskAsynchronously(this, () -> {
            try {
                JsonObject ev = new JsonObject();
                ev.addProperty("type", cheatType);
                ev.addProperty("world", loc != null && loc.getWorld() != null ? loc.getWorld().getName() : "world");
                ev.addProperty("x", loc != null ? loc.getBlockX() : 0);
                ev.addProperty("y", loc != null ? loc.getBlockY() : 0);
                ev.addProperty("z", loc != null ? loc.getBlockZ() : 0);
                ev.addProperty("details", details);
                ev.addProperty("timestamp", System.currentTimeMillis());

                JsonObject body = new JsonObject();
                body.addProperty("secret", PLUGIN_SECRET);
                body.addProperty("nick", name);
                body.addProperty("reason", cheatType + ": " + details);
                body.add("evidence", ev);

                HttpRequest req = HttpRequest.newBuilder()
                        .uri(URI.create("https://fffff-autoforge.vercel.app/api/plugin/anticheat-ban"))
                        .timeout(Duration.ofSeconds(6))
                        .header("Content-Type", "application/json")
                        .header("x-plugin-secret", PLUGIN_SECRET)
                        .header("User-Agent", "MapaBermuda-AntiCheat/1.0")
                        .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                        .build();

                httpClient.send(req, HttpResponse.BodyHandlers.discarding());
            } catch (Exception e) {
                log.warning("[AntiCheat] Erro ao enviar provas de ban para a web: " + e.getMessage());
            }
        });

        // 3. Aplica o kick in-game na thread principal do Minecraft
        getServer().getScheduler().runTask(this, () -> {
            if (player.isOnline()) {
                player.kick(Component.text("§c🛡️ [Anti-Cheat Mapa Bermuda]\n\n§fVocê foi banido permanentemente por uso de trapaça:\n§e" + cheatType + "\n§7Telemetria e provas foram registradas no sistema."));
            }
        });
    }



    // 16. Bloqueia interagir com entidades (molduras, suportes de armaduras, barcos com baú)
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

    // 17. Bloqueia danificar entidades no território (molduras, suportes de armaduras, animais)
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

    // ── Comando in-game /reino info e verificação de território/sobreposição ──
    @EventHandler(priority = EventPriority.LOWEST)
    public void onPlayerCommandPreprocess(PlayerCommandPreprocessEvent event) {
        String msg = event.getMessage().trim().toLowerCase();
        if (msg.equals("/reino info") || msg.equals("/reino checar") || msg.equals("/reino") || msg.equals("/terreno")) {
            event.setCancelled(true);
            Player player = event.getPlayer();
            Location loc = player.getLocation();
            KingdomArea area = getProtectedAreaAt(loc);

            if (area != null) {
                if (area.isAdminZone) {
                    player.sendMessage(Component.text("§6§l🛡️ [5DAY MC] Proteção de Terreno do Administrador:"));
                    player.sendMessage(Component.text("§e• Nome: §fProteção de \"" + area.nome + "\""));
                    player.sendMessage(Component.text("§e• Mundo: §f" + area.world));
                    player.sendMessage(Component.text("§e• Centro: §fX=" + area.centerX + ", Z=" + area.centerZ));
                    player.sendMessage(Component.text("§e• Limites: §fX=[" + area.getMinX() + ".." + area.getMaxX() + "], Z=[" + area.getMinZ() + ".." + area.getMaxZ() + "]"));
                    String pNick = cleanNick(player.getName()).toLowerCase().trim();
                    boolean isAdmin = BYPASS.contains(pNick) || player.isOp();
                    boolean isOwner = area.ownerNick != null && area.ownerNick.toLowerCase().trim().equals(pNick);
                    boolean isMem = area.isMember(pNick) || isAdmin;

                    String donoTxt = (area.ownerNick != null && !area.ownerNick.isBlank()) ? area.ownerNick : "Servidor / Administrador";
                    player.sendMessage(Component.text("§e• Dono: §f" + donoTxt));

                    String statusTxt;
                    if (isOwner) statusTxt = "§a👑 Você é o Dono desta Proteção (Acesso Total)";
                    else if (isAdmin) statusTxt = "§a👑 Administrador (Acesso Total)";
                    else if (isMem) statusTxt = "§a✅ Amigo / Membro Autorizado";
                    else statusTxt = "§c❌ Não é membro (Apenas visualização)";

                    player.sendMessage(Component.text("§e• Seu Status: " + statusTxt));
                } else {
                    player.sendMessage(Component.text("§6§l🏰 [5DAY MC] Território Protegido de Reino:"));
                    player.sendMessage(Component.text("§e• Reino: §f" + area.nome + " §7[" + area.tag + "]"));
                    player.sendMessage(Component.text("§e• Centro: §fX=" + area.centerX + ", Z=" + area.centerZ));
                    player.sendMessage(Component.text("§e• Raio: §f" + area.radius + " blocos para cada lado (" + (area.radius * 2) + "×" + (area.radius * 2) + ")"));
                    player.sendMessage(Component.text("§e• Limites: §fX=[" + area.getMinX() + ".." + area.getMaxX() + "], Z=[" + area.getMinZ() + ".." + area.getMaxZ() + "]"));
                    boolean isMem = area.isMember(cleanNick(player.getName()).toLowerCase().trim()) || BYPASS.contains(cleanNick(player.getName()).toLowerCase().trim());
                    player.sendMessage(Component.text("§e• Seu Status: " + (isMem ? "§a✅ Membro autorizado" : "§c❌ Não é membro (Apenas visualização)")));
                }
            } else {
                player.sendMessage(Component.text("§a§l🌍 [5DAY MC] Território Livre!"));
                player.sendMessage(Component.text("§7Nenhum reino possui proteção nesta área (Coordenadas atuais: X=" + loc.getBlockX() + ", Z=" + loc.getBlockZ() + ")."));
            }
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

            // 5.5. Processa Consultas de Logs Forenses solicitadas pelo Admin no Site
            if (root.has("logQueries") && root.get("logQueries").isJsonArray()) {
                processLogQueries(root.getAsJsonArray("logQueries"));
            }

            // 5.6. Sincroniza estado do Anti-Cheat (Ativado/Desativado no Painel Admin)
            if (root.has("anticheatEnabled")) {
                this.anticheatEnabled = root.get("anticheatEnabled").getAsBoolean();
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

            // 7. Sincroniza Proteções de Terreno do Administrador
            if (root.has("adminProtections") && root.get("adminProtections").isJsonArray()) {
                JsonArray apArr = root.getAsJsonArray("adminProtections");
                Map<String, KingdomArea> updatedAdminAreas = new ConcurrentHashMap<>();
                for (JsonElement el : apArr) {
                    if (el.isJsonObject()) {
                        JsonObject o = el.getAsJsonObject();
                        String zid = o.has("id") ? o.get("id").getAsString() : "";
                        if (zid.isEmpty()) continue;
                        String nome = o.has("name") ? o.get("name").getAsString() : "Proteção Admin";
                        String world = o.has("world") ? o.get("world").getAsString() : "world";
                        int cx = o.has("centerX") ? o.get("centerX").getAsInt() : 0;
                        int cz = o.has("centerZ") ? o.get("centerZ").getAsInt() : 0;
                        int r = o.has("radius") ? o.get("radius").getAsInt() : 50;
                        String ownerNick = o.has("ownerNick") ? o.get("ownerNick").getAsString() : "";

                        Set<String> mSet = ConcurrentHashMap.newKeySet();
                        if (o.has("members") && o.get("members").isJsonArray()) {
                            for (JsonElement mel : o.getAsJsonArray("members")) {
                                String mn = mel.getAsString().toLowerCase().trim();
                                if (!mn.isEmpty()) mSet.add(mn);
                            }
                        }

                        updatedAdminAreas.put(zid, new KingdomArea(zid, nome, "ADMIN", world, cx, cz, r, mSet, true, ownerNick));
                    }
                }
                adminProtections.clear();
                adminProtections.putAll(updatedAdminAreas);
                log.info("[Sync] 🛡️ " + adminProtections.size() + " áreas de proteção do administrador sincronizadas.");
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

    // ── Sync Combinado: 1 POST com telemetria de todos + retorna dados de sync ──
    public void syncAll() {
        try {
            Collection<? extends Player> online = getServer().getOnlinePlayers();
            if (online.isEmpty()) return;

            // Monta array JSON com dados de todos os jogadores
            StringBuilder playersArr = new StringBuilder("[");
            boolean firstP = true;
            for (Player p : online) {
                String name = cleanNick(p.getName());
                String playerJson = buildTelemetryJson(p, name, "live");
                if (playerJson == null) continue;
                // Injeta "nick" no objeto (buildTelemetryJson não inclui)
                String withNick = "{\"nick\":\"" + escJson(name) + "\"," + playerJson.substring(1);
                if (!firstP) playersArr.append(",");
                playersArr.append(withNick);
                firstP = false;
            }
            playersArr.append("]");

            String body = "{\"secret\":\"" + PLUGIN_SECRET + "\",\"players\":" + playersArr + "}";

            HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(SYNC_URL))
                .timeout(Duration.ofSeconds(8))
                .header("Content-Type", "application/json")
                .header("x-plugin-secret", PLUGIN_SECRET)
                .header("User-Agent", "MapaBermuda-Plugin/3.2")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            String respBody = resp.body();
            if (respBody == null || respBody.isBlank()) return;

            // Processa resposta de sync igual ao syncWithWeb()
            JsonObject root = JsonParser.parseString(respBody).getAsJsonObject();
            if (!root.has("success") || !root.get("success").getAsBoolean()) return;

            if (root.has("approved") && root.get("approved").isJsonArray()) {
                JsonArray appArr = root.getAsJsonArray("approved");
                localWhitelist.clear();
                for (JsonElement el : appArr) {
                    String n = el.getAsString().toLowerCase().trim();
                    if (!n.isEmpty()) localWhitelist.add(n);
                }
            }
            if (root.has("bans") && root.get("bans").isJsonArray()) {
                JsonArray bansArr = root.getAsJsonArray("bans");
                localBans.clear();
                for (JsonElement el : bansArr) {
                    if (el.isJsonObject()) {
                        JsonObject bObj = el.getAsJsonObject();
                        String n = bObj.has("nick") ? bObj.get("nick").getAsString().toLowerCase().trim() : "";
                        String r = bObj.has("reason") ? bObj.get("reason").getAsString() : "Violação das regras";
                        String rem = bObj.has("remaining") ? bObj.get("remaining").getAsString() : "Permanente";
                        if (!n.isEmpty()) localBans.put(n, new BanEntry(r, rem));
                    }
                }
            }
            if (root.has("ipBans") && root.get("ipBans").isJsonArray()) {
                JsonArray ipArr = root.getAsJsonArray("ipBans");
                localIpBans.clear();
                for (JsonElement el : ipArr) {
                    if (el.isJsonObject()) {
                        JsonObject ipObj = el.getAsJsonObject();
                        String ip = ipObj.has("ip") ? ipObj.get("ip").getAsString().trim() : "";
                        String r = ipObj.has("reason") ? ipObj.get("reason").getAsString() : "IP Bloqueado";
                        if (!ip.isEmpty()) localIpBans.put(ip, r);
                    }
                }
            }
            if (root.has("lives") && root.get("lives").isJsonObject()) {
                JsonObject livesObj = root.getAsJsonObject("lives");
                for (String nickKey : livesObj.keySet()) {
                    JsonElement entry = livesObj.get(nickKey);
                    if (entry.isJsonObject()) {
                        int lv = entry.getAsJsonObject().has("lives") ? entry.getAsJsonObject().get("lives").getAsInt() : 5;
                        localLives.put(nickKey.toLowerCase().trim(), lv);
                    }
                }
            }
            if (root.has("commands") && root.get("commands").isJsonArray()) {
                processCommandsJson(respBody);
            }
            if (root.has("logQueries") && root.get("logQueries").isJsonArray()) {
                processLogQueries(root.getAsJsonArray("logQueries"));
            }
            if (root.has("anticheatEnabled")) {
                this.anticheatEnabled = root.get("anticheatEnabled").getAsBoolean();
            }


            if (root.has("kingdomProtections") && root.get("kingdomProtections").isJsonArray()) {
                JsonArray kpArr = root.getAsJsonArray("kingdomProtections");
                Map<String, KingdomArea> updated = new ConcurrentHashMap<>();
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
                        updated.put(kid, new KingdomArea(kid, nome, tag, world, cx, cz, r, mSet));
                    }
                }
                kingdomProtections.clear();
                kingdomProtections.putAll(updated);
            }
            if (root.has("adminProtections") && root.get("adminProtections").isJsonArray()) {
                JsonArray apArr = root.getAsJsonArray("adminProtections");
                Map<String, KingdomArea> updatedAdmin = new ConcurrentHashMap<>();
                for (JsonElement el : apArr) {
                    if (el.isJsonObject()) {
                        JsonObject o = el.getAsJsonObject();
                        String zid = o.has("id") ? o.get("id").getAsString() : "";
                        if (zid.isEmpty()) continue;
                        String nome = o.has("name") ? o.get("name").getAsString() : "Proteção Admin";
                        String world = o.has("world") ? o.get("world").getAsString() : "world";
                        int cx = o.has("centerX") ? o.get("centerX").getAsInt() : 0;
                        int cz = o.has("centerZ") ? o.get("centerZ").getAsInt() : 0;
                        int r = o.has("radius") ? o.get("radius").getAsInt() : 50;
                        String ownerNick = o.has("ownerNick") ? o.get("ownerNick").getAsString() : "";
                        Set<String> mSet = ConcurrentHashMap.newKeySet();
                        if (o.has("members") && o.get("members").isJsonArray()) {
                            for (JsonElement mel : o.getAsJsonArray("members")) {
                                String mn = mel.getAsString().toLowerCase().trim();
                                if (!mn.isEmpty()) mSet.add(mn);
                            }
                        }
                        updatedAdmin.put(zid, new KingdomArea(zid, nome, "ADMIN", world, cx, cz, r, mSet, true, ownerNick));
                    }
                }
                adminProtections.clear();
                adminProtections.putAll(updatedAdmin);
            }

            saveLocalData();

            // Expulsa jogadores banidos ou sem vidas
            getServer().getScheduler().runTask(this, () -> {
                for (Player p : getServer().getOnlinePlayers()) {
                    String lower = cleanNick(p.getName()).toLowerCase().trim();
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
            log.warning("[SyncAll] Erro: " + e.getMessage());
        }
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

    // ── SISTEMA FORENSE LOCAL (SQLITE + FILA ASSÍNCRONA) ────────────────────

    private void initDatabase() {
        try {
            if (!getDataFolder().exists()) getDataFolder().mkdirs();
            dbFile = new File(getDataFolder(), "logs.db");
            try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + dbFile.getAbsolutePath());
                 Statement st = conn.createStatement()) {
                st.execute("CREATE TABLE IF NOT EXISTS action_logs (" +
                        "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                        "nick TEXT NOT NULL," +
                        "action TEXT NOT NULL," +
                        "target TEXT," +
                        "details TEXT," +
                        "world TEXT NOT NULL," +
                        "x INTEGER NOT NULL," +
                        "y INTEGER NOT NULL," +
                        "z INTEGER NOT NULL," +
                        "created_at INTEGER NOT NULL" +
                        ");");
                st.execute("CREATE INDEX IF NOT EXISTS idx_coords ON action_logs(world, x, z);");
                st.execute("CREATE INDEX IF NOT EXISTS idx_time ON action_logs(created_at);");
            }
            log.info("[Forensic] Banco de dados SQLite de auditoria pronto!");
            cleanOldLogs();
        } catch (Exception e) {
            log.severe("[Forensic] Erro ao inicializar SQLite: " + e.getMessage());
        }
    }

    public void logAction(String nick, String action, String target, String details, Location loc) {
        if (loc == null || loc.getWorld() == null || nick == null) return;
        logQueue.add(new LogEntry(
                nick,
                action,
                target != null ? target : "",
                details != null ? details : "",
                loc.getWorld().getName(),
                loc.getBlockX(),
                loc.getBlockY(),
                loc.getBlockZ(),
                System.currentTimeMillis()
        ));
    }

    private void flushLogQueue() {
        if (logQueue.isEmpty() || dbFile == null) return;
        List<LogEntry> batch = new ArrayList<>();
        LogEntry entry;
        while ((entry = logQueue.poll()) != null && batch.size() < 500) {
            batch.add(entry);
        }
        if (batch.isEmpty()) return;

        try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + dbFile.getAbsolutePath());
             PreparedStatement ps = conn.prepareStatement(
                     "INSERT INTO action_logs (nick, action, target, details, world, x, y, z, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")) {
            conn.setAutoCommit(false);
            for (LogEntry e : batch) {
                ps.setString(1, e.nick());
                ps.setString(2, e.action());
                ps.setString(3, e.target());
                ps.setString(4, e.details());
                ps.setString(5, e.world());
                ps.setInt(6, e.x());
                ps.setInt(7, e.y());
                ps.setInt(8, e.z());
                ps.setLong(9, e.createdAt());
                ps.addBatch();
            }
            ps.executeBatch();
            conn.commit();
        } catch (Exception e) {
            log.warning("[Forensic] Erro ao gravar lote no SQLite: " + e.getMessage());
        }
    }

    private void cleanOldLogs() {
        if (dbFile == null || !dbFile.exists()) return;
        try {
            long cutoff = System.currentTimeMillis() - (7L * 24 * 3600 * 1000); // 7 dias
            try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + dbFile.getAbsolutePath());
                 PreparedStatement ps = conn.prepareStatement("DELETE FROM action_logs WHERE created_at < ?")) {
                ps.setLong(1, cutoff);
                int deleted = ps.executeUpdate();
                if (deleted > 0) {
                    log.info("[Forensic] Limpeza de 7 dias: " + deleted + " logs antigos foram excluídos.");
                }
            }
        } catch (Exception e) {
            log.warning("[Forensic] Erro na limpeza de logs: " + e.getMessage());
        }
    }

    // ── PROCESSAMENTO DE CONSULTAS DE LOGS VINDAS DO SITE ───────────────────

    private void processLogQueries(JsonArray queries) {
        if (queries == null || queries.isEmpty()) return;
        getServer().getScheduler().runTaskAsynchronously(this, () -> {
            for (JsonElement el : queries) {
                if (el.isJsonObject()) {
                    executeLogQuery(el.getAsJsonObject());
                }
            }
        });
    }

    private void executeLogQuery(JsonObject q) {
        if (dbFile == null || !dbFile.exists()) return;
        String queryId = q.has("queryId") ? q.get("queryId").getAsString() : "";
        if (queryId.isEmpty()) return;

        String world = q.has("world") ? q.get("world").getAsString() : "world";
        int cx = q.has("x") ? q.get("x").getAsInt() : 0;
        Integer cy = q.has("y") && !q.get("y").isJsonNull() ? q.get("y").getAsInt() : null;
        int cz = q.has("z") ? q.get("z").getAsInt() : 0;
        int radius = q.has("radius") ? q.get("radius").getAsInt() : 10;
        String filterNick = q.has("filterNick") && !q.get("filterNick").isJsonNull() ? q.get("filterNick").getAsString().toLowerCase().trim() : null;
        String filterAction = q.has("filterAction") && !q.get("filterAction").isJsonNull() ? q.get("filterAction").getAsString().toUpperCase().trim() : null;

        int minX = cx - radius;
        int maxX = cx + radius;
        int minZ = cz - radius;
        int maxZ = cz + radius;
        long rSq = (long) radius * radius;

        JsonArray results = new JsonArray();

        // Antes de consultar, grava o que estiver pendente na fila
        flushLogQueue();

        String sql = "SELECT nick, action, target, details, world, x, y, z, created_at FROM action_logs " +
                "WHERE world = ? AND x BETWEEN ? AND ? AND z BETWEEN ? AND ? " +
                "ORDER BY created_at DESC LIMIT 400";

        try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + dbFile.getAbsolutePath());
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, world);
            ps.setInt(2, minX);
            ps.setInt(3, maxX);
            ps.setInt(4, minZ);
            ps.setInt(5, maxZ);

            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    int x = rs.getInt("x");
                    int y = rs.getInt("y");
                    int z = rs.getInt("z");

                    // Verificação do raio euclidiano
                    long dx = x - cx;
                    long dz = z - cz;
                    if ((dx * dx + dz * dz) > rSq) continue;
                    if (cy != null && Math.abs(y - cy) > radius) continue;

                    String nick = rs.getString("nick");
                    String action = rs.getString("action");

                    if (filterNick != null && !filterNick.isEmpty() && !nick.toLowerCase().contains(filterNick)) continue;
                    if (filterAction != null && !filterAction.isEmpty() && !action.equalsIgnoreCase(filterAction)) continue;

                    JsonObject item = new JsonObject();
                    item.addProperty("nick", nick);
                    item.addProperty("action", action);
                    item.addProperty("target", rs.getString("target"));
                    item.addProperty("details", rs.getString("details"));
                    item.addProperty("world", rs.getString("world"));
                    item.addProperty("x", x);
                    item.addProperty("y", y);
                    item.addProperty("z", z);
                    item.addProperty("created_at", rs.getLong("created_at"));
                    results.add(item);
                }
            }

            // Envia resposta para a Vercel
            JsonObject respObj = new JsonObject();
            respObj.addProperty("queryId", queryId);
            respObj.addProperty("secret", PLUGIN_SECRET);
            respObj.add("results", results);

            String url = "https://fffff-autoforge.vercel.app/api/plugin/logs-response";
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(10))
                    .header("Content-Type", "application/json")
                    .header("x-plugin-secret", PLUGIN_SECRET)
                    .header("User-Agent", "MapaBermuda-Plugin/3.3")
                    .POST(HttpRequest.BodyPublishers.ofString(respObj.toString()))
                    .build();

            httpClient.send(req, HttpResponse.BodyHandlers.discarding());
            log.info("[Forensic] Consulta " + queryId + " respondida com " + results.size() + " registros.");

        } catch (Exception e) {
            log.warning("[Forensic] Erro ao executar consulta de logs: " + e.getMessage());
        }
    }
}


