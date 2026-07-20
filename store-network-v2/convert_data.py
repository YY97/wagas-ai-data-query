#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
convert_data.py — 将 ETL 输出数据合并为 stores.json
读取: store_master.csv, sales_data.json, store_channel_sales.csv,
      store_market_context.csv, delivery_points.json, delivery_top_locations.csv
输出: stores.json (含 channel, dist, market, overlap, top_locations)
"""
import csv, json, math, os

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, 'public', 'data')
OUTPUT_DIR = os.path.join(BASE, '..', 'output')

R = 6371000

def hd(lat1, lng1, lat2, lng2):
    """Haversine distance in km"""
    r1, r2 = math.radians(lat1), math.radians(lat2)
    da, db = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(da/2)**2 + math.cos(r1)*math.cos(r2)*math.sin(db/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a)) / 1000

def wgs84_to_gcj02(lng, lat):
    a = 6378245.0
    ee = 0.00669342162296594323
    def out_of_china(lng, lat):
        return not (72.004 <= lng <= 137.8347 and 0.8293 <= lat <= 55.8271)
    def transform_lat(x, y):
        ret = -100.0 + 2.0*x + 3.0*y + 0.2*y*y + 0.1*x*y + 0.2*math.sqrt(abs(x))
        ret += (20.0*math.sin(6.0*x*math.pi) + 20.0*math.sin(2.0*x*math.pi)) * 2.0/3.0
        ret += (20.0*math.sin(y*math.pi) + 40.0*math.sin(y/3.0*math.pi)) * 2.0/3.0
        ret += (160.0*math.sin(y/12.0*math.pi) + 320*math.sin(y*math.pi/30)) * 2.0/3.0
        return ret
    def transform_lng(x, y):
        ret = 300.0 + x + 2.0*y + 0.1*x*x + 0.1*x*y + 0.1*math.sqrt(abs(x))
        ret += (20.0*math.sin(6.0*x*math.pi) + 20.0*math.sin(2.0*x*math.pi)) * 2.0/3.0
        ret += (20.0*math.sin(x*math.pi) + 40.0*math.sin(x/3.0*math.pi)) * 2.0/3.0
        ret += (150.0*math.sin(x/12.0*math.pi) + 320*math.sin(x*math.pi/30)) * 2.0/3.0
        return ret
    if out_of_china(lng, lat):
        return lng, lat
    dlat = transform_lat(lng - 105.0, lat - 35.0)
    dlng = transform_lng(lng - 105.0, lat - 35.0)
    radlat = lat / 180.0 * math.pi
    magic = math.sin(radlat)
    magic = 1 - ee * magic * magic
    sqrtmagic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((a * (1 - ee)) / (magic * sqrtmagic) * math.pi)
    dlng = (dlng * 180.0) / (a / sqrtmagic * math.cos(radlat) * math.pi)
    return lng + dlng, lat + dlat

# ============================================================
# 1. 门店主数据
# ============================================================
print("1. 门店主数据")
sm = {}
csv_path = os.path.join(DATA_DIR, 'store_master.csv')
with open(csv_path, 'r', encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        sid = row.get('Store_ID', '').strip()
        if not sid: continue
        try:
            lng = float(row.get('经度', 0) or 0)
            lat = float(row.get('纬度', 0) or 0)
        except (ValueError, TypeError):
            continue
        if lng == 0 or lat == 0: continue
        # BI 系统坐标已为 GCJ-02（来自高德 API），无需转换
        sm[sid] = {
            'sid': sid, 'name': row.get('门店名称', ''),
            'brand': row.get('品牌', ''), 'city': row.get('城市', ''),
            'addr': row.get('门店地址', ''), 'fmt': row.get('业态', ''),
            'lng': lng, 'lat': lat,
            'ads': 0, 'market': None, 'overlap': 0, 'overlap_names': [],
            'channel': None, 'dist': None
        }
print(f"   门店: {len(sm)}")

# ============================================================
# 2. 销售数据 (ADS)
# ============================================================
print("2. 销售数据")
sales_path = os.path.join(DATA_DIR, 'sales_data.json')
with open(sales_path, 'r', encoding='utf-8') as f:
    sales_data = json.load(f)
for sid, daily in sales_data.items():
    if sid in sm and daily:
        vals = [v for v in daily.values() if v and v > 0]
        sm[sid]['ads'] = sum(vals) / len(vals) if vals else 0
print(f"   有销售数据: {sum(1 for s in sm.values() if s['ads'] > 0)}")

# ============================================================
# 3. 渠道拆分
# ============================================================
print("3. 渠道拆分")
chs_path = os.path.join(OUTPUT_DIR, 'store_channel_sales.csv')
store_channel = {}
if os.path.exists(chs_path):
    with open(chs_path, 'r', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            sid = row.get('门店ID', '').strip()
            od = row.get('营业日期', '').strip()
            ch = row.get('渠道', '').strip()
            rev = float(row.get('渠道销售额', 0) or 0)
            orders = int(row.get('渠道订单量', 0) or 0)
            if sid and od:
                store_channel.setdefault(sid, {}).setdefault(od, {
                    'dine_in': 0, 'delivery': 0,
                    'dine_in_orders': 0, 'delivery_orders': 0
                })
                if ch == '店内':
                    store_channel[sid][od]['dine_in'] += rev
                    store_channel[sid][od]['dine_in_orders'] += orders
                elif ch == '外卖':
                    store_channel[sid][od]['delivery'] += rev
                    store_channel[sid][od]['delivery_orders'] += orders
    print(f"   门店: {len(store_channel)}")
else:
    print("   [WARN] store_channel_sales.csv 不存在")

for sid, ch_data in store_channel.items():
    if sid not in sm: continue
    dine_in_total = delivery_total = 0
    ch_days = 0
    for d, v in ch_data.items():
        dine_in_total += v['dine_in']
        delivery_total += v['delivery']
        ch_days += 1
    total_rev = dine_in_total + delivery_total
    if ch_days > 0:
        sm[sid]['channel'] = {
            'dine_in_avg': round(dine_in_total / ch_days),
            'delivery_avg': round(delivery_total / ch_days),
            'dine_in_pct': round(dine_in_total / total_rev * 100, 1) if total_rev > 0 else None,
            'delivery_pct': round(delivery_total / total_rev * 100, 1) if total_rev > 0 else None,
            'days': ch_days
        }

# ============================================================
# 4. 商圈环境
# ============================================================
print("4. 商圈环境")
mkt_path = os.path.join(OUTPUT_DIR, 'store_market_context.csv')
if os.path.exists(mkt_path):
    with open(mkt_path, 'r', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            sid = row.get('门店ID', '').strip()
            if sid and sid in sm:
                sm[sid]['market'] = {
                    'poi_count': int(row.get('poi_count', 0) or 0),
                    'avg_cost': float(row.get('avg_cost', 0) or 0) or None,
                    'median_cost': float(row.get('median_cost', 0) or 0) or None,
                    'avg_rating': float(row.get('avg_rating', 0) or 0) or None,
                    'top_categories': row.get('top_categories', ''),
                    'business_area': row.get('business_area', ''),
                    'office_count': int(row.get('office_count', 0) or 0),
                    'residential_count': int(row.get('residential_count', 0) or 0),
                    'metro_count': int(row.get('metro_count', 0) or 0),
                    'nearest_metro_km': float(row.get('nearest_metro_km', 0) or 0) or None
                }
    print(f"   门店: {sum(1 for s in sm.values() if s['market'])}")
else:
    print("   [WARN] store_market_context.csv 不存在")

# ============================================================
# 5. 配送距离分布
# ============================================================
print("5. 配送距离分布")
dlv_path = os.path.join(OUTPUT_DIR, 'delivery_points.json')
delivery_data = {}
if os.path.exists(dlv_path):
    with open(dlv_path, 'r', encoding='utf-8') as f:
        delivery_data = json.load(f)
    print(f"   门店: {len(delivery_data)}")
else:
    print("   [WARN] delivery_points.json 不存在")

for sid, pts in delivery_data.items():
    if sid not in sm: continue
    s = sm[sid]
    d1 = d2 = d3 = d4 = d5 = d_total = 0
    for p in pts:
        dist = hd(s['lat'], s['lng'], p['lat'], p['lng'])
        w = p.get('w', 1)
        d_total += w
        if dist <= 1.0: d1 += w
        elif dist <= 2.0: d2 += w
        elif dist <= 3.0: d3 += w
        elif dist <= 5.0: d4 += w
        else: d5 += w
    if d_total > 0:
        s['dist'] = {
            'd1_pct': round(d1 / d_total * 100, 1),
            'd2_pct': round(d2 / d_total * 100, 1),
            'd3_pct': round(d3 / d_total * 100, 1),
            'd4_pct': round(d4 / d_total * 100, 1),
            'd5_pct': round(d5 / d_total * 100, 1),
            'total_orders': d_total
        }

# ============================================================
# 6. 1km 重合度计算
# ============================================================
print("6. 计算 1km 重合...")
store_list = list(sm.values())
for i, s1 in enumerate(store_list):
    nb = []
    for j, s2 in enumerate(store_list):
        if i == j: continue
        if hd(s1['lat'], s1['lng'], s2['lat'], s2['lng']) <= 1.0:
            nb.append(s2['name'])
    s1['overlap'] = len(nb)
    s1['overlap_names'] = nb
overlap_stores = sum(1 for s in store_list if s['overlap'] > 0)
print(f"   有重合门店: {overlap_stores}")

# ============================================================
# 7. 输出 stores.json
# ============================================================
stores = list(sm.values())
out_path = os.path.join(DATA_DIR, 'stores.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(stores, f, ensure_ascii=False, indent=2)

print(f"\n输出: {out_path}")
print(f"总门店: {len(stores)}")
print(f"有 ADS: {sum(1 for s in stores if s['ads'] > 0)}")
print(f"有渠道: {sum(1 for s in stores if s['channel'])}")
print(f"有商圈: {sum(1 for s in stores if s['market'])}")
print(f"有配送距离: {sum(1 for s in stores if s['dist'])}")
print(f"有重合: {sum(1 for s in stores if s['overlap'] > 0)}")
