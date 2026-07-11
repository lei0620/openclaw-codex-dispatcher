package com.aixm.openclawcodex;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.net.wifi.WifiManager;
import android.provider.Settings;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public final class BackgroundRealtimeService extends Service {
    private static final String ACTION_REFRESH = "com.aixm.openclawcodex.REFRESH_BACKGROUND_REALTIME";
    static final String PREFS = "openclaw_background_realtime";
    static final String KEY_ENABLED = "enabled";
    static final String KEY_LAST_EVENT_ID = "last_event_id";
    static final String KEY_CONNECTION_STATE = "connection_state";
    static final String KEY_LAST_CONNECTED_AT = "last_connected_at";
    static final int[] RECONNECT_DELAYS_MS = { 1000, 2000, 5000, 10000, 30000 };
    private static final String LAN_API_BASE = "http://192.168.101.8:1314";
    private static final String VPN_API_BASE = "http://100.69.253.5:1314";

    private static final String CONNECTION_CHANNEL = "codex_background_connection";
    private static final String EVENT_CHANNEL = "codex_background_events";
    private static final int CONNECTION_NOTIFICATION_ID = 7101;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable reconnectRunnable = this::connect;
    private OkHttpClient client;
    private WebSocket socket;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private List<String> connectionCandidates = new ArrayList<>();
    private int connectionCandidateIndex;
    private int reconnectAttempt;
    private boolean stopping;

    static boolean isEnabled(Context context) {
        return preferences(context).getBoolean(KEY_ENABLED, false);
    }

    static void setEnabled(Context context, boolean enabled) {
        preferences(context).edit()
                .putBoolean(KEY_ENABLED, enabled)
                .putString(KEY_CONNECTION_STATE, enabled ? "connecting" : "disabled")
                .apply();
    }

    static String getConnectionState(Context context) {
        return preferences(context).getString(KEY_CONNECTION_STATE, isEnabled(context) ? "connecting" : "disabled");
    }

    static long getLastEventId(Context context) {
        return preferences(context).getLong(KEY_LAST_EVENT_ID, -1L);
    }

    static long getLastConnectedAt(Context context) {
        return preferences(context).getLong(KEY_LAST_CONNECTED_AT, 0L);
    }

    static void start(Context context) {
        ContextCompat.startForegroundService(context, new Intent(context, BackgroundRealtimeService.class));
    }

    static void startIfEnabled(Context context) {
        if (isEnabled(context) && canShowNotifications(context)) {
            start(context);
        }
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, BackgroundRealtimeService.class));
    }

    static void refreshIfEnabled(Context context) {
        if (!isEnabled(context) || !canShowNotifications(context)) {
            return;
        }
        Intent intent = new Intent(context, BackgroundRealtimeService.class).setAction(ACTION_REFRESH);
        ContextCompat.startForegroundService(context, intent);
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static boolean canShowNotifications(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
        client = new OkHttpClient.Builder()
                .pingInterval(15, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build();
        startAsForeground();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        stopping = false;
        if (!isEnabled(this)) {
            setConnectionState("disabled", false);
            stopSelf();
            return START_NOT_STICKY;
        }
        acquireKeepAliveLocks();
        if (intent != null && ACTION_REFRESH.equals(intent.getAction())) {
            handler.removeCallbacks(reconnectRunnable);
            reconnectAttempt = 0;
            connectionCandidates.clear();
            connectionCandidateIndex = 0;
            WebSocket previous = socket;
            socket = null;
            if (previous != null) {
                previous.close(1000, "connection settings changed");
            }
        }
        connect();
        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        stopping = true;
        handler.removeCallbacks(reconnectRunnable);
        if (socket != null) {
            socket.close(1000, "service stopped");
            socket = null;
        }
        if (client != null) {
            client.dispatcher().executorService().shutdown();
            client.connectionPool().evictAll();
        }
        releaseKeepAliveLocks();
        super.onDestroy();
    }

    private void acquireKeepAliveLocks() {
        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (wakeLock == null && powerManager != null) {
            wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "openclaw:background-realtime"
            );
            wakeLock.setReferenceCounted(false);
        }
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire();
        }

        WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifiLock == null && wifiManager != null) {
            wifiLock = wifiManager.createWifiLock(
                    WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                    "openclaw:background-wifi"
            );
            wifiLock.setReferenceCounted(false);
        }
        if (wifiLock != null && !wifiLock.isHeld()) {
            wifiLock.acquire();
        }
    }

    private void releaseKeepAliveLocks() {
        if (wifiLock != null && wifiLock.isHeld()) {
            wifiLock.release();
        }
        wifiLock = null;
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        wakeLock = null;
    }

    private void startAsForeground() {
        Notification notification = new NotificationCompat.Builder(this, CONNECTION_CHANNEL)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Codex 手机连接已开启")
                .setContentText("正在后台接收授权和任务结果")
                .setContentIntent(openAppIntent())
                .setOngoing(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                    CONNECTION_NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING
            );
        } else {
            startForeground(CONNECTION_NOTIFICATION_ID, notification);
        }
    }

    private void connect() {
        handler.removeCallbacks(reconnectRunnable);
        if (stopping || !isEnabled(this) || socket != null) {
            return;
        }
        try {
            SecureConnectionStore.Settings settings = SecureConnectionStore.load(this);
            if (settings.token.trim().isEmpty() || settings.apiBase.trim().isEmpty()) {
                setConnectionState("needs_settings", false);
                scheduleReconnect();
                return;
            }
            List<String> candidates = buildConnectionCandidates(settings.apiBase);
            if (!candidates.equals(connectionCandidates)) {
                connectionCandidates = candidates;
                connectionCandidateIndex = 0;
            }
            String url = websocketUrl(connectionCandidates.get(connectionCandidateIndex));
            Request request = new Request.Builder().url(url).build();
            setConnectionState("connecting", false);
            socket = client.newWebSocket(request, new Listener(settings));
        } catch (Exception ignored) {
            setConnectionState("settings_error", false);
            socket = null;
            scheduleReconnect();
        }
    }

    private final class Listener extends WebSocketListener {
        private final SecureConnectionStore.Settings settings;

        Listener(SecureConnectionStore.Settings settings) {
            this.settings = settings;
        }

        @Override
        public void onOpen(WebSocket webSocket, Response response) {
            reconnectAttempt = 0;
            setConnectionState("authenticating", false);
            try {
                JSONObject hello = new JSONObject()
                        .put("type", "client.hello")
                        .put("token", settings.token)
                        .put("clientId", "android-background:" + Settings.Secure.getString(
                                getContentResolver(),
                                Settings.Secure.ANDROID_ID
                        ));
                long cursor = preferences(BackgroundRealtimeService.this).getLong(KEY_LAST_EVENT_ID, -1L);
                if (cursor >= 0) {
                    hello.put("lastEventId", cursor);
                }
                webSocket.send(hello.toString());
            } catch (Exception ignored) {
                webSocket.close(1002, "hello failed");
            }
        }

        @Override
        public void onMessage(WebSocket webSocket, String text) {
            handleServerMessage(webSocket, text);
        }

        @Override
        public void onClosed(WebSocket webSocket, int code, String reason) {
            if (!"authentication_failed".equals(getConnectionState(BackgroundRealtimeService.this)) && !stopping) {
                setConnectionState("network_error", false);
            }
            clearSocketAndReconnect(webSocket);
        }

        @Override
        public void onFailure(WebSocket webSocket, Throwable error, @Nullable Response response) {
            setConnectionState("network_error", false);
            clearSocketAndReconnect(webSocket);
        }
    }

    private void handleServerMessage(WebSocket webSocket, String text) {
        try {
            JSONObject message = new JSONObject(text);
            String type = message.optString("type");
            if ("client.accepted".equals(type)) {
                setConnectionState("online", true);
                return;
            }
            if ("error".equals(type)) {
                setConnectionState("authentication_failed", false);
                webSocket.close(1008, "authentication failed");
                return;
            }
            if ("sync.required".equals(type)) {
                setConnectionState("online", true);
                long latest = message.optLong("latestEventId", -1L);
                saveCursor(latest);
                notifyEvent(
                        7199,
                        "Codex 后台连接已恢复",
                        "打开 App 查看当前任务和待处理权限"
                );
                return;
            }
            if (!"event".equals(type)) {
                return;
            }
            JSONObject event = message.optJSONObject("event");
            if (event == null) {
                return;
            }
            long eventId = event.optLong("eventId", -1L);
            setConnectionState("online", false);
            processEvent(event);
            saveCursor(eventId);
            if (eventId >= 0) {
                webSocket.send(new JSONObject().put("type", "client.ack").put("eventId", eventId).toString());
            }
        } catch (Exception ignored) {
            // A malformed event is ignored without exposing connection secrets.
        }
    }

    private void processEvent(JSONObject event) {
        String type = event.optString("type");
        JSONObject payload = event.optJSONObject("payload");
        if (payload == null) {
            return;
        }
        if ("approval.resolved".equals(type)) {
            JSONObject approval = payload.optJSONObject("approval");
            if (approval != null) {
                NotificationManager manager = getSystemService(NotificationManager.class);
                manager.cancel(notificationId("approval:" + approval.optString("id")));
            }
            return;
        }
        if (AppVisibility.isForeground(this)) {
            return;
        }
        if ("approval.requested".equals(type)) {
            JSONObject approval = payload.optJSONObject("approval");
            if (approval == null) {
                return;
            }
            notifyEvent(
                    notificationId("approval:" + approval.optString("id")),
                    "Codex 等待你的授权",
                    concise(approval.optString("message"), "打开 App 处理这项权限")
            );
            return;
        }
        if (!"task.updated".equals(type)) {
            return;
        }
        JSONObject task = payload.optJSONObject("task");
        if (task == null) {
            return;
        }
        String status = task.optString("status");
        if (!"completed".equals(status) && !"failed".equals(status)) {
            return;
        }
        String taskId = task.optString("id");
        if ("completed".equals(status)) {
            JSONObject result = task.optJSONObject("result");
            String summary = result == null ? "打开 App 查看结果" : result.optString("summary");
            notifyEvent(notificationId("task:" + taskId), "Codex 任务已完成", concise(summary, "打开 App 查看结果"));
        } else {
            notifyEvent(
                    notificationId("task:" + taskId),
                    "Codex 任务执行失败",
                    concise(task.optString("error"), "打开 App 查看失败原因")
            );
        }
    }

    private void saveCursor(long eventId) {
        if (eventId < 0) {
            return;
        }
        preferences(this).edit().putLong(KEY_LAST_EVENT_ID, eventId).apply();
    }

    private void setConnectionState(String state, boolean connectedNow) {
        SharedPreferences.Editor editor = preferences(this).edit().putString(KEY_CONNECTION_STATE, state);
        if (connectedNow) {
            editor.putLong(KEY_LAST_CONNECTED_AT, System.currentTimeMillis());
        }
        editor.apply();
    }

    private void clearSocketAndReconnect(WebSocket closedSocket) {
        if (socket != closedSocket) {
            return;
        }
        socket = null;
        if ("authentication_failed".equals(getConnectionState(this))) {
            return;
        }
        advanceConnectionCandidate();
        scheduleReconnect();
    }

    private List<String> buildConnectionCandidates(String preferred) {
        List<String> candidates = new ArrayList<>();
        addConnectionCandidate(candidates, preferred);
        addConnectionCandidate(candidates, LAN_API_BASE);
        addConnectionCandidate(candidates, VPN_API_BASE);
        return candidates;
    }

    private static void addConnectionCandidate(List<String> candidates, String value) {
        String normalized = value == null ? "" : value.trim().replaceAll("/+$", "");
        if (!normalized.isEmpty() && !candidates.contains(normalized)) {
            candidates.add(normalized);
        }
    }

    private void advanceConnectionCandidate() {
        if (!connectionCandidates.isEmpty()) {
            connectionCandidateIndex = (connectionCandidateIndex + 1) % connectionCandidates.size();
        }
    }

    private void scheduleReconnect() {
        if (stopping || !isEnabled(this)) {
            return;
        }
        int index = Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1);
        reconnectAttempt += 1;
        handler.removeCallbacks(reconnectRunnable);
        handler.postDelayed(reconnectRunnable, RECONNECT_DELAYS_MS[index]);
    }

    private void notifyEvent(int notificationId, String title, String text) {
        if (AppVisibility.isForeground(this)) {
            return;
        }
        Notification notification = new NotificationCompat.Builder(this, EVENT_CHANNEL)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(openAppIntent())
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .build();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(notificationId, notification);
    }

    private PendingIntent openAppIntent() {
        Intent intent = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel connection = new NotificationChannel(
                CONNECTION_CHANNEL,
                "Codex 后台连接",
                NotificationManager.IMPORTANCE_LOW
        );
        connection.setDescription("保持手机与 NAS 的 Codex 实时连接");
        NotificationChannel events = new NotificationChannel(
                EVENT_CHANNEL,
                "Codex 权限和结果",
                NotificationManager.IMPORTANCE_HIGH
        );
        events.setDescription("提醒等待授权、任务完成和失败");
        manager.createNotificationChannel(connection);
        manager.createNotificationChannel(events);
    }

    private static String websocketUrl(String apiBase) {
        String normalized = apiBase.trim().replaceAll("/+$", "");
        if (normalized.startsWith("https://")) {
            return "wss://" + normalized.substring("https://".length()) + "/events";
        }
        if (normalized.startsWith("http://")) {
            return "ws://" + normalized.substring("http://".length()) + "/events";
        }
        throw new IllegalArgumentException("unsupported api base");
    }

    private static int notificationId(String value) {
        return 7200 + Math.abs(value.hashCode() % 100000);
    }

    private static String concise(String value, String fallback) {
        String text = value == null ? "" : value.trim().replaceAll("\\s+", " ");
        if (text.isEmpty()) {
            return fallback;
        }
        return text.length() <= 160 ? text : text.substring(0, 157) + "...";
    }
}
