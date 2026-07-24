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
        
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
            <span>外卖需求潜力</span>
            <span style={{ fontWeight: 600 }}>{analysis.demandScore}/45</span>
          </div>
          <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(analysis.demandScore / 45) * 100}%`, background: '#3b82f6' }} />
          </div>
          {analysis.nearestGrid && (
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
              {analysis.nearestGrid.office_count}写字楼/{analysis.nearestGrid.residential_count}住宅
            </div>
          )}
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
            <span>蚕食风险</span>
            <span style={{ fontWeight: 600 }}>{analysis.cannibScore}/20</span>
          </div>
          <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(analysis.cannibScore / 20) * 100}%`, background: '#10b981' }} />
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
            无蚕食风险
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
            <span>竞品环境</span>
            <span style={{ fontWeight: 600 }}>{analysis.compScore}/20</span>
          </div>
          <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(analysis.compScore / 20) * 100}%`, background: '#f59e0b' }} />
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
            3km 内 {analysis.totalCompetitors} 家竞品
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
            <span>美团市场验证（加分项）</span>
            <span style={{ fontWeight: 600 }}>{analysis.meituanScore}/15</span>
          </div>
          <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(analysis.meituanScore / 15) * 100}%`, background: '#a855f7' }} />
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
            {analysis.nearestMall ? '5km 内有美团报告' : '5km 内无美团报告（不扣分）'}
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
      <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.6 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>数据洞察</div>
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          {analysis.nearestGrid && (
            <li>
              周边 3km 内有约 {analysis.nearestGrid.office_count} 栋写字楼、{analysis.nearestGrid.residential_count} 个住宅小区，
              外卖需求潜力{analysis.demandScore > 30 ? '较高' : analysis.demandScore > 15 ? '中等' : '偏低'}。
            </li>
          )}
          {analysis.cannibScore === 20 && (
            <li>该点位不在任何现有门店的配送范围内，蚕食风险低。</li>
          )}
          {analysis.totalCompetitors === 0 && (
            <li>3km 内无竞品，市场尚未被验证，需结合需求潜力综合判断。</li>
          )}
          {analysis.totalCompetitors > 0 && analysis.totalCompetitors <= 10 && (
            <li>3km 内有 {analysis.totalCompetitors} 家竞品，竞争适中，市场有需求。</li>
          )}
          {analysis.totalCompetitors > 10 && (
            <li>3km 内有 {analysis.totalCompetitors} 家竞品，市场竞争较激烈。</li>
          )}
        </ul>
      </div>
    </div>
  );
}
