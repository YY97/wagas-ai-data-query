import { useAppStore } from '../store';

export default function KPICards() {
  const { stores, filters } = useAppStore();

  // 计算 KPI
  const filteredStores = stores.filter(store => {
    if (filters.brand !== 'all' && store.brand !== filters.brand) return false;
    if (filters.city !== 'all' && store.city !== filters.city) return false;
    if (filters.fmt !== 'all' && store.fmt !== filters.fmt) return false;
    if (filters.adsRange !== 'all') {
      const ads = store.ads ?? 0;
      if (filters.adsRange === 'lt5000' && ads >= 5000) return false;
      if (filters.adsRange === '5000to10000' && (ads < 5000 || ads >= 10000)) return false;
      if (filters.adsRange === '10000to20000' && (ads < 10000 || ads >= 20000)) return false;
      if (filters.adsRange === 'gt20000' && ads < 20000) return false;
    }
    return true;
  });

  const avgAds = filteredStores.length > 0
    ? filteredStores.reduce((sum, s) => sum + (s.ads || 0), 0) / filteredStores.length
    : 0;

  const avgOverlap = filteredStores.length > 0
    ? filteredStores.reduce((sum, s) => sum + s.overlap, 0) / filteredStores.length
    : 0;

  // 计算 ADS 分布
  const adsDistribution = {
    under5k: 0,
    '5k-10k': 0,
    '10k-20k': 0,
    over20k: 0,
  };
  filteredStores.forEach(store => {
    const ads = store.ads || 0;
    if (ads < 5000) adsDistribution.under5k++;
    else if (ads < 10000) adsDistribution['5k-10k']++;
    else if (ads < 20000) adsDistribution['10k-20k']++;
    else adsDistribution.over20k++;
  });

  return (
    <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '12px' }}>
        Wagas 门店网络效率诊断
      </h2>
      
      <div className="kpi-cards" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div className="kpi-card" style={{ 
          padding: '12px', 
          background: '#f8fafc', 
          borderRadius: '8px',
          border: '1px solid #e2e8f0'
        }}>
          <div style={{ fontSize: '12px', color: '#64748b' }}>日均销售额</div>
          <div className="value" style={{ fontSize: '24px', fontWeight: 700 }}>
            ¥{Math.round(avgAds).toLocaleString()}
          </div>
        </div>
        
        <div className="kpi-card" style={{ 
          padding: '12px', 
          background: '#f8fafc', 
          borderRadius: '8px',
          border: '1px solid #e2e8f0'
        }}>
          <div style={{ fontSize: '12px', color: '#64748b' }}>1KM 重合</div>
          <div className="value" style={{ fontSize: '24px', fontWeight: 700 }}>
            {avgOverlap.toFixed(1)} 家
          </div>
        </div>
      </div>
      
      <div style={{ marginTop: '8px', fontSize: '12px', color: '#94a3b8' }}>
        {filteredStores.length} 家门店
      </div>

      {/* ADS 分布条 */}
      <div style={{ marginTop: '16px' }}>
        <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px', fontWeight: 600 }}>
          ADS 分布
        </div>
        <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
          <div style={{ flex: adsDistribution.under5k, background: '#3b82f6', height: '8px', borderRadius: '4px', minWidth: adsDistribution.under5k > 0 ? '4px' : '0' }} />
          <div style={{ flex: adsDistribution['5k-10k'], background: '#22c55e', height: '8px', borderRadius: '4px', minWidth: adsDistribution['5k-10k'] > 0 ? '4px' : '0' }} />
          <div style={{ flex: adsDistribution['10k-20k'], background: '#f97316', height: '8px', borderRadius: '4px', minWidth: adsDistribution['10k-20k'] > 0 ? '4px' : '0' }} />
          <div style={{ flex: adsDistribution.over20k, background: '#ef4444', height: '8px', borderRadius: '4px', minWidth: adsDistribution.over20k > 0 ? '4px' : '0' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '8px', height: '8px', background: '#3b82f6', borderRadius: '2px' }} />
            &lt;5K ({adsDistribution.under5k})
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '8px', height: '8px', background: '#22c55e', borderRadius: '2px' }} />
            5-10K ({adsDistribution['5k-10k']})
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '8px', height: '8px', background: '#f97316', borderRadius: '2px' }} />
            10-20K ({adsDistribution['10k-20k']})
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '8px', height: '8px', background: '#ef4444', borderRadius: '2px' }} />
            &gt;20K ({adsDistribution.over20k})
          </div>
        </div>
      </div>
    </div>
  );
}
