import { useEffect, useMemo, useState, useCallback } from 'react'
import { MapContainer, TileLayer, CircleMarker, Marker, Polygon, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// ========== Types ==========
interface Store {
  sid: string; name: string; brand: string; city: string; addr: string;
  lng: number; lat: number; ads: number | null;
  delivery_contour?: [number, number][];
}
interface CompetitorStore {
  name: string; lng: number; lat: number; addr: string; city: string;
  district: string; rating: string;
}
type CompetitorData = Record<string, CompetitorStore[]>
interface DeliveryPoint { lat: number; lng: number; w: number }
type DeliveryCityData = Record<string, DeliveryPoint[]>

interface CandidateAnalysis {
  lat: number; lng: number;
  // 自有门店
  nearbyStores1km: Store[];
  nearbyStores3km: Store[];
  nearestStore: { store: Store; dist: number } | null;
  // 蚕食风险
  cannibalizedBy: { store: Store }[];
  // 竞品
  competitorStats: { brand: string; n1: number; n3: number; med: number | null }[];
  // 外卖需求
  deliveryDemand: number | null; // total weight within 500m
  deliveryCity: string | null;
  // 评分
  score: number;
  scoreBreakdown: { label: string; value: number; max: number; note: string }[];
}

// ========== Geo Utils ==========
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointInPolygon(lat: number, lng: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2 * 10) / 10;
}

// ========== Competitor colors ==========
const COMPETITOR_COLORS: Record<string, string> = {
  '星巴克': '#00a862', '超级碗': '#8b5cf6', '赛百味': '#f5c518',
  'gaga鲜语': '#ec4899', '蓝蛙': '#2563eb', 'Manner': '#92400e',
};

