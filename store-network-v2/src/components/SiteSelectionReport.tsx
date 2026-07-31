import { useMemo } from 'react';
import { useAppStore } from '../store';
import type { Store, CompetitorData, MeituanMallData } from '../types';

// 两点间近似距离（km）
function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return Math.sqrt(Math.pow(lat1 - lat2, 2) + Math.pow(lng1 - lng2, 2)) * 111;
}

// 百分位（0-100）
function percentile(values: number[], value: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  let count = 0;
  for (const v of sorted) {
    if (v <= value) count++;
  }
  return Math.round((count / sorted.length) * 100);
}

// 按百分位映射到 0-maxScore
function scoreByPercentile(pct: number, maxScore: number): number {
  if (pct >= 90) return maxScore;
  if (pct >= 75) return Math.round(maxScore * 0.78);
  if (pct >= 50) return Math.round(maxScore * 0.56);
  if (pct >= 25) return Math.round(maxScore * 0.33);
  return Math.round(maxScore * 0.11);
}

// 中位数
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

// 选址评分计算
function computeSiteSelectionScore(
  lat: number,
  lng: number,
  stores: Store[],
  competitors: CompetitorData,
  meituanMallData: MeituanMallData[]
) {
  // ---- 预计算：按城市分组，提取同城百分位分母 ----
  const residentialByCity: Record<string, number[]> = {};
  const avgCostByCity: Record<string, number[]> = {};
  for (const s of stores) {
    if (s.market) {
      if (!residentialByCity[s.city]) residentialByCity[s.city] = [];
      if (!avgCostByCity[s.city]) avgCostByCity[s.city] = [];
      if (typeof s.market.residential_count === 'number') residentialByCity[s.city].push(s.market.residential_count);
      if (typeof s.market.avg_cost === 'number' && s.market.avg_cost > 0) avgCostByCity[s.city].push(s.market.avg_cost);
    }
  }

  // ---- 找到离候选点最近的门店，用其 market 数据作为代理 ----
  let nearestStore: Store | null = null;
  let minDist = Infinity;
  for (const s of stores) {
    const d = distKm(s.lat, s.lng, lat, lng);
    if (d < minDist) {
      minDist = d;
      nearestStore = s;
    }
  }

  // ---- 取最近门店所在城市的同城数据做百分位 ----
  const nearestCity = nearestStore?.city ?? '';
  const residentialList = residentialByCity[nearestCity] ?? [];
  const avgCostList = avgCostByCity[nearestCity] ?? [];
  const medianResidential = median(residentialList) ?? 0;
  const medianAvgCost = median(avgCostList) ?? 0;

  // ---- 1. 商圈潜力（0-40 分）— residential_count，同城百分位 ----
  let potentialScore = 0;
  let residentialPct = 0;
  let residentialValue: number | null = null;

  if (nearestStore?.market && typeof nearestStore.market.residential_count === 'number') {
    residentialValue = nearestStore.market.residential_count;
    residentialPct = percentile(residentialList, residentialValue);
    potentialScore = scoreByPercentile(residentialPct, 40);
  }

  // ---- 2. 商圈消费力（0-20 分）— avg_cost，同城百分位 ----
  let spendingScore = 0;
  let avgCostPct = 0;
  let avgCostValue: number | null = null;

  if (nearestStore?.market && typeof nearestStore.market.avg_cost === 'number' && nearestStore.market.avg_cost > 0) {
    avgCostValue = nearestStore.market.avg_cost;
    avgCostPct = percentile(avgCostList, avgCostValue);
    spendingScore = scoreByPercentile(avgCostPct, 20);
  }

  // ---- 3. 蚕食风险（0-10 分）— 3km 内 Wagas 门店数 ----
  let cannibScore = 10;
  let cannibCount = 0;
  let nearestWagasDist: number | null = null;
  let nearestWagasStore: Store | null = null;
  const nearbyWagas: { store: Store; dist: number }[] = [];

  for (const s of stores) {
    const d = distKm(s.lat, s.lng, lat, lng);
    if (d <= 3) {
      cannibCount++;
      nearbyWagas.push({ store: s, dist: d });
      if (nearestWagasDist === null || d < nearestWagasDist) {
        nearestWagasDist = d;
        nearestWagasStore = s;
      }
      // 距离越近扣分越重
      let penalty = 1;
      if (d <= 0.5) penalty = 5;
      else if (d <= 1) penalty = 4;
      else if (d <= 2) penalty = 2;
      cannibScore -= penalty;
    }
  }
  if (cannibScore < 1) cannibScore = 1;
  cannibScore = Math.round(cannibScore);

  // ---- 4. 竞品环境（0-15 分）— comp_total，单调递增 ----
  let totalCompetitors = 0;
  const compByBrand: Record<string, number> = {};
  for (const brand in competitors) {
    let count = 0;
    for (const c of competitors[brand]) {
      const d = distKm(c.lat, c.lng, lat, lng);
      if (d <= 3) {
        count++;
        totalCompetitors++;
      }
    }
    if (count > 0) compByBrand[brand] = count;
  }

  // 单调递增：竞品越多分越高
  let compScore: number;
  if (totalCompetitors === 0) compScore = 3;
  else if (totalCompetitors <= 5) compScore = 6;
  else if (totalCompetitors <= 15) compScore = 9;
  else if (totalCompetitors <= 25) compScore = 12;
  else compScore = 15;

  // ---- 5. 美团验证（0-15 分）— delivery_orders_all_3km ----
  let meituanScore = 0;
  let meituanOrders: number | null = null;
  let meituanPct = 0;
  let hasMeituanData = false;
  let meituanDist: number | null = null;

  // 预计算美团订单百分位分母
  const meituanOrdersList: number[] = [];
  for (const m of meituanMallData) {
    if (typeof m.delivery_orders_all_3km === 'number' && m.delivery_orders_all_3km > 0) {
      meituanOrdersList.push(m.delivery_orders_all_3km);
    }
  }

  if (meituanMallData.length > 0) {
    // 找到离候选点最近的美团数据点
    let nearestMeituan: MeituanMallData | null = null;
    let minMeituanDist = Infinity;
    for (const m of meituanMallData) {
      if (typeof m.lat !== 'number' || typeof m.lng !== 'number') continue;
      const d = distKm(m.lat, m.lng, lat, lng);
      if (d < minMeituanDist) {
        minMeituanDist = d;
        nearestMeituan = m;
      }
    }

    // 5km 内有美团数据才使用
    if (nearestMeituan && minMeituanDist <= 5 && typeof nearestMeituan.delivery_orders_all_3km === 'number' && nearestMeituan.delivery_orders_all_3km > 0) {
      hasMeituanData = true;
      meituanDist = minMeituanDist;
      meituanOrders = nearestMeituan.delivery_orders_all_3km;
      meituanPct = percentile(meituanOrdersList, meituanOrders);
      meituanScore = scoreByPercentile(meituanPct, 15);
    }
  }

  // ---- 汇总 ----
  const baseScore = potentialScore + spendingScore + cannibScore + compScore;
  const maxScore = hasMeituanData ? 100 : 85;
  const score = Math.round(baseScore + meituanScore);
  const percentage = score / maxScore;

  let recommendation = '';
  if (percentage >= 0.80) recommendation = '综合评分优秀，强烈推荐在此选址。';
  else if (percentage >= 0.65) recommendation = '综合评分良好，建议选址。';
  else if (percentage >= 0.50) recommendation = '综合评分中等，可以考虑但需进一步调研。';
  else recommendation = '综合评分较低，不建议在此选址。';

  return {
    score,
    baseScore,
    maxScore,
    percentage,
    potentialScore,
    spendingScore,
    cannibScore,
    compScore,
    meituanScore,
    hasMeituanData,
    meituanOrders,
    meituanPct,
    meituanDist,
    recommendation,
    nearestStore,
    nearestStoreDist: minDist === Infinity ? null : minDist,
    nearestCity,
    residentialValue,
    residentialPct,
    avgCostValue,
    avgCostPct,
    cannibCount,
    nearestWagasStore,
    nearestWagasDist,
    nearbyWagas,
    totalCompetitors,
    compByBrand,
    medianResidential,
    medianAvgCost,
    businessArea: nearestStore?.market?.business_area ?? null,
  };
}

