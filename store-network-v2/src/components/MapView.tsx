import { useRef, useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAppStore } from '../store';

export default function MapView() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const { stores, filters } = useAppStore();

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    // 初始化地图
    map.current = new maplibregl.Map({
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

    // 添加导航控件
    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    return () => {
      map.current?.remove();
    };
  }, []);

  // 更新门店标记
  useEffect(() => {
    if (!map.current) return;

    // 清除旧标记
    const existingMarkers = document.querySelectorAll('.store-marker');
    existingMarkers.forEach(m => m.remove());

    // 筛选门店
    const filteredStores = stores.filter(store => {
      if (filters.brand !== 'all' && store.brand !== filters.brand) return false;
      if (filters.city !== 'all' && store.city !== filters.city) return false;
      return true;
    });

    // 添加新标记
    filteredStores.forEach(store => {
      const el = document.createElement('div');
      el.className = 'store-marker';
      el.style.width = '20px';
      el.style.height = '20px';
      el.style.borderRadius = '50%';
      el.style.background = '#f97316';
      el.style.border = '2px solid #fff';
      el.style.cursor = 'pointer';
      el.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';

      new maplibregl.Marker(el)
        .setLngLat([store.lng, store.lat])
        .addTo(map.current!)
        .getElement()
        .addEventListener('click', () => {
          useAppStore.getState().setSelectedStore(store);
        });
    });
  }, [stores, filters]);

  return (
    <div 
      ref={mapContainer} 
      style={{ width: '100%', height: '100%' }}
    />
  );
}
