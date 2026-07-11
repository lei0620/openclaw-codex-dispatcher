package com.aixm.openclawcodex;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SecureConnection")
public class SecureConnectionPlugin extends Plugin {
    @PluginMethod
    public void load(PluginCall call) {
        try {
            SecureConnectionStore.Settings settings = SecureConnectionStore.load(getContext());
            JSObject result = new JSObject();
            result.put("token", settings.token);
            result.put("apiBase", settings.apiBase);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法读取安全连接设置。", error);
        }
    }

    @PluginMethod
    public void save(PluginCall call) {
        try {
            String token = valueOrEmpty(call.getString("token"));
            String apiBase = valueOrEmpty(call.getString("apiBase"));
            SecureConnectionStore.save(getContext(), token, apiBase);
            BackgroundRealtimeService.refreshIfEnabled(getContext());
            call.resolve();
        } catch (Exception error) {
            call.reject("无法保存安全连接设置。", error);
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        if (SecureConnectionStore.clear(getContext())) {
            BackgroundRealtimeService.setEnabled(getContext(), false);
            BackgroundRealtimeService.stop(getContext());
            call.resolve();
        } else {
            call.reject("无法清除安全连接设置。");
        }
    }

    private static String valueOrEmpty(String value) {
        return value == null ? "" : value;
    }
}
