package com.aixm.openclawcodex;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecureConnectionStore {
    private static final String PREFS = "openclaw_secure_connection";
    private static final String KEY_ALIAS = "openclaw_dispatcher_connection_key";
    private static final String KEY_TOKEN = "dispatcher_token";
    private static final String KEY_API_BASE = "api_base";

    private SecureConnectionStore() {}

    static Settings load(Context context) throws Exception {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return new Settings(
                decrypt(prefs.getString(KEY_TOKEN, "")),
                decrypt(prefs.getString(KEY_API_BASE, ""))
        );
    }

    static void save(Context context, String token, String apiBase) throws Exception {
        SharedPreferences.Editor editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        editor.putString(KEY_TOKEN, encrypt(token == null ? "" : token));
        editor.putString(KEY_API_BASE, encrypt(normalizeApiBase(apiBase)));
        if (!editor.commit()) {
            throw new IllegalStateException("secure preferences commit failed");
        }
    }

    static boolean clear(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit();
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
        return value == null ? "" : value.trim().replaceAll("/+$", "");
    }

    static final class Settings {
        final String token;
        final String apiBase;

        Settings(String token, String apiBase) {
            this.token = token;
            this.apiBase = apiBase;
        }
    }
}
