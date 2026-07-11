package com.aixm.openclawcodex;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AndroidUpdaterPlugin.class);
        registerPlugin(DispatcherHttpPlugin.class);
        registerPlugin(SecureConnectionPlugin.class);
        super.onCreate(savedInstanceState);
        installBackGestureGuard();
    }

    private void installBackGestureGuard() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge().getWebView();
                if (webView == null) {
                    return;
                }
                if (webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
                webView.evaluateJavascript(
                    "window.openclawHandleAndroidBack && window.openclawHandleAndroidBack();",
                    null
                );
            }
        });
    }
}
