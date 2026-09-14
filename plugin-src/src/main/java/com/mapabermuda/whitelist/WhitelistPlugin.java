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
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.inventory.meta.SkullMeta;
import org.bukkit.Material;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.event.inventory.InventoryClickEvent;
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

    public static class UserSession {
        public final String nick;
        public final String email;
        public final String token;
        public final boolean isAdmin;
        public final long loggedAt;

        public UserSession(String nick, String email, String token, boolean isAdmin) {
            this.nick = nick;
            this.email = email;
            this.token = token;
            this.isAdmin = isAdmin;
            this.loggedAt = System.currentTimeMillis();
        }
    }

    private final Map<String, UserSession> activeSessions = new ConcurrentHashMap<>();

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

        // Registro de comandos in-game (liberados para todos os jogadores)
        if (getCommand("painel") != null) getCommand("painel").setExecutor(this);
        if (getCommand("reino") != null) getCommand("reino").setExecutor(this);
        if (getCommand("terreno") != null) getCommand("terreno").setExecutor(this);

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

            activeSessions.clear();
            ConfigurationSection sessSec = yaml.getConfigurationSection("sessions");
            if (sessSec != null) {
                for (String sKey : sessSec.getKeys(false)) {
                    String sn = sessSec.getString(sKey + ".nick", sKey);
                    String se = sessSec.getString(sKey + ".email", "");
                    String st = sessSec.getString(sKey + ".token", "");
                    boolean sa = sessSec.getBoolean(sKey + ".isAdmin", false);
                    activeSessions.put(sKey.toLowerCase().trim(), new UserSession(sn, se, st, sa));
                }
            }

            log.info("[LocalData] Carregados do disco: " + localWhitelist.size() + " whitelist, " 
                + localBans.size() + " bans, " + localIpBans.size() + " bans IP, " + localLives.size() + " vidas, "
                + kingdomProtections.size() + " proteções de reino, "
                + adminProtections.size() + " proteções admin, "
                + activeSessions.size() + " sessões ativas.");
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

            for (Map.Entry<String, UserSession> entry : activeSessions.entrySet()) {
                String k = entry.getKey();
                UserSession s = entry.getValue();
                yaml.set("sessions." + k + ".nick", s.nick);
                yaml.set("sessions." + k + ".email", s.email);
                yaml.set("sessions." + k + ".token", s.token);
                yaml.set("sessions." + k + ".isAdmin", s.isAdmin);
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

    // 1. Bloqueia quebrar blocos na área protegida (mesmo se o jogador estiver fora alcançando a borda)
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onBlockBreak(BlockBreakEvent event) {
        Player player = event.getPlayer();
        KingdomArea[] matched = new KingdomArea[1];
        if (!canPlayerInteractAt(player, event.getBlock().getLocation(), matched)) {
            event.setCancelled(true);
            sendProtectionNotice(player, matched[0]);
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

    // 3. Bloqueia colocar blocos na área protegida
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onBlockPlace(BlockPlaceEvent event) {
        Player player = event.getPlayer();
        KingdomArea[] matched = new KingdomArea[1];
        if (!canPlayerInteractAt(player, event.getBlock().getLocation(), matched)) {
            event.setCancelled(true);
            sendProtectionNotice(player, matched[0]);
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

    // ── Holder para Menus Customizados (compatível 100% com Java e Bedrock) ──
    public static class PainelMenuHolder implements org.bukkit.inventory.InventoryHolder {
        private final String menuTipo;
        public PainelMenuHolder(String menuTipo) {
            this.menuTipo = menuTipo;
        }
        public String getMenuTipo() {
            return menuTipo;
        }
        @Override
        public Inventory getInventory() {
            return null;
        }
    }

    public boolean isPlayerAdmin(Player player) {
        if (player == null) return false;
        String clean = cleanNick(player.getName()).toLowerCase().trim();
        if (BYPASS.contains(clean) || player.isOp()) return true;
        UserSession s = activeSessions.get(clean);
        return s != null && s.isAdmin;
    }

    // ── Tratamento Oficial de Comandos Bukkit/Paper ──────────────────────────
    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("§cApenas jogadores no jogo podem usar este comando.");
            return true;
        }

        String cmd = command.getName().toLowerCase();
        if (cmd.equals("reino")) {
            if (args.length > 0 && (args[0].equalsIgnoreCase("info") || args[0].equalsIgnoreCase("checar"))) {
                exibirInfoTerritorio(player);
            } else {
                abrirMenuReinos(player);
            }
            return true;
        }

        if (cmd.equals("terreno")) {
            if (args.length > 0 && (args[0].equalsIgnoreCase("info") || args[0].equalsIgnoreCase("checar"))) {
                exibirInfoTerritorio(player);
            } else {
                abrirMenuTerrenos(player);
            }
            return true;
        }

        if (cmd.equals("painel") || cmd.equals("menu") || cmd.equals("p")) {
            if (args.length >= 3 && args[0].equalsIgnoreCase("login")) {
                fazerLoginSite(player, args[1], args[2]);
                return true;
            }
            if (args.length >= 1 && args[0].equalsIgnoreCase("logout")) {
                activeSessions.remove(cleanNick(player.getName()).toLowerCase().trim());
                saveLocalData();
                player.sendMessage(Component.text("§e[5DAY MC] Você desconectou da sua conta do site."));
                return true;
            }
            if (args.length >= 1 && args[0].equalsIgnoreCase("reino")) {
                abrirMenuReinos(player);
                return true;
            }
            if (args.length >= 1 && (args[0].equalsIgnoreCase("terreno") || args[0].equalsIgnoreCase("terrenos"))) {
                abrirMenuTerrenos(player);
                return true;
            }
            if (args.length >= 1 && args[0].equalsIgnoreCase("admin")) {
                if (isPlayerAdmin(player)) {
                    abrirMenuAdmin(player);
                } else {
                    player.sendMessage(Component.text("§c[5DAY MC] Acesso restrito. Faça login com a conta de Administrador usando /painel login <email> <senha>"));
                }
                return true;
            }

            abrirMenuPrincipal(player);
            return true;
        }

        return false;
    }

    // ── Interceptador de Comandos para Segurança e Acesso Rápido ────────────
    @EventHandler(priority = EventPriority.LOWEST)
    public void onPlayerCommandPreprocess(PlayerCommandPreprocessEvent event) {
        String fullMsg = event.getMessage().trim();
        String[] parts = fullMsg.split("\\s+");
        if (parts.length == 0) return;
        String baseCmd = parts[0].toLowerCase();

        if (baseCmd.equals("/painel") || baseCmd.equals("/menu") || baseCmd.equals("/p")) {
            if (parts.length >= 3 && parts[1].equalsIgnoreCase("login")) {
                event.setCancelled(true);
                fazerLoginSite(event.getPlayer(), parts[2], parts[3]);
                return;
            }
            if (parts.length == 1) {
                event.setCancelled(true);
                abrirMenuPrincipal(event.getPlayer());
                return;
            }
        }
        if (baseCmd.equals("/reino")) {
            if (parts.length == 1) {
                event.setCancelled(true);
                abrirMenuReinos(event.getPlayer());
                return;
            }
            if (parts.length > 1 && (parts[1].equalsIgnoreCase("info") || parts[1].equalsIgnoreCase("checar"))) {
                event.setCancelled(true);
                exibirInfoTerritorio(event.getPlayer());
                return;
            }
        }
        if (baseCmd.equals("/terreno")) {
            if (parts.length == 1) {
                event.setCancelled(true);
                abrirMenuTerrenos(event.getPlayer());
                return;
            }
            if (parts.length > 1 && (parts[1].equalsIgnoreCase("info") || parts[1].equalsIgnoreCase("checar"))) {
                event.setCancelled(true);
                exibirInfoTerritorio(event.getPlayer());
                return;
            }
        }
    }

    // ── Login Assíncrono com o Site (Supabase / Vercel API) ─────────────────
    private void fazerLoginSite(Player player, String loginOrEmail, String password) {
        player.sendMessage(Component.text("§e[5DAY MC] Verificando credenciais no site..."));
        getServer().getScheduler().runTaskAsynchronously(this, () -> {
            try {
                JsonObject json = new JsonObject();
                json.addProperty("login", loginOrEmail);
                json.addProperty("password", password);

                HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create("https://fffff-autoforge.vercel.app/api/auth/login"))
                    .header("Content-Type", "application/json")
                    .header("User-Agent", "5DAY-MC-Plugin")
                    .timeout(Duration.ofSeconds(6))
                    .POST(HttpRequest.BodyPublishers.ofString(json.toString(), StandardCharsets.UTF_8))
                    .build();

                HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() == 200) {
                    JsonObject resp = JsonParser.parseString(response.body()).getAsJsonObject();
                    if (resp.has("success") && resp.get("success").getAsBoolean()) {
                        String token = resp.has("token") ? resp.get("token").getAsString() : "";
                        boolean isAdmin = resp.has("isAdmin") && resp.get("isAdmin").getAsBoolean();
                        String userNick = cleanNick(player.getName());
                        if (resp.has("user") && resp.getAsJsonObject("user").has("nick")) {
                            userNick = resp.getAsJsonObject("user").get("nick").getAsString();
                        }

                        String key = cleanNick(player.getName()).toLowerCase().trim();
                        activeSessions.put(key, new UserSession(userNick, loginOrEmail, token, isAdmin));
                        saveLocalData();

                        final boolean fIsAdmin = isAdmin;
                        final String fNick = userNick;
                        getServer().getScheduler().runTask(this, () -> {
                            player.sendMessage(Component.text("§a✔ [5DAY MC] Login realizado com sucesso!"));
                            player.sendMessage(Component.text("§eBem-vindo(a), §f" + fNick + (fIsAdmin ? " §c§l[ADMINISTRADOR]" : "") + "§e!"));
                            abrirMenuPrincipal(player);
                        });
                        return;
                    }
                }

                String err = "Email/Nick ou senha incorretos.";
                try {
                    JsonObject errObj = JsonParser.parseString(response.body()).getAsJsonObject();
                    if (errObj.has("error")) err = errObj.get("error").getAsString();
                } catch (Exception ignored) {}

                final String finalErr = err;
                getServer().getScheduler().runTask(this, () -> {
                    player.sendMessage(Component.text("§c❌ [5DAY MC] " + finalErr));
                });
            } catch (Exception e) {
                getServer().getScheduler().runTask(this, () -> {
                    player.sendMessage(Component.text("§c❌ [5DAY MC] Falha ao conectar ao site: " + e.getMessage()));
                });
            }
        });
    }

    // ── Helper para Criar Itens Decorados ────────────────────────────────────
    private ItemStack criarItem(Material material, String nome, String... lore) {
        ItemStack item = new ItemStack(material);
        ItemMeta meta = item.getItemMeta();
        if (meta != null) {
            meta.displayName(Component.text(nome));
            if (lore != null && lore.length > 0) {
                List<Component> loreList = new ArrayList<>();
                for (String l : lore) {
                    loreList.add(Component.text(l));
                }
                meta.lore(loreList);
            }
            item.setItemMeta(meta);
        }
        return item;
    }

    private ItemStack criarCabecaJogador(Player player, String nome, String... lore) {
        ItemStack item = new ItemStack(Material.PLAYER_HEAD);
        if (item.getItemMeta() instanceof SkullMeta skullMeta) {
            skullMeta.setOwningPlayer(player);
            skullMeta.displayName(Component.text(nome));
            if (lore != null && lore.length > 0) {
                List<Component> loreList = new ArrayList<>();
                for (String l : lore) {
                    loreList.add(Component.text(l));
                }
                skullMeta.lore(loreList);
            }
            item.setItemMeta(skullMeta);
        }
        return item;
    }

    // ── Telas GUI (Caixas de Baú) ────────────────────────────────────────────
    public void abrirMenuPrincipal(Player player) {
        Inventory inv = Bukkit.createInventory(new PainelMenuHolder("principal"), 27, Component.text("§0§l5DAY MC - Menu Principal"));
        ItemStack vidro = criarItem(Material.GRAY_STAINED_GLASS_PANE, "§7");
        for (int i = 0; i < 27; i++) {
            inv.setItem(i, vidro);
        }

        String clean = cleanNick(player.getName()).toLowerCase().trim();
        int vidas = localLives.getOrDefault(clean, 5);
        int totalSeconds = player.getStatistic(Statistic.PLAY_ONE_MINUTE) / 20;
        long hours = totalSeconds / 3600;
        long minutes = (totalSeconds % 3600) / 60;
        String tempo = (hours > 0 ? hours + "h " : "") + minutes + "m";
        UserSession sess = activeSessions.get(clean);
        boolean isAdmin = isPlayerAdmin(player);

        ItemStack cabeca = criarCabecaJogador(player, "§6§l👤 " + player.getName(),
            "§7Vidas: §c" + vidas + " ❤️",
            "§7Tempo de Jogo: §e" + tempo + " ⏰",
            "§7Conta Site: " + (sess != null ? "§a" + sess.nick : "§cNão conectado"),
            "§7Cargo: " + (isAdmin ? "§c§lADMINISTRADOR" : "§7Jogador")
        );
        inv.setItem(4, cabeca);

        inv.setItem(11, criarItem(Material.GOLDEN_HELMET, "§6§l👑 Reinos",
            "§7Ver membros, status e proteção do reino.",
            "§eClique para abrir!"
        ));

        inv.setItem(13, criarItem(Material.GRASS_BLOCK, "§a§l🗺️ Meus Terrenos",
            "§7Ver terrenos protegidos onde você é Dono ou Amigo.",
            "§eClique para abrir!"
        ));

        if (isAdmin) {
            inv.setItem(15, criarItem(Material.NETHERITE_CHESTPLATE, "§c§l⚡ Painel do Administrador",
                "§7Aprovar Whitelist, Bans, Proteções e Vidas.",
                "§cClique para acessar!"
            ));
        } else {
            inv.setItem(15, criarItem(Material.BOOK, "§b§l🔑 Conectar Conta do Site",
                "§7Vincule sua conta digitando no chat:",
                "§e/painel login <email> <senha>",
                "§7Libera funções exclusivas!"
            ));
        }

        inv.setItem(22, criarItem(Material.BARRIER, "§c§l✕ Fechar Menu"));

        player.openInventory(inv);
    }

    public void abrirMenuReinos(Player player) {
        Inventory inv = Bukkit.createInventory(new PainelMenuHolder("reinos"), 27, Component.text("§0§l5DAY MC - Reinos"));
        ItemStack vidro = criarItem(Material.GRAY_STAINED_GLASS_PANE, "§7");
        for (int i = 0; i < 27; i++) {
            inv.setItem(i, vidro);
        }

        String clean = cleanNick(player.getName()).toLowerCase().trim();
        KingdomArea meuReino = null;
        for (KingdomArea k : kingdomProtections.values()) {
            if (k.isMember(clean)) {
                meuReino = k;
                break;
            }
        }

        if (meuReino != null) {
            inv.setItem(11, criarItem(Material.BEACON, "§6§l🏰 " + meuReino.nome + " §7[" + meuReino.tag + "]",
                "§e• Mundo: §f" + meuReino.world,
                "§e• Centro: §fX=" + meuReino.centerX + ", Z=" + meuReino.centerZ,
                "§e• Raio: §f" + meuReino.radius + " blocos"
            ));

            inv.setItem(13, criarItem(Material.PLAYER_HEAD, "§b§l👥 Membros do Reino",
                "§7Total: §f" + meuReino.members.size() + " membros",
                "§7Membros: §f" + String.join(", ", meuReino.members)
            ));

            inv.setItem(15, criarItem(Material.COMPASS, "§e§l🧭 Coordenadas do Território",
                "§7Coordenadas do centro do seu reino:",
                "§fX: " + meuReino.centerX + " | Z: " + meuReino.centerZ
            ));
        } else {
            inv.setItem(13, criarItem(Material.BOOK, "§e§lℹ️ Nenhum Reino Encontrado",
                "§7Você ainda não faz parte de nenhum reino.",
                "§7Acesse o site oficial para criar ou ingressar em um reino!"
            ));
        }

        inv.setItem(18, criarItem(Material.ARROW, "§7⬅ Voltar"));
        inv.setItem(22, criarItem(Material.BARRIER, "§c§l✕ Fechar Menu"));

        player.openInventory(inv);
    }

    public void abrirMenuTerrenos(Player player) {
        Inventory inv = Bukkit.createInventory(new PainelMenuHolder("terrenos"), 27, Component.text("§0§l5DAY MC - Meus Terrenos"));
        ItemStack vidro = criarItem(Material.GRAY_STAINED_GLASS_PANE, "§7");
        for (int i = 0; i < 27; i++) {
            inv.setItem(i, vidro);
        }

        String clean = cleanNick(player.getName()).toLowerCase().trim();
        List<KingdomArea> terrenos = new ArrayList<>();
        for (KingdomArea a : adminProtections.values()) {
            if (a.isMember(clean) || (a.ownerNick != null && a.ownerNick.toLowerCase().trim().equals(clean))) {
                terrenos.add(a);
            }
        }

        if (terrenos.isEmpty()) {
            inv.setItem(13, criarItem(Material.BARRIER, "§c§lNenhum Terreno Encontrado",
                "§7Você ainda não possui nenhum terreno protegido.",
                "§7Fale com um Administrador para registrar sua proteção!"
            ));
        } else {
            int slot = 10;
            for (KingdomArea t : terrenos) {
                if (slot > 16) break;
                boolean isOwner = t.ownerNick != null && t.ownerNick.toLowerCase().trim().equals(clean);
                inv.setItem(slot, criarItem(Material.OAK_DOOR, "§a§l🛡️ " + t.nome,
                    "§e• Status: " + (isOwner ? "§a👑 Dono" : "§b✅ Amigo Autorizado"),
                    "§e• Centro: §fX=" + t.centerX + ", Z=" + t.centerZ,
                    "§e• Raio: §f" + t.radius + " blocos",
                    "§e• Mundo: §f" + t.world
                ));
                slot++;
            }
        }

        inv.setItem(18, criarItem(Material.ARROW, "§7⬅ Voltar"));
        inv.setItem(22, criarItem(Material.BARRIER, "§c§l✕ Fechar Menu"));

        player.openInventory(inv);
    }

    public void abrirMenuAdmin(Player player) {
        if (!isPlayerAdmin(player)) {
            player.sendMessage(Component.text("§c❌ Apenas Administradores podem acessar este painel."));
            return;
        }

        Inventory inv = Bukkit.createInventory(new PainelMenuHolder("admin"), 27, Component.text("§0§l5DAY MC - Painel Admin"));
        ItemStack vidro = criarItem(Material.GRAY_STAINED_GLASS_PANE, "§7");
        for (int i = 0; i < 27; i++) {
            inv.setItem(i, vidro);
        }

        inv.setItem(10, criarItem(Material.WRITABLE_BOOK, "§e§l📋 Whitelist (" + localWhitelist.size() + ")",
            "§7Total aprovados: §a" + localWhitelist.size() + " jogadores",
            "§7Aprovação completa disponível no site."
        ));

        inv.setItem(12, criarItem(Material.IRON_DOOR, "§c§l🔨 Bans Ativos (" + localBans.size() + ")",
            "§7Total banidos: §c" + localBans.size() + " jogadores",
            "§7Gerencie motivos e desbans no site."
        ));

        inv.setItem(14, criarItem(Material.SHIELD, "§a§l🛡️ Criar Proteção Aqui",
            "§7Cria uma proteção no local exato onde você está em pé!",
            "§e• Raio: §f20 blocos",
            "§e• Coordenadas: §fX=" + player.getLocation().getBlockX() + ", Z=" + player.getLocation().getBlockZ(),
            "§aClique para criar agora!"
        ));

        inv.setItem(16, criarItem(Material.REDSTONE, "§c§l❤️ Resetar Vidas de Todos",
            "§7Restaura as vidas de todos os jogadores para 5.",
            "§cClique para executar!"
        ));

        inv.setItem(18, criarItem(Material.ARROW, "§7⬅ Voltar"));
        inv.setItem(22, criarItem(Material.BARRIER, "§c§l✕ Fechar Menu"));

        player.openInventory(inv);
    }

    // ── Ações Executadas pelo Administrador no Jogo ──────────────────────────
    private void criarProtecaoAdminAqui(Player player) {
        if (!isPlayerAdmin(player)) {
            player.sendMessage(Component.text("§c❌ Apenas Administradores podem criar proteções."));
            return;
        }

        Location loc = player.getLocation();
        int x = loc.getBlockX();
        int z = loc.getBlockZ();
        String worldName = loc.getWorld().getName();
        int radius = 20;
        String zoneName = "Proteção " + player.getName() + " #" + (adminProtections.size() + 1);
        String zoneId = UUID.randomUUID().toString();

        KingdomArea newZone = new KingdomArea(zoneId, zoneName, "ADMIN", worldName, x, z, radius, Set.of(player.getName().toLowerCase().trim()), true, player.getName());
        adminProtections.put(zoneId, newZone);
        saveLocalData();

        player.sendMessage(Component.text("§a🛡️ [5DAY MC] Proteção criada localmente com sucesso!"));
        player.sendMessage(Component.text("§e• Nome: §f" + zoneName + " §e• Raio: §f" + radius + " blocos (X=" + x + ", Z=" + z + ")"));

        getServer().getScheduler().runTaskAsynchronously(this, () -> {
            try {
                JsonObject json = new JsonObject();
                json.addProperty("name", zoneName);
                json.addProperty("world", worldName);
                json.addProperty("centerX", x);
                json.addProperty("centerZ", z);
                json.addProperty("radius", radius);
                json.addProperty("enabled", true);
                json.addProperty("ownerNick", player.getName());

                HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create("https://fffff-autoforge.vercel.app/api/admin/protection-zones"))
                    .header("Content-Type", "application/json")
                    .header("x-plugin-secret", PLUGIN_SECRET)
                    .POST(HttpRequest.BodyPublishers.ofString(json.toString(), StandardCharsets.UTF_8))
                    .build();

                httpClient.send(req, HttpResponse.BodyHandlers.discarding());
            } catch (Exception ignored) {}
        });
    }

    private void resetarVidasAdmin(Player player) {
        if (!isPlayerAdmin(player)) {
            player.sendMessage(Component.text("§c❌ Apenas Administradores podem resetar vidas."));
            return;
        }

        for (String k : localLives.keySet()) {
            localLives.put(k, 5);
        }
        saveLocalData();

        player.sendMessage(Component.text("§a❤️ [5DAY MC] Todas as vidas foram restauradas para 5 localmente!"));

        getServer().getScheduler().runTaskAsynchronously(this, () -> {
            try {
                HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create("https://fffff-autoforge.vercel.app/api/admin/lives/reset-all"))
                    .header("x-plugin-secret", PLUGIN_SECRET)
                    .POST(HttpRequest.BodyPublishers.noBody())
                    .build();

                httpClient.send(req, HttpResponse.BodyHandlers.discarding());
            } catch (Exception ignored) {}
        });
    }

    // ── Listener de Cliques no Menu (Java e Bedrock) ─────────────────────────
    @EventHandler
    public void onInventoryClick(InventoryClickEvent event) {
        if (!(event.getWhoClicked() instanceof Player player)) return;
        if (event.getInventory().getHolder() instanceof PainelMenuHolder holder) {
            event.setCancelled(true);
            ItemStack clicked = event.getCurrentItem();
            if (clicked == null || clicked.getType().isAir()) return;

            Material mat = clicked.getType();
            if (mat == Material.BARRIER) {
                player.closeInventory();
                return;
            }
            if (mat == Material.ARROW) {
                abrirMenuPrincipal(player);
                return;
            }

            String tipo = holder.getMenuTipo();
            if ("principal".equals(tipo)) {
                if (mat == Material.GOLDEN_HELMET) {
                    abrirMenuReinos(player);
                } else if (mat == Material.GRASS_BLOCK) {
                    abrirMenuTerrenos(player);
                } else if (mat == Material.NETHERITE_CHESTPLATE) {
                    abrirMenuAdmin(player);
                } else if (mat == Material.BOOK) {
                    player.closeInventory();
                    player.sendMessage(Component.text("§e[5DAY MC] Para vincular sua conta do site, digite no chat:"));
                    player.sendMessage(Component.text("§f/painel login <email_ou_nick> <senha>"));
                }
            } else if ("admin".equals(tipo)) {
                if (mat == Material.SHIELD) {
                    player.closeInventory();
                    criarProtecaoAdminAqui(player);
                } else if (mat == Material.REDSTONE) {
                    player.closeInventory();
                    resetarVidasAdmin(player);
                } else if (mat == Material.WRITABLE_BOOK) {
                    player.sendMessage(Component.text("§e[5DAY MC] Total de aprovados na Whitelist: §f" + localWhitelist.size()));
                } else if (mat == Material.IRON_DOOR) {
                    player.sendMessage(Component.text("§c[5DAY MC] Total de jogadores banidos: §f" + localBans.size()));
                }
            }
        }
    }

    private void exibirInfoTerritorio(Player player) {
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
