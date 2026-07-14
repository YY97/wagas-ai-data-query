import { useAppStore } from '../store';
import DateRangePicker from './DateRangePicker';

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid #cbd5e1',
  borderRadius: '6px',
  background: '#fff',
  fontSize: '14px'
};

export default function FilterPanel() {
  const { filters, setFilter, stores } = useAppStore();

  const brands = Array.from(new Set(stores.map(s => s.brand))).sort();
  const cities = Array.from(new Set(stores.map(s => s.city))).sort();
  const fmts = Array.from(new Set(stores.map(s => s.fmt).filter(Boolean))).sort();

  return (
    <div className="filter-panel" style={{ padding: '16px' }}>
      <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
        筛选
      </h3>

      {/* 日期范围 */}
      <div style={{ marginBottom: '16px' }}>
        <DateRangePicker />
      </div>

      {/* 品牌筛选 */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
          品牌
        </label>
        <select value={filters.brand} onChange={(e) => setFilter('brand', e.target.value)} style={selectStyle}>
          <option value="all">全部品牌</option>
          {brands.map(brand => (
            <option key={brand} value={brand}>{brand}</option>
          ))}
        </select>
      </div>

      {/* 城市筛选 */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
          城市
        </label>
        <select value={filters.city} onChange={(e) => setFilter('city', e.target.value)} style={selectStyle}>
          <option value="all">全部城市</option>
          {cities.map(city => (
            <option key={city} value={city}>{city}</option>
          ))}
        </select>
      </div>

      {/* ADS 区间 */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
          ADS 区间
        </label>
        <select value={filters.adsRange} onChange={(e) => setFilter('adsRange', e.target.value)} style={selectStyle}>
          <option value="all">全部 ADS 区间</option>
          <option value="lt5000">&lt;5,000</option>
          <option value="5000to10000">5,000-10,000</option>
          <option value="10000to20000">10,000-20,000</option>
          <option value="gt20000">&gt;20,000</option>
        </select>
      </div>

      {/* 门店类型 */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
          门店类型
        </label>
        <select value={filters.fmt} onChange={(e) => setFilter('fmt', e.target.value)} style={selectStyle}>
          <option value="all">全部门店类型</option>
          {fmts.map(fmt => (
            <option key={fmt} value={fmt}>{fmt}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
