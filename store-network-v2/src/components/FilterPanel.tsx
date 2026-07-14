import { useAppStore } from '../store';
import * as Select from '@radix-ui/react-select';

export default function FilterPanel() {
  const { filters, setFilter, stores } = useAppStore();

  // 获取品牌和城市选项
  const brands = Array.from(new Set(stores.map(s => s.brand))).sort();
  const cities = Array.from(new Set(stores.map(s => s.city))).sort();

  return (
    <div style={{ padding: '16px' }}>
      <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
        筛选
      </h3>

      {/* 品牌筛选 */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
          品牌
        </label>
        <Select.Root value={filters.brand} onValueChange={(v) => setFilter('brand', v)}>
          <Select.Trigger style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            background: '#fff',
            fontSize: '14px'
          }}>
            <Select.Value />
          </Select.Trigger>
          <Select.Portal>
            <Select.Content style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              zIndex: 1000
            }}>
              <Select.Viewport>
                <Select.Item value="all" style={{ padding: '8px 12px', cursor: 'pointer' }}>
                  全部品牌
                </Select.Item>
                {brands.map(brand => (
                  <Select.Item key={brand} value={brand} style={{ padding: '8px 12px', cursor: 'pointer' }}>
                    {brand}
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>

      {/* 城市筛选 */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
          城市
        </label>
        <Select.Root value={filters.city} onValueChange={(v) => setFilter('city', v)}>
          <Select.Trigger style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            background: '#fff',
            fontSize: '14px'
          }}>
            <Select.Value />
          </Select.Trigger>
          <Select.Portal>
            <Select.Content style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              zIndex: 1000
            }}>
              <Select.Viewport>
                <Select.Item value="all" style={{ padding: '8px 12px', cursor: 'pointer' }}>
                  全部城市
                </Select.Item>
                {cities.map(city => (
                  <Select.Item key={city} value={city} style={{ padding: '8px 12px', cursor: 'pointer' }}>
                    {city}
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>

      {/* ADS 区间 */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px' }}>
          ADS 区间
        </label>
        <select
          value={filters.adsRange}
          onChange={(e) => setFilter('adsRange', e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            background: '#fff',
            fontSize: '14px'
          }}
        >
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
        <select
          value={filters.fmt}
          onChange={(e) => setFilter('fmt', e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            background: '#fff',
            fontSize: '14px'
          }}
        >
          <option value="all">全部门店类型</option>
        </select>
      </div>
    </div>
  );
}
