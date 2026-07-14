import { useAppStore } from '../store';

export default function StorePopup() {
  const { selectedStore, setSelectedStore } = useAppStore();

  if (!selectedStore) return null;

  const store = selectedStore;

  return (
    <div
      className="store-popup"
      style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        width: '380px',
        maxHeight: '80vh',
        overflowY: 'auto',
        background: '#fff',
        borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        padding: '20px',
        zIndex: 100
      }}
    >
      {/* 拖拽手柄（移动端） */}
      <div className="drag-handle" style={{ display: 'none' }} />

      {/* 关闭按钮 */}
      <button
        onClick={() => setSelectedStore(null)}
        style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          background: 'none',
          border: 'none',
          fontSize: '20px',
          cursor: 'pointer',
          color: '#64748b'
        }}
      >
        ×
      </button>

      {/* 门店名称 */}
      <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>
        {store.name}
      </h2>
      <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>
        {store.brand} · {store.city}
      </div>
      <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '16px' }}>
        {store.addr}
      </div>

      {/* 区间均值 */}
      {store.ads && (
        <div style={{
          padding: '12px',
          background: '#fef3c7',
          borderRadius: '8px',
          marginBottom: '16px'
        }}>
          <div style={{ fontSize: '14px', fontWeight: 600 }}>
            区间均值: ¥{store.ads.toLocaleString()}
          </div>
        </div>
      )}

      {/* 渠道拆分 */}
      {store.channel && (
        <div style={{
          padding: '12px',
          background: '#eff6ff',
          borderRadius: '8px',
          marginBottom: '16px'
        }}>
          <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
            渠道拆分 (日均)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <span style={{ fontSize: '13px' }}>堂食: </span>
              <strong>¥{store.channel.dine_in_avg.toLocaleString()}</strong>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                ({store.channel.dine_in_pct}%)
              </span>
            </div>
            <div>
              <span style={{ fontSize: '13px' }}>外卖: </span>
              <strong>¥{store.channel.delivery_avg.toLocaleString()}</strong>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                ({store.channel.delivery_pct}%)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 配送距离分布 */}
      {store.dist && store.dist.total_orders > 0 && (
        <div style={{
          padding: '12px',
          background: '#fef3c7',
          borderRadius: '8px',
          marginBottom: '16px'
        }}>
          <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
            外卖订单距离分布 ({store.dist.total_orders}单)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px', textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: '11px' }}>≤1km</div>
              <strong>{store.dist.d1_pct}%</strong>
            </div>
            <div>
              <div style={{ fontSize: '11px' }}>1-2km</div>
              <strong>{store.dist.d2_pct}%</strong>
            </div>
            <div>
              <div style={{ fontSize: '11px' }}>2-3km</div>
              <strong>{store.dist.d3_pct}%</strong>
            </div>
            <div>
              <div style={{ fontSize: '11px' }}>3-5km</div>
              <strong>{store.dist.d4_pct}%</strong>
            </div>
            <div>
              <div style={{ fontSize: '11px' }}>&gt;5km</div>
              <strong>{store.dist.d5_pct}%</strong>
            </div>
          </div>
        </div>
      )}

      {/* 商圈环境 */}
      {store.market && store.market.poi_count > 0 && (
        <div style={{
          padding: '12px',
          background: '#f0fdf4',
          borderRadius: '8px',
          marginBottom: '16px'
        }}>
          <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
            商圈环境
          </div>
          <div className="market-info" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px' }}>
            <div>餐厅(1km): <strong>{store.market.poi_count}</strong></div>
            <div>评分: <strong>{store.market.avg_rating}</strong></div>
            <div>人均: <strong>¥{store.market.avg_cost}</strong></div>
            <div>中位数: <strong>¥{store.market.median_cost}</strong></div>
            <div>写字楼(1km): <strong>{store.market.office_count}</strong></div>
            <div>住宅(1km): <strong>{store.market.residential_count}</strong></div>
            <div>地铁站(3km): <strong>{store.market.metro_count}</strong></div>
            <div>最近地铁: <strong>{store.market.nearest_metro_km}km</strong></div>
          </div>
          {store.market.business_area && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#4b5563' }}>
              商圈: <strong>{store.market.business_area}</strong>
            </div>
          )}
        </div>
      )}

      {/* 1km 重合 */}
      {store.overlap > 0 && (
        <div style={{
          padding: '12px',
          background: '#fef3c7',
          borderRadius: '8px',
          marginBottom: '16px'
        }}>
          <div style={{ fontSize: '14px', fontWeight: 600 }}>
            ⚠️ 1km内重合: <strong>{store.overlap}</strong> 家
          </div>
          {store.overlap_names.length > 0 && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#64748b' }}>
              {store.overlap_names.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* 热门配送地 TOP10 */}
      {store.top_locations && store.top_locations.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
            热门配送地 TOP10
          </h3>
          <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
            <table className="top-locations-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', position: 'sticky', top: 0, zIndex: 10 }}>
                  <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>#</th>
                  <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>地点名称</th>
                  <th style={{ padding: '8px', textAlign: 'right', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>距离(km)</th>
                  <th style={{ padding: '8px', textAlign: 'right', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>配送次数</th>
                </tr>
              </thead>
              <tbody>
                {store.top_locations.slice(0, 10).map((loc, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '6px 8px', color: '#64748b' }}>{loc.rank}</td>
                    <td style={{ padding: '6px 8px', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {loc.name}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{loc.dist.toFixed(2)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{loc.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
