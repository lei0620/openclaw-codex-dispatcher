package com.aixm.openclawcodex;

import android.Manifest;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
        name = "BackgroundNotifications",
        permissions = {
                @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
        }
)
public final class BackgroundNotificationsPlugin extends Plugin {
    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusPayload());
    }

    @PluginMethod
    public void enable(PluginCall call) {
        try {
            SecureConnectionStore.Settings settings = SecureConnectionStore.load(getContext());
            if (settings.token.trim().isEmpty() || settings.apiBase.trim().isEmpty()) {
                call.reject("请先保存 NAS 地址和访问密码。");
                return;
            }
        } catch (Exception error) {
            call.reject("无法读取安全连接设置。", error);
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermissionResult");
            return;
        }
        enableService(call);
    }

    @PluginMethod
    public void disable(PluginCall call) {
        BackgroundRealtimeService.setEnabled(getContext(), false);
        BackgroundRealtimeService.stop(getContext());
        call.resolve(statusPayload());
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            enableService(call);
            return;
        }
        BackgroundRealtimeService.setEnabled(getContext(), false);
        call.resolve(statusPayload());
    }

    private void enableService(PluginCall call) {
        BackgroundRealtimeService.setEnabled(getContext(), true);
        BackgroundRealtimeService.start(getContext());
        call.resolve(statusPayload());
    }

    private JSObject statusPayload() {
        JSObject result = new JSObject();
        result.put("enabled", BackgroundRealtimeService.isEnabled(getContext()));
        result.put("permission", permissionName());
        return result;
    }

    private String permissionName() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return "granted";
        }
        PermissionState state = getPermissionState("notifications");
        if (state == PermissionState.GRANTED) {
            return "granted";
        }
        if (state == PermissionState.DENIED) {
            return "denied";
        }
        return "prompt";
    }
}
