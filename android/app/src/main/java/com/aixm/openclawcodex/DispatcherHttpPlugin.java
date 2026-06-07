package com.aixm.openclawcodex;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "DispatcherHttp")
public class DispatcherHttpPlugin extends Plugin {
    @PluginMethod
    public void request(PluginCall call) {
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                String method = valueOrDefault(call.getString("method"), "GET").toUpperCase();
                String baseUrl = trimTrailingSlash(valueOrDefault(call.getString("baseUrl"), ""));
                String path = valueOrDefault(call.getString("path"), "");
                String token = valueOrDefault(call.getString("token"), "");
                String body = call.getString("body");

                if (baseUrl.isEmpty() || path.isEmpty()) {
                    throw new IllegalArgumentException("缺少服务地址或请求路径。");
                }

                connection = (HttpURLConnection) new URL(baseUrl + path).openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(60000);
                connection.setRequestMethod(method);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                if (!token.isEmpty()) {
                    connection.setRequestProperty("Authorization", "Bearer " + token);
                }

                if (body != null && !body.isEmpty() && !"GET".equals(method)) {
                    connection.setDoOutput(true);
                    byte[] payload = body.getBytes(StandardCharsets.UTF_8);
                    connection.setFixedLengthStreamingMode(payload.length);
                    try (OutputStream output = connection.getOutputStream()) {
                        output.write(payload);
                    }
                }

                int status = connection.getResponseCode();
                String responseBody = readResponseBody(connection, status);
                JSObject result = new JSObject();
                result.put("status", status);
                result.put("body", responseBody);
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? error.toString() : error.getMessage());
            } finally {
                if (connection != null) {
                    connection.disconnect();
                }
            }
        }, "dispatcher-http").start();
    }

    private String readResponseBody(HttpURLConnection connection, int status) throws Exception {
        try (BufferedInputStream input = new BufferedInputStream(
                status >= 400 && connection.getErrorStream() != null ? connection.getErrorStream() : connection.getInputStream()
        );
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private String valueOrDefault(String value, String fallback) {
        return value == null ? fallback : value;
    }

    private String trimTrailingSlash(String value) {
        return value.trim().replaceAll("/+$", "");
    }
}
