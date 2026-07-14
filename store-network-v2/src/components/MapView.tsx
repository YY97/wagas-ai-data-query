import { useRef, useEffect, useState, useCallback } from 'react';
import { Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ScatterplotLayer, CircleLayer, HeatmapLayer } from '@deck.gl/layers';
import { Deck } from '@deck.gl/core';
import { useAppStore } from '../store';

export default function MapView() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const deck = useRef<Deck | null>(null);
  const { stores, filters, selectedStore, setSelectedStore } = useAppStore();
  const [deliveryData, setDeliveryData] = useState<Record<string, any[]>>({});
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [show1kmCircles, setShow1kmCircles] = useState(true);
  const [show3kmCircles, setShow3kmCircles] = useState(false);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    // 初始化地图
    map.current = new Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'osm-tiles': {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap'
          }
        },
        layers: [{
          id: 'osm-tiles',
          type: 'raster',
          source: 'osm-tiles',
          minzoom: 0,
          maxzoom: 19
        }]
      },
      center: [121.4737, 31.2304], // 上海中心
      zoom: 10
    });

    // 初始化 deck.gl
    deck.current = new Deck({
      canvas: 'deck-canvas',
      initialViewState: {
        longitude: 121.4737,
        latitude: 31.2304,
        zoom: 10
      },
      controller: true
    });

    return () => {
      deck.current?.finalize();
      map.current?.remove();
    };
  }, []);

  // 加载城市配送数据（懒加载）
  const loadCityDeliveryData = useCallback(async (city: string) => {
    if (deliveryData[city]) return; // 已加载
    
    try {
      const response = await fetch(`/data/delivery/${city}.json`);
      const data = await response.json();
      setDeliveryData(prev => ({ ...prev, [city]: data }));
    } catch (error) {
      console.error(`Failed to load delivery data for ${city}:`, error);
    }
  }, [deliveryData]);

  // 当筛选城市时加载配送数据
  useEffect(() => {
    if (filters.city !== 'all') {
      loadCityDeliveryData(filters.city);
    }
  }, [filters.city, loadCityDeliveryData]);

  // 更新 deck.gl 图层
  useEffect(() => {
    if (!deck.current) return;

    // 筛选门店
    const filteredStores = stores.filter(store => {
      if (filters.brand !== 'all' && store.brand !== filters.brand) return false;
      if (filters.city !== 'all' && store.city !== filters.city) return false;
      return true;
    });

    const layers: any[] = [];

    // 1km 覆盖圈
    if (show1kmCircles) {
      layers.push(
        new CircleLayer({
          id: 'coverage-1km',
          data: filteredStores,
          getPosition: (d: any) => [d.lng, d.lat],
          getRadius: 1000,
          getFillColor: [59, 130, 246, 40],
          getLineColor: [59, 130, 246, 200],
          stroked: true,
          filled: true,
          lineWidthMinPixels: 2,
          radiusUnits: 'meters'
        })
      );
    }

    // 3km 覆盖圈
    if (show3kmCircles) {
      layers.push(
        new CircleLayer({
          id: 'coverage-3km',
          data: filteredStores,
          getPosition: (d: any) => [d.lng, d.lat],
          getRadius: 3000,
          getFillColor: [34, 197, 94, 30],
          getLineColor: [34, 197, 94, 150],
          stroked: true,
          filled: true,
          lineWidthMinPixels: 2,
          radiusUnits: 'meters'
        })
      );
    }

    // 门店标记
    layers.push(
      new ScatterplotLayer({
        id: 'stores',
        data: filteredStores,
        getPosition: (d: any) => [d.lng, d.lat],
        getFillColor: (d: any) => {
          if (selectedStore?.sid === d.sid) return [249, 115, 22, 255];
          return [59, 130, 246, 200];
        },
        getRadius: 8,
        radiusMinPixels: 6,
        radiusMaxPixels: 12,
        pickable: true,
        onClick: (info: any) => {
          if (info.object) {
            setSelectedStore(info.object);
          }
        }
      })
    );

    // 配送热力图
    if (showHeatmap && filters.city !== 'all' && deliveryData[filters.city]) {
      const heatData: any[] = [];
      Object.entries(deliveryData[filters.city]).forEach(([_, points]) => {
        (points as any[]).forEach((p: any) => {
          heatData.push({
            position: [p.lng, p.lat],
            weight: p.count || 1
          });
        });
      });

      layers.push(
        new HeatmapLayer({
          id: 'delivery-heatmap',
          data: heatData,
          getPosition: (d: any) => d.position,
          getWeight: (d: any) => d.weight,
          radiusPixels: 60,
          intensity: 1,
          threshold: 0.03,
          colorRange: [
            [0, 0, 255, 100],
            [0, 255, 255, 150],
            [0, 255, 0, 200],
            [255, 255, 0, 230],
            [255, 0, 0, 255]
          ]
        })
      );
    }

    deck.current.setProps({ layers });
  }, [stores, filters, selectedStore, showHeatmap, show1kmCircles, show3kmCircles, deliveryData, setSelectedStore]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div 
        ref={mapContainer} 
        style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
      />
      <canvas 
        id="deck-canvas" 
        style={{ 
          width: '100%', 
          height: '100%', 
          position: 'absolute', 
          top: 0, 
          left: 0,
          pointerEvents: 'none'
        }}
      />
      
      {/* 图层控制面板 */}
      <div className="layer-control" style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        background: 'rgba(255,255,255,0.95)',
        padding: '12px',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        zIndex: 1000,
        fontSize: '13px'
      }}>
        <div style={{ fontWeight: 600, marginBottom: '8px' }}>图层控制</div>
        <label style={{ display: 'block', marginBottom: '6px' }}>
          <input 
            type="checkbox" 
            checked={show1kmCircles} 
            onChange={(e) => setShow1kmCircles(e.target.checked)}
            style={{ marginRight: '6px' }}
          />
          1km 覆盖圈
        </label>
        <label style={{ display: 'block', marginBottom: '6px' }}>
          <input 
            type="checkbox" 
            checked={show3kmCircles} 
            onChange={(e) => setShow3kmCircles(e.target.checked)}
            style={{ marginRight: '6px' }}
          />
          3km 覆盖圈
        </label>
        <label style={{ display: 'block', marginBottom: '6px' }}>
          <input 
            type="checkbox" 
            checked={showHeatmap} 
            onChange={(e) => setShowHeatmap(e.target.checked)}
            style={{ marginRight: '6px' }}
          />
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
