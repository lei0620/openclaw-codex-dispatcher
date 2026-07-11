package com.aixm.openclawcodex;

import android.app.KeyguardManager;
import android.content.Context;
import android.os.PowerManager;

final class AppVisibility {
    private static volatile boolean foreground;

    private AppVisibility() {}

    static boolean isForeground(Context context) {
        if (!foreground) {
            return false;
        }
        PowerManager powerManager = context.getSystemService(PowerManager.class);
        if (powerManager == null || !powerManager.isInteractive()) {
            return false;
        }
        KeyguardManager keyguardManager = context.getSystemService(KeyguardManager.class);
        return keyguardManager == null || !keyguardManager.isKeyguardLocked();
    }

    static void setForeground(boolean value) {
        foreground = value;
    }
}
