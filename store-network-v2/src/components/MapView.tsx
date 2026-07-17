import { useEffect, useRef, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Circle, Marker, Polygon, useMap } from 'react-leaflet';
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

// 生成水滴形指针图标
function createPinIcon(color: string, isSelected: boolean, isHighOverlap: boolean): L.DivIcon {
  const size = isSelected ? 32 : (isHighOverlap ? 28 : 24);
  const stroke = isSelected ? '#f97316' : (isHighOverlap ? '#c2410c' : '#fff');
  const strokeWidth = isSelected ? 3 : (isHighOverlap ? 2.5 : 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size * 1.3}" viewBox="0 0 ${size} ${size * 1.3}">
    <path d="M${size/2} ${size * 1.25} C${size/2} ${size * 1.25}, 0 ${size * 0.7}, 0 ${size * 0.45} A${size/2} ${size * 0.45} 0 1 1 ${size} ${size * 0.45} C${size} ${size * 0.7}, ${size/2} ${size * 1.25}, ${size/2} ${size * 1.25}Z"
      fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>
    <circle cx="${size/2}" cy="${size * 0.42}" r="${size * 0.18}" fill="#fff" opacity="0.9"/>
  </svg>`;
  return L.divIcon({
    className: 'store-pin-marker',
    html: svg,
    iconSize: [size, size * 1.3],
    iconAnchor: [size / 2, size * 1.25],
    popupAnchor: [0, -size * 0.8],
  });
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

function AutoFitBounds({ stores }: { stores: any[] }) {
  const map = useMap();
  const prevKeyRef = useRef('');

  useEffect(() => {
    if (stores.length === 0) return;
    // 生成筛选结果的唯一标识，避免重复 fitBounds
    const key = stores.map(s => s.sid).sort().join(',');
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    const lngs = stores.map(s => s.lng);
    const lats = stores.map(s => s.lat);
    const bounds = L.latLngBounds(
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)]
    );
    // 单店时放大，多店时自适应
    if (stores.length === 1) {
      map.setView([stores[0].lat, stores[0].lng], 14, { animate: true });
    } else {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: true });
    }
  }, [stores, map]);

  return null;
}

export default function MapView() {
  const { stores, filters, layers, getAds, selectedStore, setSelectedStore } = useAppStore();
  const [deliveryData, setDeliveryData] = useState<Record<string, any>>({});
  const [showDelivery, setShowDelivery] = useState(false);
  const [popupVisible, setPopupVisible] = useState(true);
  const [contourStores, setContourStores] = useState<string[]>([]); // 选中的配送轮廓门店 ID

  // 配送轮廓颜色（最多 5 家）
  const CONTOUR_COLORS = ['#3b82f6', '#f97316', '#22c55e', '#a855f7', '#ec4899'];

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

  // TOP10 标记 - 使用 top_locations 数据（包含坐标）
  const topLocMarkers: any[] = [];
  if (showDelivery && selectedStore?.top_locations) {
    topLocMarkers.push(...selectedStore.top_locations.slice(0, 10));
  }

  const deliveryCount = showDelivery && selectedStore ? (deliveryData[selectedStore.city]?.[selectedStore.sid]?.length || 0) : 0;

  // Ctrl/Cmd+点击选择门店用于配送轮廓对比（最多 5 家）
  const handleStoreClick = (store: any, event?: L.LeafletMouseEvent) => {
    const isCtrlOrCmd = event?.originalEvent?.ctrlKey || event?.originalEvent?.metaKey;
    if (layers.showDeliveryContour && isCtrlOrCmd) {
      event?.originalEvent?.stopPropagation?.();
      setContourStores(prev => {
        if (prev.includes(store.sid)) {
          return prev.filter(id => id !== store.sid);
        }
        if (prev.length >= 5) {
          alert('最多同时对比 5 家门店');
          return prev;
        }
        return [...prev, store.sid];
      });
    } else {
      setSelectedStore(store);
      setPopupVisible(true);
    }
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <MapContainer center={[31.2304, 121.4737]} zoom={10} maxZoom={18} style={{ width: '100%', height: '100%' }}>
        <TileLayer
          url="https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}"
          subdomains={['1','2','3','4']}
          attribution="高德底图"
        />

        <AutoFitBounds stores={filteredStores} />

        {(layers.showCircles1km || !layers.showMarkers) && filteredStores.map(s => (
          <Circle key={`c1-${s.sid}`} center={[s.lat, s.lng]} radius={1000} interactive={false}
            pathOptions={{ color: s.overlap >= 3 ? '#dc2626' : '#3b82f6', weight: (s.overlap >= 3 && layers.highlightOverlap) ? 2 : 1,
              fillColor: s.overlap >= 3 ? '#dc2626' : '#3b82f6', fillOpacity: 0.06 }} />
        ))}

        {layers.showCircles3km && filteredStores.map(s => (
          <Circle key={`c3-${s.sid}`} center={[s.lat, s.lng]} radius={3000} interactive={false}
            pathOptions={{ color: '#22c55e', weight: 1, fillColor: '#22c55e', fillOpacity: 0.04, dashArray: '6,4' }} />
        ))}

        {layers.showMarkers && filteredStores.map(s => {
          const isSel = selectedStore?.sid === s.sid;
          const isContourSel = contourStores.includes(s.sid);
          const color = isSel ? '#f97316' : (isContourSel ? CONTOUR_COLORS[contourStores.indexOf(s.sid) % 4] : (layers.colorByAds ? adsColor(getAds(s.sid)) : brandColor(s.brand)));
          const hi = s.overlap >= 3;
          return (
            <Marker key={s.sid} position={[s.lat, s.lng]}
              icon={createPinIcon(color, isSel || isContourSel, hi)}
              eventHandlers={{ click: (e) => handleStoreClick(s, e) }} />
          );
        })}

        {/* 配送轮廓多边形 */}
        {layers.showDeliveryContour && contourStores.map((sid, idx) => {
          const store = stores.find(s => s.sid === sid);
          if (!store || !store.delivery_contour || store.delivery_contour.length === 0) return null;
          const color = CONTOUR_COLORS[idx % 4];
          return (
            <Polygon key={`contour-${sid}`} positions={store.delivery_contour}
              pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.15, interactive: false }} />
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

      {/* 配送轮廓选择提示 */}
      {layers.showDeliveryContour && contourStores.length > 0 && (
        <div style={{ position:'absolute',top:'12px',right:'12px',zIndex:999,
          background:'rgba(255,255,255,0.95)',color:'#1e293b',padding:'8px 14px',borderRadius:'8px',fontSize:'12px',
          boxShadow:'0 2px 10px rgba(0,0,0,0.1)',border:'1px solid #e2e8f0',display:'flex',alignItems:'center',gap:'8px' }}>
          <span>已选 <span style={{ fontWeight:700,color:'#f97316' }}>{contourStores.length}</span>/5 家门店</span>
          <span style={{ color:'#94a3b8',fontSize:'11px' }}>Ctrl+点击取消</span>
          <button onClick={() => setContourStores([])}
            style={{ background:'#ef4444',color:'#fff',border:'none',borderRadius:'4px',padding:'2px 8px',fontSize:'11px',cursor:'pointer' }}>
            清除
          </button>
        </div>
      )}

      {/* 配送轮廓模式提示（未选择时） */}
      {layers.showDeliveryContour && contourStores.length === 0 && (
        <div style={{ position:'absolute',top:'12px',right:'12px',zIndex:999,
          background:'rgba(255,255,255,0.95)',color:'#64748b',padding:'8px 14px',borderRadius:'8px',fontSize:'12px',
          boxShadow:'0 2px 10px rgba(0,0,0,0.1)',border:'1px solid #e2e8f0' }}>
          Ctrl+点击门店添加对比（最多 5 家）
        </div>
      )}
    </div>
  );
}
