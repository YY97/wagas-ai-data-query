import { useMemo } from 'react';
import { useAppStore } from '../store';
import type { DensityGridPoint, MeituanMallData } from '../types';

// 选址评分计算
function computeSiteSelectionScore(
  lat: number,
  lng: number,
  densityGridData: DensityGridPoint[],
  meituanMallData: MeituanMallData[],
  stores: any[],
  competitors: Record<string, any[]>
) {
  // 1. 外卖需求潜力（0-45 分）
  let demandScore = 0;
  let nearestGrid: DensityGridPoint | null = null;
  let minDist = Infinity;
  
  for (const g of densityGridData) {
    const d = Math.sqrt(Math.pow(g.lat - lat, 2) + Math.pow(g.lng - lng, 2)) * 111; // 近似 km
    if (d < minDist) {
      minDist = d;
      nearestGrid = g;
    }
  }
  
  if (nearestGrid && minDist <= 3) {
    const total = nearestGrid.office_count + nearestGrid.residential_count;
    if (total > 100) demandScore = 45;
    else if (total > 50) demandScore = 30;
    else if (total > 20) demandScore = 15;
    else demandScore = 5;
  }

  // 2. 蚕食风险（0-20 分）
  let cannibScore = 20;
  for (const s of stores) {
    const d = Math.sqrt(Math.pow(s.lat - lat, 2) + Math.pow(s.lng - lng, 2)) * 111;
    if (d <= 3) {
      cannibScore = Math.max(0, cannibScore - 5);
    }
  }

  // 3. 竞品环境（0-20 分）
  let compScore = 0;
  let totalCompetitors = 0;
  for (const brand in competitors) {
    for (const c of competitors[brand]) {
      const d = Math.sqrt(Math.pow(c.lat - lat, 2) + Math.pow(c.lng - lng, 2)) * 111;
      if (d <= 3) totalCompetitors++;
    }
  }
  if (totalCompetitors > 0 && totalCompetitors <= 5) compScore = 15;
  else if (totalCompetitors > 5 && totalCompetitors <= 15) compScore = 20;
  else if (totalCompetitors > 15) compScore = 10;

  // 4. 美团验证（0-15 分）
  let meituanScore = 0;
  let nearestMall: MeituanMallData | null = null;
  let minMallDist = Infinity;
  
  for (const m of meituanMallData) {
    const d = Math.sqrt(Math.pow(m.lat - lat, 2) + Math.pow(m.lng - lng, 2)) * 111;
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
               数据：{analysis.nearestGrid.office_count}写字楼/{analysis.nearestGrid.residential_count}住宅（3km 内）
            </div>
          )}
          <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>
            💡 评分规则：写字楼 + 住宅总数 &gt;100 得 45 分 | 50-100 得 30 分 | 20-50 得 15 分 | &lt;20 得 5 分
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
            📊 数据：3km 内无现有门店覆盖
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>
            💡 评分规则：0 家门店覆盖=20 分 | 每多 1 家-5 分 | 3 家以上=2 分（阶梯式递减）
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

      {/* 数据洞察 */}
      <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.6, background: '#fffbeb', padding: 12, borderRadius: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 8, color: '#92400e' }}>📊 数据洞察</div>
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          {/* 需求潜力洞察 */}
          {analysis.nearestGrid && (
            <li style={{ marginBottom: 6 }}>
              <strong>需求潜力：</strong>
              周边 3km 内有约 {analysis.nearestGrid.office_count} 栋写字楼、{analysis.nearestGrid.residential_count} 个住宅小区，
              外卖需求潜力{analysis.demandScore > 30 ? '较高' : analysis.demandScore > 15 ? '中等' : '偏低'}。
              {analysis.nearestGrid.office_count > analysis.nearestGrid.residential_count 
                ? '写字楼占比高，午餐时段订单可能是主力，建议重点分析周边写字楼的午餐/晚餐订单分布。'
                : '住宅区占比高，晚餐和周末订单可能是主力，建议考察周边家庭消费场景。'}
            </li>
          )}
          
          {/* 蚕食风险洞察 */}
          {analysis.cannibScore === 20 && (
            <li style={{ marginBottom: 6 }}>
              <strong>蚕食风险：</strong>
              该点位不在任何现有门店的配送范围内，蚕食风险低。
              建议：新市场开拓时，建议先小范围测试（如云厨房模式），验证需求后再投入重资产。
            </li>
          )}
          {analysis.cannibScore < 20 && analysis.cannibScore > 0 && (
            <li style={{ marginBottom: 6 }}>
              <strong>蚕食风险：</strong>
              该点位位于现有门店的配送范围内，存在一定蚕食风险。
              建议：计算被蚕食门店的日均外卖单量，若新店预期单量 &gt; 被蚕食门店单量的 30%，则净增量仍为正。
            </li>
          )}
          
          {/* 竞品环境洞察 */}
          {analysis.totalCompetitors === 0 && (
            <li style={{ marginBottom: 6 }}>
              <strong>竞品环境：</strong>
              3km 内无竞品，市场尚未被验证，需结合需求潜力综合判断。
              建议：无竞品区域可能是蓝海，也可能是"死亡地带"。建议实地考察周边商业氛围和人流。
            </li>
          )}
          {analysis.totalCompetitors > 0 && analysis.totalCompetitors <= 5 && (
            <li style={{ marginBottom: 6 }}>
              <strong>竞品环境：</strong>
              3km 内有 {analysis.totalCompetitors} 家竞品，市场竞争较少，可能是机会也可能是需求不足。
              建议：结合写字楼/住宅密度判断——若密度高但竞品少，可能是蓝海市场；若密度也低，则需谨慎。
            </li>
          )}
          {analysis.totalCompetitors > 5 && analysis.totalCompetitors <= 15 && (
            <li style={{ marginBottom: 6 }}>
              <strong>竞品环境：</strong>
              3km 内有 {analysis.totalCompetitors} 家竞品，竞争适中，市场有需求。
              建议：分析竞品评分分布，若头部竞品评分&lt;4.0，说明服务有提升空间，可切入。
            </li>
          )}
          {analysis.totalCompetitors > 15 && analysis.totalCompetitors <= 25 && (
            <li style={{ marginBottom: 6 }}>
              <strong>竞品环境：</strong>
              3km 内有 {analysis.totalCompetitors} 家竞品，市场竞争较激烈。
              建议：饱和市场中需差异化定位（如高端健康餐、企业团餐），避免价格战。
            </li>
          )}
          {analysis.totalCompetitors > 25 && (
            <li style={{ marginBottom: 6 }}>
              <strong>竞品环境：</strong>
              3km 内有 {analysis.totalCompetitors} 家竞品，市场已饱和。
              建议：除非有显著差异化优势，否则不建议进入。
            </li>
          )}
          
          {/* 美团验证洞察 */}
          {analysis.nearestMall && (
            <li style={{ marginBottom: 6 }}>
              <strong>美团验证：</strong>
              5km 内有美团报告覆盖的门店「{analysis.nearestMall.store_name}」（{analysis.nearestMallDist?.toFixed(1)}km）。
              {analysis.nearestMall.delivery_orders_all_3km && analysis.nearestMall.delivery_orders_all_3km > 50 
                ? '该区域外卖单量高（&gt;50 千单/天），市场成熟度高，但竞争也可能激烈。建议差异化定位。'
                : analysis.nearestMall.delivery_orders_all_3km && analysis.nearestMall.delivery_orders_all_3km > 20
                ? '该区域外卖单量中等（20-50 千单/天），市场有增长空间，可考虑切入。'
                : '该区域外卖单量较低（&lt;20 千单/天），市场可能未成熟或需求有限，需谨慎评估。'}
            </li>
          )}
          {!analysis.nearestMall && (
            <li style={{ marginBottom: 6 }}>
              <strong>美团验证：</strong>
              5km 内无美团报告覆盖的门店，无法获取第三方市场验证数据。
              建议：美团数据缺失时，建议通过实地调研（人流计数、竞品观察）或购买第三方数据（如极光大数据）补充验证。
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
