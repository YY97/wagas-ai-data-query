import { useMemo } from 'react';
import { useAppStore } from '../store';
import type { DensityGridPoint, MeituanMallData } from '../types';

// 两点间近似距离（km），与地图其余计算保持一致
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

// 选址评分计算
function computeSiteSelectionScore(
  lat: number,
  lng: number,
  densityGridData: DensityGridPoint[],
  meituanMallData: MeituanMallData[],
  stores: any[],
  competitors: Record<string, any[]>
) {
  // 预计算全局百分位
  const allOffice = densityGridData.map((g) => g.office_count);
  const allResidential = densityGridData.map((g) => g.residential_count);

  // 1. 外卖需求潜力（0-45 分）
  let demandScore = 0;
  let nearestGrid: DensityGridPoint | null = null;
  let minDist = Infinity;

  for (const g of densityGridData) {
    const d = distKm(g.lat, g.lng, lat, lng);
    if (d < minDist) {
      minDist = d;
      nearestGrid = g;
    }
  }

  let officePct = 0;
  let residentialPct = 0;
  if (nearestGrid && minDist <= 3) {
    officePct = percentile(allOffice, nearestGrid.office_count);
    residentialPct = percentile(allResidential, nearestGrid.residential_count);
    // 写字楼权重高于住宅：更贴近 Wagas 轻食外卖的午餐/工作日场景
    const weightedDemand = nearestGrid.office_count * 1.5 + nearestGrid.residential_count * 1.0;
    if (weightedDemand > 120) demandScore = 45;
    else if (weightedDemand > 60) demandScore = 30;
    else if (weightedDemand > 24) demandScore = 15;
    else demandScore = 5;
  }

  // 2. 蚕食风险（0-20 分）
  let cannibScore = 20;
  let cannibCount = 0;
  let nearestStoreDist: number | null = null;
  let nearestStore: any | null = null;
  const nearbyStores: { store: any; dist: number }[] = [];

  for (const s of stores) {
    const d = distKm(s.lat, s.lng, lat, lng);
    if (d <= 3) {
      cannibCount++;
      nearbyStores.push({ store: s, dist: d });
      if (nearestStoreDist === null || d < nearestStoreDist) {
        nearestStoreDist = d;
        nearestStore = s;
      }
      // 距离越近，扣分越重
      if (d <= 1) cannibScore -= 10;
      else if (d <= 2) cannibScore -= 6;
      else cannibScore -= 3;
      if (cannibScore < 0) cannibScore = 0;
    }
  }

  // 3. 竞品环境（0-20 分）
  let compScore = 0;
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
  if (totalCompetitors === 0) compScore = 8;
  else if (totalCompetitors <= 5) compScore = 15;
  else if (totalCompetitors <= 15) compScore = 20;
  else if (totalCompetitors <= 25) compScore = 14;
  else compScore = 8;

  // 4. 美团验证（0-15 分）
  let meituanScore = 0;
  let nearestMall: MeituanMallData | null = null;
  let minMallDist = Infinity;

  for (const m of meituanMallData) {
    const d = distKm(m.lat, m.lng, lat, lng);
    if (d < minMallDist) {
      minMallDist = d;
      nearestMall = m;
    }
  }

  if (nearestMall && minMallDist <= 5) {
    if (nearestMall.delivery_orders_all_3km && nearestMall.delivery_orders_all_3km > 50) meituanScore = 15;
    else if (nearestMall.delivery_orders_all_3km && nearestMall.delivery_orders_all_3km > 20) meituanScore = 10;
    else meituanScore = 5;
  }

  const baseScore = demandScore + cannibScore + compScore;
  const maxScore = meituanScore > 0 ? 100 : 85;
  const score = baseScore + meituanScore;
  const percentage = score / maxScore;

  let recommendation = '';
  if (percentage >= 0.80) recommendation = '综合评分优秀，强烈推荐在此开设外卖店。';
  else if (percentage >= 0.65) recommendation = '综合评分良好，建议开设外卖店。';
  else if (percentage >= 0.50) recommendation = '综合评分中等，可以考虑但需进一步调研。';
  else recommendation = '综合评分较低，不建议在此开设外卖店。';

  return {
    score,
    baseScore,
    maxScore,
    percentage,
    demandScore,
    cannibScore,
    compScore,
    meituanScore,
    recommendation,
    nearestGrid,
    totalCompetitors,
    compByBrand,
    cannibCount,
    nearestStore,
    nearestStoreDist,
    nearbyStores,
    officePct,
    residentialPct,
    nearestMall,
    nearestMallDist: minMallDist === Infinity ? null : minMallDist,
  };
}

