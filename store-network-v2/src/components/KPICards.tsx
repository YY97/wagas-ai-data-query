import { useAppStore } from '../store';

function fm(n: number): string {
  return '¥' + Math.round(n).toLocaleString();
}

export default function KPICards() {
  const { stores, filters, getAds, dateRange } = useAppStore();

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

  const adsValues = filteredStores
    .map(s => getAds(s.sid))
    .filter((v): v is number => v != null && v > 0);
  const avgAds = adsValues.length
    ? adsValues.reduce((a, b) => a + b, 0) / adsValues.length
    : 0;

  const overlaps = filteredStores.map(s => s.overlap || 0);
  const avgOverlap = overlaps.length ? overlaps.reduce((a, b) => a + b, 0) / overlaps.length : 0;
  const maxOverlap = overlaps.length ? Math.max(...overlaps) : 0;

  const bands = { '<5K': 0, '5-10K': 0, '10-20K': 0, '>20K': 0 };
  filteredStores.forEach(s => {
    const a = getAds(s.sid) || 0;
    if (a < 5000) bands['<5K']++;
    else if (a < 10000) bands['5-10K']++;
    else if (a < 20000) bands['10-20K']++;
    else bands['>20K']++;
  });

  const dateLabel = filters.dateStart && filters.dateEnd
    ? `${filters.dateStart} ~ ${filters.dateEnd}`
    : `${dateRange.start} ~ ${dateRange.end}`;

  return (
    <div style={{ padding: '16px 18px' }}>
      <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', marginBottom: '2px', letterSpacing: '-0.3px' }}>
        Wagas 门店经营地图 <span style={{ fontSize: '11px', fontWeight: 400, color: '#f97316' }}>（内测中）</span>
      </h1>
      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '16px', lineHeight: 1.5 }}>
        快照: <strong style={{ color: '#334155', fontWeight: 600 }}>{dateLabel}</strong>
        &nbsp;&middot;&nbsp; {filteredStores.length} 家门店
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
        <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '10px 12px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>日均销售额</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>{fm(avgAds)}</div>
          <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '1px' }}>{dateLabel}</div>
        </div>
        <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '10px 12px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>1km 重合</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>
            {avgOverlap.toFixed(1)}<span style={{ fontSize: '12px', color: '#64748b' }}> 家</span>
          </div>
          <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '1px' }}>均值 / 最大 {maxOverlap}</div>
        </div>
      </div>

      <div style={{ marginBottom: '14px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          ADS 分布
          <span style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
          {([
            { label: '<5K', count: bands['<5K'], color: '#93c5fd' },
            { label: '5-10K', count: bands['5-10K'], color: '#86efac' },
            { label: '10-20K', count: bands['10-20K'], color: '#fdba74' },
            { label: '>20K', count: bands['>20K'], color: '#fca5a5' },
          ] as const).map(item => (
            <div key={item.label} style={{
              display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px',
              padding: '4px 8px', background: '#f8fafc', borderRadius: '5px',
              border: '1px solid #e2e8f0', color: '#475569'
            }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: item.color, flexShrink: 0 }} />
              {item.label}: {item.count}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
