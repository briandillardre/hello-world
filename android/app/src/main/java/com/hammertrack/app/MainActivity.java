package com.hammertrack.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    /** Renderer losses inside RECOVER_WINDOW_MS; past MAX_RECOVERIES it is a real fault, not memory pressure. */
    private static final long RECOVER_WINDOW_MS = 5 * 60_000L;
    private static final int MAX_RECOVERIES = 3;
    private static long windowStart = 0;
    private static int recoveries = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugin: the gallery door that returns a photo's OWN GPS
        // coordinates instead of the location-redacted copy a WebView file
        // input gets. Must be registered BEFORE super.onCreate — that is when
        // the bridge is built and the plugin list is read.
        registerPlugin(OriginalPhotosPlugin.class);
        super.onCreate(savedInstanceState);
        // When Android reclaims the web page's renderer (memory pressure on an
        // older phone with a big map open) or it crashes, Capacitor reports the
        // loss as unhandled and the system kills the whole app — a "force
        // close" (Tenna's Play reviews, Oct 4). Handle it: rebuild the screen,
        // which loads the app again. A renderer that keeps dying is left to
        // crash so it shows up in Android vitals instead of looping.
        if (bridge != null) {
            bridge.addWebViewListener(new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                    long now = SystemClock.elapsedRealtime();
                    if (now - windowStart > RECOVER_WINDOW_MS) { windowStart = now; recoveries = 0; }
                    if (++recoveries > MAX_RECOVERIES) return false;
                    new Handler(Looper.getMainLooper()).post(MainActivity.this::recreate);
                    return true;
                }
            });
        }
    }
}
