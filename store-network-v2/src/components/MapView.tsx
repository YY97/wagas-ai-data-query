import { useRef, useEffect, useState, useCallback } from 'react';
import { Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ScatterplotLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { useAppStore } from '../store';

// ADS 颜色映射
function adsColor(v: number | null): [number, number, number, number] {
  if (v == null) return [107, 114, 128, 200];
  if (v < 5000) return [147, 197, 253, 220];
  if (v < 10000) return [134, 239, 172, 220];
  if (v < 20000) return [253, 186, 116, 220];
  return [252, 165, 165, 220];
}

// 品牌颜色映射
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

export default function MapView() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const deckOverlay = useRef<MapboxOverlay | null>(null);
  const { stores, filters, layers, getAds, selectedStore, setSelectedStore } = useAppStore();
  const [deliveryData, setDeliveryData] = useState<Record<string, any[]>>({});
  const [showHeatmap, setShowHeatmap] = useState(false);

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
        layers: [{
          id: 'amap-tiles',
          type: 'raster',
          source: 'amap-tiles',
          minzoom: 0,
          maxzoom: 18
        }]
      },
      center: [121.4737, 31.2304],
      zoom: 10
    });

    deckOverlay.current = new MapboxOverlay({
      interleaved: true,
      layers: []
    });
    map.current.addControl(deckOverlay.current);

    return () => {
      if (deckOverlay.current && map.current) {
        map.current.removeControl(deckOverlay.current);
        deckOverlay.current.finalize();
      }
      map.current?.remove();
    };
  }, []);

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
    if (filters.city !== 'all') {
      loadCityDeliveryData(filters.city);
    }
  }, [filters.city, loadCityDeliveryData]);

  // 筛选门店
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
          id: 'coverage-1km',
          data: filteredStores,
          getPosition: (d: any) => [d.lng, d.lat],
          getRadius: 1000,
          getFillColor: (d: any) => {
            const isHighOverlap = d.overlap >= 3;
            return isHighOverlap ? [220, 38, 38, 20] : [59, 130, 246, 20];
          },
          getLineColor: (d: any) => {
            const isHighOverlap = d.overlap >= 3;
            return isHighOverlap ? [220, 38, 38, 200] : [59, 130, 246, 200];
          },
          stroked: true,
          filled: true,
          lineWidthMinPixels: (d: any) => (d.overlap >= 3 && layers.highlightOverlap) ? 2 : 1,
          radiusUnits: 'meters',
          pickable: true,
          onClick: (info: any) => {
            if (info.object) setSelectedStore(info.object);
          }
        })
      );
    }

    // 3km 覆盖圈
    if (layers.showCircles3km) {
      layerList.push(
        new ScatterplotLayer({
          id: 'coverage-3km',
          data: filteredStores,
          getPosition: (d: any) => [d.lng, d.lat],
          getRadius: 3000,
          getFillColor: [34, 197, 94, 10],
          getLineColor: [34, 197, 94, 150],
          stroked: true,
          filled: true,
          lineWidthMinPixels: 1,
          radiusUnits: 'meters',
        })
      );
    }

    // 门店标记
    if (layers.showMarkers) {
      layerList.push(
        new ScatterplotLayer({
          id: 'stores',
          data: filteredStores,
          getPosition: (d: any) => [d.lng, d.lat],
          getFillColor: (d: any) => {
            if (selectedStore?.sid === d.sid) return [249, 115, 22, 255];
            if (layers.colorByAds) {
              return adsColor(getAds(d.sid));
            }
            return brandColor(d.brand);
          },
          getRadius: (d: any) => (d.overlap >= 3) ? 14 : 9,
          radiusMinPixels: (d: any) => (d.overlap >= 3) ? 7 : 5,
          radiusMaxPixels: (d: any) => (d.overlap >= 3) ? 14 : 12,
          getLineWidth: (d: any) => (d.overlap >= 3) ? 3 : 2,
          lineWidthMinPixels: 2,
          getLineColor: (d: any) => (d.overlap >= 3) ? [194, 65, 12, 255] : [255, 255, 255, 255],
          stroked: true,
          filled: true,
          pickable: true,
          onClick: (info: any) => {
            if (info.object) setSelectedStore(info.object);
          }
        })
      );
    }

    // 配送热力图
    if (showHeatmap && filters.city !== 'all' && deliveryData[filters.city]) {
      const heatData: any[] = [];
      Object.entries(deliveryData[filters.city]).forEach(([_, points]) => {
        (points as any[]).forEach((p: any) => {
          heatData.push({ position: [p.lng, p.lat], weight: p.count || 1 });
        });
      });
      layerList.push(
        new HeatmapLayer({
          id: 'delivery-heatmap',
          data: heatData,
          getPosition: (d: any) => d.position,
          getWeight: (d: any) => d.weight,
          radiusPixels: 60,
          intensity: 1,
          threshold: 0.03,
          colorRange: [
            [0, 0, 255, 100], [0, 255, 255, 150], [0, 255, 0, 200],
            [255, 255, 0, 230], [255, 0, 0, 255]
          ]
        })
      );
    }

    deckOverlay.current.setProps({ layers: layerList });
  }, [filteredStores, filters, layers, selectedStore, showHeatmap, deliveryData, setSelectedStore, getAds]);

  // fit bounds
  useEffect(() => {
    if (!map.current || filteredStores.length === 0) return;
    const bounds = filteredStores.map(s => [s.lng, s.lat] as [number, number]);
    if (bounds.length > 1) {
      const lngs = bounds.map(b => b[0]);
      const lats = bounds.map(b => b[1]);
      map.current.fitBounds([
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)]
      ], { padding: 40 });
    }
  }, [filteredStores.length, filters.brand, filters.city]); // eslint-disable-line

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        ref={mapContainer}
        style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
      />

      {/* 图例 */}
      <div style={{
        position: 'absolute', bottom: '40px', left: '10px',
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px',
        padding: '10px 12px', fontSize: '10px', zIndex: 999,
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
      }}>
        {layers.colorByAds ? (
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

      {/* 图层控制 */}
      <div style={{
        position: 'absolute', top: '20px', right: '20px',
        background: 'rgba(255,255,255,0.95)', padding: '12px',
        borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        zIndex: 1000, fontSize: '13px'
      }}>
        <div style={{ fontWeight: 600, marginBottom: '8px' }}>图层</div>
        <label style={{ display: 'block', marginBottom: '6px' }}>
          <input type="checkbox" checked={layers.showCircles1km}
            onChange={e => {}} readOnly style={{ marginRight: '6px' }} />
          1km 覆盖圈
        </label>
        <label style={{ display: 'block', marginBottom: '6px' }}>
          <input type="checkbox" checked={layers.showCircles3km}
            onChange={e => {}} readOnly style={{ marginRight: '6px' }} />
          3km 覆盖圈
        </label>
        <label style={{ display: 'block', marginBottom: '6px' }}>
          <input type="checkbox" checked={showHeatmap}
            onChange={e => setShowHeatmap(e.target.checked)} style={{ marginRight: '6px' }} />
          配送热力图
        </label>
        {showHeatmap && filters.city === 'all' && (
          <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '6px' }}>
            请先选择城市查看热力图
          </div>
        )}
      </div>
    </div>
  );
}
