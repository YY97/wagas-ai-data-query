import { useState } from 'react';
import { useAppStore } from '../store';

function adsColorHex(v: number | null): string {
  if (v == null) return '#6b7280';
  if (v < 5000) return '#93c5fd';
  if (v < 10000) return '#86efac';
  if (v < 20000) return '#fdba74';
  return '#fca5a5';
}

// 计算指定日期范围内的 ADS 日均
function calcAdsRange(salesData: Record<string, Record<string, number>>, sid: string, start: string, end: string): number | null {
  const dd = salesData[sid];
  if (!dd) return null;
  const values: number[] = [];
  for (const k in dd) {
    if (dd[k] != null && dd[k] > 0 && k >= start && k <= end) values.push(dd[k]);
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

// 日期偏移：同比（-1年）、环比（-1月）
function shiftDate(dateStr: string, type: 'yoy' | 'mom'): string {
  const d = new Date(dateStr);
  if (type === 'yoy') d.setFullYear(d.getFullYear() - 1);
  else d.setMonth(d.getMonth() - 1);
  return d.toISOString().split('T')[0];
}

// 百分比变化展示
function pctChange(current: number | null, previous: number | null): string {
  if (current == null || previous == null || previous === 0) return '-';
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function adsBand(v: number | null): string {
  if (v == null) return 'N/A';
  if (v < 5000) return '<5K';
  if (v < 10000) return '5-10K';
  if (v < 20000) return '10-20K';
  return '>20K';
}

function fm(n: number | null | undefined): string {
  return n != null ? '¥' + Math.round(n).toLocaleString() : 'N/A';
}

const popupStyle: React.CSSProperties = {
  minWidth: '220px', maxWidth: '280px', fontSize: '10px', lineHeight: 1.5,
};

const sectionBase: React.CSSProperties = {
  marginTop: '6px', padding: '6px 8px', borderRadius: '3px', fontSize: '10px',
};

export default function StorePopupCard({
  showHeatmap, onToggleHeatmap, onClose
}: {
  showHeatmap: boolean;
  onToggleHeatmap: () => void;
  onClose: () => void;
}) {
  const { selectedStore, stores, getAds, salesData, filters } = useAppStore();
  const [showTopLoc, setShowTopLoc] = useState(false);
  const [minimized, setMinimized] = useState(false);

  if (!selectedStore) return null;
  const s = selectedStore;
  const a = getAds(s.sid);
  const ac = adsColorHex(a);

  // 同比/环比计算
  const ds = filters.dateStart || '';
  const de = filters.dateEnd || '';
  const yoyStart = shiftDate(ds, 'yoy');
  const yoyEnd = shiftDate(de, 'yoy');
  const momStart = shiftDate(ds, 'mom');
  const momEnd = shiftDate(de, 'mom');
  const aYoy = calcAdsRange(salesData, s.sid, yoyStart, yoyEnd);
  const aMom = calcAdsRange(salesData, s.sid, momStart, momEnd);

  // 最小化状态：只显示小条
  if (minimized) {
    return (
      <div style={{
        background: '#fff', borderRadius: '6px', padding: '6px 10px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.15)', display: 'flex',
        alignItems: 'center', gap: '8px', fontSize: '11px', cursor: 'pointer',
        minWidth: '160px', maxWidth: '240px',
      }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {s.name} {s.sid}
          </div>
          <div style={{ fontSize: '9px', color: '#94a3b8' }}>{s.brand} &middot; {s.city}</div>
        </div>
        <button
          onClick={() => setMinimized(false)}
          style={{
            background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '4px',
            padding: '2px 6px', fontSize: '10px', cursor: 'pointer', color: '#475569',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >展开 ▸</button>
      </div>
    );
  }

  return (
    <div className="store-popup-card" style={popupStyle}>
      {/* 门店名称 + Store ID */}
      <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '13px', marginBottom: '3px' }}>
        {s.name} {s.sid}
      </div>
      <div style={{ fontSize: '11px', color: '#64748b' }}>
        {s.brand} &middot; {s.city}
        {s.addr && <><br />{s.addr}</>}
      </div>

      {/* 区间均值 */}
      {a != null && (
        <div style={{
          marginTop: '8px', padding: '5px 8px',
          background: ac + '20', borderLeft: `3px solid ${ac}`,
          borderRadius: '3px', fontSize: '11px', fontWeight: 600, color: '#1f2937'
        }}>
          区间均值: {fm(a)} ({adsBand(a)})
          <div style={{ fontSize: '9px', fontWeight: 400, color: '#64748b', marginTop: '2px' }}>
            同比: <span style={{ color: aYoy != null && a >= aYoy ? '#16a34a' : '#dc2626' }}>{pctChange(a, aYoy)}</span>
            &nbsp;&middot;&nbsp;
            环比: <span style={{ color: aMom != null && a >= aMom ? '#16a34a' : '#dc2626' }}>{pctChange(a, aMom)}</span>
          </div>
        </div>
      )}

      {/* 渠道拆分 */}
      {s.channel && s.channel.days > 0 && (
        <div style={{ ...sectionBase, background: '#f0f9ff', borderLeft: '3px solid #3b82f6' }}>
          <div style={{ fontWeight: 700, color: '#1e40af', marginBottom: '3px' }}>渠道拆分 (日均)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px' }}>
            <div>堂食: <b>{fm(s.channel.dine_in_avg)}</b>{s.channel.dine_in_pct != null ? ` (${s.channel.dine_in_pct}%)` : ''}</div>
            <div>外卖: <b>{fm(s.channel.delivery_avg)}</b>{s.channel.delivery_pct != null ? ` (${s.channel.delivery_pct}%)` : ''}</div>
          </div>
        </div>
      )}

      {/* 配送距离分布 */}
      {s.dist && s.dist.total_orders > 0 && (
        <div style={{ ...sectionBase, background: '#fef3c7', borderLeft: '3px solid #d97706' }}>
          <div style={{ fontWeight: 700, color: '#92400e', marginBottom: '3px' }}>
            外卖订单距离分布 ({s.dist.total_orders}单)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: '2px', textAlign: 'center' }}>
            <div>&le;1km<br /><b>{s.dist.d1_pct != null ? `${s.dist.d1_pct}%` : 'N/A'}</b></div>
            <div>1-2km<br /><b>{s.dist.d2_pct != null ? `${s.dist.d2_pct}%` : 'N/A'}</b></div>
            <div>2-3km<br /><b>{s.dist.d3_pct != null ? `${s.dist.d3_pct}%` : 'N/A'}</b></div>
            <div>3-5km<br /><b>{s.dist.d4_pct != null ? `${s.dist.d4_pct}%` : 'N/A'}</b></div>
            <div>&gt;5km<br /><b>{s.dist.d5_pct != null ? `${s.dist.d5_pct}%` : 'N/A'}</b></div>
          </div>
        </div>
      )}

      {/* 商圈环境 */}
      {s.market && s.market.poi_count > 0 && (
        <div style={{ ...sectionBase, background: '#f0fdf4', borderLeft: '3px solid #22c55e' }}>
          <div style={{ fontWeight: 700, color: '#166534', marginBottom: '3px' }}>商圈环境</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px' }}>
            <div>餐厅(1km): <b>{s.market.poi_count}</b></div>
            <div>评分: <b>{s.market.avg_rating ? s.market.avg_rating.toFixed(1) : 'N/A'}</b></div>
            <div>人均: <b>{s.market.avg_cost ? `¥${s.market.avg_cost}` : 'N/A'}</b></div>
            <div>中位数: <b>{s.market.median_cost ? `¥${s.market.median_cost}` : 'N/A'}</b></div>
            <div>写字楼(1km): <b>{s.market.office_count}</b></div>
            <div>住宅(1km): <b>{s.market.residential_count}</b></div>
            <div>地铁站(3km): <b>{s.market.metro_count}</b></div>
            <div>最近地铁: <b>{s.market.nearest_metro_km ? `${s.market.nearest_metro_km}km` : 'N/A'}</b></div>
          </div>
          {s.market.business_area && (
            <div style={{ marginTop: '2px', color: '#4b5563' }}>商圈: <b>{s.market.business_area}</b></div>
          )}
          {s.market.top_categories && (
            <div style={{ marginTop: '2px', color: '#4b5563', fontSize: '9px' }}>品类: {s.market.top_categories}</div>
          )}
        </div>
      )}

      {/* 热门配送地按钮 */}
      {!showTopLoc ? (
        <button
          onClick={() => setShowTopLoc(true)}
          style={{
            display: 'inline-block', padding: '4px 10px', marginTop: '6px',
            borderRadius: '5px', border: 'none', fontSize: '11px',
            fontWeight: 600, cursor: 'pointer', background: '#3b82f6', color: '#fff',
          }}
        >&#128205; 热门配送地</button>
      ) : null}

      {/* 热门配送地 TOP10 */}
      {showTopLoc && s.top_locations && s.top_locations.length > 0 && (
        <div style={{ ...sectionBase, background: '#eff6ff', borderLeft: '3px solid #3b82f6' }}>
          <div style={{ fontWeight: 700, color: '#1e40af', marginBottom: '3px' }}>
            热门配送地 TOP10 <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '8px' }}>(全量单数)</span>
          </div>
          <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px' }}>
              <thead>
                <tr style={{ color: '#64748b', borderBottom: '1px solid #dbeafe' }}>
                  <th style={{ textAlign: 'left', padding: '2px 0' }}>#</th>
                  <th style={{ textAlign: 'left', padding: '2px 0' }}>地点</th>
                  <th style={{ textAlign: 'right', padding: '2px 4px' }}>距离</th>
                  <th style={{ textAlign: 'right', padding: '2px 0' }}>单数</th>
                </tr>
              </thead>
              <tbody>
                {s.top_locations.slice(0, 10).map(t => (
                  <tr key={t.rank} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '2px 0', color: '#94a3b8' }}>{t.rank}</td>
                    <td style={{ padding: '2px 0', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.name || '未知'}
                    </td>
                    <td style={{ padding: '2px 4px', textAlign: 'right', color: '#64748b' }}>{t.dist}km</td>
                    <td style={{ padding: '2px 0', textAlign: 'right', fontWeight: 600 }}>{t.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {showTopLoc && (!s.top_locations || s.top_locations.length === 0) && (
        <span style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginTop: '6px' }}>暂无配送地数据</span>
      )}

      {/* 1km 重合 */}
      {(s.overlap || 0) > 0 && (
        <div style={{ ...sectionBase, background: '#fef3c7', borderLeft: '3px solid #d97706' }}>
          &#9888; 1km内重合: <b>{s.overlap}</b> 家
          {s.overlap_names && s.overlap_names.length > 0 && (
            <div style={{ maxHeight: '80px', overflowY: 'auto', marginTop: '3px', fontSize: '9px', lineHeight: 1.6 }}>
              {s.overlap_names.map((n, i) => {
                const ms = stores.find(x => x.name === n);
                return (
                  <div key={i} style={{ padding: '1px 0', borderBottom: '1px dashed #e5e7eb' }}>
                    <b>{ms?.brand || ''}</b> &middot; {n} ({fm(getAds(ms?.sid || ''))})
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 外卖热力图按钮 */}
      <button
        onClick={onToggleHeatmap}
        style={{
          display: 'block', width: '100%', padding: '4px 10px', marginTop: '8px',
          borderRadius: '5px', border: 'none', fontSize: '11px',
          fontWeight: 600, cursor: 'pointer',
          background: showHeatmap ? '#dc2626' : '#f97316', color: '#fff',
        }}
      >
        {showHeatmap ? '关闭热力图' : '🔥 外卖热力图'}
      </button>

      {/* 操作按钮区 */}
      <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
        <button onClick={() => setMinimized(true)} style={{
          flex: 1, padding: '3px', borderRadius: '4px',
          border: '1px solid #e2e8f0', fontSize: '10px',
          cursor: 'pointer', background: '#f1f5f9', color: '#475569',
        }}>收起 ▴</button>
        <button onClick={onClose} style={{
          flex: 1, padding: '3px', borderRadius: '4px',
          border: '1px solid #e2e8f0', fontSize: '10px',
          cursor: 'pointer', background: '#f8fafc', color: '#64748b',
        }}>关闭</button>
      </div>
    </div>
  );
}
