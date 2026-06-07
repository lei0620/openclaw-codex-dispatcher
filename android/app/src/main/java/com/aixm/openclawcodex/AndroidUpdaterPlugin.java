package com.aixm.openclawcodex;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "AndroidUpdater")
public class AndroidUpdaterPlugin extends Plugin {
    private static final String APK_MIME_TYPE = "application/vnd.android.package-archive";

    @PluginMethod
    public void check(PluginCall call) {
        runAsync(call, () -> {
            Credentials credentials = CredentialStore.load(getContext());
            UpdateManifest manifest = fetchManifest(credentials);
            AppVersion current = getCurrentVersion();

            JSObject result = manifest.toJson();
            result.put("currentVersionCode", current.versionCode);
            result.put("currentVersionName", current.versionName);
            result.put("hasUpdate", manifest.versionCode > current.versionCode);
            result.put("status", manifest.versionCode > current.versionCode ? "update_available" : "latest");
            call.resolve(result);
        });
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        runAsync(call, () -> {
            Credentials credentials = CredentialStore.load(getContext());
            UpdateManifest manifest = fetchManifest(credentials);
            AppVersion current = getCurrentVersion();
            if (manifest.versionCode <= current.versionCode) {
                JSObject result = manifest.toJson();
                result.put("currentVersionCode", current.versionCode);
                result.put("currentVersionName", current.versionName);
                result.put("hasUpdate", false);
                result.put("status", "latest");
                call.resolve(result);
                return;
            }

            File apk = downloadApk(credentials, manifest);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
                Intent settings = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName())
                );
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(settings);

                JSObject result = manifest.toJson();
                result.put("status", "install_permission_required");
                result.put("message", "请先允许本应用安装未知来源应用，然后再点一次立即升级。");
                call.resolve(result);
                return;
            }

