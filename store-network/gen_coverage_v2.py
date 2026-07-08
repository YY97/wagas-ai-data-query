import csv, json, re
import pandas as pd

ADS_FILE = r"D:/Files/桌面/FIN BI Store Data 2026-06-29 10_51_29.xlsx"
CSV_FILE = r"D:\SoftWare_Download\腾讯WorkBuddy\2026-06-01-16-32-22\output\stores_all.csv"
OUTPUT = r"D:\SoftWare_Download\腾讯WorkBuddy\2026-06-29-10-31-21\wagas_stores_coverage_v2.html"

# Read ADS data
df_ads = pd.read_excel(ADS_FILE)
ads_map = dict(zip(df_ads['门店'].str.strip(), df_ads['本期ADS']))

# Read store CSV
stores = []
with open(CSV_FILE, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        status = row.get('门店状态', '').strip()
        if status != '已开业':
            continue
        lng = row.get('经度', '').strip()
        lat = row.get('纬度', '').strip()
        if not lng or not lat:
            continue
        name = row['门店名称(中文)'].strip()
        stores.append({
            'name': name,
            'brand': row['品牌'],
            'city': row['城市(中文)'],
            'lng': float(lng),
            'lat': float(lat),
            'addr': row.get('门店地址(中文)', ''),
            'ads': ads_map.get(name)  # None if no match
        })

# Only keep stores with both coords and ADS
stores = [s for s in stores if s['ads'] is not None]

# Pre-compute neighbors within 1km
import math
R = 6371000
for i, s in enumerate(stores):
    neighbors = []
    lat1, lng1 = math.radians(s['lat']), math.radians(s['lng'])
    for j, t in enumerate(stores):
        if i == j: continue
        dlat = math.radians(t['lat']) - lat1
        dlng = math.radians(t['lng']) - lng1
        a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(math.radians(t['lat'])) * math.sin(dlng/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        if R * c <= 1000:
            neighbors.append({'name': t['name'], 'brand': t['brand'], 'ads': t['ads']})
    s['neighbors'] = neighbors

# Count match rate + overall avg
matched = sum(1 for s in stores if s['ads'] is not None)
ads_values = [s['ads'] for s in stores if s['ads'] is not None]
overall_avg_ads = sum(ads_values) / len(ads_values) if ads_values else 0
print(f"Stores with coords and open: {len(stores)}")
print(f"Matched with ADS: {matched}")
print(f"Overall avg ADS: ¥{overall_avg_ads:,.0f}")
print(f"Unmatched ADS stores: {len(ads_map) - matched}")

# ADS buckets
def bucket(ads):
    if ads is None: return 'none'
    if ads < 5000: return '<¥5,000'
    if ads < 10000: return '¥5,000-10,000'
    if ads < 20000: return '¥10,000-20,000'
    return '>¥20,000'

ADS_COLORS = {
    '<¥5,000': '#93c5fd',
    '¥5,000-10,000': '#86efac',
    '¥10,000-20,000': '#fdba74',
    '>¥20,000': '#fca5a5',
    'none': '#d1d5db'
}

BRAND_COLORS = {
    'Wagas': '#3b82f6',
    'Baker & Spice': '#f97316',
    'Lokal': '#22c55e',
    'Funk & Kale': '#ef4444',
    'Uno': '#a855f7',
    'Sodavand': '#06b6d4',
    'JUNi': '#ec4899'
}

brands = sorted(set(s['brand'] for s in stores))
cities = sorted(set(s['city'] for s in stores))

brand_options = ''.join(f'<option value="{b}">{b}</option>' for b in brands)
city_options = ''.join(f'<option value="{c}">{c}</option>' for c in cities)

# Stats
brand_counts = {}
for s in stores:
    brand_counts[s['brand']] = brand_counts.get(s['brand'], 0) + 1
stats_html = ''.join(
    f'<div class="stat-item" onclick="selectBrand(\'{b}\')" data-brand="{b}">'
    f'<div class="num" style="color:{BRAND_COLORS.get(b,"#6b7280")}">{c}</div>'
    f'<div class="label">{b}</div></div>'
    for b, c in brand_counts.items()
)

legend_brand = ''.join(
    f'<div class="legend-item"><div class="legend-color" style="background:{BRAND_COLORS.get(b,"#6b7280")}">'
    f'</div>{b}</div>' for b in brands
)

ads_buckets_count = {}
for s in stores:
    b = bucket(s['ads'])
    ads_buckets_count[b] = ads_buckets_count.get(b, 0) + 1
legend_ads = ''.join(
    f'<div class="legend-item"><div class="legend-color" style="background:{c}"></div>{b}'
    f'<span style="margin-left:4px;color:#6b7280">({ads_buckets_count[b]})</span></div>'
    for b, c in ADS_COLORS.items() if b != 'none'
)

ads_stats_html = ''.join(
    f'<div class="stat-item-ads"><div class="num" style="color:{c};font-size:13px">{ads_buckets_count[b]}</div>'
    f'<div class="label">{b}</div></div>'
    for b, c in ADS_COLORS.items() if b != 'none'
)

# Generate HTML
stores_json = json.dumps(stores, ensure_ascii=False)
ads_colors_json = json.dumps(ADS_COLORS, ensure_ascii=False)
brand_colors_json = json.dumps(BRAND_COLORS, ensure_ascii=False)

html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Wagas 已开业门店 · 1km 覆盖圈 · 店日均销售额</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
*{{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;}}
body{{background:#f0f2f5;}}
#map{{position:fixed;top:0;left:0;width:100%;height:100vh;z-index:1;}}
.panel{{position:fixed;top:16px;left:16px;z-index:1000;background:rgba(255,255,255,0.95);backdrop-filter:blur(10px);border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.12);padding:16px;min-width:270px;max-width:310px;max-height:90vh;overflow-y:auto;}}
.panel h2{{font-size:15px;font-weight:700;color:#1f2937;margin-bottom:12px;display:flex;align-items:center;gap:6px;}}
.panel h2 .dot{{width:8px;height:8px;border-radius:50%;background:#f97316;}}
.panel .subtitle{{font-size:11px;color:#6b7280;margin-bottom:12px;line-height:1.5;}}
.filter-group{{margin-bottom:10px;}}
.filter-group label{{display:block;font-size:11px;font-weight:600;color:#374151;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;}}
.filter-group select{{width:100%;padding:6px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;background:#fff;outline:none;cursor:pointer;}}
.filter-group select:focus{{border-color:#f97316;}}
.search-box{{display:flex;gap:6px;margin-bottom:10px;}}
.search-box input{{flex:1;padding:6px 8px;border:1px solid #e5e7eb;border-radius:6px;font-size:12px;outline:none;}}
.search-box button{{padding:6px 10px;background:#f97316;color:#fff;border:none;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;}}
.stats{{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px;}}
.stat-item{{background:#f8fafc;border-radius:6px;padding:6px 8px;text-align:center;cursor:pointer;transition:all 0.15s;border:2px solid transparent;}}
.stat-item:hover{{background:#fff7ed;}}
.stat-item.active{{border-color:#f97316;background:#fff7ed;}}
.stat-item .num{{font-size:16px;font-weight:700;color:#1f2937;}}
.stat-item .label{{font-size:10px;color:#6b7280;margin-top:2px;}}
.toggle-group{{margin-top:10px;padding-top:10px;border-top:1px solid #e5e7eb;}}
.toggle-item{{display:flex;align-items:center;justify-content:space-between;padding:4px 0;font-size:12px;color:#374151;}}
.toggle-item input[type="checkbox"]{{width:32px;height:18px;appearance:none;background:#d1d5db;border-radius:9px;position:relative;cursor:pointer;transition:0.2s;}}
.toggle-item input[type="checkbox"]:checked{{background:#f97316;}}
.toggle-item input[type="checkbox"]::after{{content:"";position:absolute;width:14px;height:14px;background:#fff;border-radius:50%;top:2px;left:2px;transition:0.2s;}}
.toggle-item input[type="checkbox"]:checked::after{{left:16px;}}
.ads-stats{{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb;}}
.stat-item-ads{{background:#f8fafc;border-radius:5px;padding:5px 6px;text-align:center;}}
.stat-item-ads .num{{font-weight:700;}}
.stat-item-ads .label{{font-size:10px;color:#6b7280;margin-top:1px;}}
.legend{{position:fixed;bottom:16px;right:16px;z-index:1000;background:rgba(255,255,255,0.95);backdrop-filter:blur(10px);border-radius:10px;padding:10px 14px;box-shadow:0 4px 20px rgba(0,0,0,0.12);font-size:11px;}}
.legend-item{{display:flex;align-items:center;gap:6px;margin:3px 0;}}
.legend-color{{width:10px;height:10px;border-radius:50%;flex-shrink:0;}}
.ads-info-row{{display:flex;align-items:center;gap:8px;margin-top:4px;padding:3px 6px;background:#fff7ed;border-radius:4px;font-size:11px;color:#c2410c;font-weight:600;}}
@keyframes pulse{{0%{{transform:scale(1);opacity:1;}}50%{{transform:scale(1.3);opacity:0.7;}}100%{{transform:scale(1);opacity:1;}}}}
</style>
</head>
<body>
<div id="map"></div>
<div class="panel">
  <h2><span class="dot"></span>Wagas 已开业门店分布</h2>
  <div class="subtitle">共 {len(stores)} 家已开业门店<br>门店日均销售额 ¥{overall_avg_ads:,.0f}<br>1km 覆盖圈</div>
  
  <div class="filter-group"><label>品牌</label><select id="brand-filter" onchange="applyFilter()">
    <option value="all">全部品牌</option>{brand_options}
  </select></div>
  <div class="filter-group"><label>城市</label><select id="city-filter" onchange="applyFilter()">
    <option value="all">全部城市</option>{city_options}
  </select></div>
  <div class="filter-group"><label>日均销售额</label><select id="ads-filter" onchange="applyFilter()">
    <option value="all">全部区间</option>
    <option value="<¥5,000">&lt;¥5,000（{ads_buckets_count.get('<¥5,000', 0)}家）</option>
    <option value="¥5,000-10,000">¥5,000-10,000（{ads_buckets_count.get('¥5,000-10,000', 0)}家）</option>
    <option value="¥10,000-20,000">¥10,000-20,000（{ads_buckets_count.get('¥10,000-20,000', 0)}家）</option>
    <option value=">¥20,000">&gt;¥20,000（{ads_buckets_count.get('>¥20,000', 0)}家）</option>
  </select></div>
  <div class="search-box">
    <input type="text" id="search-input" placeholder="搜索门店名称..." onkeyup="if(event.key==='Enter')applyFilter()">
    <button onclick="applyFilter()">搜索</button>
  </div>
  <div class="toggle-group">
    <div class="toggle-item"><span>显示 1km 覆盖圈</span><input type="checkbox" id="show-circles" checked onchange="applyFilter()"></div>
    <div class="toggle-item"><span>显示门店点位</span><input type="checkbox" id="show-markers" checked onchange="applyFilter()"></div>
    <div class="toggle-item"><span>高亮重叠区域</span><input type="checkbox" id="highlight-overlap" onchange="applyFilter()"></div>
    <div class="toggle-item"><span>按销售额着色</span><input type="checkbox" id="color-by-ads" onchange="applyFilter()"></div>
  </div>
  <div style="margin-top:8px;font-size:11px;color:#6b7280;line-height:1.5;">
    <b>颜色说明：</b><br>🔵 灰色 = 单个门店覆盖<br>🟠 橙色 = 多店重叠区域<br>颜色越橙 = 重合门店越多
  </div>
  <div class="stats">{stats_html}</div>
  
  <div class="ads-stats">{ads_stats_html}</div>
  <div style="font-size:10px;color:#9ca3af;margin-top:2px;">门店日均销售额 (¥)</div>
  
  <div style="margin-top:10px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:12px;color:#1f2937;">
    当前显示：<b id="filtered-count">全部品牌 · {len(stores)}家</b>
  </div>
</div>
<div class="legend" id="legend">{legend_brand}</div>
<script>
const BRAND_COLORS = {brand_colors_json};
const ADS_COLORS = {ads_colors_json};
const stores = {stores_json};

const map = L.map("map").setView([31.2304, 121.4737], 10);
L.tileLayer("https://webrd0{{s}}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={{x}}&y={{y}}&z={{z}}", {{subdomains:"1234",attribution:"高德底图"}}).addTo(map);

let markers = [];
let circles = [];

function getADSColor(ads) {{
  if (ads == null) return "#d1d5db";
  if (ads < 5000) return "#93c5fd";
  if (ads < 10000) return "#86efac";
  if (ads < 20000) return "#fdba74";
  return "#fca5a5";
}}

function formatMoney(val) {{
  if (val == null) return "无数据";
  return "¥" + Math.round(val).toLocaleString("zh-CN");
}}

function createPopup(s) {{
  const color = BRAND_COLORS[s.brand] || "#6b7280";
  let html = '<div style="font-family:sans-serif;min-width:240px;">';
  html += '<div style="font-size:13px;font-weight:700;color:' + color + ';margin-bottom:4px;">' + s.brand + '</div>';
  html += '<div style="font-size:14px;font-weight:600;color:#1f2937;margin-bottom:6px;">' + s.name + '</div>';
  html += '<div style="font-size:12px;color:#4b5563;line-height:1.6;">&#128205; ' + (s.addr || '') + '<br>&#127751; ' + s.city + '</div>';
  if (s.ads != null) {{
    const adsColor = getADSColor(s.ads);
    html += '<div style="margin-top:6px;padding:4px 8px;background:' + adsColor + '20;border-left:3px solid ' + adsColor + ';border-radius:3px;font-size:12px;font-weight:600;color:#1f2937;">' +
      '日均销售额: ' + formatMoney(s.ads) + '</div>';
  }}
  if (s.neighbors && s.neighbors.length > 0) {{
    html += '<div style="margin-top:6px;font-size:11px;color:#c2410c;font-weight:600;">1km内重合门店: ' + s.neighbors.length + '家</div>';
    html += '<div style="margin-top:3px;max-height:100px;overflow-y:auto;font-size:10px;color:#6b7280;line-height:1.6;">';
    s.neighbors.forEach(function(n) {{
      html += '<div style="padding:1px 0;">' + n.brand + ' · ' + n.name + ' (¥' + Math.round(n.ads).toLocaleString("zh-CN") + ')</div>';
    }});
    html += '</div>';
  }}
  html += '</div>';
  return html;
}}

const R = 6371000;
stores.forEach((s, i) => {{
  let overlap = 0;
  stores.forEach((t, j) => {{
    if (i === j) return;
    const dLat = (t.lat - s.lat) * Math.PI / 180;
    const dLng = (t.lng - s.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(s.lat * Math.PI/180) * Math.cos(t.lat * Math.PI/180) * Math.sin(dLng/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    if (R * c <= 1000) overlap++;
  }});
  s.overlap = overlap;
}});

function getOverlapColor(overlap) {{
  if (overlap >= 10) return {{ stroke: "#9a3412", fill: "#c2410c" }};
  if (overlap >= 5) return {{ stroke: "#c2410c", fill: "#ea580c" }};
  if (overlap >= 3) return {{ stroke: "#ea580c", fill: "#fb923c" }};
  if (overlap >= 1) return {{ stroke: "#f97316", fill: "#fdba74" }};
  return {{ stroke: "#94a3b8", fill: "#cbd5e1" }};
}}

function applyFilter() {{
  markers.forEach(m => map.removeLayer(m));
  circles.forEach(c => map.removeLayer(c));
  markers = [];
  circles = [];
  
  const brandF = document.getElementById("brand-filter").value;
  const cityF = document.getElementById("city-filter").value;
  const adsF = document.getElementById("ads-filter").value;
  const searchF = document.getElementById("search-input").value.trim().toLowerCase();
  const showCircles = document.getElementById("show-circles").checked;
  const showMarkers = document.getElementById("show-markers").checked;
  const highlightOverlap = document.getElementById("highlight-overlap").checked;
  const colorByAds = document.getElementById("color-by-ads").checked;

  // Update legend
  const legend = document.getElementById("legend");
  if (colorByAds) {{
    legend.innerHTML = '{legend_ads}';
  }} else {{
    legend.innerHTML = '{legend_brand}';
  }}

  let filtered = stores.filter(s => {{
    if (brandF !== "all" && s.brand !== brandF) return false;
    if (cityF !== "all" && s.city !== cityF) return false;
    if (searchF && !s.name.toLowerCase().includes(searchF)) return false;
    if (adsF !== "all") {{
      if (s.ads == null) return false;
      if (adsF === "<¥5,000" && s.ads >= 5000) return false;
      if (adsF === "¥5,000-10,000" && (s.ads < 5000 || s.ads >= 10000)) return false;
      if (adsF === "¥10,000-20,000" && (s.ads < 10000 || s.ads >= 20000)) return false;
      if (adsF === ">¥20,000" && s.ads < 20000) return false;
    }}
    return true;
  }});

  if (showCircles) {{
    filtered.forEach(s => {{
      const overlap = s.overlap || 0;
      const colors = getOverlapColor(overlap);
      const weight = overlap >= 3 ? 2 : 1;
      let opacity, fillOpacity;
      if (highlightOverlap) {{
        opacity = overlap >= 1 ? 0.4 : 0.05;
        fillOpacity = overlap >= 1 ? 0.3 : 0.02;
      }} else {{
        opacity = 0.1 + Math.min(overlap/8,1) * 0.3;
        fillOpacity = 0.08 + Math.min(overlap/8,1) * 0.22;
      }}
      const c = L.circle([s.lat, s.lng], {{ radius: 1000, color: colors.stroke, weight: weight, opacity: opacity, fillColor: colors.fill, fillOpacity: fillOpacity }});
      c.bindPopup(createPopup(s));
      c.addTo(map);
      circles.push(c);
    }});
  }}

  if (showMarkers) {{
    filtered.forEach(s => {{
      let color;
      if (colorByAds) {{
        color = getADSColor(s.ads);
      }} else {{
        color = BRAND_COLORS[s.brand] || "#6b7280";
      }}
      const overlap = s.overlap || 0;
      const isHigh = overlap >= 3;
      const size = isHigh ? 14 : 9;
      const weight = isHigh ? 3 : 2;
      const border = isHigh ? "#c2410c" : "white";
      const anim = isHigh ? "animation:pulse 1.5s infinite;" : "";
      const icon = L.divIcon({{ className: "custom-marker", html: '<div style="width:' + size + 'px;height:' + size + 'px;background:' + color + ';border:' + weight + 'px solid ' + border + ';border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.4);' + anim + '"></div>', iconSize: [size, size], iconAnchor: [size/2, size/2] }});
      const marker = L.marker([s.lat, s.lng], {{icon}}).bindPopup(createPopup(s));
      marker.addTo(map);
      markers.push(marker);
    }});
  }}

  const label = brandF === "all" ? "全部品牌 · " + filtered.length + "家" : brandF + " · " + filtered.length + "家";
  document.getElementById("filtered-count").textContent = label;
  document.querySelectorAll(".stat-item").forEach(el => el.classList.toggle("active", el.dataset.brand === brandF));
  if (filtered.length > 0 && (brandF !== "all" || cityF !== "all" || searchF)) {{
    const fg = L.featureGroup(markers.concat(circles));
    map.fitBounds(fg.getBounds().pad(0.15));
  }}
}}

function selectBrand(brand) {{
  document.getElementById("brand-filter").value = brand;
  applyFilter();
}}

applyFilter();
</script>
</body>
</html>'''

with open(OUTPUT, 'w', encoding='utf-8') as f:
    f.write(html)

print(f"\nGenerated: {OUTPUT}")
print(f"Stores: {len(stores)}, with ADS: {matched}")
print(f"ADS buckets: {json.dumps(ads_buckets_count, ensure_ascii=False)}")
