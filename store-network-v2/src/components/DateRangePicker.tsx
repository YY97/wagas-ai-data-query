import { useState } from 'react';
import { DayPicker, DateRange } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import { useAppStore } from '../store';

export default function DateRangePicker() {
  const { dateRange, setDateRange } = useAppStore();
  const [showPicker, setShowPicker] = useState(false);

  const handleDateChange = (range: DateRange | undefined) => {
    if (range?.from && range?.to) {
      setDateRange({
        start: range.from.toISOString().split('T')[0],
        end: range.to.toISOString().split('T')[0]
      });
      setShowPicker(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ display: 'block', fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>
        日期范围
      </label>
      <div
        onClick={() => setShowPicker(!showPicker)}
        style={{
          padding: '8px 12px',
          border: '1px solid #cbd5e1',
          borderRadius: '6px',
          background: '#fff',
          cursor: 'pointer',
          fontSize: '14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <span>
          {dateRange.start && dateRange.end
            ? `${formatDate(dateRange.start)} ~ ${formatDate(dateRange.end)}`
            : '选择日期范围'}
        </span>
        <span style={{ fontSize: '10px' }}>▼</span>
      </div>

      {showPicker && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          zIndex: 1000,
          marginTop: '4px',
          padding: '12px'
        }}>
          <DayPicker
            mode="range"
            selected={
              dateRange.start && dateRange.end
                ? { from: new Date(dateRange.start), to: new Date(dateRange.end) }
                : undefined
            }
            onSelect={handleDateChange}
            numberOfMonths={2}
            showOutsideDays
            styles={{
              months: { display: 'flex', gap: '16px' },
              month: { margin: 0 },
              nav: { position: 'relative' },
              head_cell: { color: '#64748b', fontSize: '12px', fontWeight: 600 },
              day: { fontSize: '13px' },
              day_selected: { background: '#3b82f6', color: '#fff' },
              day_range_middle: { background: '#dbeafe', color: '#1e40af' }
            }}
          />
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setShowPicker(false)}
              style={{
                padding: '6px 12px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                background: '#fff',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
