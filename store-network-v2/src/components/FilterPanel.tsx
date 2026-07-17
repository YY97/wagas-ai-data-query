import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../store';

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', borderRadius: '6px',
  border: '1px solid #cbd5e1', background: '#fff', color: '#1e293b',
  fontSize: '12px', outline: 'none', appearance: 'none',
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
      {children}
      <span style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
    </div>
  );
}

// 多选下拉组件
function MultiSelect({
  label, items, selected, onChange
}: {
  label: string;
  items: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = items.filter(i => i.label.toLowerCase().includes(search.toLowerCase()));

  const toggle = (val: string) => {
    onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val]);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', marginBottom: '6px' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', minHeight: '32px', padding: '4px 28px 4px 8px', borderRadius: '6px',
          border: `1px solid ${open ? '#f97316' : '#cbd5e1'}`, background: '#fff', cursor: 'pointer',
          display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center', fontSize: '12px',
          color: '#1e293b', position: 'relative',
          boxShadow: open ? '0 0 0 2px rgba(249,115,22,0.1)' : 'none',
        }}
      >
        {selected.length === 0 ? (
          <span style={{ color: '#94a3b8', fontSize: '12px' }}>{label}</span>
        ) : (
          selected.slice(0, 3).map(s => {
            const item = items.find(i => i.value === s);
            return (
              <span key={s} style={{
                display: 'inline-flex', alignItems: 'center', gap: '2px',
                background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '4px',
                padding: '1px 6px', fontSize: '11px', color: '#334155', maxWidth: '120px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {item?.label || s}
                <span onClick={(e) => { e.stopPropagation(); toggle(s); }} style={{ cursor: 'pointer', color: '#94a3b8', fontSize: '13px', marginLeft: '2px' }}>&times;</span>
              </span>
            );
          })
        )}
        {selected.length > 3 && <span style={{ fontSize: '10px', color: '#94a3b8' }}>+{selected.length - 3}</span>}
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 2000,
          background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', marginTop: '4px',
          maxHeight: '280px', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #e2e8f0' }}>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="搜索..."
              style={{ width: '100%', padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '12px', outline: 'none' }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', borderBottom: '1px solid #e2e8f0', fontSize: '11px', color: '#64748b' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
              <input type="checkbox" checked={selected.length === items.length && items.length > 0}
                onChange={() => onChange(selected.length === items.length ? [] : items.map(i => i.value))}
                style={{ width: '14px', height: '14px', accentColor: '#f97316' }} />
              全选
            </label>
            <span style={{ fontSize: '10px', color: '#94a3b8' }}>{selected.length}/{items.length}</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {filtered.map(item => (
              <div key={item.value}
                onClick={() => toggle(item.value)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer', color: '#1e293b' }}
              >
                <input type="checkbox" checked={selected.includes(item.value)} readOnly
                  style={{ width: '14px', height: '14px', accentColor: '#f97316', flexShrink: 0 }} />
                {item.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// 图层开关
function ToggleItem({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '6px 10px', marginBottom: '4px', fontSize: '11px', color: '#475569',
      background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0',
    }}>
      <span>{label}</span>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: '32px', height: '18px', borderRadius: '9px', cursor: 'pointer',
          background: checked ? '#f97316' : '#cbd5e1', position: 'relative',
          transition: '0.2s',
        }}
      >
        <div style={{
          width: '14px', height: '14px', background: '#fff', borderRadius: '50%',
          position: 'absolute', top: '2px', left: checked ? '16px' : '2px',
          transition: '0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }} />
      </div>
    </div>
  );
}

export default function FilterPanel() {
  const { stores, filters, setFilter, layers, setLayer, dateRange, allDates, setDateRange, setShowHelp } = useAppStore();

  // === 联动筛选 ===
  // 先按城市过滤，计算可用品牌（带计数）
  const storesByCity = filters.city !== 'all'
    ? stores.filter(s => s.city === filters.city)
    : stores;

  const brandCounts: Record<string, number> = {};
  storesByCity.forEach(s => { brandCounts[s.brand] = (brandCounts[s.brand] || 0) + 1; });
  const brands = Object.keys(brandCounts).sort();

  // 先按品牌过滤，计算可用城市（带计数）
  const storesByBrand = filters.brand !== 'all'
    ? stores.filter(s => s.brand === filters.brand)
    : stores;

  const cityCounts: Record<string, number> = {};
  storesByBrand.forEach(s => { cityCounts[s.city] = (cityCounts[s.city] || 0) + 1; });
  const cities = Object.keys(cityCounts).sort();

  // 门店类型（基于当前品牌+城市过滤）
  const filteredForFmt = stores.filter(s => {
    if (filters.brand !== 'all' && s.brand !== filters.brand) return false;
    if (filters.city !== 'all' && s.city !== filters.city) return false;
    return true;
  });
  const fmtCounts: Record<string, number> = {};
  filteredForFmt.forEach(s => { if (s.fmt) fmtCounts[s.fmt] = (fmtCounts[s.fmt] || 0) + 1; });
  const fmts = Object.keys(fmtCounts).sort();

  // 门店名称和ID选项（基于当前品牌+城市过滤）
  const storeNameItems = filteredForFmt.map(s => ({ value: s.sid, label: s.name }));
  const storeIdItems = filteredForFmt.map(s => ({ value: s.sid, label: s.sid }));

  // 联动：品牌/城市改变时，清除不再匹配的多选项
  const validSids = new Set(filteredForFmt.map(s => s.sid));
  const cleanedNames = filters.storeNames.filter(id => validSids.has(id));
  const cleanedIds = filters.storeIds.filter(id => validSids.has(id));
  if (cleanedNames.length !== filters.storeNames.length) {
    setTimeout(() => setFilter('storeNames', cleanedNames), 0);
  }
  if (cleanedIds.length !== filters.storeIds.length) {
    setTimeout(() => setFilter('storeIds', cleanedIds), 0);
  }

  // 联动：当前选中的品牌/城市/类型如果不在可用列表中，自动重置
  if (filters.brand !== 'all' && !brandCounts[filters.brand]) {
    setTimeout(() => setFilter('brand', 'all'), 0);
  }
  if (filters.city !== 'all' && !cityCounts[filters.city]) {
    setTimeout(() => setFilter('city', 'all'), 0);
  }
  if (filters.fmt !== 'all' && !fmtCounts[filters.fmt]) {
    setTimeout(() => setFilter('fmt', 'all'), 0);
  }

  // 日期下拉选项（仅近 60 天）
  const lastDate = allDates[allDates.length - 1];
  const sixtyDaysAgo = new Date(lastDate);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 59);
  const cutoff = sixtyDaysAgo.toISOString().split('T')[0];
  const dateOptions = [...allDates].filter(d => d >= cutoff).reverse();

  return (
    <div style={{ padding: '0 18px 16px' }}>
      {/* 日期区间 */}
      <div style={{ marginBottom: '14px' }}>
        <SectionTitle>日期区间</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <div>
            <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '2px', fontWeight: 500 }}>起始</div>
            <select value={filters.dateStart || dateRange.start}
              onChange={e => setDateRange({ start: e.target.value, end: filters.dateEnd || dateRange.end })}
              style={selectStyle}>
              {dateOptions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '2px', fontWeight: 500 }}>结束</div>
            <select value={filters.dateEnd || dateRange.end}
              onChange={e => setDateRange({ start: filters.dateStart || dateRange.start, end: e.target.value })}
              style={selectStyle}>
              {dateOptions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* 筛选 */}
      <div style={{ marginBottom: '14px' }}>
        <SectionTitle>筛选</SectionTitle>
        <div style={{ marginBottom: '6px' }}>
          <select value={filters.brand} onChange={e => setFilter('brand', e.target.value)} style={selectStyle}>
            <option value="all">全部品牌</option>
            {brands.map(b => <option key={b} value={b}>{b} ({brandCounts[b]})</option>)}
          </select>
        </div>
        <div style={{ marginBottom: '6px' }}>
          <select value={filters.city} onChange={e => setFilter('city', e.target.value)} style={selectStyle}>
            <option value="all">全部城市</option>
            {cities.map(c => <option key={c} value={c}>{c} ({cityCounts[c]})</option>)}
          </select>
        </div>
        <div style={{ marginBottom: '6px' }}>
          <select value={filters.adsRange} onChange={e => setFilter('adsRange', e.target.value)} style={selectStyle}>
            <option value="all">全部 ADS 区间</option>
            <option value="lt5000">&lt;5,000</option>
            <option value="5000to10000">5,000-10,000</option>
            <option value="10000to20000">10,000-20,000</option>
            <option value="gt20000">&gt;20,000</option>
          </select>
        </div>
        <div style={{ marginBottom: '6px' }}>
          <select value={filters.fmt} onChange={e => setFilter('fmt', e.target.value)} style={selectStyle}>
            <option value="all">全部门店类型</option>
            {fmts.map(f => <option key={f} value={f}>{f} ({fmtCounts[f]})</option>)}
          </select>
        </div>
        <MultiSelect label="门店名称(多选)" items={storeNameItems} selected={filters.storeNames}
          onChange={v => setFilter('storeNames', v)} />
        <MultiSelect label="Store ID(多选)" items={storeIdItems} selected={filters.storeIds}
          onChange={v => setFilter('storeIds', v)} />
      </div>

      {/* 图层 */}
      <div style={{ marginBottom: '14px' }}>
        <SectionTitle>图层</SectionTitle>
        <ToggleItem label="门店点位" checked={layers.showMarkers} onChange={v => setLayer('showMarkers', v)} />
        <ToggleItem label="1km 覆盖圈" checked={layers.showCircles1km} onChange={v => setLayer('showCircles1km', v)} />
        <ToggleItem label="3km 覆盖圈" checked={layers.showCircles3km} onChange={v => setLayer('showCircles3km', v)} />
        <ToggleItem label="高亮重合区域" checked={layers.highlightOverlap} onChange={v => setLayer('highlightOverlap', v)} />
        <ToggleItem label="按销售额着色" checked={layers.colorByAds} onChange={v => setLayer('colorByAds', v)} />
        <ToggleItem label="配送范围对比" checked={layers.showDeliveryContour} onChange={v => setLayer('showDeliveryContour', v)} />
      </div>

      {/* 帮助按钮 */}
      <button onClick={() => setShowHelp(true)}
        style={{
          width: '100%', padding: '10px 16px', borderRadius: '8px',
          border: '1px solid #f97316', background: '#fff7ed', color: '#ea580c',
          fontSize: '13px', fontWeight: 600, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
          transition: 'all 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#ffedd5'; }}
        onMouseLeave={e => { e.currentTarget.style.background = '#fff7ed'; }}>
        <span style={{ fontSize: '16px' }}>?</span>
        <span>使用说明</span>
      </button>
    </div>
  );
}
