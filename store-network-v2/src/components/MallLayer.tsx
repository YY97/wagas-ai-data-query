import { useEffect, useMemo, useState } from 'react';
import { Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useAppStore } from '../store';
import type { MallIndexItem, MallDetail } from '../types';

// 商场统一用紫色，与门店(蓝绿橙红)/圈层(蓝绿)/高亮(红)区分
const MALL_COLOR = '#8b5cf6';

// 商场建筑 SVG 图标
function createMallIcon(): L.DivIcon {
  const size = 28;
  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 21V7L8 4V21" stroke="${MALL_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M8 21V4L16 8V21" stroke="${MALL_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M16 21V8L21 11V21" stroke="${MALL_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M3 21H21" stroke="${MALL_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M10 12H11" stroke="${MALL_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M10 16H11" stroke="${MALL_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M18 14H19" stroke="${MALL_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M18 18H19" stroke="${MALL_COLOR}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  return L.divIcon({
    className: '',
    html: `<div style="background:#fff;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.3);border:2px solid ${MALL_COLOR};">${svg}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

export default function MallLayer({ onSelectMall }: { onSelectMall: (mall: MallDetail) => void }) {
  const mallIndex = useAppStore(s => s.mallIndex);
  const map = useMap();
  const [loading, setLoading] = useState(false);

  // Load index on mount
  useEffect(() => {
    const { setMallIndex, mallIndex } = useAppStore.getState();
    if (mallIndex.length > 0) return;

    setLoading(true);
    fetch(`${import.meta.env.BASE_URL}data/malls/index.json`)
      .then(r => r.json())
      .then(data => {
        setMallIndex(data);
      })
      .catch(e => console.warn('Failed to load mall index:', e))
      .finally(() => setLoading(false));
  }, []);

  // Only show at zoom >= 12
  const zoom = map.getZoom();
  const [mapZoom, setMapZoom] = useState(zoom);
  useEffect(() => {
    const handler = () => setMapZoom(map.getZoom());
    map.on('zoomend', handler);
    return () => { map.off('zoomend', handler); };
  }, [map]);

  if (mapZoom < 12 || mallIndex.length === 0) return null;

  const handleClick = (mall: MallIndexItem) => {
    const safeName = `${mall.city}_${mall.name}`.replace(/[\\/:*?"<>|#]/g, '_');
    fetch(`${import.meta.env.BASE_URL}data/malls/${encodeURIComponent(safeName)}.json`)
      .then(r => r.json())
      .then(detail => onSelectMall(detail))
      .catch(console.warn);
  };

  return (
    <>
      {mallIndex.map(mall => {
        if (mall.lat == null || mall.lng == null) return null;
        return (
          <Marker
            key={`${mall.city}_${mall.name}`}
            position={[mall.lat, mall.lng]}
            icon={createMallIcon()}
            eventHandlers={{
              click: () => handleClick(mall),
              mouseover: (e) => { e.target.openPopup(); },
              mouseout: (e) => { e.target.closePopup(); },
            }}
          >
            <Popup>
              <div style={{ fontSize: '11px' }}>
                <div style={{ fontWeight: 700, marginBottom: '2px' }}>{mall.name}</div>
                {mall.type && <div style={{ color: MALL_COLOR, fontSize: 10, marginBottom: 2 }}>{mall.type}</div>}
                {mall.score != null && <div style={{ color: '#92400e' }}>综合评分: {mall.score}</div>}
                {mall.open_date && <div style={{ color: '#64748b', fontSize: 10 }}>开业: {mall.open_date}</div>}
                <div
                  style={{ marginTop: '4px', color: '#3b82f6', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => handleClick(mall)}
                >
                  查看详情 →
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}
