package com.aixm.openclawcodex;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SecureConnection")
public class SecureConnectionPlugin extends Plugin {
    private static final String PREFS = "openclaw_secure_connection";
    private static final String KEY_ALIAS = "openclaw_dispatcher_connection_key";
    private static final String KEY_TOKEN = "dispatcher_token";
    private static final String KEY_API_BASE = "api_base";

    @PluginMethod
    public void load(PluginCall call) {
        try {
            SharedPreferences prefs = preferences();
            JSObject result = new JSObject();
            result.put("token", decrypt(prefs.getString(KEY_TOKEN, "")));
            result.put("apiBase", decrypt(prefs.getString(KEY_API_BASE, "")));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法读取安全连接设置。", error);
        }
    }

    @PluginMethod
    public void save(PluginCall call) {
        try {
            String token = valueOrEmpty(call.getString("token"));
            String apiBase = normalizeApiBase(valueOrEmpty(call.getString("apiBase")));
            SharedPreferences.Editor editor = preferences().edit();
            editor.putString(KEY_TOKEN, encrypt(token));
            editor.putString(KEY_API_BASE, encrypt(apiBase));
            if (!editor.commit()) {
                throw new IllegalStateException("secure preferences commit failed");
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("无法保存安全连接设置。", error);
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        if (preferences().edit().clear().commit()) {
            call.resolve();
        } else {
            call.reject("无法清除安全连接设置。");
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        }
        KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    private static String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey(), new SecureRandom());
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
            throw new IllegalArgumentException("invalid encrypted payload");
        }
        byte[] iv = Arrays.copyOfRange(payload, 0, 12);
        byte[] encrypted = Arrays.copyOfRange(payload, 12, payload.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    private static String normalizeApiBase(String value) {
        return value.trim().replaceAll("/+$", "");
    }

    private static String valueOrEmpty(String value) {
        return value == null ? "" : value;
    }
}
