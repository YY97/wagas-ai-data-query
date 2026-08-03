import type { MallDetail } from '../types';

function fm(n: number | null | undefined, unit?: string): string {
  if (n == null) return '-';
  if (unit === '万人') return `${n.toFixed(1)}万`;
  if (unit === '万人次') return `${n.toFixed(1)}万人次`;
  return n >= 10000 ? `${(n/10000).toFixed(1)}万` : String(Math.round(n));
}

const sectionBase = {
  padding: '8px 10px', borderRadius: '6px', fontSize: '11px',
  lineHeight: '1.5' as const,
};

export default function MallDetailPanel({
  mall, onClose
}: {
  mall: MallDetail | null;
  onClose: () => void;
}) {
  if (!mall) return null;

  const scoreColor = () => {
    const s = mall.overview.score;
    if (s == null) return '#6b7280';
    if (s >= 90) return '#16a34a';
    if (s >= 80) return '#2563eb';
    if (s >= 70) return '#f59e0b';
    return '#dc2626';
  };

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: '420px', height: '100vh',
      background: '#fff', boxShadow: '-4px 0 20px rgba(0,0,0,0.1)',
      zIndex: 2000, display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid #e2e8f0',
        background: 'linear-gradient(135deg, #fef3c7, #fff7ed)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#1e293b' }}>{mall.name}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
              {mall.city} · {mall.address}
            </div>
            {mall.overview.type && (
              <div style={{ fontSize: '10px', color: '#92400e', marginTop: '2px' }}>
                {mall.overview.type} · {mall.overview.floors} · {mall.overview.area_size_sqm != null ? `${mall.overview.area_size_sqm}万㎡` : ''}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            fontSize: '20px', lineHeight: '20px', background: 'none', border: 'none',
            cursor: 'pointer', color: '#94a3b8', padding: '0 4px',
          }}>×</button>
        </div>
        {/* Score bar */}
        {mall.overview.score != null && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center' }}>
            <div style={{
              fontSize: '28px', fontWeight: 800, color: scoreColor(),
              lineHeight: 1,
            }}>
              {mall.overview.score.toFixed(1)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '10px', color: '#64748b' }}>综合评分</div>
              <div style={{ fontSize: '9px', color: '#94a3b8' }}>{mall.overview.score_rank}</div>
            </div>
          </div>
        )}
      </div>

      {/* Body — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {/* Overview */}
        <div style={{ ...sectionBase, background: '#f8fafc', borderLeft: '3px solid #3b82f6' }}>
          <div style={{ fontWeight: 700, color: '#1e40af', marginBottom: '6px' }}>基本信息</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px', fontSize: '10px' }}>
            <div>开业时间：<b>{mall.overview.open_date || '-'}</b></div>
            <div>运营商：<b>{mall.overview.operator || '-'}</b></div>
            <div>品牌线：<b>{mall.overview.brand || '-'}</b></div>
            <div>商业面积：<b>{mall.overview.area_size_sqm != null ? `${mall.overview.area_size_sqm}万㎡` : '-'}</b></div>
          </div>
          {mall.overview.annual_sales && (
            <div style={{ fontSize: '10px', marginTop: '3px' }}>
              年销售额：<b>{mall.overview.annual_sales}{mall.overview.annual_sales_unit || ''}</b>
            </div>
          )}
          {/* Sub-scores */}
          <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
            {[
              ['人口客群', mall.overview.population_score],
              ['区域特征', mall.overview.area_score],
              ['消费能力', mall.overview.consumption_score],
              ['行业', mall.overview.industry_score],
            ].map(([label, v]) => (
              <div key={label} style={{
                background: '#e0e7ff', color: '#3730a3', padding: '1px 6px',
                borderRadius: '3px', fontSize: '9px', fontWeight: 600,
              }}>
                {label}: {v != null ? v.toFixed(1) : '-'}
              </div>
            ))}
          </div>
        </div>

        {/* Traffic */}
        <div style={{ ...sectionBase, background: '#f0fdf4', borderLeft: '3px solid #16a34a', marginTop: '8px' }}>
          <div style={{ fontWeight: 700, color: '#15803d', marginBottom: '4px' }}>客流数据</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', fontSize: '10px' }}>
            <div style={{ textAlign: 'center', background: '#fff', borderRadius: '4px', padding: '4px' }}>
              <div style={{ color: '#64748b', fontSize: '9px' }}>年日均</div>
              <div style={{ fontWeight: 700, color: '#1e293b' }}>
                {fm(mall.traffic.annual_daily, mall.traffic.annual_daily_unit)}
              </div>
            </div>
            <div style={{ textAlign: 'center', background: '#fff', borderRadius: '4px', padding: '4px' }}>
              <div style={{ color: '#64748b', fontSize: '9px' }}>6月日均</div>
              <div style={{ fontWeight: 700, color: '#1e293b' }}>
                {fm(mall.traffic.jun_daily_avg, mall.traffic.jun_daily_unit)}
              </div>
            </div>
            <div style={{ textAlign: 'center', background: '#fff', borderRadius: '4px', padding: '4px' }}>
              <div style={{ color: '#64748b', fontSize: '9px' }}>6月总量</div>
              <div style={{ fontWeight: 700, color: '#1e293b' }}>
                {fm(mall.traffic.jun_total, '万人')}
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginTop: '4px', fontSize: '10px' }}>
            <div>工作日日均：<b>{fm(mall.traffic.weekday_avg, '万人次')}</b></div>
            <div>节假日日均：<b>{fm(mall.traffic.holiday_avg, '万人次')}</b></div>
          </div>
        </div>

        {/* Population around mall */}
        <div style={{ ...sectionBase, background: '#fef3c7', borderLeft: '3px solid #d97706', marginTop: '8px' }}>
          <div style={{ fontWeight: 700, color: '#92400e', marginBottom: '4px' }}>周边人口（万人）</div>
          <div style={{ fontSize: '10px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#92400e', borderBottom: '1px solid #fde68a' }}>
                  <th style={{ textAlign: 'left', padding: '2px 0' }}>范围</th>
                  <th style={{ textAlign: 'right', padding: '2px 4px' }}>居住</th>
                  <th style={{ textAlign: 'right', padding: '2px 4px' }}>办公</th>
                  <th style={{ textAlign: 'right', padding: '2px 0' }}>常住</th>
                </tr>
              </thead>
              <tbody>
                {(['500m', '1_5km', '3km'] as const).map(r => (
                  <tr key={r} style={{ borderBottom: '1px solid #fef3c7' }}>
                    <td style={{ padding: '2px 0', color: '#a16207' }}>{r}</td>
                    <td style={{ padding: '2px 4px', textAlign: 'right', fontWeight: 600 }}>{mall.population.residential[r] ?? '-'}</td>
                    <td style={{ padding: '2px 4px', textAlign: 'right', fontWeight: 600 }}>{mall.population.office[r] ?? '-'}</td>
                    <td style={{ padding: '2px 0', textAlign: 'right', fontWeight: 600 }}>{mall.population.permanent[r] ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Business structure */}
        <div style={{ ...sectionBase, background: '#f1f5f9', borderLeft: '3px solid #475569', marginTop: '8px' }}>
          <div style={{ fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
            商场业态结构
            {mall.business.total_stores != null && <span style={{ fontWeight: 400, color: '#64748b', fontSize: '10px' }}>（总门店 {Math.round(mall.business.total_stores)}）</span>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', fontSize: '10px' }}>
            {[
              ['餐饮', mall.business.food, '#f87171'],
              ['购物', mall.business.shopping, '#fb923c'],
              ['休闲娱乐', mall.business.leisure, '#facc15'],
              ['教育', mall.business.education, '#4ade80'],
              ['酒店', mall.business.hotel, '#60a5fa'],
              ['生活服务', mall.business.services, '#c084fc'],
              ['健身', mall.business.fitness, '#f472b6'],
              ['车辆服务', mall.business.auto, '#a3a3a3'],
            ].map(([l, v, c]) => (
              <div key={l as string} style={{
                background: `${c}30`, color: c, padding: '1px 6px',
                borderRadius: '3px', fontWeight: 600,
              }}>
                {l}: {v ?? '-'}
              </div>
            ))}
          </div>
          {mall.business.competitors != null && (
            <div style={{ fontSize: '10px', marginTop: '3px', color: '#64748b' }}>
              竞品门店：<b>{mall.business.competitors}</b> · 老店(3年+占比)：<b>{mall.business.old_store_3yr_pct != null ? `${mall.business.old_store_3yr_pct}%` : '-'}</b>
            </div>
          )}
        </div>

        {/* Business survival */}
        {mall.business_survival.length > 0 && (
          <div style={{ ...sectionBase, background: '#faf5ff', borderLeft: '3px solid #7c3aed', marginTop: '8px' }}>
            <div style={{ fontWeight: 700, color: '#6d28d9', marginBottom: '4px' }}>业态存续分析</div>
            <div style={{ fontSize: '10px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: '#6d28d9', borderBottom: '1px solid #ede9fe', fontSize: '9px' }}>
                    <th style={{ textAlign: 'left', padding: '2px 0' }}>业态</th>
                    <th style={{ textAlign: 'right', padding: '2px 2px' }}>门店</th>
                    <th style={{ textAlign: 'right', padding: '2px 2px' }}>1年内</th>
                    <th style={{ textAlign: 'right', padding: '2px 2px' }}>1-3年</th>
                    <th style={{ textAlign: 'right', padding: '2px 0' }}>3年+</th>
                  </tr>
                </thead>
                <tbody>
                  {mall.business_survival.map(b => (
                    <tr key={b.type} style={{ borderBottom: '1px solid #f5f3ff' }}>
                      <td style={{ padding: '2px 0' }}>{b.type}</td>
                      <td style={{ padding: '2px 2px', textAlign: 'right' }}>{b.count ?? '-'}</td>
                      <td style={{ padding: '2px 2px', textAlign: 'right' }}>{b.within_1yr_pct}%</td>
                      <td style={{ padding: '2px 2px', textAlign: 'right' }}>{b['1_3yr_pct']}%</td>
                      <td style={{ padding: '2px 0', textAlign: 'right', fontWeight: 600 }}>{b.over_3yr_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Nearby POI */}
        <div style={{ ...sectionBase, background: '#f0fdf4', borderLeft: '3px solid #059669', marginTop: '8px' }}>
          <div style={{ fontWeight: 700, color: '#047857', marginBottom: '4px' }}>周边POI</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', fontSize: '10px' }}>
            {Object.entries(mall.nearby_poi).filter(([,v]) => v != null).map(([k,v]) => (
              <div key={k} style={{
                background: '#d1fae5', color: '#065f46', padding: '1px 6px',
                borderRadius: '3px', fontWeight: 600,
              }}>
                {k}: {v}
              </div>
            ))}
          </div>
        </div>

        {/* Nearby malls */}
        {mall.nearby_malls.length > 0 && (
          <div style={{ ...sectionBase, background: '#fff7ed', borderLeft: '3px solid #ea580c', marginTop: '8px' }}>
            <div style={{ fontWeight: 700, color: '#9a3412', marginBottom: '4px' }}>
              周边商场 ({mall.nearby_malls.length}家)
            </div>
            <div style={{ fontSize: '10px', maxHeight: '180px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: '#9a3412', borderBottom: '1px solid #fed7aa', fontSize: '9px' }}>
                    <th style={{ textAlign: 'left', padding: '2px 0' }}>商场名</th>
                    <th style={{ textAlign: 'right', padding: '2px 2px' }}>面积</th>
                    <th style={{ textAlign: 'right', padding: '2px 2px' }}>6月日均</th>
                    <th style={{ textAlign: 'right', padding: '2px 0' }}>节假日</th>
                  </tr>
                </thead>
                <tbody>
                  {mall.nearby_malls.map(nm => (
                    <tr key={nm.name} style={{ borderBottom: '1px solid #fff7ed' }}>
                      <td style={{ padding: '2px 0', fontWeight: 500 }}>{nm.name}</td>
                      <td style={{ padding: '2px 2px', textAlign: 'right' }}>{nm.area || '-'}</td>
                      <td style={{ padding: '2px 2px', textAlign: 'right' }}>{nm.jun_daily_avg || '-'}</td>
                      <td style={{ padding: '2px 0', textAlign: 'right' }}>{nm.holiday_avg || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Nearby restaurants */}
        {mall.nearby_restaurants.length > 0 && (
          <div style={{ ...sectionBase, background: '#f8fafc', borderLeft: '3px solid #0ea5e9', marginTop: '8px' }}>
            <div style={{ fontWeight: 700, color: '#0369a1', marginBottom: '4px' }}>
              餐饮品牌 (TOP {mall.nearby_restaurants.length})
            </div>
            <div style={{ fontSize: '10px', maxHeight: '200px', overflowY: 'auto' }}>
              {mall.nearby_restaurants.map((r, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '2px 0', borderBottom: '1px solid #e2e8f0',
                }}>
                  <span style={{ fontWeight: 500 }}>{r.brand}</span>
                  <span style={{ color: '#64748b' }}>{r.distance}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Demographics */}
        {mall.demographics.male_pct != null && (
          <div style={{ ...sectionBase, background: '#fdf2f8', borderLeft: '3px solid #db2777', marginTop: '8px' }}>
            <div style={{ fontWeight: 700, color: '#be185d', marginBottom: '4px' }}>客群画像</div>
            <div style={{ fontSize: '10px' }}>
              <div>男性: <b>{mall.demographics.male_pct}%</b> · 女性: <b>{(100 - mall.demographics.male_pct).toFixed(1)}%</b></div>
              {mall.demographics.has_children_pct != null && (
                <div style={{ marginTop: '2px' }}>有子女: <b>{mall.demographics.has_children_pct}%</b></div>
              )}
              {Object.keys(mall.demographics.education).length > 0 && (
                <div style={{ display: 'flex', gap: '3px', marginTop: '4px', flexWrap: 'wrap' }}>
                  {Object.entries(mall.demographics.education).map(([k,v]) => (
                    <div key={k} style={{
                      background: '#fce7f3', color: '#9d174d', padding: '1px 6px',
                      borderRadius: '3px', fontWeight: 600, fontSize: '9px',
                    }}>
                      {k}: {v ?? '-'}%
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Scraped at */}
        {mall.scraped_at && (
          <div style={{ fontSize: '9px', color: '#cbd5e1', textAlign: 'right', marginTop: '12px' }}>
            数据抓取时间: {new Date(mall.scraped_at).toLocaleString('zh-CN')}
          </div>
        )}
      </div>
    </div>
  );
}