// ========== Candidate Pin Icon ==========
function createCandidateIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<svg width="36" height="48" viewBox="0 0 36 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 30 18 30s18-16.5 18-30C36 8.06 27.94 0 18 0z" fill="#ef4444" stroke="#fff" stroke-width="2"/>
      <circle cx="18" cy="17" r="7" fill="#fff"/>
    </svg>`,
    iconSize: [36, 48],
    iconAnchor: [18, 48],
  });
}

// ========== Analysis Computation ==========
function computeAnalysis(
  lat: number, lng: number,
  stores: Store[], competitors: CompetitorData,
  deliveryData: DeliveryCityData, deliveryCity: string | null,
): CandidateAnalysis {
  // Nearby our stores
  const nearby1km = stores.filter(s => haversine(lat, lng, s.lat, s.lng) <= 1.0);
  const nearby3km = stores.filter(s => haversine(lat, lng, s.lat, s.lng) <= 3.0);
  const nearest = nearby3km.length > 0
    ? nearby3km.reduce((best, s) => {
        const d = haversine(lat, lng, s.lat, s.lng);
        return d < best.dist ? { store: s, dist: d } : best;
      }, { store: nearby3km[0], dist: Infinity })
    : null;

  // Cannibalization: which stores' delivery contours contain this point
  const cannibalizedBy = stores
    .filter(s => s.delivery_contour && s.delivery_contour.length > 0)
    .filter(s => pointInPolygon(lat, lng, s.delivery_contour!))
    .map(s => ({ store: s }));

  // Competitor stats
  const competitorStats = Object.entries(competitors)
    .map(([brand, list]) => {
      const in1km = list.filter(c => haversine(lat, lng, c.lat, c.lng) <= 1.0);
      const in3km = list.filter(c => haversine(lat, lng, c.lat, c.lng) <= 3.0);
      const ratings = in3km.map(c => parseFloat(c.rating)).filter(r => !isNaN(r) && r > 0);
      return { brand, n1: in1km.length, n3: in3km.length, med: median(ratings) };
    })
    .filter(c => c.n3 > 0)
    .sort((a, b) => b.n3 - a.n3);

  // Delivery demand: sum of weights within 500m
  let deliveryDemand: number | null = null;
  if (deliveryCity && deliveryData[deliveryCity]) {
    deliveryDemand = deliveryData[deliveryCity]
      .filter(p => haversine(lat, lng, p.lat, p.lng) <= 0.5)
      .reduce((sum, p) => sum + p.w, 0);
  }

  // Score (0-100)
  // 1. Delivery demand (0-30): higher = better
  const demandScore = deliveryDemand != null ? Math.min(30, deliveryDemand / 5) : 10;
  // 2. Competitor presence (0-25): some = validated, too many = saturated
  const totalCompetitors3km = competitorStats.reduce((s, c) => s + c.n3, 0);
  const compScore = totalCompetitors3km === 0 ? 5 : Math.min(25, 10 + totalCompetitors3km * 0.5);
  // 3. Cannibalization (0-25): fewer = better
  const cannibScore = Math.max(0, 25 - cannibalizedBy.length * 8);
  // 4. Nearest store distance (0-20): moderate distance = good
  let storeScore = 10;
  if (nearest) {
    if (nearest.dist < 0.5) storeScore = 2; // too close, cannibalize
    else if (nearest.dist < 1.0) storeScore = 8;
    else if (nearest.dist < 2.0) storeScore = 15;
    else storeScore = 20; // far = new market
  } else {
    storeScore = 20; // no nearby store = new market
  }

  const score = Math.round(demandScore + compScore + cannibScore + storeScore);

  return {
    lat, lng, nearbyStores1km: nearby1km, nearbyStores3km: nearby3km,
    nearestStore: nearest, cannibalizedBy, competitorStats,
    deliveryDemand, deliveryCity, score,
    scoreBreakdown: [
      { label: '外卖需求热度', value: Math.round(demandScore), max: 30, note: deliveryDemand != null ? `${Math.round(deliveryDemand)} 单(500m内)` : '暂无数据' },
      { label: '竞品验证度', value: Math.round(compScore), max: 25, note: `3km内 ${totalCompetitors3km} 家竞品` },
      { label: '蚕食风险', value: Math.round(cannibScore), max: 25, note: cannibalizedBy.length > 0 ? `${cannibalizedBy.length} 家门店轮廓覆盖此点` : '无蚕食风险' },
      { label: '自有门店距离', value: storeScore, max: 20, note: nearest ? `最近 ${nearest.store.name} ${nearest.dist.toFixed(1)}km` : '周边无自有门店' },
    ],
  };
}

// ========== Map Events ==========
function MapClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

// ========== Main App ==========
export default function App() {
  const [stores, setStores] = useState<Store[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorData>({});
  const [deliveryData, setDeliveryData] = useState<DeliveryCityData>({});
  const [deliveryCity, setDeliveryCity] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<{ lat: number; lng: number } | null>(null);
  const [showCompetitors, setShowCompetitors] = useState(true);
  const [competitorBrands, setCompetitorBrands] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Load data
  useEffect(() => {
    Promise.all([
      fetch(`${import.meta.env.BASE_URL}data/stores.json`).then(r => r.json()),
      fetch(`${import.meta.env.BASE_URL}data/competitor_stores.json`).then(r => r.json()).catch(() => ({})),
    ]).then(([s, c]) => {
      setStores(s);
      setCompetitors(c);
      const brands: Record<string, boolean> = {};
      Object.keys(c).forEach(b => { brands[b] = true; });
      setCompetitorBrands(brands);
      setLoading(false);
    }).catch(() => {
      setError('数据加载失败，请检查文件路径');
      setLoading(false);
    });
  }, []);

  // Load delivery data for a city on demand
  const loadDeliveryData = useCallback(async (city: string) => {
    if (deliveryData[city]) { setDeliveryCity(city); return; }
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}data/delivery/${city}.json`);
      if (!r.ok) throw new Error('not found');
      const d: Record<string, DeliveryPoint[]> = await r.json();
      setDeliveryData(prev => ({ ...prev, [city]: Object.values(d).flat() }));
      setDeliveryCity(city);
    } catch {
      setDeliveryCity(city); // mark as attempted
    }
  }, [deliveryData]);

  // Determine city from click (simple: check which city has stores nearby)
  const getCityFromPoint = useCallback((lat: number, lng: number): string | null => {
    // Find nearest store and use its city
    let nearest: Store | null = null;
    let minDist = Infinity;
    for (const s of stores) {
      const d = haversine(lat, lng, s.lat, s.lng);
      if (d < minDist && d < 50) { minDist = d; nearest = s; }
    }
    return nearest ? nearest.city.replace('市', '') : null;
  }, [stores]);

  const handleMapClick = useCallback((lat: number, lng: number) => {
    setCandidate({ lat, lng });
    const city = getCityFromPoint(lat, lng);
    if (city) loadDeliveryData(city);
  }, [getCityFromPoint, loadDeliveryData]);

  // Compute analysis
  const analysis = useMemo(() => {
    if (!candidate) return null;
    return computeAnalysis(candidate.lat, candidate.lng, stores, competitors, deliveryData, deliveryCity);
  }, [candidate, stores, competitors, deliveryData, deliveryCity]);

  if (loading) return <div style={{ padding: 40, fontSize: 16 }}>加载中...</div>;
  if (error) return <div style={{ padding: 40, color: 'red' }}>{error}</div>;

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      {/* Sidebar */}
      <div style={{
        width: 400, minWidth: 400, background: '#fff', borderRight: '1px solid #e2e8f0',
        overflowY: 'auto', padding: '16px', fontSize: 13,
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Wagas 外卖店选址工具</h2>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>测试版 · 点击地图选择候选点位</div>

        {!analysis ? (
          <div style={{ color: '#64748b', padding: '20px 0' }}>
            <p>👆 在右侧地图上点击任意位置，放置候选点位。</p>
            <p style={{ marginTop: 8 }}>工具将自动分析该点位的：</p>
            <ul style={{ marginTop: 4, paddingLeft: 20, lineHeight: 1.8 }}>
              <li>周边自有门店 & 蚕食风险</li>
              <li>竞品分布（6个品牌）</li>
              <li>外卖需求热度</li>
              <li>综合选址评分</li>
            </ul>
          </div>
        ) : (
          <AnalysisView analysis={analysis} />
        )}

        {/* Layer toggles */}
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 12 }}>图层</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={showCompetitors} onChange={e => setShowCompetitors(e.target.checked)} />
            竞品门店
          </label>
          {showCompetitors && Object.keys(competitors).map(brand => (
            <label key={brand} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, marginLeft: 16, cursor: 'pointer' }}>
              <input type="checkbox" checked={competitorBrands[brand] ?? true}
                onChange={e => setCompetitorBrands(prev => ({ ...prev, [brand]: e.target.checked }))} />
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: COMPETITOR_COLORS[brand] || '#64748b', display: 'inline-block' }} />
              {brand} ({competitors[brand]?.length || 0})
            </label>
          ))}
        </div>

        <div style={{ marginTop: 16, fontSize: 10, color: '#94a3b8', lineHeight: 1.6 }}>
          <p>数据说明：</p>
          <p>• 门店数据：{stores.length} 家常规门店</p>
          <p>• 竞品数据：{Object.values(competitors).reduce((s, l) => s + l.length, 0)} 家（6品牌）</p>
          <p>• 外卖需求：基于近30天真实配送点</p>
          <p>• 评分为测试版算法，仅供参考</p>
        </div>

        <button onClick={() => setShowHelp(true)} style={{
          width: '100%', padding: '10px 16px', marginTop: 12, borderRadius: 8,
          border: '1px solid #f97316', background: '#fff7ed', color: '#ea580c',
          fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>❓ 使用说明</button>
      </div>

      {/* Map */}
      <MapContainer center={[31.2304, 121.4737]} zoom={11} style={{ flex: 1 }}>
        <TileLayer
          url="https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}"
          subdomains={['1', '2', '3', '4']}
          attribution="高德底图"
        />
        <MapClickHandler onClick={handleMapClick} />

        {/* Our stores */}
        {stores.map(s => (
          <CircleMarker key={s.sid} center={[s.lat, s.lng]} radius={6}
            pathOptions={{ color: '#fff', weight: 1.5, fillColor: '#f97316', fillOpacity: 0.85 }} />
        ))}

        {/* Competitors */}
        {showCompetitors && Object.entries(competitors).map(([brand, list]) => {
          if (!competitorBrands[brand]) return null;
          const color = COMPETITOR_COLORS[brand] || '#64748b';
          return list.map((c, i) => (
            <CircleMarker key={`${brand}-${i}`} center={[c.lat, c.lng]} radius={5}
              pathOptions={{ color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 0.8 }} />
          ));
        })}

        {/* Delivery contours */}
        {stores.map(s => {
          if (!s.delivery_contour || s.delivery_contour.length === 0) return null;
          return <Polygon key={`dc-${s.sid}`} positions={s.delivery_contour}
            pathOptions={{ color: '#3b82f6', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.06, interactive: false }} />;
        })}

        {/* Candidate pin */}
        {candidate && (
          <Marker position={[candidate.lat, candidate.lng]} icon={createCandidateIcon()} />
        )}
      </MapContainer>

      {/* 帮助面板 */}
      {showHelp && (
        <div onClick={() => setShowHelp(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 12, padding: '24px 28px',
            maxWidth: 560, width: '90%', maxHeight: '85vh', overflowY: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)', fontSize: 13, lineHeight: 1.7,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>使用说明</h2>
              <button onClick={() => setShowHelp(false)} style={{
                background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8',
              }}>✕</button>
            </div>

            <HelpSection title="🚀 快速上手">
              <p>1. 在右侧地图上<b>点击任意位置</b>，放置一个红色候选点位标记。</p>
              <p>2. 左侧面板会自动显示该点位的<b>选址分析报告</b>，包括评分、周边门店、竞品分布、外卖需求和蚕食风险。</p>
              <p>3. 点击地图其他位置可以<b>移动候选点</b>，重新分析。</p>
              <p>4. 通过左下角的<b>图层开关</b>控制竞品门店的显示。</p>
            </HelpSection>

            <HelpSection title="📊 评分说明（满分 100）">
              <p>评分由 4 个维度加权计算，每个维度的含义和"好方向"不同：</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 6 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                    <th style={{ textAlign: 'left', padding: '4px 0' }}>指标</th>
                    <th style={{ textAlign: 'right', padding: '4px 4px' }}>满分</th>
                    <th style={{ textAlign: 'left', padding: '4px 4px' }}>高分含义</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '4px 0' }}>外卖需求热度</td>
                    <td style={{ textAlign: 'right', padding: '4px 4px' }}>30</td>
                    <td style={{ padding: '4px 4px' }}>该区域已有大量 Wagas 外卖订单（需求外溢）</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '4px 0' }}>竞品验证度</td>
                    <td style={{ textAlign: 'right', padding: '4px 4px' }}>25</td>
                    <td style={{ padding: '4px 4px' }}>有竞品 = 市场被验证；适中最好，过多不加分</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '4px 0' }}>蚕食风险</td>
                    <td style={{ textAlign: 'right', padding: '4px 4px' }}>25</td>
                    <td style={{ padding: '4px 4px' }}>分数高 = 蚕食少 = 安全；落在现有店配送圈内会扣分</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 0' }}>自有门店距离</td>
                    <td style={{ textAlign: 'right', padding: '4px 4px' }}>20</td>
                    <td style={{ padding: '4px 4px' }}>越远分越高（覆盖新客群）；&lt;0.5km 几乎不得分</td>
                  </tr>
                </tbody>
              </table>
              <p style={{ marginTop: 8, fontSize: 11, color: '#94a3b8' }}>⚠ 当前为测试版评分算法，权重和阈值可根据实际反馈调整。</p>
            </HelpSection>

            <HelpSection title="🗺️ 地图图层">
              <p><b style={{ color: '#f97316' }}>🟠 橙色圆点</b> — Wagas 现有门店（362 家）</p>
              <p><b style={{ color: '#ef4444' }}> 红色水滴</b> — 你选择的候选点位</p>
              <p><b style={{ color: '#3b82f6' }}> 蓝色轮廓</b> — 现有门店的外卖配送范围（70% 订单覆盖圈）</p>
              <p><b>彩色小圆点</b> — 竞品门店（绿色=星巴克、紫色=超级碗、黄色=赛百味、粉色=gaga、蓝色=蓝蛙、棕色=Manner）</p>
            </HelpSection>

            <HelpSection title=" 数据说明">
              <p>• <b>门店数据</b>：{stores.length} 家常规门店（已过滤云厨子店），含真实 ADS、渠道拆分、配送距离分布</p>
              <p>• <b>竞品数据</b>：6 个品牌共 {Object.values(competitors).reduce((s, l) => s + l.length, 0)} 家门店，来自高德 POI，每月更新</p>
              <p>• <b>外卖需求</b>：基于近 30 天真实配送点坐标，反映"顾客实际从哪里下单"</p>
              <p>• <b>配送轮廓</b>：基于 70% 订单阈值 + 95 分位距离过滤 + Chaikin 平滑算法计算</p>
              <p>• <b>外卖需求数据</b>目前仅覆盖上海、北京，其他城市显示"暂无数据"</p>
            </HelpSection>

            <HelpSection title="❓ 常见问题">
              <QaItem q="评分多少算好？" a="测试版暂无基准线。建议对比多个候选点位的评分，选相对最高的。后续积累数据后可建立基准。" />
              <QaItem q="蚕食风险高怎么办？" a="说明该点位落在现有门店的配送范围内。如果目的是开纯外卖店扩大覆盖，蚕食风险高意味着新店的订单可能主要来自现有店的客群，而非新客。" />
              <QaItem q="竞品太多是不是不好？" a="不一定。适度竞品（10-20家/3km）说明市场有需求且被验证。但竞品评分项在 30 家后不再加分，意味着过度饱和的区域优势有限。" />
              <QaItem q="外卖需求为 0 是什么意思？" a="该点位 500m 范围内近 30 天没有 Wagas 外卖订单。可能是全新市场（机会），也可能是确实没需求（风险），需结合其他指标判断。" />
              <QaItem q="可以保存多个候选点对比吗？" a="当前测试版只支持一个候选点。后续版本会加入候选点列表和对比功能。" />
            </HelpSection>

            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e2e8f0', fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
              Wagas 外卖店选址工具 v0.1（测试版）· 数据截至 {new Date().toLocaleDateString('zh-CN')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ========== Analysis Panel ==========
function AnalysisView({ analysis }: { analysis: CandidateAnalysis }) {
  const a = analysis;
  return (
    <div>
      {/* Score */}
      <div style={{
        background: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)', borderRadius: 8,
        padding: '12px 14px', marginBottom: 12,
      }}>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>综合选址评分</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 36, fontWeight: 800, color: a.score >= 70 ? '#16a34a' : a.score >= 50 ? '#f59e0b' : '#ef4444' }}>
            {a.score}
          </span>
          <span style={{ fontSize: 14, color: '#94a3b8' }}>/ 100</span>
        </div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
          {a.lat.toFixed(5)}, {a.lng.toFixed(5)}
        </div>
      </div>

      {/* Score breakdown */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>评分明细</div>
        {a.scoreBreakdown.map((item, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span>{item.label}</span>
              <span style={{ fontWeight: 600 }}>{item.value}/{item.max}</span>
            </div>
            <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(item.value / item.max) * 100}%`,
                background: item.value / item.max > 0.7 ? '#16a34a' : item.value / item.max > 0.4 ? '#f59e0b' : '#ef4444',
                borderRadius: 2 }} />
            </div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>{item.note}</div>
          </div>
        ))}
      </div>

      {/* Nearby our stores */}
      <Section title={`周边自有门店`} badge={`${a.nearbyStores1km.length}家(1km) / ${a.nearbyStores3km.length}家(3km)`}>
        {a.nearestStore ? (
          <div style={{ fontSize: 11, marginBottom: 4 }}>
            最近：<b>{a.nearestStore.store.name}</b>（{a.nearestStore.dist.toFixed(1)}km，ADS ¥{Math.round(a.nearestStore.store.ads || 0).toLocaleString()}）
          </div>
        ) : <div style={{ fontSize: 11, color: '#16a34a' }}>周边3km内无自有门店 — 新市场机会</div>}
        {a.cannibalizedBy.length > 0 && (
          <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>
             蚕食风险：该点位于 {a.cannibalizedBy.map(c => c.store.name).join('、')} 的配送范围内
          </div>
        )}
      </Section>

      {/* Competitors */}
      <Section title="竞品分布" badge={`${a.competitorStats.length} 个品牌`}>
        {a.competitorStats.length === 0 ? (
          <div style={{ fontSize: 11, color: '#64748b' }}>3km内无竞品</div>
        ) : (
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#94a3b8', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ textAlign: 'left', padding: '2px 0' }}>品牌</th>
                <th style={{ textAlign: 'right', padding: '2px 4px' }}>1km</th>
                <th style={{ textAlign: 'right', padding: '2px 4px' }}>3km</th>
                <th style={{ textAlign: 'right', padding: '2px 0' }}>评分</th>
              </tr>
            </thead>
            <tbody>
              {a.competitorStats.map(c => (
                <tr key={c.brand} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '3px 0' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: COMPETITOR_COLORS[c.brand] || '#64748b' }} />
                      {c.brand}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', padding: '3px 4px', fontWeight: 600 }}>{c.n1}</td>
                  <td style={{ textAlign: 'right', padding: '3px 4px' }}>{c.n3}</td>
                  <td style={{ textAlign: 'right', padding: '3px 0', color: '#f59e0b' }}>{c.med != null ? `★${c.med}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Delivery demand */}
      <Section title="外卖需求热度">
        {a.deliveryDemand != null ? (
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: a.deliveryDemand > 20 ? '#16a34a' : a.deliveryDemand > 5 ? '#f59e0b' : '#94a3b8' }}>
              {Math.round(a.deliveryDemand)} <span style={{ fontSize: 12, fontWeight: 400, color: '#64748b' }}>单 (500m内/30天)</span>
            </div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
              {a.deliveryDemand > 20 ? ' 高需求区域 — 已有大量Wagas外卖订单从此处发出' :
               a.deliveryDemand > 5 ? '📦 中等需求 — 有一定外卖基础' : '❄️ 低需求 — 该区域Wagas外卖覆盖较少'}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: '#94a3b8' }}>
            {a.deliveryCity ? '该城市暂无外卖配送数据' : '点击位置超出数据覆盖范围'}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12, padding: '8px 10px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 12 }}>{title}</span>
        {badge && <span style={{ fontSize: 10, color: '#94a3b8' }}>{badge}</span>}
      </div>
      {children}
    </div>
  );
}

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: '#1e293b' }}>{title}</h3>
      <div style={{ fontSize: 13, lineHeight: 1.8, color: '#475569' }}>{children}</div>
    </div>
  );
}

function QaItem({ q, a }: { q: string; a: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 12, color: '#1e293b' }}>{q}</div>
      <div style={{ fontSize: 12, color: '#64748b', paddingLeft: 12 }}>{a}</div>
    </div>
  );
}
