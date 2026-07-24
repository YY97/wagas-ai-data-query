import { useEffect, useRef, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Circle, CircleMarker, Marker, Polygon, Popup, Pane, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import { createPortal } from 'react-dom';
import { useAppStore } from '../store';
import StorePopupCard from './StorePopupCard';

// 地图点击处理组件
function MapClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function adsColor(v: number | null): string {
  if (v == null) return '#6b7280';
  if (v < 5000) return '#93c5fd';
  if (v < 10000) return '#86efac';
  if (v < 20000) return '#fdba74';
  return '#fca5a5';
}

const BRAND_COLORS: Record<string, string> = {
  'Wagas': '#e11d48', 'Baker&Spice': '#f59e0b', 'Baker & Spice': '#f59e0b',
  'Lokal': '#22c55e', 'JUNi': '#8b5cf6', 'Funk&Kale': '#06b6d4', 'Funk & Kale': '#06b6d4',
};
function brandColor(brand: string): string { return BRAND_COLORS[brand] || '#6b7280'; }

// 竞品品牌颜色
const COMPETITOR_COLORS: Record<string, string> = {
  '星巴克': '#00a862',
  '超级碗': '#8b5cf6',
  '赛百味': '#f5c518',
  'gaga鲜语': '#ec4899',
  '蓝蛙': '#2563eb',
  'Manner': '#92400e',
};
function competitorColor(brand: string): string { return COMPETITOR_COLORS[brand] || '#64748b'; }

// 生成水滴形指针图标
function createPinIcon(color: string, isSelected: boolean, isHighOverlap: boolean): L.DivIcon {
  const size = isSelected ? 32 : (isHighOverlap ? 28 : 24);
  const stroke = isSelected ? '#f97316' : (isHighOverlap ? '#c2410c' : '#fff');
  const strokeWidth = isSelected ? 3 : (isHighOverlap ? 2.5 : 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size * 1.3}" viewBox="0 0 ${size} ${size * 1.3}">
    <path d="M${size/2} ${size * 1.25} C${size/2} ${size * 1.25}, 0 ${size * 0.7}, 0 ${size * 0.45} A${size/2} ${size * 0.45} 0 1 1 ${size} ${size * 0.45} C${size} ${size * 0.7}, ${size/2} ${size * 1.25}, ${size/2} ${size * 1.25}Z"
      fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>
    <circle cx="${size/2}" cy="${size * 0.42}" r="${size * 0.18}" fill="#fff" opacity="0.9"/>
  </svg>`;
  return L.divIcon({
    className: 'store-pin-marker',
    html: svg,
    iconSize: [size, size * 1.3],
    iconAnchor: [size / 2, size * 1.25],
    popupAnchor: [0, -size * 0.8],
  });
}

function HeatmapLayer({ points }: { points: [number, number, number][] }) {
  const map = useMap();
  const heatRef = useRef<any>(null);
  useEffect(() => {
    if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; }
    if (points.length === 0) return;
    heatRef.current = (L as any).heatLayer(points, {
      radius: 25, blur: 15, maxZoom: 17,
      gradient: { 0.2: 'blue', 0.4: 'cyan', 0.6: 'lime', 0.8: 'yellow', 1.0: 'red' }
    }).addTo(map);
    return () => { if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; } };
  }, [points, map]);
  return null;
}

function TopLocationMarkers({ locations }: { locations: any[] }) {
  return (
    <>
      {locations.map(loc => (
        <Marker key={loc.rank} position={[loc.lat, loc.lng]}
          icon={L.divIcon({
            className: '', iconSize: [22, 22], iconAnchor: [11, 11],
            html: `<div style="width:22px;height:22px;border-radius:50%;background:#3b82f6;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3)">${loc.rank}</div>`
          })}
        />
      ))}
    </>
  );
}

function PopupFollow({ store, visible, onClose, showDelivery, onToggleDelivery }: any) {
  const map = useMap();
  const popupRef = useRef<L.Popup | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [renderKey, setRenderKey] = useState(0);

  useEffect(() => {
    if (!store || !visible) {
      if (popupRef.current) { map.closePopup(popupRef.current); popupRef.current = null; }
      containerRef.current = null;
      return;
    }
    if (!containerRef.current) {
      containerRef.current = document.createElement('div');
      containerRef.current.style.pointerEvents = 'auto';
    }
    if (!popupRef.current) {
      popupRef.current = L.popup({
        maxWidth: 320, closeButton: false, autoClose: false, closeOnClick: false,
        offset: [15, 0], className: 'store-popup-leaflet'
      }).setLatLng([store.lat, store.lng]).setContent(containerRef.current).openOn(map);
    } else {
      popupRef.current.setLatLng([store.lat, store.lng]);
    }
    setRenderKey(k => k + 1);
    return () => {
      if (popupRef.current) { map.closePopup(popupRef.current); popupRef.current = null; }
    };
  }, [store?.sid, visible, map]); // eslint-disable-line

  if (!store || !visible || !containerRef.current) return null;
  return createPortal(
    <StorePopupCard key={`${store.sid}-${renderKey}`} showHeatmap={showDelivery}
      onToggleHeatmap={onToggleDelivery} onClose={onClose} />,
    containerRef.current
  );
}

function AutoFitBounds({ stores }: { stores: any[] }) {
  const map = useMap();
  const prevKeyRef = useRef('');

  useEffect(() => {
    if (stores.length === 0) return;
    // 生成筛选结果的唯一标识，避免重复 fitBounds
    const key = stores.map(s => s.sid).sort().join(',');
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    const lngs = stores.map(s => s.lng);
    const lats = stores.map(s => s.lat);
    const bounds = L.latLngBounds(
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)]
    );
    // 单店时放大，多店时自适应
    if (stores.length === 1) {
      map.setView([stores[0].lat, stores[0].lng], 14, { animate: true });
    } else {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: true });
    }
  }, [stores, map]);

  return null;
}

export default function MapView() {
  const { stores, filters, layers, getAds, selectedStore, setSelectedStore, showHelp, setShowHelp, contourStores, setContourStores, competitors, competitorBrands } = useAppStore();
  const [deliveryData, setDeliveryData] = useState<Record<string, any>>({});
  const [showDelivery, setShowDelivery] = useState(false);
  const [popupVisible, setPopupVisible] = useState(true);

  // 配送轮廓颜色（最多 5 家）
  const CONTOUR_COLORS = ['#3b82f6', '#f97316', '#22c55e', '#a855f7', '#ec4899'];

  const loadCityDeliveryData = useCallback(async (city: string) => {
    if (deliveryData[city]) return;
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}data/delivery/${city}.json`);
      const data = await r.json();
      setDeliveryData(prev => ({ ...prev, [city]: data }));
    } catch (e) { console.error(e); }
  }, [deliveryData]);

  useEffect(() => {
    if (selectedStore) loadCityDeliveryData(selectedStore.city);
    if (filters.city !== 'all') loadCityDeliveryData(filters.city);
  }, [filters.city, selectedStore, loadCityDeliveryData]);

  const filteredStores = stores.filter(store => {
    if (filters.brand !== 'all' && store.brand !== filters.brand) return false;
    if (filters.city !== 'all' && store.city !== filters.city) return false;
    if (filters.fmt !== 'all' && store.fmt !== filters.fmt) return false;
    if (filters.adsRange !== 'all') {
      const ads = getAds(store.sid) ?? 0;
      if (filters.adsRange === 'lt5000' && ads >= 5000) return false;
      if (filters.adsRange === '5000to10000' && (ads < 5000 || ads >= 10000)) return false;
      if (filters.adsRange === '10000to20000' && (ads < 10000 || ads >= 20000)) return false;
      if (filters.adsRange === 'gt20000' && ads < 20000) return false;
    }
    if (filters.storeNames.length > 0 && !filters.storeNames.includes(store.sid)) return false;
    if (filters.storeIds.length > 0 && !filters.storeIds.includes(store.sid)) return false;
    return true;
  });

  // 热力图数据
  const heatPoints: [number, number, number][] = [];
  if (showDelivery && selectedStore) {
    const pts = deliveryData[selectedStore.city]?.[selectedStore.sid];
    if (Array.isArray(pts) && pts.length > 0) {
      const maxW = Math.max(...pts.map((p: any) => p.w || 1));
      pts.forEach((p: any) => heatPoints.push([p.lat, p.lng, (p.w || 1) / maxW]));
    }
  }

  // TOP10 标记 - 使用 top_locations 数据（包含坐标）
  const topLocMarkers: any[] = [];
  if (showDelivery && selectedStore?.top_locations) {
    topLocMarkers.push(...selectedStore.top_locations.slice(0, 10));
  }

  const deliveryCount = showDelivery && selectedStore ? (deliveryData[selectedStore.city]?.[selectedStore.sid]?.length || 0) : 0;

  const handleStoreClick = (store: any) => {
    setSelectedStore(store);
    setPopupVisible(true);
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}
      className={layers.competitorFocus ? 'competitor-focus' : ''}>
      <MapContainer center={[31.2304, 121.4737]} zoom={10} maxZoom={18} style={{ width: '100%', height: '100%' }}>
        <TileLayer
          url="https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}"
          subdomains={['1','2','3','4']}
          attribution="高德底图"
        />

        <AutoFitBounds stores={filteredStores} />

        {(layers.showCircles1km || !layers.showMarkers) && filteredStores.map(s => (
          <Circle key={`c1-${s.sid}`} center={[s.lat, s.lng]} radius={1000} interactive={false}
            pathOptions={{ color: s.overlap >= 3 ? '#dc2626' : '#3b82f6', weight: (s.overlap >= 3 && layers.highlightOverlap) ? 2 : 1,
              fillColor: s.overlap >= 3 ? '#dc2626' : '#3b82f6', fillOpacity: 0.06 }} />
        ))}

        {layers.showCircles3km && filteredStores.map(s => (
          <Circle key={`c3-${s.sid}`} center={[s.lat, s.lng]} radius={3000} interactive={false}
            pathOptions={{ color: '#22c55e', weight: 1, fillColor: '#22c55e', fillOpacity: 0.04, dashArray: '6,4' }} />
        ))}

        {layers.showMarkers && filteredStores.map(s => {
          const isSel = selectedStore?.sid === s.sid;
          const isContourSel = contourStores.includes(s.sid);
          const color = isSel ? '#f97316' : (isContourSel ? CONTOUR_COLORS[contourStores.indexOf(s.sid) % 5] : (layers.colorByAds ? adsColor(getAds(s.sid)) : brandColor(s.brand)));
          const hi = s.overlap >= 3;
          return (
            <Marker key={s.sid} position={[s.lat, s.lng]}
              icon={createPinIcon(color, isSel || isContourSel, hi)}
              eventHandlers={{ click: () => handleStoreClick(s) }} />
          );
        })}

        {/* 竞品门店（置顶图层，大圆点+白边，按品牌着色） */}
        {layers.showCompetitors && (
          <Pane name="competitor-pane" style={{ zIndex: 650 }}>
            {Object.entries(competitors).map(([brand, list]) => {
              if (!competitorBrands[brand]) return null;
              const color = competitorColor(brand);
              const cityFilter = filters.city;
              return list
                .filter(c => cityFilter === 'all' || c.city === cityFilter)
                .map((c, i) => (
                  <CircleMarker key={`${brand}-${i}`} center={[c.lat, c.lng]} radius={7}
                    pathOptions={{ color: '#ffffff', weight: 2, fillColor: color, fillOpacity: 0.95 }}>
                    <Popup>
                      <div style={{ fontSize: '12px', lineHeight: 1.6, minWidth: '140px' }}>
                        <div style={{ fontWeight: 700, color }}>{brand}</div>
                        <div style={{ color: '#1e293b' }}>{c.name}</div>
                        {c.addr && <div style={{ color: '#64748b' }}>{c.district} {c.addr}</div>}
                        {c.rating && <div style={{ color: '#f59e0b' }}>★ 评分 {c.rating}</div>}
                      </div>
                    </Popup>
                  </CircleMarker>
                ));
            })}
          </Pane>
        )}

        {/* 选址模式：点击地图显示评分报告（不在地图上渲染额外标记） */}
        {layers.siteSelectionMode && (
          <MapClickHandler onClick={(lat: number, lng: number) => {
            const handler = (window as any).onSiteSelectionClick;
            if (handler) {
              handler(lat, lng);
            }
          }} />
        )}

        {/* 配送轮廓多边形 */}
        {layers.showDeliveryContour && contourStores.map((sid, idx) => {
          const store = stores.find(s => s.sid === sid);
          if (!store || !store.delivery_contour || store.delivery_contour.length === 0) return null;
          const color = CONTOUR_COLORS[idx % 4];
          return (
            <Polygon key={`contour-${sid}`} positions={store.delivery_contour}
              pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.15, interactive: false }} />
          );
        })}

        {heatPoints.length > 0 && <HeatmapLayer points={heatPoints} />}
        {topLocMarkers.length > 0 && <TopLocationMarkers locations={topLocMarkers} />}

        <PopupFollow store={selectedStore} visible={popupVisible}
          onClose={() => setPopupVisible(false)} showDelivery={showDelivery}
          onToggleDelivery={() => {
            if (!showDelivery && selectedStore) loadCityDeliveryData(selectedStore.city);
            setShowDelivery(!showDelivery);
          }} />
      </MapContainer>

      {/* 图例 */}
      <div style={{ position: 'absolute', bottom: '40px', left: '10px', zIndex: 999,
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px',
        padding: '10px 12px', fontSize: '10px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        {/* 门店标记说明 */}
        <div style={{ fontWeight: 600, color: '#475569', marginBottom: '4px' }}>门店标记</div>
        <div style={{ display:'flex',alignItems:'center',gap:'5px',padding:'1px 0',color:'#64748b',marginBottom:'6px' }}>
          <svg width="12" height="16" viewBox="0 0 24 32" style={{ flexShrink: 0 }}>
            <path d="M12 30 C12 30, 0 22, 0 14 A12 14 0 1 1 24 14 C24 22, 12 30, 12 30Z" fill="#f97316" stroke="#fff" strokeWidth="2"/>
            <circle cx="12" cy="13" r="4" fill="#fff" opacity="0.9"/>
          </svg>
          <span>门店位置（颜色见下方说明）</span>
        </div>

        {showDelivery && selectedStore ? (
          <>
            <div style={{ fontWeight: 600, color: '#475569', marginBottom: '4px', marginTop: '4px' }}>配送距离</div>
            {[{c:'#ef4444',l:'≤1km'},{c:'#f97316',l:'1-2km'},{c:'#eab308',l:'2-3km'},{c:'#3b82f6',l:'3-5km'},{c:'#94a3b8',l:'>5km'}].map(i => (
              <div key={i.l} style={{ display:'flex',alignItems:'center',gap:'5px',padding:'1px 0',color:'#64748b' }}>
                <span style={{ width:'10px',height:'10px',borderRadius:'50%',background:i.c,flexShrink:0 }} />{i.l}
              </div>
            ))}
          </>
        ) : layers.colorByAds ? (
          <>
            <div style={{ fontWeight: 600, color: '#475569', marginBottom: '4px', marginTop: '4px' }}>按日均销售额</div>
            {[{c:'#93c5fd',l:'<5K'},{c:'#86efac',l:'5-10K'},{c:'#fdba74',l:'10-20K'},{c:'#fca5a5',l:'>20K'}].map(i => (
              <div key={i.l} style={{ display:'flex',alignItems:'center',gap:'5px',padding:'1px 0',color:'#64748b' }}>
                <span style={{ width:'10px',height:'10px',borderRadius:'3px',background:i.c,flexShrink:0 }} />{i.l}
              </div>
            ))}
          </>
        ) : (
          <>
            <div style={{ fontWeight: 600, color: '#475569', marginBottom: '4px', marginTop: '4px' }}>按品牌</div>
            {[{c:'#e11d48',l:'Wagas'},{c:'#f59e0b',l:'B&S'},{c:'#22c55e',l:'Lokal'},{c:'#8b5cf6',l:'JUNi'},{c:'#06b6d4',l:'F&K'}].map(i => (
              <div key={i.l} style={{ display:'flex',alignItems:'center',gap:'5px',padding:'1px 0',color:'#64748b' }}>
                <span style={{ width:'10px',height:'10px',borderRadius:'3px',background:i.c,flexShrink:0 }} />{i.l}
              </div>
            ))}
          </>
        )}
      </div>

      {showDelivery && selectedStore && deliveryCount > 0 && (
        <div style={{ position:'absolute',top:'12px',right:'12px',zIndex:999,
          background:'rgba(255,255,255,0.95)',color:'#1e293b',padding:'8px 14px',borderRadius:'8px',fontSize:'12px',
          boxShadow:'0 2px 10px rgba(0,0,0,0.1)',border:'1px solid #e2e8f0' }}>
          <span style={{ fontWeight:700,color:'#f97316' }}>{deliveryCount}</span> 个配送地址 &middot; 再次点击关闭
        </div>
      )}

      {/* 配送轮廓选择提示 */}
      {layers.showDeliveryContour && contourStores.length > 0 && (
        <div style={{ position:'absolute',top:'12px',right:'12px',zIndex:999,
          background:'rgba(255,255,255,0.95)',color:'#1e293b',padding:'8px 14px',borderRadius:'8px',fontSize:'12px',
          boxShadow:'0 2px 10px rgba(0,0,0,0.1)',border:'1px solid #e2e8f0',display:'flex',alignItems:'center',gap:'8px' }}>
          <span>已选 <span style={{ fontWeight:700,color:'#f97316' }}>{contourStores.length}</span>/5 家门店</span>
          <button onClick={() => setContourStores(() => [])}
            style={{ background:'#ef4444',color:'#fff',border:'none',borderRadius:'4px',padding:'2px 8px',fontSize:'11px',cursor:'pointer' }}>
            清除
          </button>
        </div>
      )}

      {/* 帮助面板 */}
      {showHelp && (
        <div style={{ position:'absolute',top:0,left:0,right:0,bottom:0,zIndex:1000,
          background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center' }}
          onClick={() => setShowHelp(false)}>
          <div style={{ background:'#fff',borderRadius:'12px',padding:'24px',maxWidth:'560px',width:'90%',
            maxHeight:'80vh',overflowY:'auto',boxShadow:'0 8px 32px rgba(0,0,0,0.2)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px' }}>
              <h2 style={{ margin:0,fontSize:'18px',color:'#0f172a' }}>Wagas 门店经营地图 - 使用说明</h2>
              <button onClick={() => setShowHelp(false)}
                style={{ background:'none',border:'none',fontSize:'20px',cursor:'pointer',color:'#64748b' }}>×</button>
            </div>

            <div style={{ fontSize:'13px',color:'#334155',lineHeight:1.6 }}>
              <Section title="🗺️ 快速上手">
                <ul style={{ margin:'4px 0',paddingLeft:'20px' }}>
                  <li>点击地图上的门店标记，查看经营详情</li>
                  <li>左侧面板可筛选品牌、城市、ADS 区间等</li>
                  <li>图层开关控制地图显示内容</li>
                </ul>
              </Section>

              <Section title=" 数据说明">
                <table style={{ width:'100%',borderCollapse:'collapse',fontSize:'12px' }}>
                  <tbody>
                    <DataRow label="销售数据" value="每日 7:00 / 8:00 自动更新" />
                    <DataRow label="外卖配送热力图" value="每日更新，展示近 30 天数据" />
                    <DataRow label="热门配送地" value="每月 1 日更新" />
                    <DataRow label="商圈环境" value="每季度（1/4/7/10 月）1 日更新" />
                    <DataRow label="门店总数" value="361 家（已排除 112 家云厨子店）" />
                    <DataRow label="数据延迟" value="BI 数据通常 10:00 后就绪" />
                  </tbody>
                </table>
              </Section>

              <Section title="🔵 配送范围对比">
                <p style={{ margin:'4px 0' }}>用于分析多家门店的配送范围重叠（蚕食）情况：</p>
                <ol style={{ margin:'4px 0',paddingLeft:'20px' }}>
                  <li>左侧 <b>配送范围对比</b> 开关默认开启</li>
                  <li>点击门店打开详情，点击 <b>＋ 加入配送范围对比</b></li>
                  <li>最多选 5 家，每家显示不同颜色的配送轮廓</li>
                  <li>轮廓重叠区域 = 潜在蚕食区域</li>
                  <li>再次点击按钮可取消选中</li>
                </ol>
                <p style={{ margin:'4px 0',fontSize:'11px',color:'#64748b' }}>
                  注：轮廓基于 70% 订单的配送范围，已排除 95 分位距离外的异常订单
                </p>
              </Section>

              <Section title="🔥 外卖热力图">
                <ol style={{ margin:'4px 0',paddingLeft:'20px' }}>
                  <li>点击门店打开详情弹窗</li>
                  <li>点击弹窗中的 <b>外卖热力图</b> 按钮</li>
                  <li>地图显示该店的配送点分布</li>
                  <li>颜色越红 = 订单越密集</li>
                </ol>
              </Section>

              <Section title="📍 图层说明">
                <table style={{ width:'100%',borderCollapse:'collapse',fontSize:'12px' }}>
                  <tbody>
                    <DataRow label="门店点位" value="显示/隐藏所有门店标记" />
                    <DataRow label="1km 覆盖圈" value="以门店为圆心的 1km 范围" />
                    <DataRow label="3km 覆盖圈" value="以门店为圆心的 3km 范围" />
                    <DataRow label="高亮重合区域" value="1km 内有 3 家以上门店时标红" />
                    <DataRow label="按销售额着色" value="门店颜色反映日均销售额" />
                    <DataRow label="配送范围对比" value="开启后可多选门店对比配送轮廓" />
                    <DataRow label="竞品门店" value="显示星巴克/蓝蛙/Manner等6个竞品位置，可开焦点模式突出显示" />
                    <DataRow label="选址模式" value="启用后点击地图任意位置，左侧显示选址评分报告" />
                  </tbody>
                </table>
              </Section>

              <Section title=" 选址评分">
                <p style={{ margin:'4px 0' }}>用于评估候选点位的外卖经营潜力：</p>
                <ol style={{ margin:'4px 0',paddingLeft:'20px' }}>
                  <li>左侧面板底部打开 <b>选址模式</b> → <b>启用选址分析</b></li>
                  <li>点击地图任意位置，左侧显示评分报告</li>
                  <li>报告包含 4 个维度（满分 85 或 100 分）</li>
                </ol>
                
                <table style={{ width:'100%',borderCollapse:'collapse',fontSize:'11px',marginTop:'8px' }}>
                  <tbody>
                    <DataRow label="外卖需求潜力" value="0-45 分 | 基于写字楼/住宅数量" />
                    <DataRow label="蚕食风险" value="0-20 分 | 0 家覆盖=20 分，每多 1 家-5 分" />
                    <DataRow label="竞品环境" value="0-20 分 | 钟形曲线，6-15 家最佳" />
                    <DataRow label="美团验证" value="0-15 分 | 加分项，有报告才加分" />
                  </tbody>
                </table>
                
                <p style={{ margin:'8px 0 4px',fontSize:'11px',color:'#64748b' }}>
                  💡 得分率 ≥80% 优秀 | ≥65% 良好 | ≥50% 中等 | &lt;50% 较低
                </p>
              </Section>

              <Section title="❓ 常见问题">
                <Qa q="为什么有些门店看不到？" a="地图已过滤 112 家云厨子店（是否子店=是），只显示 361 家常规门店。" />
                <Qa q="ADS 是什么意思？" a="ADS = Average Daily Sales，日均销售额。按选定日期区间计算。" />
                <Qa q="为什么数据不是今天的？" a="销售数据每日 7:00/8:00 更新，但 BI 源数据通常 10:00 后才就绪，所以实际看到的是前天的数据。" />
                <Qa q="如何对比两家店的蚕食情况？" a="点击门店打开详情，点击'＋ 加入配送范围对比'按钮，选择 2-5 家门店后查看轮廓重叠区域。" />
                <Qa q="竞品门店数据从哪来？多久更新？" a="竞品位置来自高德地图 POI 数据，覆盖星巴克/超级碗/赛百味/gaga鲜语/蓝蛙/Manner 共6个品牌，每月 1 号更新。点开任意门店弹窗可看到 1km 内各品牌竞品数量和评分中位数。觉得竞品标记不够醒目时，可开启'焦点模式'把底图置灰。" />
                <Qa q="热门配送地的名称显示'未知'？" a="部分配送坐标无法逆地理编码到具体地点名称，已尽量用地址兜底，极少数仍显示未知。" />
              </Section>

              <div style={{ marginTop:'16px',paddingTop:'12px',borderTop:'1px solid #e2e8f0',fontSize:'11px',color:'#94a3b8',textAlign:'center' }}>
                Wagas 门店经营地图 v2 · 最后更新：{new Date().toLocaleDateString('zh-CN')}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 帮助面板子组件
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '6px', fontSize: '14px' }}>{title}</div>
      {children}
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
      <td style={{ padding: '4px 8px 4px 0', color: '#64748b', whiteSpace: 'nowrap' }}>{label}</td>
      <td style={{ padding: '4px 0', color: '#1e293b' }}>{value}</td>
    </tr>
  );
}

function Qa({ q, a }: { q: string; a: string }) {
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '12px' }}>{q}</div>
      <div style={{ color: '#475569', fontSize: '12px', marginTop: '2px' }}>{a}</div>
    </div>
  );
}
