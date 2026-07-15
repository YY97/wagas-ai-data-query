import { useRef, useEffect, useState, useCallback } from 'react';
import { Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ScatterplotLayer } from '@deck.gl/layers';
import { HexagonLayer } from '@deck.gl/aggregation-layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { useAppStore } from '../store';
import StorePopupCard from './StorePopupCard';

function adsColor(v: number | null): [number, number, number, number] {
  if (v == null) return [107, 114, 128, 200];
  if (v < 5000) return [147, 197, 253, 220];
  if (v < 10000) return [134, 239, 172, 220];
  if (v < 20000) return [253, 186, 116, 220];
  return [252, 165, 165, 220];
}

const BRAND_COLORS: Record<string, [number, number, number, number]> = {
  'Wagas': [225, 29, 72, 220],
  'Baker&Spice': [245, 158, 11, 220],
  'Lokal': [34, 197, 94, 220],
  'JUNi': [139, 92, 246, 220],
  'Funk&Kale': [6, 182, 212, 220],
};
function brandColor(brand: string): [number, number, number, number] {
  return BRAND_COLORS[brand] || [107, 114, 128, 200];
}

// 配送点距离颜色：近=红，远=蓝
function distColor(distKm: number): [number, number, number, number] {
  if (distKm <= 1) return [239, 68, 68, 180];
  if (distKm <= 2) return [249, 115, 22, 160];
  if (distKm <= 3) return [234, 179, 8, 140];
  if (distKm <= 5) return [59, 130, 246, 120];
  return [148, 163, 184, 100];
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export default function MapView() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const deckOverlay = useRef<MapboxOverlay | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const { stores, filters, layers, getAds, selectedStore, setSelectedStore } = useAppStore();
  const [deliveryData, setDeliveryData] = useState<Record<string, any>>({});
  const [showDelivery, setShowDelivery] = useState(false);
  const [popupVisible, setPopupVisible] = useState(true);

  const selectedStoreRef = useRef(selectedStore);
  useEffect(() => { selectedStoreRef.current = selectedStore; }, [selectedStore]);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'amap-tiles': {
            type: 'raster',
            tiles: [
              'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
              'https://webrd02.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
              'https://webrd03.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
              'https://webrd04.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}'
            ],
            tileSize: 256,
            attribution: '高德底图'
          }
        },
        layers: [{ id: 'amap-tiles', type: 'raster', source: 'amap-tiles', minzoom: 0, maxzoom: 18 }]
      },
      center: [121.4737, 31.2304],
      zoom: 10
    });

    deckOverlay.current = new MapboxOverlay({ interleaved: true, layers: [] });
    map.current.addControl(deckOverlay.current);

    // 地图移动时直接操作 DOM 更新弹窗位置（绕过 React 渲染）
    const updatePopupPos = () => {
      const el = popupRef.current;
      const store = selectedStoreRef.current;
      if (el && store && map.current) {
        const pt = map.current.project([store.lng, store.lat]);
        el.style.left = `${pt.x + 15}px`;
        el.style.top = `${pt.y - 20}px`;
        el.style.display = 'block';
      } else if (el) {
        el.style.display = 'none';
      }
    };
    map.current.on('move', updatePopupPos);
    map.current.on('zoom', updatePopupPos);
    map.current.on('moveend', updatePopupPos);

    return () => {
      if (deckOverlay.current && map.current) {
        map.current.removeControl(deckOverlay.current);
        deckOverlay.current.finalize();
      }
      map.current?.remove();
    };
  }, []);

  // 选中/切换门店时定位弹窗
  useEffect(() => {
    const el = popupRef.current;
    if (el && selectedStore && popupVisible && map.current) {
      const pt = map.current.project([selectedStore.lng, selectedStore.lat]);
      el.style.left = `${pt.x + 15}px`;
      el.style.top = `${pt.y - 20}px`;
      el.style.display = 'block';
    } else if (el) {
      el.style.display = 'none';
    }
  }, [selectedStore, popupVisible]);

  const loadCityDeliveryData = useCallback(async (city: string) => {
    if (deliveryData[city]) return;
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}data/delivery/${city}.json`);
      const data = await response.json();
      setDeliveryData(prev => ({ ...prev, [city]: data }));
    } catch (error) {
      console.error(`Failed to load delivery data for ${city}:`, error);
    }
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

  // 更新 deck.gl 图层
  useEffect(() => {
    if (!deckOverlay.current) return;
    const layerList: any[] = [];

    // 1km 覆盖圈
    if (layers.showCircles1km || !layers.showMarkers) {
      layerList.push(
        new ScatterplotLayer({
          id: 'coverage-1km', data: filteredStores,
          getPosition: (d: any) => [d.lng, d.lat],
          getRadius: 1000,
          getFillColor: (d: any) => (d.overlap >= 3 ? [220, 38, 38, 20] : [59, 130, 246, 20]),
          getLineColor: (d: any) => (d.overlap >= 3 ? [220, 38, 38, 200] : [59, 130, 246, 200]),
          stroked: true, filled: true,
          getLineWidth: (d: any) => (d.overlap >= 3 && layers.highlightOverlap) ? 2 : 1,
          lineWidthMinPixels: 1, radiusUnits: 'meters', pickable: true,
          onClick: (info: any) => {
            if (info.object) {
              setSelectedStore(info.object);
              setPopupVisible(true);
            }
          }
        })
      );
    }

    // 3km 覆盖圈
    if (layers.showCircles3km) {
      layerList.push(
        new ScatterplotLayer({
          id: 'coverage-3km', data: filteredStores,
          getPosition: (d: any) => [d.lng, d.lat],
          getRadius: 3000,
          getFillColor: [34, 197, 94, 10], getLineColor: [34, 197, 94, 150],
          stroked: true, filled: true, lineWidthMinPixels: 1, radiusUnits: 'meters',
        })
      );
    }

    // 门店标记
    if (layers.showMarkers) {
      layerList.push(
        new ScatterplotLayer({
          id: 'stores', data: filteredStores,
          getPosition: (d: any) => [d.lng, d.lat],
          getFillColor: (d: any) => {
            if (selectedStore?.sid === d.sid) return [249, 115, 22, 255];
            return layers.colorByAds ? adsColor(getAds(d.sid)) : brandColor(d.brand);
          },
          getRadius: (d: any) => (d.overlap >= 3) ? 14 : 9,
          radiusMinPixels: 5, radiusMaxPixels: 14,
          getLineWidth: (d: any) => (d.overlap >= 3) ? 3 : 2,
          lineWidthMinPixels: 2,
          getLineColor: (d: any) => (d.overlap >= 3) ? [194, 65, 12, 255] : [255, 255, 255, 255],
          stroked: true, filled: true, pickable: true,
          onClick: (info: any) => {
            if (info.object) {
              setSelectedStore(info.object);
              setPopupVisible(true);
            }
          }
        })
      );
    }

    // 配送热力图（匹配旧版 Leaflet L.heatLayer 效果）
    if (showDelivery && selectedStore) {
      const cityData = deliveryData[selectedStore.city];
      if (cityData) {
        const storePoints = cityData[selectedStore.sid];
        if (Array.isArray(storePoints) && storePoints.length > 0) {
          const maxW = Math.max(...storePoints.map((p: any) => p.w || 1));
          const heatData = storePoints.map((p: any) => ({
            position: [p.lng, p.lat],
            weight: (p.w || 1) / maxW
          }));
          layerList.push(
            new HeatmapLayer({
              id: 'delivery-heatmap',
              data: heatData,
              getPosition: (d: any) => d.position,
              getWeight: (d: any) => d.weight,
              radiusPixels: 25,
              intensity: 1,
              threshold: 0.02,
              colorRange: [
                [0, 0, 255, 120],
                [0, 255, 255, 160],
                [0, 255, 0, 200],
                [255, 255, 0, 230],
                [255, 0, 0, 255]
              ]
            })
          );
        }
      }
    }

    deckOverlay.current.setProps({ layers: layerList });
  }, [filteredStores, filters, layers, selectedStore, showDelivery, deliveryData, setSelectedStore, getAds]);

  // fit bounds
  useEffect(() => {
    if (!map.current || filteredStores.length === 0) return;
    const lngs = filteredStores.map(s => s.lng);
    const lats = filteredStores.map(s => s.lat);
    if (lngs.length > 1) {
      map.current.fitBounds([
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)]
      ], { padding: 40 });
    }
  }, [filteredStores.length, filters.brand, filters.city]); // eslint-disable-line

  // 配送点统计
  const deliveryCount = showDelivery && selectedStore
    ? (deliveryData[selectedStore.city]?.[selectedStore.sid]?.length || 0)
    : 0;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }} />

      {/* 弹窗容器（ref 直接操作 DOM，不走 React 渲染） */}
      {selectedStore && popupVisible && (
        <div
          ref={popupRef}
          style={{
            position: 'absolute', zIndex: 100, display: 'none',
            pointerEvents: 'auto',
          }}
        >
          <StorePopupCard
            key={selectedStore?.sid}
            showHeatmap={showDelivery}
            onToggleHeatmap={() => {
              const city = selectedStore?.city;
              if (!showDelivery && city) loadCityDeliveryData(city);
              setShowDelivery(!showDelivery);
            }}
            onClose={() => { setPopupVisible(false); }}
          />
        </div>
      )}

      {/* 图例 */}
      <div style={{
        position: 'absolute', bottom: '40px', left: '10px',
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px',
        padding: '10px 12px', fontSize: '10px', zIndex: 999,
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
      }}>
        {showDelivery && selectedStore ? (
          <>
            <div style={{ fontWeight: 600, color: '#475569', marginBottom: '4px' }}>配送距离</div>
            {[
              { color: '#ef4444', label: '≤1km' },
              { color: '#f97316', label: '1-2km' },
              { color: '#eab308', label: '2-3km' },
              { color: '#3b82f6', label: '3-5km' },
              { color: '#94a3b8', label: '>5km' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '1px 0', color: '#64748b' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                {item.label}
              </div>
            ))}
          </>
        ) : layers.colorByAds ? (
          <>
            <div style={{ fontWeight: 600, color: '#475569', marginBottom: '4px' }}>ADS</div>
            {[
              { color: '#93c5fd', label: '<5K' },
              { color: '#86efac', label: '5-10K' },
              { color: '#fdba74', label: '10-20K' },
              { color: '#fca5a5', label: '>20K' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '1px 0', color: '#64748b' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: item.color, flexShrink: 0 }} />
                {item.label}
              </div>
            ))}
          </>
        ) : (
          <>
            <div style={{ fontWeight: 600, color: '#475569', marginBottom: '4px' }}>品牌</div>
            {[
              { color: '#e11d48', label: 'Wagas' },
              { color: '#f59e0b', label: 'B&S' },
              { color: '#22c55e', label: 'Lokal' },
              { color: '#8b5cf6', label: 'JUNi' },
              { color: '#06b6d4', label: 'F&K' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '1px 0', color: '#64748b' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: item.color, flexShrink: 0 }} />
                {item.label}
              </div>
            ))}
          </>
        )}
      </div>

      {/* 配送信息提示 */}
      {showDelivery && selectedStore && deliveryCount > 0 && (
        <div style={{
          position: 'absolute', top: '12px', right: '12px',
          background: 'rgba(255,255,255,0.95)', color: '#1e293b',
          padding: '8px 14px', borderRadius: '8px', fontSize: '12px', zIndex: 999,
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0'
        }}>
          <span style={{ fontWeight: 700, color: '#f97316' }}>{deliveryCount}</span> 个配送地址 &nbsp;&middot;&nbsp; 再次点击关闭
        </div>
      )}
    </div>
  );
}
