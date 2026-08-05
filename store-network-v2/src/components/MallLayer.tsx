import { useEffect, useMemo, useState } from 'react';
import { Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useAppStore } from '../store';
import type { MallIndexItem, MallDetail } from '../types';

// 商场统一用紫色，与门店(蓝绿橙红)/圈层(蓝绿)/高亮(红)区分
const MALL_COLOR = '#8b5cf6';

function createMallIcon(): L.DivIcon {
  const size = 24;
  const svg = `
    <svg width="${size}" height="${size * 1.3}" viewBox="0 0 24 31" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.373 0 0 5.373 0 12c0 7.2 12 19 12 19s12-11.8 12-19C24 5.373 18.627 0 12 0z" fill="${MALL_COLOR}" stroke="#fff" stroke-width="1.5"/>
      <circle cx="12" cy="10" r="4" fill="#fff" opacity="0.9"/>
      <text x="12" y="13" text-anchor="middle" font-size="7" font-weight="700" fill="${MALL_COLOR}">M</text>
    </svg>`;
  return L.divIcon({
    className: '',
    html: svg,
    iconSize: [size, size * 1.3],
    iconAnchor: [size / 2, size * 1.3],
    popupAnchor: [0, -(size * 1.3)],
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
