import { useEffect, useRef, useState, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Circle, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import { createPortal } from 'react-dom';
import { useAppStore } from '../store';
import StorePopupCard from './StorePopupCard';

function adsColor(v: number | null): string {
  if (v == null) return '#6b7280';
  if (v < 5000) return '#93c5fd';
  if (v < 10000) return '#86efac';
  if (v < 20000) return '#fdba74';
  return '#fca5a5';
}

const BRAND_COLORS: Record<string, string> = {
  'Wagas': '#e11d48', 'Baker&Spice': '#f59e0b', 'Baker & Spice': '#f59e0b',
  'Lokal': '#22c55e', 'JUNi': '#8b5cf6', 'Funk&Kale': '#06b6d4', 'Funk & Kale': '#06b6d4',
};
function brandColor(brand: string): string { return BRAND_COLORS[brand] || '#6b7280'; }

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getTopDeliveryMarkers(pts: any[], maxMarkers: number = 10) {
  if (!pts || pts.length === 0) return [];
  // 按权重降序排列
  const sorted = pts.map((p: any, i: number) => ({ ...p, idx: i })).sort((a: any, b: any) => (b.w || 1) - (a.w || 1));
  const clusters: any[] = [];
  const assigned = new Set<number>();

  for (const p of sorted) {
    if (assigned.has(p.idx)) continue;
    // 找到 150m 内的所有未分配点，合并为一个簇
    let sumW = p.w || 1, sumLat = p.lat * (p.w || 1), sumLng = p.lng * (p.w || 1), count = 1;
    assigned.add(p.idx);
    for (const q of sorted) {
      if (assigned.has(q.idx)) continue;
      if (haversineKm(p.lat, p.lng, q.lat, q.lng) <= 0.15) {
        const qw = q.w || 1;
        sumW += qw; sumLat += q.lat * qw; sumLng += q.lng * qw; count++;
        assigned.add(q.idx);
      }
    }
    clusters.push({ lat: sumLat / sumW, lng: sumLng / sumW, totalWeight: sumW, pointCount: count });
    if (clusters.length >= maxMarkers) break;
  }
  // 按总权重排序，编号 1-N
  clusters.sort((a, b) => b.totalWeight - a.totalWeight);
  return clusters.slice(0, maxMarkers).map((c, i) => ({ rank: i + 1, lat: c.lat, lng: c.lng, count: c.totalWeight }));
}

function HeatmapLayer({ points }: { points: [number, number, number][] }) {
  const map = useMap();
  const heatRef = useRef<any>(null);
  useEffect(() => {
    if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; }
    if (points.length === 0) return;
    heatRef.current = (L as any).heatLayer(points, {
      radius: 25, blur: 15, maxZoom: 17,
      gradient: { 0.2: 'blue', 0.4: 'cyan', 0.6: 'lime', 0.8: 'yellow', 1.0: 'red' }
    }).addTo(map);
    return () => { if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; } };
  }, [points, map]);
  return null;
}

function TopLocationMarkers({ locations }: { locations: any[] }) {
  return (
    <>
      {locations.map(loc => (
        <Marker key={loc.rank} position={[loc.lat, loc.lng]}
          icon={L.divIcon({
            className: '', iconSize: [22, 22], iconAnchor: [11, 11],
            html: `<div style="width:22px;height:22px;border-radius:50%;background:#3b82f6;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3)">${loc.rank}</div>`
          })}
        />
      ))}
    </>
  );
}

function PopupFollow({ store, visible, onClose, showDelivery, onToggleDelivery }: any) {
  const map = useMap();
  const popupRef = useRef<L.Popup | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [renderKey, setRenderKey] = useState(0);

  useEffect(() => {
    if (!store || !visible) {
      if (popupRef.current) { map.closePopup(popupRef.current); popupRef.current = null; }
      containerRef.current = null;
      return;
    }
    if (!containerRef.current) {
      containerRef.current = document.createElement('div');
      containerRef.current.style.pointerEvents = 'auto';
    }
    if (!popupRef.current) {
      popupRef.current = L.popup({
        maxWidth: 320, closeButton: false, autoClose: false, closeOnClick: false,
        offset: [15, 0], className: 'store-popup-leaflet'
      }).setLatLng([store.lat, store.lng]).setContent(containerRef.current).openOn(map);
    } else {
      popupRef.current.setLatLng([store.lat, store.lng]);
    }
    setRenderKey(k => k + 1);
    return () => {
      if (popupRef.current) { map.closePopup(popupRef.current); popupRef.current = null; }
    };
  }, [store?.sid, visible, map]); // eslint-disable-line

  if (!store || !visible || !containerRef.current) return null;
  return createPortal(
    <StorePopupCard key={`${store.sid}-${renderKey}`} showHeatmap={showDelivery}
      onToggleHeatmap={onToggleDelivery} onClose={onClose} />,
    containerRef.current
  );
}