interface SiteSelectionReportProps {
  lat: number;
  lng: number;
}

export default function SiteSelectionReport({ lat, lng }: SiteSelectionReportProps) {
  const { densityGridData, meituanMallData, stores, competitors } = useAppStore();

  const analysis = useMemo(() => {
    return computeSiteSelectionScore(lat, lng, densityGridData, meituanMallData, stores, competitors);
  }, [lat, lng, densityGridData, meituanMallData, stores, competitors]);

  const cappedOffice = analysis.nearestGrid && analysis.nearestGrid.office_count >= 600;
  const cappedResidential = analysis.nearestGrid && analysis.nearestGrid.residential_count >= 600;

  // 关键结论：找出最拖分和最加分的维度
  const dimensionGaps = [
    { name: '外卖需求潜力', score: analysis.demandScore, max: 45 },
    { name: '蚕食风险', score: analysis.cannibScore, max: 20 },
    { name: '竞品环境', score: analysis.compScore, max: 20 },
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
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>综合选址评分</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 36, fontWeight: 800, color: analysis.percentage >= 0.80 ? '#16a34a' : analysis.percentage >= 0.65 ? '#f59e0b' : '#ef4444' }}>
            {analysis.score}
          </span>
          <span style={{ fontSize: 14, color: '#94a3b8' }}>/ {analysis.maxScore}</span>
          <span style={{ fontSize: 11, color: '#64748b', marginLeft: 'auto' }}>
            得分率 {Math.round(analysis.percentage * 100)}%
          </span>
        </div>
      </div>

      {/* 评分明细 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>评分明细</div>

        {/* 外卖需求潜力 */}
        <div style={{ marginBottom: 12, padding: 8, background: '#f8fafc', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
            <span style={{ fontWeight: 600 }}>外卖需求潜力</span>
            <span style={{ fontWeight: 600 }}>{analysis.demandScore}/45</span>
          </div>
          <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', width: `${(analysis.demandScore / 45) * 100}%`, background: '#3b82f6' }} />
          </div>
          {analysis.nearestGrid && (
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>
               数据：
              {cappedOffice ? '≥' : ''}{analysis.nearestGrid.office_count}写字楼/
              {cappedResidential ? '≥' : ''}{analysis.nearestGrid.residential_count}住宅（3km 内）
              {(cappedOffice || cappedResidential) && (
                <span style={{ color: '#ef4444', marginLeft: 4 }}>
                  *高德单类型上限 600，实际密度可能更高
                </span>
              )}
            </div>
          )}
          <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>
            💡 评分规则：写字楼×1.5 + 住宅×1.0 加权需求指数 &gt;120 得 45 分 | 60-120 得 30 分 | 24-60 得 15 分 | &lt;24 得 5 分
          </div>
        </div>

        {/* 蚕食风险 */}
        <div style={{ marginBottom: 12, padding: 8, background: '#f8fafc', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
            <span style={{ fontWeight: 600 }}>蚕食风险</span>
            <span style={{ fontWeight: 600 }}>{analysis.cannibScore}/20</span>
          </div>
          <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', width: `${(analysis.cannibScore / 20) * 100}%`, background: '#10b981' }} />
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>
            📊 数据：{analysis.cannibCount === 0
              ? '3km 内无现有门店覆盖'
              : `3km 内现有门店覆盖：${analysis.cannibCount} 家${analysis.nearestStoreDist !== null ? `（最近 ${analysis.nearestStoreDist.toFixed(1)} km${analysis.nearestStore ? ` · ${analysis.nearestStore.store_name || analysis.nearestStore.name || analysis.nearestStore.store_id}` : ''}）` : ''}`}
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>
            💡 评分规则：0 家=20 分 | ≤1km 每家-10 分 | 1-2km 每家-6 分 | 2-3km 每家-3 分
          </div>
        </div>

        {/* 竞品环境 */}
        <div style={{ marginBottom: 12, padding: 8, background: '#f8fafc', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
            <span style={{ fontWeight: 600 }}>竞品环境</span>
            <span style={{ fontWeight: 600 }}>{analysis.compScore}/20</span>
          </div>
          <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', width: `${(analysis.compScore / 20) * 100}%`, background: '#f59e0b' }} />
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
            💡 评分规则：钟形曲线 | 0 家=8 分 | 1-5 家=15 分 | 6-15 家=20 分（最佳）| 16-25 家=14 分 | 26+ 家=8 分（饱和）
          </div>
        </div>

        {/* 美团市场验证 */}
        <div style={{ marginBottom: 8, padding: 8, background: '#f8fafc', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
            <span style={{ fontWeight: 600 }}>美团市场验证（加分项）</span>
            <span style={{ fontWeight: 600 }}>{analysis.meituanScore}/15</span>
          </div>
          <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', width: `${(analysis.meituanScore / 15) * 100}%`, background: '#a855f7' }} />
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>
            📊 数据：{analysis.nearestMall ? '5km 内有美团报告' : '5km 内无美团报告（不扣分）'}
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>
            💡 评分规则：加分项 | 外卖单量&gt;50 千单=15 分 | 20-50 千单=10 分 | &lt;20 千单=5 分 | 无报告=0 分（不扣分）
          </div>
        </div>
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
            {weakest.name === '蚕食风险' && analysis.cannibCount > 0 && (
              <span>，最近门店 {analysis.nearestStoreDist?.toFixed(1)} km</span>
            )}
            {weakest.name === '竞品环境' && analysis.totalCompetitors > 0 && (
              <span>，3km 内 {analysis.totalCompetitors} 家竞品</span>
            )}
            {weakest.name === '外卖需求潜力' && analysis.nearestGrid && (
              <span>，加权需求指数 {Math.round(analysis.nearestGrid.office_count * 1.5 + analysis.nearestGrid.residential_count)}</span>
            )}
          </li>
        </ul>
      </div>

      {/* 数据洞察 */}
      <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.6, background: '#fffbeb', padding: 12, borderRadius: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 8, color: '#92400e' }}>📊 数据洞察</div>
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          {/* 需求潜力洞察 */}
          {analysis.nearestGrid && (
            <li style={{ marginBottom: 6 }}>
              <strong>需求潜力：</strong>
              周边 3km 内{cappedOffice ? '≥' : ''}{analysis.nearestGrid.office_count} 栋写字楼（前 {analysis.officePct}%）、
              {cappedResidential ? '≥' : ''}{analysis.nearestGrid.residential_count} 个住宅小区（前 {analysis.residentialPct}%）。
              {analysis.nearestGrid.office_count > analysis.nearestGrid.residential_count
                ? '写字楼更密集，建议主打工作日午餐 + 下午茶场景，关注 11:00-14:00 运力。'
                : '住宅区更密集，建议主打晚餐 + 周末家庭场景，关注 17:00-20:00 运力。'}
              {(cappedOffice || cappedResidential) && (
                <span style={{ color: '#ef4444' }}> 注：数值已触高德上限 600，实际密度可能更高，建议结合实地人流再验证。</span>
              )}
            </li>
          )}

          {/* 蚕食风险洞察 */}
          {analysis.cannibScore === 20 && (
            <li style={{ marginBottom: 6 }}>
              <strong>蚕食风险：</strong>
              3km 内无现有 Wagas 门店，空白市场。若需求验证通过，可作为新市场首店优先测试（如云厨房）。
            </li>
          )}
          {analysis.cannibScore < 20 && analysis.cannibScore > 0 && (
            <li style={{ marginBottom: 6 }}>
              <strong>蚕食风险：</strong>
              3km 内已有 {analysis.cannibCount} 家现有门店，最近为「{analysis.nearestStore?.store_name || analysis.nearestStore?.name || analysis.nearestStore?.store_id}」
              （{analysis.nearestStoreDist?.toFixed(1)} km）。
              建议评估该店外卖日均单量：若新店预计净增量 &gt; 被蚕食量的 30%，整体仍为正。
            </li>
          )}
          {analysis.cannibScore === 0 && analysis.cannibCount > 0 && (
            <li style={{ marginBottom: 6 }}>
              <strong>蚕食风险：</strong>
              3km 内已有 {analysis.cannibCount} 家现有门店，且最近一家在 {analysis.nearestStoreDist?.toFixed(1)} km 内，重叠度极高。
              建议：优先以云厨房/微店切入，避免堂食资源内耗。
            </li>
          )}

          {/* 竞品环境洞察 */}
          {analysis.totalCompetitors === 0 && (
            <li style={{ marginBottom: 6 }}>
              <strong>竞品环境：</strong>
              3km 内无轻食/咖啡竞品。若写字楼/住宅密度同时高，可能是蓝海；否则可能是需求未验证区域，建议实地蹲点。
            </li>
          )}
          {analysis.totalCompetitors > 0 && analysis.totalCompetitors <= 5 && (
            <li style={{ marginBottom: 6 }}>
              <strong>竞品环境：</strong>
              3km 内仅 {analysis.totalCompetitors} 家竞品
              {Object.keys(analysis.compByBrand).length > 0 ? `（${Object.entries(analysis.compByBrand).sort((a, b) => b[1] - a[1]).map(([b, c]) => `${b}${c}家`).join('、')}）` : ''}，
              竞争压力小。建议快速测试，抢占先入优势。
            </li>
          )}
          {analysis.totalCompetitors > 5 && analysis.totalCompetitors <= 15 && (
            <li style={{ marginBottom: 6 }}>
              <strong>竞品环境：</strong>
              3km 内 {analysis.totalCompetitors} 家竞品，密度适中、需求已被验证。
              主要品牌：{Object.entries(analysis.compByBrand).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b, c]) => `${b}${c}家`).join('、')}。
              若头部竞品评分 &lt;4.0，说明服务有提升空间。
            </li>
          )}
          {analysis.totalCompetitors > 15 && analysis.totalCompetitors <= 25 && (
            <li style={{ marginBottom: 6 }}>
              <strong>竞品环境：</strong>
              3km 内 {analysis.totalCompetitors} 家竞品，竞争较激烈。
              主要品牌：{Object.entries(analysis.compByBrand).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b, c]) => `${b}${c}家`).join('、')}。
              需差异化定位（高端健康餐、企业团餐）才能避开价格战。
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
          {analysis.nearestMall && (
            <li style={{ marginBottom: 6 }}>
              <strong>美团验证：</strong>
              最近美团报告门店「{analysis.nearestMall.store_name}」距离 {analysis.nearestMallDist?.toFixed(1)} km，
              3km 内外卖单量约 {analysis.nearestMall.delivery_orders_all_3km ?? '—'} 千单/天。
              {analysis.nearestMall.delivery_orders_all_3km && analysis.nearestMall.delivery_orders_all_3km > 50
                ? '外卖市场成熟，可作为需求侧强佐证。'
                : analysis.nearestMall.delivery_orders_all_3km && analysis.nearestMall.delivery_orders_all_3km > 20
                ? '外卖单量中等，有一定增长空间。'
                : '外卖单量偏低，需结合线下人流综合判断。'}
            </li>
          )}
          {!analysis.nearestMall && (
            <li style={{ marginBottom: 6 }}>
              <strong>美团验证：</strong>
              5km 内无美团报告，缺少第三方单量验证。建议通过实地人流计数或采购极光/美团商业大脑数据补充。
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
