import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import type { Store, SalesData } from './types';
import MapView from './components/MapView';
import FilterPanel from './components/FilterPanel';
import KPICards from './components/KPICards';

function App() {
  const { initData, loading } = useAppStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${import.meta.env.BASE_URL}data/stores.json`).then(r => r.json()),
      fetch(`${import.meta.env.BASE_URL}data/sales_data.json`).then(r => r.json()),
      fetch(`${import.meta.env.BASE_URL}data/channel_sales.json`).then(r => r.json()).catch(() => ({})),
      fetch(`${import.meta.env.BASE_URL}data/weather_data.json`).then(r => r.json()).catch(() => ({})),
      fetch(`${import.meta.env.BASE_URL}data/delivery_top_locations.json`).then(r => r.json()).catch(() => ({})),
    ])
      .then(([stores, salesData, channelSales, weatherData, topLocationsData]: [Store[], SalesData, any, any, Record<string, any[]>]) => {
        const storesWithLocations = stores.map(store => ({
          ...store,
          top_locations: topLocationsData[store.sid] || [],
        }));

        const allDates = new Set<string>();
        Object.values(salesData).forEach(storeSales => {
          Object.keys(storeSales).forEach(date => allDates.add(date));
        });
        const sortedDates = Array.from(allDates).sort();
        const dateRange = {
          start: sortedDates[0] || '',
          end: sortedDates[sortedDates.length - 1] || '',
        };

        initData(storesWithLocations, salesData, channelSales, weatherData, dateRange);
      })
      .catch(err => {
        console.error('Failed to load data:', err);
        setError('数据加载失败，请刷新页面重试');
      });
  }, [initData]);

  if (error) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <h2>⚠️ {error}</h2>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        height: '100vh', flexDirection: 'column', gap: '12px',
      }}>
        <div style={{ width: '40px', height: '40px', border: '4px solid #e2e8f0', borderTop: '4px solid #f97316', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <div style={{ fontSize: '13px', color: '#64748b' }}>加载中...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div className="app-layout" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <div className="side-panel" style={{
        width: '350px', overflowY: 'auto', overflowX: 'hidden',
        borderRight: '1px solid #e2e8f0', background: '#fff',
      }}>
        <KPICards />
        <FilterPanel />
      </div>
      <div className="map-container" style={{ flex: 1, position: 'relative' }}>
        <MapView />
      </div>
    </div>
  );
}

export default App;
