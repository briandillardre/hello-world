import React, { useRef, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../lib/AppContext';
import { RootStackParamList, RestArea } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function buildMapHtml(restAreas: RestArea[], userLat?: number, userLng?: number): string {
  const markers = restAreas.map(ra => ({
    id: ra.id,
    name: ra.name,
    lat: ra.lat,
    lng: ra.lng,
    isKing: !!ra.king,
    kingName: ra.king?.username ?? null,
    country: ra.country,
    highway: ra.highway,
  }));

  const centerLat = userLat ?? 39.8;
  const centerLng = userLng ?? -98.5;
  const zoom = userLat ? 10 : 4;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.1.3/dist/maplibre-gl.css" />
  <script src="https://unpkg.com/maplibre-gl@4.1.3/dist/maplibre-gl.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1a1a2e; overflow: hidden; }
    #map { width: 100vw; height: 100vh; }
    .marker-crown {
      font-size: 28px;
      cursor: pointer;
      text-shadow: 0 2px 6px rgba(0,0,0,0.8);
      filter: drop-shadow(0 0 8px #f59e0b);
      transition: transform 0.15s;
    }
    .marker-pin {
      font-size: 22px;
      cursor: pointer;
      text-shadow: 0 2px 4px rgba(0,0,0,0.8);
    }
    .marker-crown:active, .marker-pin:active { transform: scale(1.3); }
    .popup-box {
      background: #1e1e3a;
      color: #e2e8f0;
      border-radius: 10px;
      padding: 10px 14px;
      font-family: -apple-system, sans-serif;
      border: 1px solid #4a4a8a;
      min-width: 180px;
    }
    .popup-title { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
    .popup-sub { font-size: 12px; color: #94a3b8; margin-bottom: 8px; }
    .popup-king { font-size: 11px; color: #f59e0b; margin-bottom: 6px; }
    .popup-btn {
      background: #7c3aed;
      color: white;
      border: none;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
    }
    .popup-btn:active { background: #6d28d9; }
    .maplibregl-popup-content { background: transparent; padding: 0; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.6); }
    .maplibregl-popup-tip { display: none; }
    .maplibregl-popup-close-button { color: #94a3b8; font-size: 18px; top: 6px; right: 8px; }
    .user-dot {
      width: 16px; height: 16px;
      background: #3b82f6;
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 0 12px #3b82f6;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const MARKERS = ${JSON.stringify(markers)};
    const USER_LAT = ${userLat ?? 'null'};
    const USER_LNG = ${userLng ?? 'null'};

    const map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          carto: {
            type: 'raster',
            tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
          }
        },
        layers: [{ id: 'carto', type: 'raster', source: 'carto' }]
      },
      center: [${centerLng}, ${centerLat}],
      zoom: ${zoom},
    });

    map.on('load', () => {
      MARKERS.forEach(ra => {
        const el = document.createElement('div');
        el.className = ra.isKing ? 'marker-crown' : 'marker-pin';
        el.textContent = ra.isKing ? '👑' : '🚻';

        const popup = new maplibregl.Popup({ offset: 10, closeOnClick: false })
          .setHTML(\`
            <div class="popup-box">
              <div class="popup-title">\${ra.isKing ? '👑 ' : ''}\${ra.name}</div>
              <div class="popup-sub">\${ra.highway} · \${ra.country === 'US' ? ra.country : ra.country}</div>
              \${ra.isKing ? '<div class="popup-king">King: @' + ra.kingName + '</div>' : ''}
              <button class="popup-btn" onclick="selectRA('\${ra.id}')">View Rest Stop →</button>
            </div>
          \`);

        new maplibregl.Marker({ element: el })
          .setLngLat([ra.lng, ra.lat])
          .setPopup(popup)
          .addTo(map);

        el.addEventListener('click', () => popup.addTo(map));
      });

      if (USER_LAT !== null && USER_LNG !== null) {
        const userEl = document.createElement('div');
        userEl.className = 'user-dot';
        new maplibregl.Marker({ element: userEl })
          .setLngLat([USER_LNG, USER_LAT])
          .addTo(map);
      }
    });

    function selectRA(id) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'SELECT_REST_AREA', id }));
    }
  </script>
</body>
</html>`;
}

export default function MapScreen() {
  const navigation = useNavigation<Nav>();
  const { restAreas, userLocation, refreshLocation, profile, isLoadingProfile } = useApp();
  const webViewRef = useRef<WebView>(null);

  const html = buildMapHtml(
    restAreas,
    userLocation?.lat,
    userLocation?.lng,
  );

  const onMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === 'SELECT_REST_AREA') {
          navigation.navigate('RestArea', { restAreaId: msg.id });
        }
      } catch {
        // ignore
      }
    },
    [navigation],
  );

  if (isLoadingProfile) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html }}
        style={styles.map}
        onMessage={onMessage}
        javaScriptEnabled
        originWhitelist={['*']}
        mixedContentMode="always"
      />

      {/* Header overlay */}
      <View style={styles.header} pointerEvents="none">
        <View style={styles.headerInner}>
          <Text style={styles.appName}>👑 Rest Stop Royale</Text>
          <Text style={styles.subtitle}>
            {restAreas.filter(r => r.king).length} kingdoms active
          </Text>
        </View>
      </View>

      {/* Location refresh button */}
      <TouchableOpacity style={styles.locBtn} onPress={refreshLocation}>
        <Text style={styles.locBtnText}>📍</Text>
      </TouchableOpacity>

      {/* Profile indicator */}
      {!profile && (
        <TouchableOpacity
          style={styles.profileBanner}
          onPress={() => navigation.navigate('Main')}
        >
          <Text style={styles.profileBannerText}>
            👆 Set your username to claim crowns
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  map: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a2e' },
  header: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 16,
    left: 16,
    right: 16,
    pointerEvents: 'none',
  },
  headerInner: {
    backgroundColor: 'rgba(26, 26, 46, 0.88)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.4)',
    alignSelf: 'flex-start',
  },
  appName: { color: '#f1f5f9', fontSize: 16, fontWeight: '700' },
  subtitle: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  locBtn: {
    position: 'absolute',
    bottom: 100,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(26, 26, 46, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.4)',
  },
  locBtnText: { fontSize: 22 },
  profileBanner: {
    position: 'absolute',
    bottom: 160,
    left: 16,
    right: 16,
    backgroundColor: '#7c3aed',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  profileBannerText: { color: 'white', fontWeight: '600', fontSize: 13 },
});
