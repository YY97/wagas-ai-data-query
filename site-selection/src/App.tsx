import { useEffect, useMemo, useState, useCallback } from 'react'
import { MapContainer, TileLayer, CircleMarker, Marker, Polygon, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// ========== Types ==========
interface Store {
  sid: string; name: string; brand: string; city: string; addr: string;
  lng: number; lat: number; ads: number | null;
  market?: { office_count: number; residential_count: number; [key: string]: unknown };
  dist?: { d1_pct: number | null; d2_pct: number | null; d3_pct: number | null; d4_pct: number | null; d5_pct: number | null; total_orders: number };
  delivery_contour?: [number, number][];
}
interface CompetitorStore {
  name: string; lng: number; lat: number; addr: string; city: string;
  district: string; rating: string;
}
type CompetitorData = Record<string, CompetitorStore[]>
interface DeliveryPoint { lat: number; lng: number; w: number }
type DeliveryCityData = Record<string, DeliveryPoint[]>

interface MeituanMallData {
  store_id: string;
  store_name: string;
  delivery_orders_all_3km: number | null;
  delivery_pop_all_3km: number | null;
  delivery_orders_target_3km: number | null;
  catering_spending: number | null;
  work_population: number | null;
  residential_percentile: number | null;
}

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
  deliveryDemand: number | null;
  deliveryCity: string | null;
  // 需求潜力（周边写字楼/住宅）
  officeCount: number | null;
  residentialCount: number | null;
  // 配送效率（周边门店短距离订单占比）
  deliveryEfficiency: number | null;
  // 美团市场验证（5km内有美团报告的门店数据）
  meituanStore: { store_id: string; store_name: string; dist: number } | null;
  meituanData: MeituanMallData | null;
  // 评分
  score: number;
  scoreBreakdown: { label: string; value: number; max: number; note: string; logic: string }[];
  // 数据洞察结论
  insights: string[];
  // 综合建议
  recommendation: string;
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
  meituanData: MeituanMallData[],
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

  // Cannibalization: point-in-polygon + area overlap estimate
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

  // Demand potential: use nearby stores' market data (office/residential counts)
  let officeCount: number | null = null;
  let residentialCount: number | null = null;
  if (nearby3km.length > 0) {
    const offices = nearby3km.map(s => s.market?.office_count ?? 0).filter(v => v > 0);
    const resid = nearby3km.map(s => s.market?.residential_count ?? 0).filter(v => v > 0);
    officeCount = offices.length > 0 ? Math.round(offices.reduce((a, b) => a + b, 0) / offices.length) : 0;
    residentialCount = resid.length > 0 ? Math.round(resid.reduce((a, b) => a + b, 0) / resid.length) : 0;
  }

  // Delivery efficiency: nearby stores' short-distance order ratio (d1+d2)
  let deliveryEfficiency: number | null = null;
  if (nearby3km.length > 0) {
    const effs = nearby3km
      .map(s => s.dist ? (s.dist.d1_pct ?? 0) + (s.dist.d2_pct ?? 0) : null)
      .filter((v): v is number => v !== null);
    if (effs.length > 0) {
      deliveryEfficiency = Math.round(effs.reduce((a, b) => a + b, 0) / effs.length * 10) / 10;
    }
  }

  // Meituan market validation: find nearest store within 5km that has Meituan data
  let meituanStore: { store_id: string; store_name: string; dist: number } | null = null;
  let meituanInfo: MeituanMallData | null = null;
  if (meituanData.length > 0) {
    const meituanMap = new Map(meituanData.map(m => [m.store_id, m]));
    let bestDist = Infinity;
    let bestStore: Store | null = null;
    for (const s of stores) {
      const d = haversine(lat, lng, s.lat, s.lng);
      if (d <= 5.0 && d < bestDist && meituanMap.has(s.sid)) {
        bestDist = d;
        bestStore = s;
      }
    }
    if (bestStore) {
      meituanStore = { store_id: bestStore.sid, store_name: bestStore.name, dist: Math.round(bestDist * 10) / 10 };
      meituanInfo = meituanMap.get(bestStore.sid) ?? null;
    }
  }

  // ===== Scoring (6 dimensions, 115 total) =====

  // 1. 外卖需求潜力 (0-30): delivery demand + POI density
  // Solves chicken-and-egg: even with 0 delivery points, high density = potential
  let demandScore = 0;
  if (deliveryDemand != null) {
    demandScore += Math.min(15, deliveryDemand / 3); // 0-15 from actual orders
  } else {
    demandScore += 5; // baseline when no delivery data
  }
  const densityScore = (officeCount ?? 0) + (residentialCount ?? 0);
  if (densityScore > 0) {
    demandScore += Math.min(15, densityScore / 20); // 0-15 from POI density
  } else {
    demandScore += 5; // baseline when no POI data
  }
  demandScore = Math.min(30, demandScore);

  // 2. 竞品验证度 (0-20): validated market, saturation penalty
  const totalCompetitors3km = competitorStats.reduce((s, c) => s + c.n3, 0);
  let compScore: number;
  if (totalCompetitors3km === 0) compScore = 3;
  else if (totalCompetitors3km <= 10) compScore = 8 + totalCompetitors3km * 0.7;
  else if (totalCompetitors3km <= 25) compScore = 15 + (totalCompetitors3km - 10) * 0.4;
  else compScore = Math.max(10, 20 - (totalCompetitors3km - 25) * 0.3); // saturation penalty
  compScore = Math.min(20, Math.max(0, compScore));

  // 3. 蚕食风险 (0-25): fewer = better
  const cannibScore = Math.max(0, 25 - cannibalizedBy.length * 8);

  // 4. 配送效率 (0-15): higher short-distance ratio = more profitable
  let efficiencyScore = 7; // baseline
  if (deliveryEfficiency != null) {
    if (deliveryEfficiency >= 60) efficiencyScore = 15;
    else if (deliveryEfficiency >= 45) efficiencyScore = 12;
    else if (deliveryEfficiency >= 30) efficiencyScore = 9;
    else efficiencyScore = 5;
  }

  // 5. 自有门店距离 (0-10): farther = new market
  let storeScore = 5;
  if (nearest) {
    if (nearest.dist < 0.5) storeScore = 1;
    else if (nearest.dist < 1.0) storeScore = 3;
    else if (nearest.dist < 2.0) storeScore = 6;
    else if (nearest.dist < 3.0) storeScore = 8;
    else storeScore = 10;
  } else {
    storeScore = 10;
  }

  // 6. 美团市场验证 (0-15): based on nearest store's Meituan report data
  let meituanScore = 0;
  if (meituanInfo) {
    // 外卖单量 (0-5): >50千单=5, 20-50=3, <20=1
    if (meituanInfo.delivery_orders_all_3km != null) {
      if (meituanInfo.delivery_orders_all_3km > 50) meituanScore += 5;
      else if (meituanInfo.delivery_orders_all_3km > 20) meituanScore += 3;
      else meituanScore += 1;
    }
    // 外卖人口 (0-3): >30千人=3, 10-30=2, <10=1
    if (meituanInfo.delivery_pop_all_3km != null) {
      if (meituanInfo.delivery_pop_all_3km > 30) meituanScore += 3;
      else if (meituanInfo.delivery_pop_all_3km > 10) meituanScore += 2;
      else meituanScore += 1;
    }
    // 目标品类单量 (0-2): >3千单=2, 1-3=1, <1=0
    if (meituanInfo.delivery_orders_target_3km != null) {
      if (meituanInfo.delivery_orders_target_3km > 3) meituanScore += 2;
      else if (meituanInfo.delivery_orders_target_3km > 1) meituanScore += 1;
    }
    // 餐饮消费金额 (0-2): >5000万=2, 1000-5000=1, <1000=0
    if (meituanInfo.catering_spending != null) {
      if (meituanInfo.catering_spending > 5000) meituanScore += 2;
      else if (meituanInfo.catering_spending > 1000) meituanScore += 1;
    }
    // 工作人口 (0-2): >50万=2, 20-50=1, <20=0
    if (meituanInfo.work_population != null) {
      if (meituanInfo.work_population > 50) meituanScore += 2;
      else if (meituanInfo.work_population > 20) meituanScore += 1;
    }
    // 居住人口百分位 (0-1): >70%=1, <70%=0
    if (meituanInfo.residential_percentile != null && meituanInfo.residential_percentile > 70) {
      meituanScore += 1;
    }
  }
  meituanScore = Math.min(15, meituanScore);

  const score = Math.round(demandScore + compScore + cannibScore + efficiencyScore + storeScore + meituanScore);

  // ===== Insights =====
  const insights: string[] = [];

  // Demand insight
  if (deliveryDemand != null && deliveryDemand > 0) {
    insights.push(`该点位 500m 范围内近 30 天有 ${Math.round(deliveryDemand)} 笔 Wagas 外卖订单，说明已有真实需求从此处发出。`);
  } else if (officeCount != null && residentialCount != null) {
    const total = officeCount + residentialCount;
    if (total > 100) {
      insights.push(`周边 3km 内有约 ${officeCount} 栋写字楼、${residentialCount} 个住宅小区，外卖需求潜力较高。`);
    } else if (total > 30) {
      insights.push(`周边 3km 内有约 ${officeCount} 栋写字楼、${residentialCount} 个住宅小区，外卖需求潜力中等。`);
    } else {
      insights.push(`周边 3km 内写字楼和住宅小区较少（${officeCount} + ${residentialCount}），外卖需求潜力偏低。`);
    }
  }

  // Cannibalization insight
  if (cannibalizedBy.length > 0) {
    const names = cannibalizedBy.slice(0, 3).map(c => c.store.name).join('、');
    insights.push(`该点位位于 ${cannibalizedBy.length} 家现有门店的配送范围内（${names}${cannibalizedBy.length > 3 ? '等' : ''}），蚕食风险较高。`);
  } else {
    insights.push('该点位不在任何现有门店的配送范围内，蚕食风险低。');
  }

  // Competitor insight
  if (totalCompetitors3km > 0) {
    const topBrand = competitorStats[0]?.brand ?? '';
    if (totalCompetitors3km > 25) {
      insights.push(`3km 内有 ${totalCompetitors3km} 家竞品（以${topBrand}为主），市场已被充分验证但趋于饱和。`);
    } else if (totalCompetitors3km > 10) {
      insights.push(`3km 内有 ${totalCompetitors3km} 家竞品（以${topBrand}为主），竞争适中，市场有需求。`);
    } else {
      insights.push(`3km 内仅 ${totalCompetitors3km} 家竞品，市场竞争较少，可能是机会也可能是需求不足。`);
    }
  } else {
    insights.push('3km 内无竞品，市场尚未被验证，需结合需求潜力综合判断。');
  }

  // Delivery efficiency insight
  if (deliveryEfficiency != null) {
    if (deliveryEfficiency >= 50) {
      insights.push(`周边门店 ${deliveryEfficiency}% 的订单在 2km 内完成，配送效率高，适合外卖店运营。`);
    } else {
      insights.push(`周边门店仅 ${deliveryEfficiency}% 的订单在 2km 内，配送距离偏长，成本较高。`);
    }
  }

  // Meituan market validation insight
  if (meituanStore && meituanInfo) {
    insights.push(`5km 内有美团报告覆盖的门店「${meituanStore.store_name}」（${meituanStore.dist}km）：外卖单量 ${meituanInfo.delivery_orders_all_3km ?? '?'}千单/3km，外卖人口 ${meituanInfo.delivery_pop_all_3km ?? '?'}千人/3km，餐饮消费 ${meituanInfo.catering_spending ? Math.round(meituanInfo.catering_spending) + '万/月' : '?'}。注意：数据针对商场，非商场位置仅供参考。`);
  } else {
    insights.push('5km 内无美团报告覆盖的门店，无法获取第三方市场验证数据。');
  }

  // Recommendation
  let recommendation: string;
  if (score >= 85) {
    recommendation = '综合评分优秀，推荐在此开设外卖店。';
  } else if (score >= 70) {
    recommendation = '综合评分良好，建议进一步调研后决策。';
  } else if (score >= 55) {
    recommendation = '综合评分一般，蚕食风险或需求不足，谨慎考虑。';
  } else {
    recommendation = '综合评分较低，不建议在此开设外卖店。';
  }

  return {
    lat, lng, nearbyStores1km: nearby1km, nearbyStores3km: nearby3km,
    nearestStore: nearest, cannibalizedBy, competitorStats,
    deliveryDemand, deliveryCity,
    officeCount, residentialCount, deliveryEfficiency,
    meituanStore, meituanData: meituanInfo,
    score,
    scoreBreakdown: [
      {
        label: '外卖需求潜力', value: Math.round(demandScore), max: 30,
        note: deliveryDemand != null ? `${Math.round(deliveryDemand)} 单(500m) + ${officeCount ?? 0}写字楼/${residentialCount ?? 0}住宅` : `${officeCount ?? 0}写字楼/${residentialCount ?? 0}住宅`,
        logic: '实际配送单量(0-15分) + 周边写字楼/住宅密度(0-15分)',
      },
      {
        label: '竞品验证度', value: Math.round(compScore), max: 20,
        note: `3km内 ${totalCompetitors3km} 家竞品`,
        logic: '0家=3分, 1-10家线性增长至15分, 10-25家缓增至20分, >25家递减(饱和惩罚)',
      },
      {
        label: '蚕食风险', value: Math.round(cannibScore), max: 25,
        note: cannibalizedBy.length > 0 ? `${cannibalizedBy.length} 家门店配送轮廓覆盖此点` : '无蚕食风险',
        logic: '25分 - 覆盖门店数×8 (0家=25分, 3家以上=0分)',
      },
      {
        label: '配送效率', value: efficiencyScore, max: 15,
        note: deliveryEfficiency != null ? `${deliveryEfficiency}% 订单在2km内` : '暂无周边门店配送数据',
        logic: '≥60%=15分, ≥45%=12分, ≥30%=9分, <30%=5分, 无数据=7分',
      },
      {
        label: '自有门店距离', value: storeScore, max: 10,
        note: nearest ? `最近 ${nearest.store.name} ${nearest.dist.toFixed(1)}km` : '周边3km无自有门店',
        logic: '<0.5km=1分, 0.5-1km=3分, 1-2km=6分, 2-3km=8分, >3km或无门店=10分',
      },
      {
        label: '美团市场验证', value: meituanScore, max: 15,
        note: meituanStore ? `基于${meituanStore.store_name}(${meituanStore.dist}km)` : '5km内无美团报告',
        logic: '外卖单量(0-5) + 外卖人口(0-3) + 目标品类(0-2) + 餐饮消费(0-2) + 工作人口(0-2) + 居住人口(0-1)',
      },
    ],
    insights,
    recommendation,
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
  const [meituanData, setMeituanData] = useState<MeituanMallData[]>([]);
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
      fetch(`${import.meta.env.BASE_URL}data/meituan_mall_data.json`).then(r => r.json()).catch(() => ([])),
    ]).then(([s, c, m]) => {
      setStores(s);
      setCompetitors(c);
      setMeituanData(m);
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
    return computeAnalysis(candidate.lat, candidate.lng, stores, competitors, deliveryData, deliveryCity, meituanData);
  }, [candidate, stores, competitors, deliveryData, deliveryCity, meituanData]);

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

            <HelpSection title="📊 评分说明（满分 115）">
              <p>评分由 6 个维度加权计算，每个维度的含义和"好方向"不同：</p>
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
                    <td style={{ textAlign: 'right', padding: '4px 4px' }}>10</td>
                    <td style={{ padding: '4px 4px' }}>越远分越高（覆盖新客群）；&lt;0.5km 几乎不得分</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 0' }}>美团市场验证</td>
                    <td style={{ textAlign: 'right', padding: '4px 4px' }}>15</td>
                    <td style={{ padding: '4px 4px' }}>5km内有美团报告时加分；数据针对商场，非商场仅供参考</td>
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
          <span style={{ fontSize: 36, fontWeight: 800, color: a.score >= 85 ? '#16a34a' : a.score >= 60 ? '#f59e0b' : '#ef4444' }}>
            {a.score}
          </span>
          <span style={{ fontSize: 14, color: '#94a3b8' }}>/ 115</span>
        </div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
          {a.lat.toFixed(5)}, {a.lng.toFixed(5)}
        </div>
      </div>

      {/* Score breakdown */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>评分明细</div>
        {a.scoreBreakdown.map((item, i) => (
          <div key={i} style={{ marginBottom: 8, padding: '6px 8px', background: '#f8fafc', borderRadius: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span style={{ fontWeight: 600 }}>{item.label}</span>
              <span style={{ fontWeight: 700 }}>{item.value}/{item.max}</span>
            </div>
            <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden', marginTop: 4 }}>
              <div style={{ height: '100%', width: `${(item.value / item.max) * 100}%`,
                background: item.value / item.max > 0.7 ? '#16a34a' : item.value / item.max > 0.4 ? '#f59e0b' : '#ef4444',
                borderRadius: 2 }} />
            </div>
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>{item.note}</div>
            <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2, fontStyle: 'italic' }}>算法：{item.logic}</div>
          </div>
        ))}
      </div>

      {/* Insights */}
      <div style={{ marginBottom: 12, padding: '10px 12px', background: '#fffbeb', borderRadius: 6, border: '1px solid #fde68a' }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, color: '#92400e' }}>数据洞察</div>
        {a.insights.map((insight, i) => (
          <div key={i} style={{ fontSize: 11, color: '#78350f', lineHeight: 1.7, marginBottom: 4 }}>
            • {insight}
          </div>
        ))}
      </div>

      {/* Recommendation */}
      <div style={{
        marginBottom: 12, padding: '10px 12px', borderRadius: 6,
        background: a.score >= 60 ? '#f0fdf4' : a.score >= 45 ? '#fffbeb' : '#fef2f2',
        border: `1px solid ${a.score >= 60 ? '#bbf7d0' : a.score >= 45 ? '#fde68a' : '#fecaca'}`,
      }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4,
          color: a.score >= 60 ? '#166534' : a.score >= 45 ? '#92400e' : '#991b1b' }}>
          综合建议
        </div>
        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.6 }}>{a.recommendation}</div>
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
