import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import type { Store, SalesData } from './types';
import MapView from './components/MapView';
import FilterPanel from './components/FilterPanel';
import KPICards from './components/KPICards';
import StorePopup from './components/StorePopup';

function App() {
  const { initData, loading } = useAppStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 加载数据
    Promise.all([
      fetch('./data/stores.json').then(r => r.json()),
      fetch('./data/sales_data.json').then(r => r.json()),
      fetch('./data/delivery_top_locations.json').then(r => r.json()).catch(() => ({})),
    ])
      .then(([stores, salesData, topLocationsData]: [Store[], SalesData, Record<string, any[]>]) => {
        // 合并 top_locations 到 stores
        const storesWithLocations = stores.map(store => ({
          ...store,
          top_locations: topLocationsData[store.sid] || [],
        }));

        // 计算日期范围
        const allDates = new Set<string>();
        Object.values(salesData).forEach(storeSales => {
          Object.keys(storeSales).forEach(date => allDates.add(date));
        });
        const sortedDates = Array.from(allDates).sort();
        const dateRange = {
          start: sortedDates[0] || '',
          end: sortedDates[sortedDates.length - 1] || '',
        };
        
        initData(storesWithLocations, salesData, dateRange);
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
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        <div>加载中...</div>
      </div>
    );
  }

  return (
    <div className="app-layout" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* 左侧筛选面板 */}
      <div className="side-panel" style={{ 
        width: '350px', 
        overflowY: 'auto',
        borderRight: '1px solid #e2e8f0',
        background: '#fff'
      }}>
        <KPICards />
        <FilterPanel />
      </div>
      
      {/* 地图区域 */}
      <div className="map-container" style={{ flex: 1, position: 'relative' }}>
        <MapView />
        <StorePopup />
      </div>
    </div>
  );
}

export default App;
