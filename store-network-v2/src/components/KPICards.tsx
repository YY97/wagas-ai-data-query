import { useAppStore } from '../store';

export default function KPICards() {
  const { stores, filters } = useAppStore();

  // 计算 KPI
  const filteredStores = stores.filter(store => {
    if (filters.brand !== 'all' && store.brand !== filters.brand) return false;
    if (filters.city !== 'all' && store.city !== filters.city) return false;
    return true;
  });

  const avgAds = filteredStores.length > 0
    ? filteredStores.reduce((sum, s) => sum + (s.ads || 0), 0) / filteredStores.length
    : 0;

  const avgOverlap = filteredStores.length > 0
    ? filteredStores.reduce((sum, s) => sum + s.overlap, 0) / filteredStores.length
    : 0;

  return (
    <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '12px' }}>
        Wagas 门店网络效率诊断
      </h2>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div style={{ 
          padding: '12px', 
          background: '#f8fafc', 
          borderRadius: '8px',
          border: '1px solid #e2e8f0'
        }}>
          <div style={{ fontSize: '12px', color: '#64748b' }}>日均销售额</div>
          <div style={{ fontSize: '24px', fontWeight: 700 }}>
            ¥{Math.round(avgAds).toLocaleString()}
          </div>
        </div>
        
        <div style={{ 
          padding: '12px', 
          background: '#f8fafc', 
          borderRadius: '8px',
          border: '1px solid #e2e8f0'
        }}>
          <div style={{ fontSize: '12px', color: '#64748b' }}>1KM 重合</div>
          <div style={{ fontSize: '24px', fontWeight: 700 }}>
            {avgOverlap.toFixed(1)} 家
          </div>
        </div>
      </div>
      
      <div style={{ marginTop: '8px', fontSize: '12px', color: '#94a3b8' }}>
        {filteredStores.length} 家门店
      </div>
    </div>
  );
}
