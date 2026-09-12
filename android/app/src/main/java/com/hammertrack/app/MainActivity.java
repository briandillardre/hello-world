package com.hammertrack.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugin: the gallery door that returns a photo's OWN GPS
        // coordinates instead of the location-redacted copy a WebView file
        // input gets. Must be registered BEFORE super.onCreate — that is when
        // the bridge is built and the plugin list is read.
        registerPlugin(OriginalPhotosPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
