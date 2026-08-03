import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, Popup, useMap } from 'react-leaflet';
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

export default function MallLayer({ onSelectMall }: { onSelectMall: (mall: MallDetail) => void }) {
  const mallIndex = useAppStore(s => s.mallIndex);
  const map = useMap();
  const [loading, setLoading] = useState(false);

  // Load index on mount
  useEffect(() => {
    const { setMallIndex, mallIndex } = useAppStore.getState();
    if (mallIndex.length > 0) return;

    setLoading(true);
    fetch('/data/malls/index.json')
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
      // Track centroid as running average
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
    fetch(`/data/malls/${encodeURIComponent(safeName)}.json`)
      .then(r => r.json())
      .then(detail => onSelectMall(detail))
      .catch(console.warn);
  };

  return (
    <>
      {clusters.map(c => {
        const isCluster = c.count > 1;
        const color = isCluster ? '#f59e0b' : '#d97706';
        const radius = isCluster ? Math.min(8 + Math.log2(c.count) * 3, 22) : 7;

        return (
          <CircleMarker
            key={`mall-${c.lat}-${c.lng}`}
            center={[c.lat, c.lng]}
            radius={radius}
            pathOptions={{
              fillColor: color,
              color: '#fff',
              weight: 1.5,
              fillOpacity: 0.8,
            }}
            eventHandlers={{
              click: isCluster ? undefined : () => handleClick(c.malls[0]),
            }}
          >
            {isCluster ? (
              <Popup>
                <div style={{ maxWidth: '200px', maxHeight: '200px', overflowY: 'auto', fontSize: '11px' }}>
                  <div style={{ fontWeight: 700, marginBottom: '4px', color: '#92400e' }}>
                    周边 {c.count} 个商场
                  </div>
                  {c.malls.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map(m => (
                    <div
                      key={`${m.city}_${m.name}`}
                      style={{ padding: '2px 0', cursor: 'pointer', borderBottom: '1px solid #fef3c7' }}
                      onClick={() => handleClick(m)}
                    >
                      <span style={{ color: '#1e293b' }}>{m.name}</span>
                      {m.score != null && <span style={{ color: '#92400e', marginLeft: '6px', fontSize: '10px' }}>⭐{(m.score/20).toFixed(1)}</span>}
                    </div>
                  ))}
                </div>
              </Popup>
            ) : (
              <Popup>
                <div style={{ fontSize: '11px' }}>
                  <div style={{ fontWeight: 700, marginBottom: '2px' }}>{c.malls[0].name}</div>
                  {c.malls[0].score != null && <div style={{ color: '#92400e' }}>综合评分: {c.malls[0].score}</div>}
                  <div
                    style={{ marginTop: '4px', color: '#3b82f6', cursor: 'pointer', fontWeight: 600 }}
                    onClick={() => handleClick(c.malls[0])}
                  >
                    查看详情 →
                  </div>
                </div>
              </Popup>
            )}
          </CircleMarker>
        );
      })}
    </>
  );
}
