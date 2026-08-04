import { useEffect, useMemo, useState } from 'react';
import { Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useAppStore } from '../store';
import type { MallIndexItem, MallDetail } from '../types';

// Grid cluster: group malls within ~0.02 degree (≈2km)
const CLUSTER_GRID = 0.02;

function gridKey(lat: number, lng: number): string {
  return `${Math.round(lat / CLUSTER_GRID)},${Math.round(lng / CLUSTER_GRID)}`;
}

interface ClusterNode {
  lat: number;
  lng: number;
  count: number;
  malls: MallIndexItem[];
}

// Color by type
const TYPE_COLORS: Record<string, string> = {
  '购物型': '#ef4444',
  '美食型': '#f59e0b',
  '综合型': '#3b82f6',
  '亲子型': '#ec4899',
  '休闲娱乐型': '#22c55e',
};
const DEFAULT_COLOR = '#6b7280';

function mallColor(mall: MallIndexItem): string {
  return TYPE_COLORS[mall.type] || DEFAULT_COLOR;
}

// Pin SVG icon (similar to marker-drop)
function createPinIcon(color: string, size: number): L.DivIcon {
  const svg = `
    <svg width="${size}" height="${size * 1.3}" viewBox="0 0 24 31" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.373 0 0 5.373 0 12c0 7.2 12 19 12 19s12-11.8 12-19C24 5.373 18.627 0 12 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
      <circle cx="12" cy="10" r="4" fill="#fff" opacity="0.9"/>
      <text x="12" y="13" text-anchor="middle" font-size="7" font-weight="700" fill="${color}">M</text>
    </svg>`;
  return L.divIcon({
    className: '',
    html: svg,
    iconSize: [size, size * 1.3],
    iconAnchor: [size / 2, size * 1.3],
    popupAnchor: [0, -(size * 1.3)],
  });
}

// Cluster icon
function createClusterIcon(count: number): L.DivIcon {
  const size = 36;
  const html = `
    <div style="
      width:${size}px;height:${size}px;
      background:#f59e0b;border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
      border:3px solid #fff;
    ">
      <span style="color:#fff;font-weight:800;font-size:14px;line-height:1;">${count}</span>
    </div>`;
  return L.divIcon({
    className: '',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

export default function MallLayer({ onSelectMall }: { onSelectMall: (mall: MallDetail) => void }) {
  const mallIndex = useAppStore(s => s.mallIndex);
  const map = useMap();
  const [loading, setLoading] = useState(false);

  // Load index on mount
  useEffect(() => {
    const { setMallIndex, mallIndex } = useAppStore.getState();
    if (mallIndex.length > 0) return;

    setLoading(true);
    fetch(`${import.meta.env.BASE_URL}data/malls/index.json`)
      .then(r => r.json())
      .then(data => {
        setMallIndex(data);
      })
      .catch(e => console.warn('Failed to load mall index:', e))
      .finally(() => setLoading(false));
  }, []);

  // Clustering
  const clusters = useMemo(() => {
    if (mallIndex.length === 0) return [];
    const map2 = new Map<string, ClusterNode>();
    for (const m of mallIndex) {
      if (m.lat == null || m.lng == null) continue;
      const key = gridKey(m.lat, m.lng);
      if (!map2.has(key)) {
        map2.set(key, { lat: m.lat, lng: m.lng, count: 0, malls: [] });
      }
      const node = map2.get(key)!;
      node.lat = (node.lat * node.count + m.lat) / (node.count + 1);
      node.lng = (node.lng * node.count + m.lng) / (node.count + 1);
      node.count += 1;
      node.malls.push(m);
    }
    return Array.from(map2.values());
  }, [mallIndex]);

  // Only show at zoom >= 12
  const zoom = map.getZoom();
  const [mapZoom, setMapZoom] = useState(zoom);
  useEffect(() => {
    const handler = () => setMapZoom(map.getZoom());
    map.on('zoomend', handler);
    return () => { map.off('zoomend', handler); };
  }, [map]);

  if (mapZoom < 12 || mallIndex.length === 0) return null;

  const handleClick = (mall: MallIndexItem) => {
    const safeName = `${mall.city}_${mall.name}`.replace(/[\\/:*?"<>|#]/g, '_');
    fetch(`${import.meta.env.BASE_URL}data/malls/${encodeURIComponent(safeName)}.json`)
      .then(r => r.json())
      .then(detail => onSelectMall(detail))
      .catch(console.warn);
  };

  return (
    <>
      {clusters.map(c => {
        const isCluster = c.count > 1;

        if (isCluster) {
          return (
            <Marker
              key={`mall-cluster-${c.lat}-${c.lng}`}
              position={[c.lat, c.lng]}
              icon={createClusterIcon(c.count)}
            >
              <Popup>
                <div style={{ maxWidth: '200px', maxHeight: '200px', overflowY: 'auto', fontSize: '11px' }}>
                  <div style={{ fontWeight: 700, marginBottom: '4px', color: '#92400e' }}>
                    周边 {c.count} 个商场
                  </div>
                  {c.malls.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map(m => {
                    const color = mallColor(m);
                    return (
                      <div
                        key={`${m.city}_${m.name}`}
                        style={{ padding: '3px 0', cursor: 'pointer', borderBottom: '1px solid #fef3c7' }}
                        onClick={() => handleClick(m)}
                      >
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 6 }} />
                        <span style={{ color: '#1e293b' }}>{m.name}</span>
                        {m.score != null && <span style={{ color: '#92400e', marginLeft: '6px', fontSize: '10px' }}>⭐{(m.score/20).toFixed(1)}</span>}
                        {m.type && <span style={{ color: '#94a3b8', marginLeft: 4, fontSize: 9 }}>{m.type}</span>}
                      </div>
                    );
                  })}
                </div>
              </Popup>
            </Marker>
          );
        }

        // Single mall: use pin icon
        const mall = c.malls[0];
        const color = mallColor(mall);
        return (
          <Marker
            key={`mall-${mall.city}-${mall.name}`}
            position={[c.lat, c.lng]}
            icon={createPinIcon(color, 28)}
            eventHandlers={{
              click: () => handleClick(mall),
              mouseover: (e) => { e.target.openPopup(); },
              mouseout: (e) => { e.target.closePopup(); },
            }}
          >
            <Popup>
              <div style={{ fontSize: '11px' }}>
                <div style={{ fontWeight: 700, marginBottom: '2px' }}>{mall.name}</div>
                {mall.type && <div style={{ color: color, fontSize: 10, marginBottom: 2 }}>{mall.type}</div>}
                {mall.score != null && <div style={{ color: '#92400e' }}>综合评分: {mall.score}</div>}
                {mall.open_date && <div style={{ color: '#64748b', fontSize: 10 }}>开业: {mall.open_date}</div>}
                <div
                  style={{ marginTop: '4px', color: '#3b82f6', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => handleClick(mall)}
                >
                  查看详情 →
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}