interface SiteSelectionReportProps {
  lat: number;
  lng: number;
}

export default function SiteSelectionReport({ lat, lng }: SiteSelectionReportProps) {
  const { stores, competitors, meituanMallData } = useAppStore();

  const analysis = useMemo(() => {
    return computeSiteSelectionScore(lat, lng, stores, competitors, meituanMallData);
  }, [lat, lng, stores, competitors, meituanMallData]);

  // 关键结论：找出最拖分和最加分的维度
  const dimensionGaps = [
    { name: '商圈潜力', score: analysis.potentialScore, max: 40 },
    { name: '商圈消费力', score: analysis.spendingScore, max: 20 },
    { name: '蚕食风险', score: analysis.cannibScore, max: 10 },
    { name: '竞品环境', score: analysis.compScore, max: 15 },
    ...(analysis.hasMeituanData ? [{ name: '美团验证', score: analysis.meituanScore, max: 15 }] : []),
  ];
  const weakest = dimensionGaps.reduce((a, b) => (a.score / a.max < b.score / b.max ? a : b));
  const strongest = dimensionGaps.reduce((a, b) => (a.score / a.max > b.score / b.max ? a : b));

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: '#1e293b' }}>
        选址评分报告
      </div>

      {/* 综合评分 */}
      <div style={{ background: '#f0f9ff', padding: 12, borderRadius: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>综合得分</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'nowrap' }}>
          <span style={{ fontSize: 36, fontWeight: 800, color: analysis.percentage >= 0.80 ? '#16a34a' : analysis.percentage >= 0.65 ? '#f59e0b' : '#ef4444', whiteSpace: 'nowrap' }}>
            {Math.round(analysis.score)}
          </span>
          <span style={{ fontSize: 14, color: '#94a3b8', whiteSpace: 'nowrap' }}>/ {analysis.maxScore}</span>
          <span style={{ fontSize: 11, color: '#64748b', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
            得分率 {Math.round(analysis.percentage * 100)}%
          </span>
        </div>
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6, lineHeight: 1.5 }}>
          💡 基于门店历史数据回归建模，{analysis.hasMeituanData ? '5' : '4'} 维度加权评分（满分 {analysis.maxScore} 分）。
          {analysis.hasMeituanData ? '含美团外卖验证数据。' : '该区域暂无美团验证数据，满分 85 分。'}
          {analysis.nearestCity && <span> 百分位基于{analysis.nearestCity}同城门店。</span>}
        </div>
      </div>

      {/* 评分明细 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>评分明细</div>

        {/* 商圈潜力 */}
        <div style={{ marginBottom: 12, padding: 8, background: '#f8fafc', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
            <span style={{ fontWeight: 600 }}>商圈潜力</span>
            <span style={{ fontWeight: 600 }}>{analysis.potentialScore}/40</span>
          </div>
          <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', width: `${(analysis.potentialScore / 40) * 100}%`, background: '#3b82f6' }} />
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>
            📊 数据：1km 内住宅小区 {analysis.residentialValue ?? '—'} 个
            （{analysis.nearestCity || '同城'}前 {analysis.residentialPct}%，中位数 {analysis.medianResidential}）
            {analysis.businessArea && <span> · 商圈：{analysis.businessArea}</span>}
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>
            💡 评分规则：住宅小区 POI 数按同城百分位打分（前 10% 满分、前 25% 较高、前 50% 中等、前 75% 较低、后 25% 低）
          </div>
          <div style={{ fontSize: 10, color: '#f59e0b', lineHeight: 1.5, marginTop: 4 }}>
            ⚠️ 数据来源：最近门店（{analysis.nearestStoreDist?.toFixed(1) ?? '—'} km）的 1km 商圈数据，候选点位实际密度可能略有差异
          </div>
        </div>

        {/* 商圈消费力 */}
        <div style={{ marginBottom: 12, padding: 8, background: '#f8fafc', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
            <span style={{ fontWeight: 600 }}>商圈消费力</span>
            <span style={{ fontWeight: 600 }}>{analysis.spendingScore}/20</span>
          </div>
          <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', width: `${(analysis.spendingScore / 20) * 100}%`, background: '#8b5cf6' }} />
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>
            📊 数据：商圈人均消费 ¥{analysis.avgCostValue ?? '—'}
            （{analysis.nearestCity || '同城'}前 {analysis.avgCostPct}%，中位数 ¥{Math.round(analysis.medianAvgCost)}）
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>
            💡 评分规则：商圈内餐厅人均消费均价按同城百分位打分。Wagas 客单价 60-80 元，需消费力匹配的商圈。
          </div>
        </div>

        {/* 蚕食风险 */}
        <div style={{ marginBottom: 12, padding: 8, background: '#f8fafc', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
            <span style={{ fontWeight: 600 }}>蚕食风险</span>
            <span style={{ fontWeight: 600 }}>{Math.round(analysis.cannibScore)}/10</span>
          </div>
          <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', width: `${(analysis.cannibScore / 10) * 100}%`, background: '#10b981' }} />
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>
            📊 数据：{analysis.cannibCount === 0
              ? '3km 内无现有门店覆盖'
              : `3km 内现有门店 ${analysis.cannibCount} 家${
                  analysis.nearestWagasDist !== null
                    ? `（最近 ${analysis.nearestWagasDist.toFixed(1)} km${analysis.nearestWagasStore ? ` · ${analysis.nearestWagasStore.name || analysis.nearestWagasStore.sid}` : ''}）`
                    : ''
                }`}
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>
            💡 评分规则：0 家=10 分 | ≤0.5km 每家 -5 | ≤1km 每家 -4 | ≤2km 每家 -2 | 2-3km 每家 -1，最低 1 分
          </div>
        </div>

        {/* 竞品环境 */}
        <div style={{ marginBottom: 12, padding: 8, background: '#f8fafc', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
            <span style={{ fontWeight: 600 }}>竞品环境</span>
            <span style={{ fontWeight: 600 }}>{analysis.compScore}/15</span>
          </div>
          <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', width: `${(analysis.compScore / 15) * 100}%`, background: '#f59e0b' }} />
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>
            📊 数据：3km 内 {analysis.totalCompetitors} 家竞品
            {Object.keys(analysis.compByBrand).length > 0 && (
              <span>（{Object.entries(analysis.compByBrand)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([brand, count]) => `${brand}${count}家`)
                .join('、')}）</span>
            )}
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>
            💡 评分规则：竞品越多分越高（单调递增）。0 家=3 | 1-5 家=6 | 6-15 家=9 | 16-25 家=12 | 26+ 家=15
          </div>
        </div>

        {/* 美团验证 */}
        {analysis.hasMeituanData && (
          <div style={{ marginBottom: 12, padding: 8, background: '#f8fafc', borderRadius: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>美团验证</span>
              <span style={{ fontWeight: 600 }}>{analysis.meituanScore}/15</span>
            </div>
            <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
              <div style={{ height: '100%', width: `${(analysis.meituanScore / 15) * 100}%`, background: '#ef4444' }} />
            </div>
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>
              📊 数据：3km 内外卖订单 {analysis.meituanOrders?.toLocaleString() ?? '—'} 单
              （前 {analysis.meituanPct}%）
              {analysis.meituanDist !== null && <span> · 数据点距离 {analysis.meituanDist.toFixed(1)} km</span>}
            </div>
            <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>
              💡 评分规则：美团 3km 外卖订单量按百分位打分，验证区域外卖需求。前 10% 满分 15 分。
            </div>
          </div>
        )}
        {!analysis.hasMeituanData && (
          <div style={{ marginBottom: 12, padding: 8, background: '#fef3c7', borderRadius: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: '#92400e' }}>美团验证</span>
              <span style={{ fontWeight: 600, color: '#92400e' }}>— /15</span>
            </div>
            <div style={{ fontSize: 10, color: '#92400e', lineHeight: 1.5 }}>
              ⚠️ 该区域 5km 内暂无美团验证数据，此项不计入总分。满分按 85 分计算，按得分率评估。
            </div>
          </div>
        )}
      </div>

      {/* 综合建议 */}
      <div style={{
        background: analysis.percentage >= 0.65 ? '#dcfce7' : '#fef3c7',
        padding: 12,
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 600,
        marginBottom: 12
      }}>
        {analysis.recommendation}
      </div>

      {/* 关键结论 */}
      <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.6, background: '#eff6ff', padding: 12, borderRadius: 8, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8, color: '#1e40af' }}>🔍 关键结论</div>
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <li style={{ marginBottom: 4 }}>
            <strong>最强项：</strong>{strongest.name}（{strongest.score}/{strongest.max}）
          </li>
          <li style={{ marginBottom: 4 }}>
            <strong>最弱项：</strong>{weakest.name}（{weakest.score}/{weakest.max}）
            {weakest.name === '蚕食风险' && analysis.cannibCount > 0 && analysis.nearestWagasStore && (
              <span>，最近门店 {analysis.nearestWagasDist?.toFixed(1)} km · {analysis.nearestWagasStore.name || analysis.nearestWagasStore.sid}</span>
            )}
            {weakest.name === '竞品环境' && analysis.totalCompetitors === 0 && (
              <span>，3km 内无竞品，可能为需求未验证区域</span>
            )}
            {weakest.name === '商圈潜力' && analysis.residentialValue !== null && (
              <span>，住宅小区 {analysis.residentialValue} 个（{analysis.nearestCity || '同城'}前 {analysis.residentialPct}%）</span>
            )}
            {weakest.name === '商圈消费力' && analysis.avgCostValue !== null && (
              <span>，人均消费 ¥{analysis.avgCostValue}（{analysis.nearestCity || '同城'}前 {analysis.avgCostPct}%）</span>
            )}
            {weakest.name === '美团验证' && analysis.meituanOrders !== null && (
              <span>，3km 外卖订单 {analysis.meituanOrders.toLocaleString()} 单（前 {analysis.meituanPct}%）</span>
            )}
          </li>
        </ul>
      </div>

      {/* 数据洞察 */}
      <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.6, background: '#fffbeb', padding: 12, borderRadius: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 8, color: '#92400e' }}>📊 数据洞察</div>
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          {/* 商圈潜力洞察 */}
          {analysis.residentialValue !== null && (
            <li style={{ marginBottom: 6 }}>
              <strong>商圈潜力：</strong>
              周边 1km 内 {analysis.residentialValue} 个住宅小区（{analysis.nearestCity || '同城'}前 {analysis.residentialPct}%）。
              {analysis.residentialValue > analysis.medianResidential
                ? '住宅密度高于同城中位数，有稳定的常住人口基础。'
                : '住宅密度低于同城中位数，日常客流可能不足，建议关注写字楼和商业流量补充。'}
            </li>
          )}

          {/* 商圈消费力洞察 */}
          {analysis.avgCostValue !== null && (
            <li style={{ marginBottom: 6 }}>
              <strong>商圈消费力：</strong>
              商圈人均消费 ¥{analysis.avgCostValue}（{analysis.nearestCity || '同城'}前 {analysis.avgCostPct}%）。
              {analysis.avgCostValue >= 80
                ? '消费力强，与 Wagas 客单价匹配度高。'
                : analysis.avgCostValue >= 50
                ? '消费力中等，客单价匹配度尚可。'
                : '消费力偏低，客单价可能存在压力，需关注定价策略。'}
            </li>
          )}

          {/* 蚕食风险洞察 */}
          {analysis.cannibCount === 0 && (
            <li style={{ marginBottom: 6 }}>
              <strong>蚕食风险：</strong>
              3km 内无现有门店，空白市场。若商圈潜力通过验证，可作为新区域首店优先测试。
            </li>
          )}
          {analysis.cannibCount > 0 && (
            <li style={{ marginBottom: 6 }}>
              <strong>蚕食风险：</strong>
              3km 内已有 {analysis.cannibCount} 家现有门店
              {analysis.nearestWagasStore ? `，最近为「${analysis.nearestWagasStore.name || analysis.nearestWagasStore.sid}」（${analysis.nearestWagasDist?.toFixed(1)} km）` : ''}。
              {analysis.cannibCount >= 3
                ? '门店密度较高，建议评估净增量是否大于蚕食量。'
                : '门店密度可控，蚕食风险较低。'}
            </li>
          )}

          {/* 竞品环境洞察 */}
          {analysis.totalCompetitors === 0 && (
            <li style={{ marginBottom: 6 }}>
              <strong>竞品环境：</strong>
              3km 内无竞品。若住宅密度同时高，可能是蓝海；否则可能是需求未验证区域，建议实地蹲点。
            </li>
          )}
          {analysis.totalCompetitors > 0 && analysis.totalCompetitors <= 5 && (
            <li style={{ marginBottom: 6 }}>
              <strong>竞品环境：</strong>
              3km 内仅 {analysis.totalCompetitors} 家竞品，竞争压力小。建议快速测试，抢占先入优势。
            </li>
          )}
          {analysis.totalCompetitors > 5 && analysis.totalCompetitors <= 15 && (
            <li style={{ marginBottom: 6 }}>
              <strong>竞品环境：</strong>
              3km 内 {analysis.totalCompetitors} 家竞品，密度适中、需求已被验证。
              主要品牌：{Object.entries(analysis.compByBrand).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b, c]) => `${b}${c}家`).join('、')}。
            </li>
          )}
          {analysis.totalCompetitors > 15 && analysis.totalCompetitors <= 25 && (
            <li style={{ marginBottom: 6 }}>
              <strong>竞品环境：</strong>
              3km 内 {analysis.totalCompetitors} 家竞品，竞争较激烈。
              主要品牌：{Object.entries(analysis.compByBrand).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b, c]) => `${b}${c}家`).join('、')}。
              需差异化定位才能避开价格战。
            </li>
          )}
          {analysis.totalCompetitors > 25 && (
            <li style={{ marginBottom: 6 }}>
              <strong>竞品环境：</strong>
              3km 内 {analysis.totalCompetitors} 家竞品，市场高度饱和。
              主要品牌：{Object.entries(analysis.compByBrand).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b, c]) => `${b}${c}家`).join('、')}。
              除非有显著差异化，否则不建议进入。
            </li>
          )}

          {/* 美团验证洞察 */}
          {analysis.hasMeituanData && analysis.meituanOrders !== null && (
            <li style={{ marginBottom: 6 }}>
              <strong>美团验证：</strong>
              3km 内外卖订单 {analysis.meituanOrders.toLocaleString()} 单（前 {analysis.meituanPct}%）。
              {analysis.meituanPct >= 50
                ? '外卖需求验证通过，区域有稳定的外卖消费基础。'
                : '外卖需求偏低，建议结合堂食预期综合评估。'}
            </li>
          )}
          {!analysis.hasMeituanData && (
            <li style={{ marginBottom: 6 }}>
              <strong>美团验证：</strong>
              该区域暂无美团验证数据。建议通过美团 App 实地查看周边外卖热度，或联系美团获取商圈报告补充验证。
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
