package com.aixm.openclawcodex;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

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
    static final int[] RECONNECT_DELAYS_MS = { 1000, 2000, 5000, 10000, 30000 };

    private static final String CONNECTION_CHANNEL = "codex_background_connection";
    private static final String EVENT_CHANNEL = "codex_background_events";
    private static final int CONNECTION_NOTIFICATION_ID = 7101;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable reconnectRunnable = this::connect;
    private OkHttpClient client;
    private WebSocket socket;
    private int reconnectAttempt;
    private boolean stopping;

    static boolean isEnabled(Context context) {
        return preferences(context).getBoolean(KEY_ENABLED, false);
    }

    static void setEnabled(Context context, boolean enabled) {
        preferences(context).edit().putBoolean(KEY_ENABLED, enabled).apply();
    }

    static void start(Context context) {
        ContextCompat.startForegroundService(context, new Intent(context, BackgroundRealtimeService.class));
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, BackgroundRealtimeService.class));
    }

    static void refreshIfEnabled(Context context) {
        if (!isEnabled(context)) {
            return;
        }
        Intent intent = new Intent(context, BackgroundRealtimeService.class).setAction(ACTION_REFRESH);
        ContextCompat.startForegroundService(context, intent);
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
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
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_REFRESH.equals(intent.getAction())) {
            handler.removeCallbacks(reconnectRunnable);
            reconnectAttempt = 0;
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
        super.onDestroy();
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
                scheduleReconnect();
                return;
            }
            String url = websocketUrl(settings.apiBase);
            Request request = new Request.Builder().url(url).build();
            socket = client.newWebSocket(request, new Listener(settings));
        } catch (Exception ignored) {
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
                socket.send(hello.toString());
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
            clearSocketAndReconnect(webSocket);
        }

        @Override
        public void onFailure(WebSocket webSocket, Throwable error, @Nullable Response response) {
            clearSocketAndReconnect(webSocket);
        }
    }

    private void handleServerMessage(WebSocket webSocket, String text) {
        try {
            JSONObject message = new JSONObject(text);
            String type = message.optString("type");
            if ("sync.required".equals(type)) {
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
        if (AppVisibility.isForeground()) {
            return;
        }
        String type = event.optString("type");
        JSONObject payload = event.optJSONObject("payload");
        if (payload == null) {
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

    private void clearSocketAndReconnect(WebSocket closedSocket) {
        if (socket != closedSocket) {
            return;
        }
        socket = null;
        scheduleReconnect();
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
        if (AppVisibility.isForeground()) {
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
