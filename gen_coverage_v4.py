#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Wagas 门店网络效率 V4 — 融合版地图生成
融合: 日期选择器(销售数据) + 外卖热力图(配送点数据)
输出: wagas_stores_coverage_v4.html + output/delivery_points_compact.json
"""

import csv, json, math, os, sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SM_CSV = os.path.join(SCRIPT_DIR, "output", "store_master.csv")
ADS_CSV = os.path.join(SCRIPT_DIR, "output", "store_daily_sales.csv")
CHS_CSV = os.path.join(SCRIPT_DIR, "output", "store_channel_sales.csv")
DLV_JSON = os.path.join(SCRIPT_DIR, "output", "delivery_points.json")
DLV_OUT = os.path.join(SCRIPT_DIR, "output", "delivery_points_compact.json")
MKT_CSV = os.path.join(SCRIPT_DIR, "output", "store_market_context.csv")
OUTPUT_HTML = os.path.join(SCRIPT_DIR, "wagas_stores_coverage_v4.html")

R = 6371000
MAP_CENTER = (31.2304, 121.4737)


def hd(a, b, c, d):
    r1, r2 = math.radians(a), math.radians(c)
    da, db = math.radians(c - a), math.radians(d - b)
    a = math.sin(da / 2) ** 2 + math.cos(r1) * math.cos(r2) * math.sin(db / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)) / 1000


def adc(v):
    if v is None: return "#6b7280"
    if v < 5000: return "#93c5fd"
    if v < 10000: return "#86efac"
    if v < 20000: return "#fdba74"
    return "#fca5a5"


def adb(v):
    if v is None: return "N/A"
    if v < 5000: return "<5K"
    if v < 10000: return "5-10K"
    if v < 20000: return "10-20K"
    return ">20K"


def fmt(n):
    return "¥" + '{:,}'.format(int(n)) if n else "N/A"


# ============================================================
# 1. 读取门店主数据
# ============================================================
print("1. 门店主数据:", SM_CSV)
sm = {}
if not os.path.exists(SM_CSV):
    print("   [WARN] store_master.csv 不存在，请先运行 etl_pull_data.py")
    sys.exit(0)
with open(SM_CSV, "r", encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        sid = r.get("Store_ID", "").strip()
        if not sid: continue
        try:
            lng, lat = float(r.get("经度", 0) or 0), float(r.get("纬度", 0) or 0)
        except (ValueError, TypeError):
            continue
        if lng == 0 or lat == 0: continue
        sm[sid] = {"sid": sid, "name": r.get("门店名称", ""), "brand": r.get("品牌", ""),
                   "city": r.get("城市", ""), "addr": r.get("门店地址", ""), "fmt": r.get("业态", ""),
                   "lng": lng, "lat": lat}
print(f"   有效门店: {len(sm)}")

# ============================================================
# 2. 读取日销售(全量日期)
# ============================================================
print("2. 日销售:", ADS_CSV)
store_ads = {}  # {sid: {date: sales}}
all_dates = set()
if not os.path.exists(ADS_CSV):
    print("   [WARN] store_daily_sales.csv 不存在，使用空销售数据")
else:
    with open(ADS_CSV, "r", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            sid = r.get("门店ID", "").strip()
            od = r.get("营业日期", "").strip()
            ds = float(r.get("当日销售额", 0) or 0)
            if sid and od:
                store_ads.setdefault(sid, {})[od] = ds
                all_dates.add(od)

# 只保留最近 N 个自然日
from datetime import datetime, timedelta
LOOKBACK_DAYS = 30
sorted_dates = sorted(all_dates)
if sorted_dates:
    # 以最新数据日期为终点，往前推 30 个自然日
    latest = datetime.strptime(sorted_dates[-1], "%Y-%m-%d")
    start_dt = latest - timedelta(days=LOOKBACK_DAYS - 1)
    start_date = start_dt.strftime("%Y-%m-%d")
    # 生成完整的 30 天日期序列
    expected_dates = set()
    d = start_dt
    while d <= latest:
        expected_dates.add(d.strftime("%Y-%m-%d"))
        d += timedelta(days=1)
    # 检测缺失日期
    missing = sorted(expected_dates - all_dates)
    if missing:
        print(f"   [WARN] 30天内缺少 {len(missing)} 天数据: {', '.join(missing[:10])}" + (" ..." if len(missing) > 10 else ""))
    else:
        print(f"   30天数据完整，无缺失")
    # 过滤：只保留窗口内的数据
    trimmed = 0
    for sid in list(store_ads.keys()):
        store_ads[sid] = {d: v for d, v in store_ads[sid].items() if start_date <= d <= sorted_dates[-1]}
        if not store_ads[sid]:
            del store_ads[sid]
            trimmed += 1
    recent_dates = sorted(expected_dates & all_dates)
    print(f"   全量: {len(sorted_dates)} 天 -> 自然日窗口: {start_date}~{sorted_dates[-1]} ({len(recent_dates)}/{LOOKBACK_DAYS} 天有数据)")
else:
    recent_dates = []
    start_date = ""
    print(f"   无销售数据")

sorted_dates = sorted(recent_dates, reverse=True)
default_date = sorted_dates[0] if sorted_dates else ""
print(f"   日期范围: {sorted_dates[-1]}~{sorted_dates[0]}, {len(sorted_dates)}天")

# ============================================================
# 3. 读取外卖配送点 (已聚合, 供热力图)
# ============================================================
print("3. 外卖配送点:", DLV_JSON)
if not os.path.exists(DLV_JSON):
    print("   [WARN] 文件不存在，使用空配送点数据")
    delivery_data = {}
else:
    with open(DLV_JSON, "r", encoding="utf-8") as f:
        delivery_data = json.load(f)
dlv_stores = len(delivery_data)
dlv_points = sum(len(v) for v in delivery_data.values())

# 输出压缩版 (紧凑 JSON, 浏览器用)
with open(DLV_OUT, "w", encoding="utf-8") as f:
    json.dump(delivery_data, f, ensure_ascii=False, separators=(",", ":"))
dlv_size = os.path.getsize(DLV_OUT) / 1024
print(f"   门店: {dlv_stores}, 唯一点: {dlv_points}, 压缩: {dlv_size:.0f}KB")

# ============================================================
# 3b. 读取渠道销售拆分 (店内/外卖)
# ============================================================
CHS_CSV_PATH = CHS_CSV
print("3b. 渠道销售:", CHS_CSV_PATH)
store_channel = {}  # {sid: {date: {"dine_in": rev, "delivery": rev, "dine_in_orders": n, "delivery_orders": n}}}
if not os.path.exists(CHS_CSV_PATH):
    print("   [WARN] store_channel_sales.csv 不存在，跳过渠道拆分")
else:
    with open(CHS_CSV_PATH, "r", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            sid = r.get("门店ID", "").strip()
            od = r.get("营业日期", "").strip()
            ch = r.get("渠道", "").strip()
            rev = float(r.get("渠道销售额", 0) or 0)
            orders = int(r.get("渠道订单量", 0) or 0)
            if sid and od:
                if sid not in store_channel:
                    store_channel[sid] = {}
                if od not in store_channel[sid]:
                    store_channel[sid][od] = {"dine_in": 0, "delivery": 0, "dine_in_orders": 0, "delivery_orders": 0}
                if ch == "店内":
                    store_channel[sid][od]["dine_in"] += rev
                    store_channel[sid][od]["dine_in_orders"] += orders
                elif ch == "外卖":
                    store_channel[sid][od]["delivery"] += rev
                    store_channel[sid][od]["delivery_orders"] += orders
    print(f"   门店: {len(store_channel)}, 日期覆盖: {len(set(d for s in store_channel.values() for d in s))} 天")

# ============================================================
# 3c. 读取商圈环境数据 (高德 POI)
# ============================================================
print("3c. 商圈环境:", MKT_CSV)
store_market = {}
if not os.path.exists(MKT_CSV):
    print("   [WARN] store_market_context.csv 不存在，跳过商圈数据")
else:
    with open(MKT_CSV, "r", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            sid = r.get("门店ID", "").strip()
            if sid:
                store_market[sid] = {
                    "poi_count": int(r.get("poi_count", 0) or 0),
                    "avg_cost": float(r.get("avg_cost", 0) or 0) or None,
                    "median_cost": float(r.get("median_cost", 0) or 0) or None,
                    "avg_rating": float(r.get("avg_rating", 0) or 0) or None,
                    "top_categories": r.get("top_categories", ""),
                    "business_area": r.get("business_area", "")
                }
    print(f"   门店: {len(store_market)}")

# ============================================================
# 4. 合并门店 + 销售 → 地图门店列表
# ============================================================
stores = []
for sid, s in sm.items():
    if sid not in store_ads: continue
    s["ads_data"] = store_ads[sid]
    s["ads"] = s["ads_data"].get(default_date)
    s["market"] = store_market.get(sid)
    stores.append(s)

print(f"   地图门店: {len(stores)}")

# 空数据保护：上游 ETL 可能拉不到数据，此时优雅退出而非崩溃
if len(stores) == 0:
    print("\n[WARN] 地图门店数为 0，跳过地图生成。")
    print("   请检查上游 ETL (etl_pull_data.py) 是否正常拉取到 store_master.csv 和 store_daily_sales.csv")
    # 如果旧 HTML 存在就保留，不覆盖
    if os.path.exists(OUTPUT_HTML):
        print(f"   保留上一次地图: {OUTPUT_HTML}")
    sys.exit(0)

# overlap 计算
print("   计算 1km 重合...")
for i, s1 in enumerate(stores):
    nb = []
    for j, s2 in enumerate(stores):
        if i == j: continue
        if hd(s1["lat"], s1["lng"], s2["lat"], s2["lng"]) <= 1.0:
            nb.append(s2["name"])
    s1["overlap"] = len(nb)
    s1["overlap_names"] = nb

# 渠道汇总 + 配送距离分布
print("   计算渠道拆分 + 配送距离...")
for s in stores:
    sid = s["sid"]
    # 渠道汇总（日期窗口内）
    ch_data = store_channel.get(sid, {})
    dine_in_total = 0; delivery_total = 0; dine_in_orders = 0; delivery_orders = 0; ch_days = 0
    for d in ch_data:
        if start_date <= d <= sorted_dates[0]:  # sorted_dates is reverse sorted, [0] is latest
            dine_in_total += ch_data[d]["dine_in"]
            delivery_total += ch_data[d]["delivery"]
            dine_in_orders += ch_data[d]["dine_in_orders"]
            delivery_orders += ch_data[d]["delivery_orders"]
            ch_days += 1
    total_rev = dine_in_total + delivery_total
    s["channel"] = {
        "dine_in_avg": round(dine_in_total / ch_days) if ch_days > 0 else None,
        "delivery_avg": round(delivery_total / ch_days) if ch_days > 0 else None,
        "dine_in_pct": round(dine_in_total / total_rev * 100, 1) if total_rev > 0 else None,
        "delivery_pct": round(delivery_total / total_rev * 100, 1) if total_rev > 0 else None,
        "days": ch_days
    }
    # 配送距离分布（从 delivery_points 计算）
    pts = delivery_data.get(sid, [])
    d1 = d2 = d3 = d_total = 0
    for p in pts:
        dist = hd(s["lat"], s["lng"], p["lat"], p["lng"])
        w = p.get("w", 1)
        d_total += w
        if dist <= 1.0: d1 += w
        if dist <= 2.0: d2 += w
        if dist <= 3.0: d3 += w
    s["dist"] = {
        "d1_pct": round(d1 / d_total * 100, 1) if d_total > 0 else None,
        "d2_pct": round(d2 / d_total * 100, 1) if d_total > 0 else None,
        "d3_pct": round(d3 / d_total * 100, 1) if d_total > 0 else None,
        "total_orders": d_total
    }

# 统计(默认日期)
bx, cx, fx = {}, {}, {}
at = ot = mx = 0
for s in stores:
    a = s["ads"] or 0; bx[s["brand"]] = bx.get(s["brand"], 0) + 1
    cx[s["city"]] = cx.get(s["city"], 0) + 1
    fx[s.get("fmt", "")] = fx.get(s.get("fmt", ""), 0) + 1
    at += a; ot += s["overlap"]; mx = max(mx, s["overlap"])
avg_ad = round(at / len(stores)) if len(stores) > 0 else 0


# ============================================================
# 5. 生成 HTML
# ============================================================
city_opts = "".join(f'<option value="{c}">{c}</option>' for c in sorted(cx.keys()))
bsn = bx.get("Baker & Spice", 0) + bx.get("Baker&Spice", 0)
fkn = bx.get("Funk & Kale", 0) + bx.get("Funk&Kale", 0)

# 日期区间选项（起始/结束，默认最近7天）
recent_dates = sorted_dates[:30]  # 最近30天选项
end_default = recent_dates[0] if recent_dates else ""
start_default = recent_dates[6] if len(recent_dates) >= 7 else (recent_dates[-1] if recent_dates else "")
# 起始日期选项（默认选中 start_default）
date_opts_start = "".join(f'<option value="{d}" {"selected" if d==start_default else ""}>{d}</option>' for d in recent_dates)
# 结束日期选项（默认选中 end_default）
date_opts_end = "".join(f'<option value="{d}" {"selected" if d==end_default else ""}>{d}</option>' for d in recent_dates)

# 门店类型选项
fmt_opts = "".join(f'<option value="{f}">{f} ({n})</option>' for f, n in sorted(fx.items()) if f)

# stores JS (不含 ads_data, ads_data 在 dateData 里)
store_js = []
for s in stores:
    store_js.append({k: v for k, v in s.items() if k != "ads_data"})

date_data_js = json.dumps(store_ads, ensure_ascii=False)

html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Wagas 门店网络效率诊断 · V4</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{height:100vh;overflow:hidden}}
body{{font-family:-apple-system,"SF Pro","PingFang SC","Microsoft YaHei",sans-serif;background:#f1f5f9;color:#1e293b}}
#map{{position:absolute;top:0;left:360px;right:0;bottom:0;z-index:1}}

/* ====== 侧栏 ====== */
.panel{{position:absolute;top:0;left:0;width:350px;height:100vh;overflow-y:auto;overflow-x:hidden;
  background:#fff;padding:20px 18px;z-index:1000;
  box-shadow:2px 0 12px rgba(0,0,0,0.06);border-right:1px solid #e2e8f0}}

/* ====== 标题区 ====== */
.panel h1{{font-size:16px;font-weight:700;color:#0f172a;margin-bottom:2px;letter-spacing:-0.3px}}
.subtitle{{font-size:11px;color:#64748b;margin-bottom:16px;line-height:1.5}}
.subtitle strong{{color:#334155;font-weight:600}}

/* ====== 指标卡片 ====== */
.kpi-grid{{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}}
.kpi-card{{background:#f8fafc;border-radius:8px;padding:10px 12px;border:1px solid #e2e8f0}}
.kpi-label{{font-size:10px;color:#64748b;margin-bottom:2px;text-transform:uppercase;letter-spacing:0.3px}}
.kpi-value{{font-size:18px;font-weight:700;color:#0f172a;line-height:1.2}}
.kpi-sub{{font-size:10px;color:#94a3b8;margin-top:1px}}

/* ====== 分区 ====== */
.section{{margin-bottom:14px}}
.section-title{{font-size:11px;font-weight:700;color:#475569;margin-bottom:6px;
  text-transform:uppercase;letter-spacing:0.5px;display:flex;align-items:center;gap:6px}}
.section-title::after{{content:"";flex:1;height:1px;background:#e2e8f0}}

/* ====== 筛选器 ====== */
.filter-group{{margin-bottom:6px}}
.filter-group label{{display:block;font-size:10px;color:#64748b;margin-bottom:2px;font-weight:500}}
.filter-group select, .filter-group input{{width:100%;padding:6px 8px;border-radius:6px;
  border:1px solid #cbd5e1;background:#fff;color:#1e293b;font-size:12px;outline:none;
  transition:border-color 0.15s;appearance:none;-webkit-appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' fill='none' stroke='%2394a3b8' stroke-width='1.5'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 8px center;padding-right:28px}}
.filter-group select:hover, .filter-group input:hover{{border-color:#94a3b8}}
.filter-group select:focus, .filter-group input:focus{{border-color:#f97316;box-shadow:0 0 0 2px rgba(249,115,22,0.1)}}

/* ====== 图层开关 ====== */
.toggle-item{{display:flex;align-items:center;justify-content:space-between;
  padding:6px 10px;margin-bottom:4px;font-size:11px;color:#475569;
  background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;
  transition:background 0.15s}}
.toggle-item:hover{{background:#f1f5f9}}
.toggle-item input[type="checkbox"]{{width:32px;height:18px;appearance:none;background:#cbd5e1;
  border-radius:9px;position:relative;cursor:pointer;transition:0.2s;border:none}}
.toggle-item input[type="checkbox"]:checked{{background:#f97316}}
.toggle-item input[type="checkbox"]::after{{content:"";position:absolute;width:14px;height:14px;
  background:#fff;border-radius:50%;top:2px;left:2px;transition:0.2s;box-shadow:0 1px 2px rgba(0,0,0,0.2)}}
.toggle-item input[type="checkbox"]:checked::after{{left:16px}}

/* ====== ADS 分段 ====== */
.band-grid{{display:grid;grid-template-columns:1fr 1fr;gap:4px}}
.band-stat{{display:flex;align-items:center;gap:6px;font-size:11px;padding:4px 8px;
  background:#f8fafc;border-radius:5px;border:1px solid #e2e8f0;color:#475569}}
.dot{{width:10px;height:10px;border-radius:3px;flex-shrink:0}}

/* ====== 按钮 ====== */
.btn{{display:inline-block;padding:4px 10px;margin-top:6px;border-radius:5px;border:none;
  font-size:11px;font-weight:600;cursor:pointer;transition:0.15s}}
.btn-heat{{background:#f97316;color:#fff}}
.btn-heat.active{{background:#dc2626;color:#fff}}
.btn-heat:hover{{opacity:0.9}}
.btn-heat.loading{{background:#94a3b8;pointer-events:none}}

/* ====== 图例 ====== */
.legend{{position:absolute;bottom:40px;left:370px;background:#fff;border:1px solid #e2e8f0;
  border-radius:8px;padding:10px 12px;font-size:10px;z-index:999;box-shadow:0 2px 8px rgba(0,0,0,0.08)}}
.legend-title{{font-weight:600;color:#475569;margin-bottom:4px}}
.legend-item{{display:flex;align-items:center;gap:5px;padding:1px 0;color:#64748b}}

/* ====== 热力图提示 ====== */
.heat-info{{position:absolute;top:12px;right:12px;background:rgba(255,255,255,0.95);color:#1e293b;
  padding:8px 14px;border-radius:8px;font-size:12px;z-index:999;display:none;
  box-shadow:0 2px 10px rgba(0,0,0,0.1);border:1px solid #e2e8f0}}
.heat-info .heat-count{{font-weight:700;color:#f97316}}

/* ====== 地图标记 ====== */
.custom-marker{{background:transparent!important}}
@keyframes pulse{{0%,100%{{opacity:1}}50%{{opacity:0.4}}}}

/* ====== Toast 提示 ====== */
.toast{{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;
  background:#1e293b;color:#f8fafc;padding:10px 20px;border-radius:8px;font-size:13px;
  box-shadow:0 4px 16px rgba(0,0,0,0.2);animation:toastIn 0.3s ease}}
@keyframes toastIn{{from{{opacity:0;transform:translateX(-50%) translateY(-8px)}}to{{opacity:1;transform:translateX(-50%) translateY(0)}}}}
</style></head><body>

<div class="panel">
<h1>Wagas 门店网络效率诊断</h1>
<div class="subtitle" id="panel-date">快照: <strong id="cur-date-display">{start_default} ~ {end_default}</strong> &nbsp;·&nbsp; {len(stores)} 家门店</div>

<div class="kpi-grid">
<div class="kpi-card"><div class="kpi-label">日均销售额</div><div class="kpi-value" id="stat-avg">{fmt(avg_ad)}</div><div class="kpi-sub" id="date-range-label">{start_default} ~ {end_default}</div></div>
<div class="kpi-card"><div class="kpi-label">1km 重合</div><div class="kpi-value" id="stat-overlap">{round(ot/len(stores),1)}<span style="font-size:12px;color:#64748b"> 家</span></div><div class="kpi-sub">均值 / 最大 <span id="stat-overlap-max">{mx}</span></div></div>
</div>

<div class="section"><div class="section-title">ADS 分布</div>
<div class="band-grid" id="band-dist">
<div class="band-stat"><span class="dot" style="background:#93c5fd"></span>&lt;5K: 0</div>
<div class="band-stat"><span class="dot" style="background:#86efac"></span>5-10K: 0</div>
<div class="band-stat"><span class="dot" style="background:#fdba74"></span>10-20K: 0</div>
<div class="band-stat"><span class="dot" style="background:#fca5a5"></span>&gt;20K: 0</div>
</div></div>

<div class="section"><div class="section-title">📅 日期区间</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
<div class="filter-group"><label>起始</label><select id="date-start" onchange="onDateRangeChange()">{date_opts_start}</select></div>
<div class="filter-group"><label>结束</label><select id="date-end" onchange="onDateRangeChange()">{date_opts_end}</select></div>
</div></div>

<div class="section"><div class="section-title">🔍 筛选</div>
<div class="filter-group"><select id="brand-filter" onchange="applyFilter()">
<option value="all">全部品牌</option>
<option value="Wagas">Wagas ({bx.get('Wagas',0)})</option>
<option value="Baker&Spice">Baker & Spice ({bsn})</option>
<option value="Lokal">Lokal ({bx.get('Lokal',0)})</option>
<option value="JUNi">JUNi ({bx.get('JUNi',0)})</option>
<option value="Funk&Kale">Funk & Kale ({fkn})</option>
</select></div>
<div class="filter-group"><select id="city-filter" onchange="applyFilter()">
<option value="all">全部城市</option>{city_opts}</select></div>
<div class="filter-group"><select id="ads-filter" onchange="applyFilter()">
<option value="all">全部 ADS 区间</option>
<option value="lt5000">&lt;5,000</option><option value="5000to10000">5,000-10,000</option>
<option value="10000to20000">10,000-20,000</option><option value="gt20000">&gt;20,000</option>
</select></div>
<div class="filter-group"><select id="fmt-filter" onchange="applyFilter()">
<option value="all">全部门店类型</option>{fmt_opts}
</select></div>
<div class="filter-group"><input id="search-input" placeholder="搜索门店名称..." oninput="applyFilter()"></div></div>

<div class="section"><div class="section-title">🎛 图层</div>
<div class="toggle-item"><span>门店点位</span><input type="checkbox" id="show-markers" checked onchange="applyFilter()"></div>
<div class="toggle-item"><span>1km 覆盖圈</span><input type="checkbox" id="show-circles" checked onchange="applyFilter()"></div>
<div class="toggle-item"><span>高亮重合区域</span><input type="checkbox" id="highlight-overlap" onchange="applyFilter()"></div>
<div class="toggle-item"><span>按销售额着色</span><input type="checkbox" id="color-by-ads" checked onchange="applyFilter()"></div></div>
</div>

<div id="map"></div>
<div class="heat-info" id="heat-info"></div>

<div class="legend" id="legend-brand"><div class="legend-title">品牌</div>
<div class="legend-item"><span class="dot" style="background:#e11d48"></span>Wagas</div>
<div class="legend-item"><span class="dot" style="background:#f59e0b"></span>B&S</div>
<div class="legend-item"><span class="dot" style="background:#22c55e"></span>Lokal</div>
<div class="legend-item"><span class="dot" style="background:#8b5cf6"></span>JUNi</div>
<div class="legend-item"><span class="dot" style="background:#06b6d4"></span>F&K</div></div>
<div class="legend" id="legend-ads" style="display:none"><div class="legend-title">ADS</div>
<div class="legend-item"><span class="dot" style="background:#93c5fd"></span>&lt;5K</div>
<div class="legend-item"><span class="dot" style="background:#86efac"></span>5-10K</div>
<div class="legend-item"><span class="dot" style="background:#fdba74"></span>10-20K</div>
<div class="legend-item"><span class="dot" style="background:#fca5a5"></span>&gt;20K</div></div>

<script>
var BC={{Wagas:"#e11d48","Baker & Spice":"#f59e0b","Baker&Spice":"#f59e0b",
  Lokal:"#22c55e",JUNi:"#8b5cf6","Funk & Kale":"#06b6d4","Funk&Kale":"#06b6d4"}};
var stores={json.dumps(store_js, ensure_ascii=False)};
var dateData={date_data_js};
var dateStart="{start_default}";var dateEnd="{end_default}";

// 外卖配送点数据 (异步加载)
var deliveryData=null;
fetch("delivery_points_compact.json").then(function(r){{return r.json()}}).then(function(d){{
  deliveryData=d;console.log("外卖点已加载: "+Object.keys(d).length+"店");
}}).catch(function(e){{console.log("外卖点加载失败(可忽略):",e)}});

var heatLayer=null, activeHeatStore=null;

function getAds(sid){{
  var dd=dateData[sid];if(!dd)return null;
  var vs=[];
  for(var k in dd){{
    if(dd[k]!=null&&dd[k]>0&&k>=dateStart&&k<=dateEnd)vs.push(dd[k]);
  }}
  return vs.length?vs.reduce(function(a,b){{return a+b}})/vs.length:null;
}}

function adc(v){{if(v==null)return"#6b7280";if(v<5000)return"#93c5fd";if(v<10000)return"#86efac";if(v<20000)return"#fdba74";return"#fca5a5"}}
function adb(v){{if(v==null)return"N/A";if(v<5000)return"<5K";if(v<10000)return"5-10K";if(v<20000)return"10-20K";return">20K"}}
function fm(n){{return n!=null?"¥"+n.toLocaleString():"N/A"}}

function createPopup(s){{
  var a=getAds(s.sid);
  var h='<div style="min-width:220px;max-width:280px">';
  h+='<div style="font-weight:700;color:#1e293b;font-size:13px;margin-bottom:3px">'+s.name+'</div>';
  h+='<div style="font-size:11px;color:#64748b">'+s.brand+' · '+s.city+(s.addr?'<br>'+s.addr:'')+'</div>';
  if(a!=null){{
    var ac=adc(a);
    h+='<div style="margin-top:8px;padding:5px 8px;background:'+ac+'20;border-left:3px solid '+ac+
      ';border-radius:3px;font-size:11px;font-weight:600;color:#1f2937">'+
      '区间均值: '+fm(a)+' ('+adb(a)+')</div>';
  }}

  // 渠道拆分
  if(s.channel && s.channel.days>0){{
    var ch=s.channel;
    h+='<div style="margin-top:8px;padding:6px 8px;background:#f0f9ff;border-left:3px solid #3b82f6;border-radius:3px;font-size:10px">';
    h+='<div style="font-weight:700;color:#1e40af;margin-bottom:3px">渠道拆分 (日均)</div>';
    h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px">';
    h+='<div>堂食: <b>'+fm(ch.dine_in_avg)+'</b>'+(ch.dine_in_pct!=null?' ('+ch.dine_in_pct+'%)':'')+'</div>';
    h+='<div>外卖: <b>'+fm(ch.delivery_avg)+'</b>'+(ch.delivery_pct!=null?' ('+ch.delivery_pct+'%)':'')+'</div>';
    h+='</div></div>';
  }}

  // 配送距离分布
  if(s.dist && s.dist.total_orders>0){{
    var dt=s.dist;
    h+='<div style="margin-top:6px;padding:6px 8px;background:#fef3c7;border-left:3px solid #d97706;border-radius:3px;font-size:10px">';
    h+='<div style="font-weight:700;color:#92400e;margin-bottom:3px">外卖订单距离分布 ('+dt.total_orders+'单)</div>';
    h+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:2px;text-align:center">';
    h+='<div>&le;1km<br><b>'+(dt.d1_pct!=null?dt.d1_pct+'%':'N/A')+'</b></div>';
    h+='<div>&le;2km<br><b>'+(dt.d2_pct!=null?dt.d2_pct+'%':'N/A')+'</b></div>';
    h+='<div>&le;3km<br><b>'+(dt.d3_pct!=null?dt.d3_pct+'%':'N/A')+'</b></div>';
    h+='</div></div>';
  }}

  // 商圈环境
  if(s.market && s.market.poi_count>0){{
    var mk=s.market;
    h+='<div style="margin-top:6px;padding:6px 8px;background:#f0fdf4;border-left:3px solid #22c55e;border-radius:3px;font-size:10px">';
    h+='<div style="font-weight:700;color:#166534;margin-bottom:3px">商圈环境 (3km内)</div>';
    h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px">';
    h+='<div>餐厅数: <b>'+mk.poi_count+'</b></div>';
    h+='<div>评分: <b>'+(mk.avg_rating?mk.avg_rating.toFixed(1):'N/A')+'</b></div>';
    h+='<div>人均: <b>'+(mk.avg_cost?'¥'+mk.avg_cost:'N/A')+'</b></div>';
    h+='<div>中位数: <b>'+(mk.median_cost?'¥'+mk.median_cost:'N/A')+'</b></div>';
    h+='</div>';
    if(mk.business_area) h+='<div style="margin-top:2px;color:#4b5563">商圈: <b>'+mk.business_area+'</b></div>';
    if(mk.top_categories) h+='<div style="margin-top:2px;color:#4b5563;font-size:9px">品类: '+mk.top_categories+'</div>';
    h+='</div>';
  }}

  var ol=s.overlap||0;
  if(ol>0){{
    h+='<div style="margin-top:6px;padding:4px 6px;background:#fef3c7;border-left:3px solid #d97706;border-radius:3px;font-size:10px">'+
      '&#9888; 1km内重合: <b>'+ol+'</b> 家</div>';
    var ns=s.overlap_names||[];
    if(ns.length>0){{
      h+='<div style="max-height:80px;overflow-y:auto;margin-top:3px;font-size:9px;line-height:1.6">';
      ns.forEach(function(n){{
        var ms=stores.find(function(x){{return x.name===n}});
        if(ms){{h+='<div style="padding:1px 0;border-bottom:1px dashed #e5e7eb">'+
          '<b>'+(ms.brand||'')+'</b> · '+n+' ('+fm(getAds(ms.sid))+')</div>';}}
      }});h+='</div>';
    }}
  }}

  h+='<button class="btn btn-heat" data-sid="'+s.sid+'" onclick="toggleHeat(this.dataset.sid,this)" style="margin-top:8px">'+
    '&#128293; 外卖热力图</button>';
  h+='</div>';return h;
}}

function toggleHeat(sid,btn){{
  if(!deliveryData){{showToast("外卖数据加载中，请稍候");btn.classList.add("loading");setTimeout(function(){{btn.classList.remove("loading")}},2000);return}}
  var pts=deliveryData[sid];
  if(!pts||!pts.length){{showToast("该门店暂无外卖配送数据");return}}

  if(activeHeatStore===sid){{
    // 关闭热力
    if(heatLayer){{map.removeLayer(heatLayer);heatLayer=null}}
    activeHeatStore=null;
    document.getElementById("heat-info").style.display="none";
    btn.classList.remove("active");btn.textContent="🔥 外卖热力图";
    return;
  }}

  // 移除旧热力
  if(heatLayer){{map.removeLayer(heatLayer)}}

  // 创建新热力
  var hp=pts.map(function(p){{return [p.lat,p.lng,p.w]}});
  heatLayer=L.heatLayer(hp,{{
    radius:25,blur:15,maxZoom:17,
    gradient:{{0.2:"blue",0.4:"cyan",0.6:"lime",0.8:"yellow",1.0:"red"}},
    max:Math.max.apply(null,pts.map(function(p){{return p.w}}))
  }}).addTo(map);

  activeHeatStore=sid;
  document.getElementById("heat-info").style.display="block";
  document.getElementById("heat-info").innerHTML='<span class="heat-count">'+pts.length+'</span> 个配送地址(7天) &nbsp;·&nbsp; 再次点击关闭';
  btn.classList.add("active");btn.textContent="关闭热力图";
}}

function passFilters(s){{
  var bf=document.getElementById("brand-filter").value;
  var cf=document.getElementById("city-filter").value;
  var ff=document.getElementById("fmt-filter").value;
  var af=document.getElementById("ads-filter").value;
  var sf=document.getElementById("search-input").value.trim().toLowerCase();
  if(bf!=="all"&&s.brand!==bf&&s.brand!==bf.replace("&"," & "))return false;
  if(cf!=="all"&&s.city!==cf)return false;
  if(ff!=="all"&&s.fmt!==ff)return false;
  if(sf&&!s.name.toLowerCase().includes(sf))return false;
  if(af!=="all"){{var v=getAds(s.sid)||0;
    if(af==="lt5000"&&v>=5000)return false;
    if(af==="5000to10000"&&(v<5000||v>=10000))return false;
    if(af==="10000to20000"&&(v<10000||v>=20000))return false;
    if(af==="gt20000"&&v<20000)return false;}}
  return true;
}}

var map=L.map("map").setView([{MAP_CENTER[0]},{MAP_CENTER[1]}],10);
L.tileLayer("https://webrd0{{s}}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={{x}}&y={{y}}&z={{z}}",
  {{subdomains:"1234",attribution:"高德底图"}}).addTo(map);

var markers=[],circles=[];

function applyFilter(){{
  // 保持热力图(如果有)
  markers.forEach(function(m){{map.removeLayer(m)}});
  circles.forEach(function(c){{map.removeLayer(c)}});
  markers=[];circles=[];

  var sm=document.getElementById("show-markers").checked;
  var sc=document.getElementById("show-circles").checked;
  var ho=document.getElementById("highlight-overlap").checked;
  var ca=document.getElementById("color-by-ads").checked;

  var filtered=stores.filter(passFilters);
  if(!filtered.length)return;
  var bounds=[];

  // 覆盖圈
  if(sc||!sm){{
    filtered.forEach(function(s){{
      var oc=s.overlap>=3?"#dc2626":"#3b82f6",op=ho&&s.overlap>=3?0.25:0.08,ow=ho&&s.overlap>=3?2:1;
      var c=L.circle([s.lat,s.lng],{{radius:1000,color:oc,weight:ow,opacity:ow,fillColor:oc,fillOpacity:op}});
      c.bindPopup(createPopup(s));c.addTo(map);circles.push(c);
      bounds.push([s.lat,s.lng]);
    }});
  }}

  // 门点点位
  if(sm){{
    filtered.forEach(function(s){{
      var a=getAds(s.sid),color;if(ca)color=adc(a);else color=BC[s.brand]||"#6b7280";
      var ol=s.overlap||0,hl=ol>=3,sz=hl?14:9,wt=hl?3:2,bd=hl?"#c2410c":"white",anim=hl?"animation:pulse 1.5s infinite;":"";
      var icon=L.divIcon({{className:"custom-marker",
        html:'<div style="width:'+sz+'px;height:'+sz+'px;background:'+color+
             ';border:'+wt+'px solid '+bd+';border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.4);'+anim+'"></div>',
        iconSize:[sz,sz],iconAnchor:[sz/2,sz/2]}});
      var mk=L.marker([s.lat,s.lng],{{icon}}).bindPopup(createPopup(s));mk.addTo(map);markers.push(mk);
      bounds.push([s.lat,s.lng]);
    }});
  }}

  if(bounds.length)map.fitBounds(bounds,{{padding:[20,20]}});
  document.getElementById("legend-brand").style.display=ca?"none":"block";
  document.getElementById("legend-ads").style.display=ca?"block":"none";
  updateStats(filtered);
}}

function updateStats(fs){{
  var vs=[];fs.forEach(function(s){{var a=getAds(s.sid);if(a!=null&&a>0)vs.push(a);}});
  var avg=vs.length?vs.reduce(function(a,b){{return a+b}})/vs.length:0;
  document.getElementById("stat-avg").textContent=fm(Math.round(avg));

  // 重合度动态更新
  var olSum=0, olMax=0;
  fs.forEach(function(s){{olSum+=s.overlap||0;olMax=Math.max(olMax,s.overlap||0);}});
  var olAvg=fs.length?olSum/fs.length:0;
  document.getElementById("stat-overlap").innerHTML=olAvg.toFixed(1)+'<span style="font-size:12px;color:#64748b"> 家</span>';
  document.getElementById("stat-overlap-max").textContent=olMax;

  var bs={{"<5K":0,"5-10K":0,"10-20K":0,">20K":0}};
  fs.forEach(function(s){{var a=getAds(s.sid)||0;
    if(a<5000)bs["<5K"]++;else if(a<10000)bs["5-10K"]++;else if(a<20000)bs["10-20K"]++;else bs[">20K"]++;}});
  document.getElementById("band-dist").innerHTML=
    '<div class="band-stat"><span class="dot" style="background:#93c5fd"></span>&lt;5K: '+bs["<5K"]+'</div>'+
    '<div class="band-stat"><span class="dot" style="background:#86efac"></span>5-10K: '+bs["5-10K"]+'</div>'+
    '<div class="band-stat"><span class="dot" style="background:#fdba74"></span>10-20K: '+bs["10-20K"]+'</div>'+
    '<div class="band-stat"><span class="dot" style="background:#fca5a5"></span>&gt;20K: '+bs[">20K"]+'</div>';
}}

// Toast 通知
function showToast(msg,dur){{dur=dur||2000;
  var t=document.createElement("div");t.className="toast";t.textContent=msg;document.body.appendChild(t);
  setTimeout(function(){{t.remove()}},dur);
}}

function onDateRangeChange(){{
  var ds=document.getElementById("date-start").value;
  var de=document.getElementById("date-end").value;
  if(ds&&de&&ds>de){{var t=ds;ds=de;de=t;}} // 自动交换
  dateStart=ds||"";dateEnd=de||"";
  var label=dateStart&&dateEnd?dateStart+" ~ "+dateEnd:"全部日期";
  document.getElementById("date-range-label").textContent=label;
  document.getElementById("cur-date-display").textContent=label;
  applyFilter();
}}

applyFilter();
</script>
</body></html>'''

with open(OUTPUT_HTML, "w", encoding="utf-8") as f:
    f.write(html)

print(f"\nV4 地图: {OUTPUT_HTML}  ({os.path.getsize(OUTPUT_HTML)/1024:.0f}KB)")
print(f"外卖热力数据: {DLV_OUT}  ({dlv_size:.0f}KB)")
print(f"部署需复制: {os.path.basename(OUTPUT_HTML)} + {os.path.basename(DLV_OUT)}")