export default function MapView() {
  const { stores, filters, layers, getAds, selectedStore, setSelectedStore } = useAppStore();
  const [deliveryData, setDeliveryData] = useState<Record<string, any>>({});
  const [showDelivery, setShowDelivery] = useState(false);
  const [popupVisible, setPopupVisible] = useState(true);

  const loadCityDeliveryData = useCallback(async (city: string) => {
    if (deliveryData[city]) return;
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}data/delivery/${city}.json`);
      const data = await r.json();
      setDeliveryData(prev => ({ ...prev, [city]: data }));
    } catch (e) { console.error(e); }
  }, [deliveryData]);

  useEffect(() => {
    if (selectedStore) loadCityDeliveryData(selectedStore.city);
    if (filters.city !== 'all') loadCityDeliveryData(filters.city);
  }, [filters.city, selectedStore, loadCityDeliveryData]);

  const filteredStores = stores.filter(store => {
    if (filters.brand !== 'all' && store.brand !== filters.brand) return false;
    if (filters.city !== 'all' && store.city !== filters.city) return false;
    if (filters.fmt !== 'all' && store.fmt !== filters.fmt) return false;
    if (filters.adsRange !== 'all') {
      const ads = getAds(store.sid) ?? 0;
      if (filters.adsRange === 'lt5000' && ads >= 5000) return false;
      if (filters.adsRange === '5000to10000' && (ads < 5000 || ads >= 10000)) return false;
      if (filters.adsRange === '10000to20000' && (ads < 10000 || ads >= 20000)) return false;
      if (filters.adsRange === 'gt20000' && ads < 20000) return false;
    }
    if (filters.storeNames.length > 0 && !filters.storeNames.includes(store.sid)) return false;
    if (filters.storeIds.length > 0 && !filters.storeIds.includes(store.sid)) return false;
    return true;
  });

  // 热力图数据
  const heatPoints: [number, number, number][] = [];
  if (showDelivery && selectedStore) {
    const pts = deliveryData[selectedStore.city]?.[selectedStore.sid];
    if (Array.isArray(pts) && pts.length > 0) {
      const maxW = Math.max(...pts.map((p: any) => p.w || 1));
      pts.forEach((p: any) => heatPoints.push([p.lat, p.lng, (p.w || 1) / maxW]));
    }
  }

  // TOP10 标记
  const topLocMarkers: any[] = [];
  if (showDelivery && selectedStore) {
    const pts = deliveryData[selectedStore.city]?.[selectedStore.sid];
    if (Array.isArray(pts)) {
      topLocMarkers.push(...getTopDeliveryMarkers(pts));
    }
  }

  const deliveryCount = showDelivery && selectedStore ? (deliveryData[selectedStore.city]?.[selectedStore.sid]?.length || 0) : 0;

  const handleStoreClick = (store: any) => { setSelectedStore(store); setPopupVisible(true); };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <MapContainer center={[31.2304, 121.4737]} zoom={10} maxZoom={18} style={{ width: '100%', height: '100%' }}>
        <TileLayer
          url="https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}"
          subdomains={['1','2','3','4']}
          attribution="高德底图"
        />

        {(layers.showCircles1km || !layers.showMarkers) && filteredStores.map(s => (
          <Circle key={`c1-${s.sid}`} center={[s.lat, s.lng]} radius={1000}
            pathOptions={{ color: s.overlap >= 3 ? '#dc2626' : '#3b82f6', weight: (s.overlap >= 3 && layers.highlightOverlap) ? 2 : 1,
              fillColor: s.overlap >= 3 ? '#dc2626' : '#3b82f6', fillOpacity: 0.06 }} />
        ))}

        {layers.showCircles3km && filteredStores.map(s => (
          <Circle key={`c3-${s.sid}`} center={[s.lat, s.lng]} radius={3000}
            pathOptions={{ color: '#22c55e', weight: 1, fillColor: '#22c55e', fillOpacity: 0.04, dashArray: '6,4' }} />
        ))}

        {layers.showMarkers && filteredStores.map(s => {
          const isSel = selectedStore?.sid === s.sid;
          const color = isSel ? '#f97316' : (layers.colorByAds ? adsColor(getAds(s.sid)) : brandColor(s.brand));
          const hi = s.overlap >= 3;
          return (
            <CircleMarker key={s.sid} center={[s.lat, s.lng]} radius={hi ? 8 : 5}
              pathOptions={{ color: hi ? '#c2410c' : '#fff', weight: hi ? 3 : 2, fillColor: color, fillOpacity: 0.85 }}
              eventHandlers={{ click: () => handleStoreClick(s) }} />
          );
        })}

        {heatPoints.length > 0 && <HeatmapLayer points={heatPoints} />}
        {topLocMarkers.length > 0 && <TopLocationMarkers locations={topLocMarkers} />}

        <PopupFollow store={selectedStore} visible={popupVisible}
          onClose={() => setPopupVisible(false)} showDelivery={showDelivery}
          onToggleDelivery={() => {
            if (!showDelivery && selectedStore) loadCityDeliveryData(selectedStore.city);
            setShowDelivery(!showDelivery);
          }} />
      </MapContainer>

      {/* 图例 */}
      <div style={{ position: 'absolute', bottom: '40px', left: '10px', zIndex: 999,
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px',
        padding: '10px 12px', fontSize: '10px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        {showDelivery && selectedStore ? (
          <>
            <div style={{ fontWeight: 600, color: '#475569', marginBottom: '4px' }}>配送距离</div>
            {[{c:'#ef4444',l:'≤1km'},{c:'#f97316',l:'1-2km'},{c:'#eab308',l:'2-3km'},{c:'#3b82f6',l:'3-5km'},{c:'#94a3b8',l:'>5km'}].map(i => (
              <div key={i.l} style={{ display:'flex',alignItems:'center',gap:'5px',padding:'1px 0',color:'#64748b' }}>
                <span style={{ width:'10px',height:'10px',borderRadius:'50%',background:i.c,flexShrink:0 }} />{i.l}
              </div>
            ))}
          </>
        ) : layers.colorByAds ? (
          <>
            <div style={{ fontWeight: 600, color: '#475569', marginBottom: '4px' }}>ADS</div>
            {[{c:'#93c5fd',l:'<5K'},{c:'#86efac',l:'5-10K'},{c:'#fdba74',l:'10-20K'},{c:'#fca5a5',l:'>20K'}].map(i => (
              <div key={i.l} style={{ display:'flex',alignItems:'center',gap:'5px',padding:'1px 0',color:'#64748b' }}>
                <span style={{ width:'10px',height:'10px',borderRadius:'3px',background:i.c,flexShrink:0 }} />{i.l}
              </div>
            ))}
          </>
        ) : (
          <>
            <div style={{ fontWeight: 600, color: '#475569', marginBottom: '4px' }}>品牌</div>
            {[{c:'#e11d48',l:'Wagas'},{c:'#f59e0b',l:'B&S'},{c:'#22c55e',l:'Lokal'},{c:'#8b5cf6',l:'JUNi'},{c:'#06b6d4',l:'F&K'}].map(i => (
              <div key={i.l} style={{ display:'flex',alignItems:'center',gap:'5px',padding:'1px 0',color:'#64748b' }}>
                <span style={{ width:'10px',height:'10px',borderRadius:'3px',background:i.c,flexShrink:0 }} />{i.l}
              </div>
            ))}
          </>
        )}
      </div>

      {showDelivery && selectedStore && deliveryCount > 0 && (
        <div style={{ position:'absolute',top:'12px',right:'12px',zIndex:999,
          background:'rgba(255,255,255,0.95)',color:'#1e293b',padding:'8px 14px',borderRadius:'8px',fontSize:'12px',
          boxShadow:'0 2px 10px rgba(0,0,0,0.1)',border:'1px solid #e2e8f0' }}>
          <span style={{ fontWeight:700,color:'#f97316' }}>{deliveryCount}</span> 个配送地址 &middot; 再次点击关闭
        </div>
      )}
    </div>
  );
}
