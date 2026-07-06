import React, { useMemo, useState, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../lib/AppContext';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function buildMapHtml(restAreas: { id: string; lat: number; lng: number; name: string; hasKing: boolean }[]): string {
  const markers = JSON.stringify(restAreas);
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link href="https://unpkg.com/maplibre-gl@4.1.3/dist/maplibre-gl.css" rel="stylesheet"/>
<script src="https://unpkg.com/maplibre-gl@4.1.3/dist/maplibre-gl.js"></script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #map { width: 100%; height: 100%; background: #0f0f1e; }
.marker { cursor: pointer; font-size: 24px; line-height: 1; filter: drop-shadow(0 0 4px #7c3aed); }
.marker.king { font-size: 28px; filter: drop-shadow(0 0 8px #f59e0b); animation: pulse 2s infinite; }
@keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.2)} }
</style>
</head>
<body>
<div id="map"></div>
<script>
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  center: [-95, 38],
  zoom: 3.5,
});

const MARKERS = ${markers};

map.on('load', () => {
  MARKERS.forEach(m => {
    const el = document.createElement('div');
    el.className = 'marker' + (m.hasKing ? ' king' : '');
    el.textContent = m.hasKing ? '👑' : '🚻';
    el.onclick = () => {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'SELECT', id: m.id }));
    };
    new maplibregl.Marker({ element: el }).setLngLat([m.lng, m.lat]).addTo(map);
  });
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'READY' }));
});
</script>
</body>
</html>`;
}

export default function MapScreen() {
  const { restAreas, userLocation, refreshLocation } = useApp();
  const navigation = useNavigation<Nav>();
  const [mapReady, setMapReady] = useState(false);

  const markerData = useMemo(
    () => restAreas.map(r => ({ id: r.id, lat: r.lat, lng: r.lng, name: r.name, hasKing: !!r.king })),
    [restAreas],
  );

  const html = useMemo(() => buildMapHtml(markerData), [markerData]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(e.nativeEvent.data) as { type: string; id?: string };
        if (msg.type === 'READY') setMapReady(true);
        if (msg.type === 'SELECT' && msg.id) navigation.navigate('RestArea', { restAreaId: msg.id });
      } catch {}
    },
    [navigation],
  );

  const kingCount = restAreas.filter(r => r.king).length;

  return (
    <View style={styles.container}>
      <WebView
        source={{ html }}
        style={styles.map}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled
        allowUniversalAccessFromFileURLs
        allowFileAccessFromFileURLs
        mixedContentMode="always"
        originWhitelist={['*']}
      />

      {!mapReady && (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#7c3aed" />
          <Text style={styles.loaderText}>Loading map...</Text>
        </View>
      )}

      <View pointerEvents="none" style={styles.header}>
        <Text style={styles.appName}>Rest Stop Royale 👑</Text>
        <Text style={styles.kingCount}>{kingCount} active kings</Text>
      </View>

      <TouchableOpacity style={styles.locationBtn} onPress={refreshLocation}>
        <Text style={styles.locationBtnText}>📍</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1e' },
  map: { flex: 1 },
  loader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0f0f1e',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loaderText: { color: '#64748b', fontSize: 14 },
  header: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: '#1e1e3add',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 2,
  },
  appName: { color: '#f1f5f9', fontSize: 16, fontWeight: '800' },
  kingCount: { color: '#f59e0b', fontSize: 12, fontWeight: '600' },
  locationBtn: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    backgroundColor: '#1e1e3a',
    borderRadius: 28,
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2d2d5a',
  },
  locationBtnText: { fontSize: 22 },
});
