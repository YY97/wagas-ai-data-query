import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../store';

function adsColorHex(v: number | null): string {
  if (v == null) return '#6b7280';
  if (v < 5000) return '#93c5fd';
  if (v < 10000) return '#86efac';
  if (v < 20000) return '#fdba74';
  return '#fca5a5';
}

function calcAdsRange(salesData: Record<string, Record<string, number>>, sid: string, start: string, end: string): number | null {
  const dd = salesData[sid];
  if (!dd) return null;
  const values: number[] = [];
  for (const k in dd) {
    if (dd[k] != null && dd[k] > 0 && k >= start && k <= end) values.push(dd[k]);
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function shiftDate(dateStr: string, type: 'yoy' | 'mom'): string {
  const d = new Date(dateStr);
  if (type === 'yoy') d.setFullYear(d.getFullYear() - 1);
  else d.setMonth(d.getMonth() - 1);
  return d.toISOString().split('T')[0];
}

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

const COMPETITOR_COLORS: Record<string, string> = {
  '星巴克': '#00a862',
  '超级碗': '#8b5cf6',
  '赛百味': '#f5c518',
  'gaga鲜语': '#ec4899',
  '蓝蛙': '#2563eb',
  'Manner': '#92400e',
};

const sectionBase: React.CSSProperties = {
  marginTop: '6px', padding: '6px 8px', borderRadius: '3px', fontSize: '10px',
};

export default function StorePopupCard({
  showHeatmap, onToggleHeatmap, onClose, onSelectMall
}: {
  showHeatmap: boolean;
  onToggleHeatmap: () => void;
  onClose: () => void;
  onSelectMall: (mall: any) => void;
}) {
  const { selectedStore, stores, getAds, salesData, channelSales, filters, layers, contourStores, setContourStores, mallIndex } = useAppStore();
  const [showTopLoc, setShowTopLoc] = useState(false);
  const [showMalls, setShowMalls] = useState(false);
  const [minimized, setMinimized] = useState(false);

  if (!selectedStore) return null;
  const s = selectedStore;
  const a = getAds(s.sid);
  const ac = adsColorHex(a);

  const ds = filters.dateStart || '';
  const de = filters.dateEnd || '';
  const yoyStart = shiftDate(ds, 'yoy');
  const yoyEnd = shiftDate(de, 'yoy');
  const momStart = shiftDate(ds, 'mom');
  const momEnd = shiftDate(de, 'mom');
  const aYoy = calcAdsRange(salesData, s.sid, yoyStart, yoyEnd);
  const aMom = calcAdsRange(salesData, s.sid, momStart, momEnd);

  const calcChannelRange = (sid: string, start: string, end: string) => {
    const cd = channelSales[sid];
    if (!cd) return null;
    let dineIn = 0, delivery = 0, days = 0;
    for (const d in cd) {
      if (d >= start && d <= end) {
        dineIn += cd[d].dine_in || 0;
        delivery += cd[d].delivery || 0;
        days++;
      }
    }
    if (days === 0) return null;
    return { dineInAvg: Math.round(dineIn / days), deliveryAvg: Math.round(delivery / days) };
  };
  const chCurrent = calcChannelRange(s.sid, ds, de);
  const chYoy = calcChannelRange(s.sid, yoyStart, yoyEnd);
  const chMom = calcChannelRange(s.sid, momStart, momEnd);

  const cardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const onUp = () => {
      if (!dragRef.current.dragging) return;
      dragRef.current.dragging = false;
      const rect = el.getBoundingClientRect();
      el.style.left = `${rect.left}px`;
      el.style.top = `${rect.top}px`;
      el.style.transform = '';
      el.style.position = 'fixed';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  const onDragStart = (e: React.MouseEvent) => {
    if (!cardRef.current) return;
    dragRef.current.dragging = true;
    dragRef.current.startX = e.clientX;
    dragRef.current.startY = e.clientY;
    cardRef.current.style.position = 'relative';
    cardRef.current.style.left = 'auto';
    cardRef.current.style.top = 'auto';
    cardRef.current.style.transform = 'translate(0, 0)';
  };

  return (
    <div className="store-popup-card" ref={cardRef} style={{
      minWidth: '300px', maxWidth: '360px', fontSize: '10px', lineHeight: 1.5,
    }}>
      {/* 最小化状态：显示小条 */}
      {minimized && (
        <div onClick={(e) => { e.stopPropagation(); setMinimized(false); }} style={{
          background: '#fff', borderRadius: '6px', padding: '6px 10px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.15)', display: 'flex',
          alignItems: 'center', gap: '8px', fontSize: '11px', cursor: 'pointer',
          minWidth: '160px', maxWidth: '240px',
        }}>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.name} {s.sid}
            </div>
            <div style={{ fontSize: '9px', color: '#94a3b8' }}>{s.brand} · {s.city}</div>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMinimized(false); }}
            style={{
              background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '4px',
              padding: '2px 6px', fontSize: '10px', cursor: 'pointer', color: '#475569',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >展开</button>
        </div>
      )}

      {/* 完整内容：最小化时隐藏 */}
      <div style={{ display: minimized ? 'none' : 'block' }}>
        {/* 拖拽手柄 */}
        <div
          onMouseDown={(e) => { e.stopPropagation(); onDragStart(e); }}
          style={{
            width: '100%', height: '8px', cursor: 'grab',
            background: 'linear-gradient(to bottom, #e2e8f0, transparent)',
            borderRadius: '8px 8px 0 0', marginBottom: '4px',
            userSelect: 'none',
          }}
        />
        {/* 门店名称 + Store ID */}
        <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '13px', marginBottom: '3px' }}>
          {s.name} {s.sid}
        </div>
        <div style={{ fontSize: '11px', color: '#64748b' }}>
          {s.brand} · {s.city}
          {s.addr && <><br />{s.addr}</>}
        </div>

        {/* 区间均值 */}
        {a != null && (
          <div style={{
            marginTop: '8px', padding: '5px 8px',
            background: ac + '20', borderLeft: `3px solid ${ac}`,
            borderRadius: '3px', fontSize: '11px', fontWeight: 600, color: '#1f2937'
          }}>
            区间均值：{fm(a)} ({adsBand(a)})
            <div style={{ fontSize: '9px', fontWeight: 400, color: '#64748b', marginTop: '2px' }}>
              同比：<span style={{ color: aYoy != null && a >= aYoy ? '#16a34a' : '#dc2626' }}>{pctChange(a, aYoy)}</span>
              &nbsp;·&nbsp;
              环比：<span style={{ color: aMom != null && a >= aMom ? '#16a34a' : '#dc2626' }}>{pctChange(a, aMom)}</span>
            </div>
          </div>
        )}

        {/* 渠道拆分 */}
        {chCurrent && (
          <div style={{ ...sectionBase, background: '#f0f9ff', borderLeft: '3px solid #3b82f6' }}>
            <div style={{ fontWeight: 700, color: '#1e40af', marginBottom: '3px' }}>渠道拆分 (日均)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px' }}>
              <div>堂食：<b>{fm(chCurrent.dineInAvg)}</b></div>
              <div>外卖：<b>{fm(chCurrent.deliveryAvg)}</b></div>
            </div>
            <div style={{ fontSize: '9px', color: '#64748b', marginTop: '3px' }}>
              <div>堂食 同比：<span style={{ color: chYoy && chCurrent.dineInAvg >= chYoy.dineInAvg ? '#16a34a' : '#dc2626' }}>{pctChange(chCurrent.dineInAvg, chYoy?.dineInAvg ?? null)}</span>
                &nbsp;环比：<span style={{ color: chMom && chCurrent.dineInAvg >= chMom.dineInAvg ? '#16a34a' : '#dc2626' }}>{pctChange(chCurrent.dineInAvg, chMom?.dineInAvg ?? null)}</span></div>
              <div>外卖 同比：<span style={{ color: chYoy && chCurrent.deliveryAvg >= chYoy.deliveryAvg ? '#16a34a' : '#dc2626' }}>{pctChange(chCurrent.deliveryAvg, chYoy?.deliveryAvg ?? null)}</span>
                &nbsp;环比：<span style={{ color: chMom && chCurrent.deliveryAvg >= chMom.deliveryAvg ? '#16a34a' : '#dc2626' }}>{pctChange(chCurrent.deliveryAvg, chMom?.deliveryAvg ?? null)}</span></div>
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
              <div>≤1km<br /><b>{s.dist.d1_pct != null ? `${s.dist.d1_pct}%` : 'N/A'}</b></div>
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
              <div>评分：<b>{s.market.avg_rating ? s.market.avg_rating.toFixed(1) : 'N/A'}</b></div>
              <div>人均：<b>{s.market.avg_cost ? `¥${s.market.avg_cost}` : 'N/A'}</b></div>
              <div>中位数：<b>{s.market.median_cost ? `¥${s.market.median_cost}` : 'N/A'}</b></div>
              <div>写字楼(1km): <b>{s.market.office_count}</b></div>
              <div>住宅(1km): <b>{s.market.residential_count}</b></div>
              <div>地铁站(3km): <b>{s.market.metro_count}</b></div>
              <div>最近地铁：<b>{s.market.nearest_metro_km ? `${s.market.nearest_metro_km}km` : 'N/A'}</b></div>
            </div>
            {s.market.business_area && (
              <div style={{ marginTop: '2px', color: '#4b5563' }}>商圈：<b>{s.market.business_area}</b></div>
            )}
            {s.market.top_categories && (
              <div style={{ marginTop: '2px', color: '#4b5563', fontSize: '9px' }}>品类：{s.market.top_categories}</div>
            )}
          </div>
        )}

        {/* 周边竞品 */}
        {s.comp && Object.keys(s.comp).length > 0 && (
          <div style={{ ...sectionBase, background: '#fdf4ff', borderLeft: '3px solid #a855f7' }}>
            <div style={{ fontWeight: 700, color: '#7e22ce', marginBottom: '3px' }}>
              周边竞品 <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '8px' }}>(1km 内家数 · 评分中位)</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 10px' }}>
              {Object.entries(s.comp).map(([brand, cst]) => (
                <div key={brand} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: COMPETITOR_COLORS[brand] || '#64748b', display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ color: '#374151' }}>{brand}</span>
                  <b style={{ marginLeft: 'auto', color: '#1e293b' }}>{cst.n1}家</b>
                  <span style={{ color: '#f59e0b', fontSize: '9px', minWidth: '26px', textAlign: 'right' }}>{cst.med != null ? `★${cst.med}` : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 按钮区 */}
        <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
          {!showTopLoc ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); setShowTopLoc(true); }}
              style={{ padding: '4px 10px', borderRadius: '5px', border: 'none', fontSize: '11px', fontWeight: 600, cursor: 'pointer', background: '#3b82f6', color: '#fff' }}>
               热门配送地</button>
          ) : null}
          {!showMalls ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); setShowMalls(true); }}
              style={{ padding: '4px 10px', borderRadius: '5px', border: 'none', fontSize: '11px', fontWeight: 600, cursor: 'pointer', background: '#f59e0b', color: '#fff' }}>
              🏢 周边商场详情</button>
          ) : null}
        </div>

        {/* 周边商场详情 */}
        {showMalls && (() => {
          if (mallIndex.length === 0) {
            return <div style={{ ...sectionBase, background: '#fffbeb', borderLeft: '3px solid #f59e0b' }}>
              <div style={{ fontWeight: 700, color: '#92400e', marginBottom: '3px' }}>周边商场详情</div>
              <div style={{ fontSize: '9px', color: '#94a3b8' }}>商场数据加载中...</div>
            </div>;
          }
          // Compute malls within 3km of the store
          const R = 6371;
          const toRad = (d: number) => d * Math.PI / 180;
          const nearbyMalls = mallIndex
            .filter(m => m.lat != null && m.lng != null)
            .map(m => {
              const dLat = toRad(m.lat - s.lat);
              const dLng = toRad(m.lng - s.lng);
              const a = Math.sin(dLat/2)**2 + Math.cos(toRad(s.lat)) * Math.cos(toRad(m.lat)) * Math.sin(dLng/2)**2;
              return { ...m, dist: R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) };
            })
            .filter(m => m.dist <= 3)
            .sort((a, b) => a.dist - b.dist);

          if (nearbyMalls.length === 0) {
            return <div style={{ ...sectionBase, background: '#fffbeb', borderLeft: '3px solid #f59e0b' }}>
              <div style={{ fontWeight: 700, color: '#92400e', marginBottom: '3px' }}>周边商场详情</div>
              <div style={{ fontSize: '9px', color: '#94a3b8' }}>3km 内暂无商场数据</div>
            </div>;
          }

          const handleMallClick = (mall: typeof nearbyMalls[0]) => {
            const safeName = `${mall.city}_${mall.name}`.replace(/[\\/:*?"<>|#]/g, '_');
            fetch(`/data/malls/${encodeURIComponent(safeName)}.json`)
              .then(r => r.json())
              .then(detail => onSelectMall(detail))
              .catch(console.warn);
          };

          return (
            <div style={{ ...sectionBase, background: '#fffbeb', borderLeft: '3px solid #f59e0b' }}>
              <div style={{ fontWeight: 700, color: '#92400e', marginBottom: '3px' }}>
                周边商场详情 ({nearbyMalls.length}家)
              </div>
              <div style={{ maxHeight: '180px', overflowY: 'auto', fontSize: '10px' }}>
                {nearbyMalls.map(m => (
                  <div key={`${m.city}_${m.name}`}
                    onClick={(e) => { e.stopPropagation(); handleMallClick(m); }}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '3px 4px', cursor: 'pointer',
                      borderBottom: '1px solid #fef3c7', borderRadius: '3px',
                      transition: 'background 0.1s',
                      background: '#fff',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#fffbeb')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.name}
                      </div>
                      {m.score != null && (
                        <div style={{ fontSize: '9px', color: '#92400e' }}>⭐ {(m.score/20).toFixed(1)}</div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '8px' }}>
                      <div style={{ fontSize: '9px', color: '#64748b' }}>{m.dist.toFixed(1)}km</div>
                      <div style={{ fontSize: '9px', color: '#3b82f6', fontWeight: 600 }}>详情 →</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

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
            ⚠ 1km 内重合：<b>{s.overlap}</b> 家
            {s.overlap_names && s.overlap_names.length > 0 && (
              <div style={{ maxHeight: '80px', overflowY: 'auto', marginTop: '3px', fontSize: '9px', lineHeight: 1.6 }}>
                {s.overlap_names.map((n, i) => {
                  const ms = stores.find(x => x.name === n);
                  return (
                    <div key={i} style={{ padding: '1px 0', borderBottom: '1px dashed #e5e7eb' }}>
                      <b>{ms?.brand || ''}</b> · {n} ({fm(getAds(ms?.sid || ''))})
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 外卖热力图按钮 */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleHeatmap(); }}
          style={{
            display: 'block', width: '100%', padding: '4px 10px', marginTop: '8px',
            borderRadius: '5px', border: 'none', fontSize: '11px',
            fontWeight: 600, cursor: 'pointer',
            background: showHeatmap ? '#dc2626' : '#f97316', color: '#fff',
          }}
        >
          {showHeatmap ? '关闭热力图' : ' 外卖热力图'}
        </button>

        {/* 配送范围对比按钮 */}
        {layers.showDeliveryContour && selectedStore && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const sid = selectedStore.sid;
              setContourStores(prev => {
                if (prev.includes(sid)) {
                  return prev.filter(id => id !== sid);
                }
                if (prev.length >= 5) {
                  alert('最多同时对比 5 家门店');
                  return prev;
                }
                return [...prev, sid];
              });
            }}
            style={{
              display: 'block', width: '100%', padding: '4px 10px', marginTop: '4px',
              borderRadius: '5px', border: '1px solid #3b82f6', fontSize: '11px',
              fontWeight: 600, cursor: 'pointer',
              background: contourStores.includes(selectedStore.sid) ? '#dbeafe' : '#fff',
              color: contourStores.includes(selectedStore.sid) ? '#1d4ed8' : '#3b82f6',
            }}
          >
            {contourStores.includes(selectedStore.sid) ? '✓ 已加入对比（点击取消）' : '＋ 加入配送范围对比'}
          </button>
        )}

        {/* 操作按钮区 */}
        <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
          <button type="button" onClick={(e) => { e.stopPropagation(); setMinimized(true); }} style={{
            flex: 1, padding: '3px', borderRadius: '4px',
            border: '1px solid #e2e8f0', fontSize: '10px',
            cursor: 'pointer', background: '#f1f5f9', color: '#475569',
          }}>收起</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onClose(); }} style={{
            flex: 1, padding: '3px', borderRadius: '4px',
            border: '1px solid #e2e8f0', fontSize: '10px',
            cursor: 'pointer', background: '#f8fafc', color: '#64748b',
          }}>关闭</button>
        </div>
      </div>
    </div>
  );
}