            Uri apkUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    apk
            );
            Intent installer = new Intent(Intent.ACTION_VIEW);
            installer.setDataAndType(apkUri, APK_MIME_TYPE);
            installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(installer);

            JSObject result = manifest.toJson();
            result.put("status", "installer_opened");
            result.put("message", "已打开系统安装器，请按提示完成升级。");
            call.resolve(result);
        });
    }

    private void runAsync(PluginCall call, CheckedRunnable runnable) {
        new Thread(() -> {
            try {
                runnable.run();
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? error.toString() : error.getMessage());
            }
        }, "android-webdav-updater").start();
    }

    private UpdateManifest fetchManifest(Credentials credentials) throws Exception {
        credentials.requireComplete();
        String manifestUrl = joinUrl(credentials.endpoint, credentials.remoteFolder, "update.json");
        String body = httpGetText(manifestUrl, credentials);
        return UpdateManifest.fromJson(new JSONObject(body), credentials.endpoint);
    }

    private File downloadApk(Credentials credentials, UpdateManifest manifest) throws Exception {
        String apkUrl = resolveApkUrl(credentials.endpoint, manifest.apkUrl);
        File updateDir = new File(getContext().getCacheDir(), "updates");
        if (!updateDir.exists() && !updateDir.mkdirs()) {
            throw new IllegalStateException("无法创建更新缓存目录。");
        }
        File apk = new File(updateDir, "openclaw-codex-update.apk");
        httpDownload(apkUrl, credentials, apk);

        String actualSha256 = sha256(apk);
        if (!actualSha256.equalsIgnoreCase(manifest.sha256)) {
            if (!apk.delete()) {
                apk.deleteOnExit();
            }
            throw new IllegalStateException("APK 校验失败，已停止安装。");
        }
        return apk;
    }

    private String httpGetText(String url, Credentials credentials) throws Exception {
        HttpURLConnection connection = openConnection(url, credentials);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IllegalStateException("读取更新信息失败，HTTP " + status);
            }
            try (BufferedInputStream input = new BufferedInputStream(connection.getInputStream());
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                }
                return output.toString(StandardCharsets.UTF_8.name());
            }
        } finally {
            connection.disconnect();
        }
    }

    private void httpDownload(String url, Credentials credentials, File outputFile) throws Exception {
        HttpURLConnection connection = openConnection(url, credentials);
        try {
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                throw new IllegalStateException("下载 APK 失败，HTTP " + status);
            }
            try (BufferedInputStream input = new BufferedInputStream(connection.getInputStream());
                 FileOutputStream output = new FileOutputStream(outputFile)) {
                byte[] buffer = new byte[1024 * 64];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                }
            }
        } finally {
            connection.disconnect();
        }
    }

    private HttpURLConnection openConnection(String url, Credentials credentials) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(60000);
        connection.setRequestProperty("Authorization", basicAuth(credentials.username, credentials.password));
        connection.setRequestProperty("Accept", "application/json, application/vnd.android.package-archive, */*");
        return connection;
    }

    private String basicAuth(String username, String password) {
        String pair = username + ":" + password;
        return "Basic " + Base64.encodeToString(pair.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
    }

    private AppVersion getCurrentVersion() throws Exception {
        PackageInfo info;
        PackageManager manager = getContext().getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            info = manager.getPackageInfo(getContext().getPackageName(), PackageManager.PackageInfoFlags.of(0));
        } else {
            info = manager.getPackageInfo(getContext().getPackageName(), 0);
        }
        long versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
        return new AppVersion(versionCode, info.versionName == null ? "" : info.versionName);
    }

    private String resolveApkUrl(String endpoint, String apkUrl) {
        String trimmedEndpoint = endpoint.trim().replaceAll("/+$", "");
        String trimmedApkUrl = apkUrl.trim();
        if (trimmedApkUrl.startsWith("http://") || trimmedApkUrl.startsWith("https://")) {
            if (!trimmedApkUrl.startsWith(trimmedEndpoint + "/")) {
                throw new IllegalArgumentException("update.json 里的 APK 地址不在 WebDAV 地址下，已拒绝下载。");
            }
            return trimmedApkUrl;
        }
        return trimmedEndpoint + "/" + encodePath(trimmedApkUrl);
    }

    private String joinUrl(String endpoint, String... segments) {
        StringBuilder builder = new StringBuilder(endpoint.trim().replaceAll("/+$", ""));
        for (String segment : segments) {
            builder.append("/").append(Uri.encode(segment));
        }
        return builder.toString();
    }

    private String encodePath(String path) {
        String[] parts = path.split("/");
        StringBuilder builder = new StringBuilder();
        for (String part : parts) {
            if (part.isEmpty()) {
                continue;
            }
            if (builder.length() > 0) {
                builder.append("/");
            }
            builder.append(Uri.encode(part));
        }
        return builder.toString();
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (BufferedInputStream input = new BufferedInputStream(file.toURI().toURL().openStream())) {
            byte[] buffer = new byte[1024 * 64];
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        StringBuilder builder = new StringBuilder();
        for (byte value : digest.digest()) {
            builder.append(String.format("%02x", value));
        }
        return builder.toString();
    }

    private interface CheckedRunnable {
        void run() throws Exception;
    }

    private static final class AppVersion {
        final long versionCode;
        final String versionName;

        AppVersion(long versionCode, String versionName) {
            this.versionCode = versionCode;
            this.versionName = versionName;
        }
    }

    private static final class UpdateManifest {
        final long versionCode;
        final String versionName;
        final String apkUrl;
        final String sha256;
        final String notes;
        final String publishedAt;

        private UpdateManifest(long versionCode, String versionName, String apkUrl, String sha256, String notes, String publishedAt) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.apkUrl = apkUrl;
            this.sha256 = sha256;
            this.notes = notes;
            this.publishedAt = publishedAt;
        }

        static UpdateManifest fromJson(JSONObject json, String endpoint) {
            String apkUrl = json.optString("apkUrl", "").trim();
            String sha256 = json.optString("sha256", "").trim().toLowerCase();
            if (apkUrl.isEmpty()) {
                throw new IllegalArgumentException("update.json 缺少 apkUrl。");
            }
            if (!sha256.matches("[0-9a-f]{64}")) {
                throw new IllegalArgumentException("update.json 里的 sha256 格式不正确。");
            }
            if ((apkUrl.startsWith("http://") || apkUrl.startsWith("https://")) && !apkUrl.startsWith(endpoint.replaceAll("/+$", "") + "/")) {
                throw new IllegalArgumentException("update.json 里的 APK 地址不在 WebDAV 地址下。");
            }
            return new UpdateManifest(
                    json.optLong("versionCode", 0),
                    json.optString("versionName", ""),
                    apkUrl,
                    sha256,
                    json.optString("notes", ""),
                    json.optString("publishedAt", "")
            );
        }

        JSObject toJson() {
            JSObject object = new JSObject();
            object.put("versionCode", versionCode);
            object.put("versionName", versionName);
            object.put("apkUrl", apkUrl);
            object.put("sha256", sha256);
            object.put("notes", notes);
            object.put("publishedAt", publishedAt);
            return object;
        }
    }

    private static final class Credentials {
        final String endpoint;
        final String username;
        final String password;
        final String remoteFolder;

        Credentials(String endpoint, String username, String password, String remoteFolder) {
            this.endpoint = endpoint == null ? "" : endpoint.trim().replaceAll("/+$", "");
            this.username = username == null ? "" : username.trim();
            this.password = password == null ? "" : password;
            this.remoteFolder = remoteFolder == null ? "" : remoteFolder.trim();
        }

        void requireComplete() {
            if (endpoint.isEmpty() || username.isEmpty() || password.isEmpty() || remoteFolder.isEmpty()) {
                throw new IllegalStateException("缺少 WebDAV 更新配置。");
            }
        }
    }

    private static final class CredentialStore {
        private static final String PREFS = "android_webdav_update";
        private static final String KEY_ALIAS = "openclaw_webdav_update_key";
        private static final String KEY_ENDPOINT = "endpoint";
        private static final String KEY_USERNAME = "username";
        private static final String KEY_PASSWORD = "password";
        private static final String KEY_REMOTE_FOLDER = "remote_folder";

        static Credentials load(Context context) throws Exception {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (!prefs.contains(KEY_ENDPOINT)) {
                saveDefaults(context, prefs);
            }
            return new Credentials(
                    prefs.getString(KEY_ENDPOINT, ""),
                    prefs.getString(KEY_USERNAME, ""),
                    decrypt(prefs.getString(KEY_PASSWORD, "")),
                    prefs.getString(KEY_REMOTE_FOLDER, "")
            );
        }

        private static void saveDefaults(Context context, SharedPreferences prefs) throws Exception {
            String password = BuildConfig.WEBDAV_UPDATE_PASSWORD == null ? "" : BuildConfig.WEBDAV_UPDATE_PASSWORD;
            SharedPreferences.Editor editor = prefs.edit();
            editor.putString(KEY_ENDPOINT, BuildConfig.WEBDAV_UPDATE_ENDPOINT);
            editor.putString(KEY_USERNAME, BuildConfig.WEBDAV_UPDATE_USERNAME);
            editor.putString(KEY_REMOTE_FOLDER, BuildConfig.WEBDAV_UPDATE_REMOTE_FOLDER);
            if (!password.isEmpty()) {
                editor.putString(KEY_PASSWORD, encrypt(password));
            }
            editor.apply();
        }

        private static SecretKey getOrCreateKey() throws Exception {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            if (keyStore.containsAlias(KEY_ALIAS)) {
                return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
            }

            KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
            android.security.keystore.KeyGenParameterSpec spec =
                    new android.security.keystore.KeyGenParameterSpec.Builder(
                            KEY_ALIAS,
                            android.security.keystore.KeyProperties.PURPOSE_ENCRYPT | android.security.keystore.KeyProperties.PURPOSE_DECRYPT
                    )
                            .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                            .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                            .setRandomizedEncryptionRequired(true)
                            .build();
            generator.init(spec);
            return generator.generateKey();
        }

        private static String encrypt(String value) throws Exception {
            SecretKey key = getOrCreateKey();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new SecureRandom());
            byte[] iv = cipher.getIV();
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] payload = new byte[iv.length + encrypted.length];
            System.arraycopy(iv, 0, payload, 0, iv.length);
            System.arraycopy(encrypted, 0, payload, iv.length, encrypted.length);
            return Base64.encodeToString(payload, Base64.NO_WRAP);
        }

        private static String decrypt(String value) throws Exception {
            if (value == null || value.isEmpty()) {
                return "";
            }
            byte[] payload = Base64.decode(value, Base64.NO_WRAP);
            if (payload.length <= 12) {
                return "";
            }
            byte[] iv = Arrays.copyOfRange(payload, 0, 12);
            byte[] encrypted = Arrays.copyOfRange(payload, 12, payload.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        }
    }
}
