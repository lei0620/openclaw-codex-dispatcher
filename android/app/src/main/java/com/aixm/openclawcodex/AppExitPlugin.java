package com.aixm.openclawcodex;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppExit")
public final class AppExitPlugin extends Plugin {
    @PluginMethod
    public void exitCompletely(PluginCall call) {
        BackgroundRealtimeService.setEnabled(getContext(), false);
        BackgroundRealtimeService.stop(getContext());

        JSObject result = new JSObject();
        result.put("exiting", true);
        call.resolve(result);

        Activity activity = getActivity();
        Handler mainHandler = new Handler(Looper.getMainLooper());
        mainHandler.post(() -> {
            if (activity != null) {
                activity.finishAndRemoveTask();
            }
            mainHandler.postDelayed(() -> Process.killProcess(Process.myPid()), 250L);
        });
    }
}
