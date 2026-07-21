#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
daily_sync.py — Wagas 门店网络 v2 每日数据同步
=====================================================
每日同步清单：
  ① 门店主数据 → store_master.csv → stores.json（含 GCJ-02 转换 + 重合度计算）
  ② 销售数据 → sales_data.json
  ③ 渠道拆分 → channel_sales.json
  ④ 外卖配送点 → delivery_points.json + delivery_by_city/*.json
  ⑤ 热门配送地 TOP10 → delivery_top_locations.json
  ⑥ 城市天气 → weather_data.json

用法：
  python daily_sync.py                          # 完整每日同步
  python daily_sync.py --skip-weather           # 跳过天气（节省时间）
  python daily_sync.py --skip-delivery          # 跳过配送点
"""

import argparse
import csv
import json
import math
import os
import sys
import time
from datetime import date, timedelta

# Windows GBK 编码兼容
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

BASE = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE, "output")
V2_DATA = os.path.join(BASE, "store-network-v2", "public", "data")
V2_DEPLOY = os.path.join(BASE, "store-network-v2", "data")

R = 6371000

def hd(lat1, lng1, lat2, lng2):
    r1, r2 = math.radians(lat1), math.radians(lat2)
    da, db = math.radians(lat2-lat1), math.radians(lng2-lng1)
    a = math.sin(da/2)**2 + math.cos(r1)*math.cos(r2)*math.sin(db/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a)) / 1000

def wgs84_to_gcj02(lng, lat):
    a = 6378245.0; ee = 0.00669342162296594323
    def out_of_china(lng, lat):
        return not (72.004 <= lng <= 137.8347 and 0.8293 <= lat <= 55.8271)
    def tlat(x, y):
        r = -100+2*x+3*y+0.2*y*y+0.1*x*y+0.2*math.sqrt(abs(x))
        r += (20*math.sin(6*x*math.pi)+20*math.sin(2*x*math.pi))*2/3
        r += (20*math.sin(y*math.pi)+40*math.sin(y/3*math.pi))*2/3
        r += (160*math.sin(y/12*math.pi)+320*math.sin(y*math.pi/30))*2/3
        return r
    def tlng(x, y):
        r = 300+x+2*y+0.1*x*x+0.1*x*y+0.1*math.sqrt(abs(x))
        r += (20*math.sin(6*x*math.pi)+20*math.sin(2*x*math.pi))*2/3
        r += (20*math.sin(x*math.pi)+40*math.sin(x/3*math.pi))*2/3
        r += (150*math.sin(x/12*math.pi)+320*math.sin(x*math.pi/30))*2/3
        return r
    if out_of_china(lng, lat): return lng, lat
    dl = tlat(lng-105, lat-35); dn = tlng(lng-105, lat-35)
    rp = lat/180*math.pi; m = math.sin(rp); m = 1-ee*m*m; sm = math.sqrt(m)
    dl = dl*180/((a*(1-ee))/(m*sm)*math.pi)
    dn = dn*180/(a/sm*math.cos(rp)*math.pi)
    return lng+dn, lat+dl

def save_json(data, *paths):
    for p in paths:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False)

def compute_competitor_stats(stores):
    """为每家门店计算周边竞品统计（各品牌 1km 内数量 + 1km 评分中位数）。

    读取 output/competitor_stores.csv，结果写入每个 store 的 comp 字段。
    """
    csv_path = os.path.join(OUTPUT_DIR, "competitor_stores.csv")
    if not os.path.exists(csv_path):
        return
    # 预加载竞品（按品牌分组，含坐标与评分）
    comp_by_brand = {}
    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            brand = row.get('brand', '').strip()
            if not brand:
                continue
            try:
                lng = float(row.get('lng', 0) or 0)
                lat = float(row.get('lat', 0) or 0)
            except (ValueError, TypeError):
                continue
            if lng == 0 or lat == 0:
                continue
            rating = None
            try:
                r = float(row.get('rating', '') or '')
                if r > 0:
                    rating = r
            except (ValueError, TypeError):
                pass
            comp_by_brand.setdefault(brand, []).append((lat, lng, rating))
    if not comp_by_brand:
        return

    def _median(vals):
        if not vals:
            return None
        s = sorted(vals)
        n = len(s)
        mid = n // 2
        return s[mid] if n % 2 else round((s[mid - 1] + s[mid]) / 2, 1)

    for st in stores:
        comp = {}
        for brand, items in comp_by_brand.items():
            n1 = 0
            ratings = []
            for (clat, clng, rating) in items:
                if hd(st['lat'], st['lng'], clat, clng) <= 1.0:
                    n1 += 1
                    if rating is not None:
                        ratings.append(rating)
            if n1 > 0:
                comp[brand] = {'n1': n1, 'med': _median(ratings)}
        st['comp'] = comp

def step1_store_master():
    """从 store_master.csv 生成 stores.json（GCJ-02 + 重合度）"""
    print("\n=== Step 1: 门店主数据 → stores.json ===")
    csv_path = os.path.join(OUTPUT_DIR, "store_master.csv")
    if not os.path.exists(csv_path):
        print("  [SKIP] store_master.csv 不存在")
        return False

    # 读取门店（过滤掉云厨子店）
    stores = []
    skipped_sub = 0
    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            sid = row.get('Store_ID', '').strip()
            if not sid: continue
            # 云厨子店不纳入门店网络展示
            if row.get('是否子店', '').strip() == '是':
                skipped_sub += 1
                continue
            try:
                lng = float(row.get('经度', 0) or 0)
                lat = float(row.get('纬度', 0) or 0)
            except: continue
            if lng == 0 or lat == 0: continue
            # BI 系统坐标已为 GCJ-02（来自高德 API），无需转换
            stores.append({
                'sid': sid, 'name': row.get('门店名称', ''),
                'brand': row.get('品牌', ''), 'city': row.get('城市', ''),
                'addr': row.get('门店地址', ''), 'fmt': row.get('业态', ''),
                'lng': lng, 'lat': lat,
                'ads': 0, 'market': None, 'overlap': 0, 'overlap_names': [],
                'channel': None, 'dist': None
            })
    print(f"  门店: {len(stores)}（已过滤 {skipped_sub} 家云厨子店）")

    # 合并 ADS（从 sales_data.json）
    sales_path = os.path.join(V2_DATA, "sales_data.json")
    if os.path.exists(sales_path):
        with open(sales_path, 'r', encoding='utf-8') as f:
            sales_data = json.load(f)
        for s in stores:
            dd = sales_data.get(s['sid'], {})
            vals = [v for v in dd.values() if v and v > 0]
            s['ads'] = sum(vals) / len(vals) if vals else 0
        print(f"  ADS 合并完成")

    # 合并商圈环境（从 market context CSV）
    mkt_path = os.path.join(OUTPUT_DIR, "store_market_context.csv")
    if os.path.exists(mkt_path):
        with open(mkt_path, 'r', encoding='utf-8-sig') as f:
            for row in csv.DictReader(f):
                sid = row.get('门店ID', '').strip()
                for s in stores:
                    if s['sid'] == sid:
                        s['market'] = {
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
                        break
        print(f"  商圈环境合并完成")

    # 合并渠道拆分
    ch_path = os.path.join(OUTPUT_DIR, "store_channel_sales.csv")
    if os.path.exists(ch_path):
        ch_agg = {}
        with open(ch_path, 'r', encoding='utf-8-sig') as f:
            for row in csv.DictReader(f):
                sid = row['门店ID']; od = row['营业日期']; ch = row['渠道']
                rev = float(row['渠道销售额'] or 0); orders = int(row['渠道订单量'] or 0)
                key = (sid, od)
                if key not in ch_agg:
                    ch_agg[key] = {'dine_in': 0, 'delivery': 0, 'dine_in_orders': 0, 'delivery_orders': 0, 'days': 0}
                if ch == '店内':
                    ch_agg[key]['dine_in'] += rev; ch_agg[key]['dine_in_orders'] += orders
                elif ch == '外卖':
                    ch_agg[key]['delivery'] += rev; ch_agg[key]['delivery_orders'] += orders
                ch_agg[key]['days'] += 1

        for s in stores:
            sid = s['sid']
            ch_days = 0; dine_in_total = 0; delivery_total = 0
            for (csid, cod), v in ch_agg.items():
                if csid == sid:
                    dine_in_total += v['dine_in']; delivery_total += v['delivery']
                    ch_days += 1
            if ch_days > 0:
                total_rev = dine_in_total + delivery_total
                s['channel'] = {
                    'dine_in_avg': round(dine_in_total / ch_days),
                    'delivery_avg': round(delivery_total / ch_days),
                    'dine_in_pct': round(dine_in_total / total_rev * 100, 1) if total_rev > 0 else None,
                    'delivery_pct': round(delivery_total / total_rev * 100, 1) if total_rev > 0 else None,
                    'days': ch_days
                }
        print(f"  渠道拆分合并完成")

    # 合并配送距离分布
    dlv_path = os.path.join(OUTPUT_DIR, "delivery_points.json")
    if os.path.exists(dlv_path):
        with open(dlv_path, 'r', encoding='utf-8') as f:
            delivery_data = json.load(f)
        for s in stores:
            pts = delivery_data.get(s['sid'], [])
            if not pts: continue
            d1=d2=d3=d4=d5=d_total=0
            for p in pts:
                dist = hd(s['lat'], s['lng'], p['lat'], p['lng'])
                w = p.get('w', 1); d_total += w
                if dist <= 1.0: d1 += w
                elif dist <= 2.0: d2 += w
                elif dist <= 3.0: d3 += w
                elif dist <= 5.0: d4 += w
                else: d5 += w
            if d_total > 0:
                s['dist'] = {
                    'd1_pct': round(d1/d_total*100,1), 'd2_pct': round(d2/d_total*100,1),
                    'd3_pct': round(d3/d_total*100,1), 'd4_pct': round(d4/d_total*100,1),
                    'd5_pct': round(d5/d_total*100,1), 'total_orders': d_total
                }
        print(f"  配送距离分布合并完成")

    # 计算 1km 重合度
    print("  计算 1km 重合度...")
    for i, s1 in enumerate(stores):
        nb = []
        for j, s2 in enumerate(stores):
            if i == j: continue
            if hd(s1['lat'], s1['lng'], s2['lat'], s2['lng']) <= 1.0:
                nb.append(s2['name'])
        s1['overlap'] = len(nb)
        s1['overlap_names'] = nb
    overlap_count = sum(1 for s in stores if s['overlap'] > 0)
    print(f"  有重合门店: {overlap_count}/{len(stores)}")

    # 计算配送轮廓
    print("  计算配送轮廓...")
    store_coords = {s['sid']: (s['lat'], s['lng']) for s in stores}
    contours = compute_delivery_contour(store_coords)
    for s in stores:
        s['delivery_contour'] = contours.get(s['sid'], [])
    contour_count = sum(1 for s in stores if s['delivery_contour'])
    print(f"  配送轮廓：{contour_count}/{len(stores)} 家门店")

    # 计算周边竞品统计
    print("  计算周边竞品统计...")
    compute_competitor_stats(stores)
    comp_count = sum(1 for s in stores if s.get('comp'))
    print(f"  周边有竞品的门店: {comp_count}/{len(stores)}")

    # 保存
    save_json(stores, os.path.join(V2_DATA, "stores.json"), os.path.join(V2_DEPLOY, "stores.json"))
    print(f"  stores.json 已更新 ({len(stores)} 店)")
    return True

def convex_hull(points):
    """计算点集的凸包（Andrew's monotone chain）"""
    points = sorted(set(points))
    if len(points) <= 1:
        return points
    lower = []
    for p in points:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(points):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]

def cross(o, a, b):
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

def chaikin_smooth(points, iterations=2):
    """Chaikin 算法平滑多边形"""
    for _ in range(iterations):
        new_points = []
        for i in range(len(points)):
            p0 = points[i]
            p1 = points[(i + 1) % len(points)]
            new_points.append((p0[0] * 0.75 + p1[0] * 0.25, p0[1] * 0.75 + p1[1] * 0.25))
            new_points.append((p0[0] * 0.25 + p1[0] * 0.75, p0[1] * 0.25 + p1[1] * 0.75))
        points = new_points
    return points

def compute_delivery_contour(store_coords=None):
    """计算每家门店的 70% 配送轮廓（平滑多边形），排除 95 分位距离外的异常点"""
    print("\n=== 配送轮廓计算 ===")
    dlv_path = os.path.join(OUTPUT_DIR, "delivery_points.json")
    if not os.path.exists(dlv_path):
        print("  [SKIP] delivery_points.json 不存在")
        return {}

    with open(dlv_path, 'r', encoding='utf-8') as f:
        delivery_data = json.load(f)

    if store_coords is None:
        store_coords = {}

    contours = {}
    for sid, pts in delivery_data.items():
        if not pts or len(pts) < 5:
            continue

        # 获取门店坐标
        if sid not in store_coords:
            continue
        slat, slng = store_coords[sid]

        # 计算每个配送点到门店的距离
        pts_with_dist = []
        for p in pts:
            d = hd(slat, slng, p['lat'], p['lng'])
            pts_with_dist.append((p, d))

        # 计算 95 分位距离
        distances = sorted([d for _, d in pts_with_dist])
        p95_idx = int(len(distances) * 0.95)
        p95_dist = distances[p95_idx] if p95_idx < len(distances) else distances[-1]

        # 过滤掉超过 95 分位距离的异常点
        filtered = [(p, d) for p, d in pts_with_dist if d <= p95_dist]
        if len(filtered) < 5:
            continue

        # 按权重排序，取累计 70% 的点
        sorted_pts = sorted(filtered, key=lambda x: x[0].get('w', 1), reverse=True)
        total_w = sum(p.get('w', 1) for p, _ in sorted_pts)
        target_w = total_w * 0.7
        cum_w = 0
        selected = []
        for p, _ in sorted_pts:
            w = p.get('w', 1)
            cum_w += w
            selected.append((p['lng'], p['lat']))  # (x, y) = (lng, lat)
            if cum_w >= target_w:
                break
        if len(selected) < 3:
            continue
        # 计算凸包
        hull = convex_hull(selected)
        if len(hull) < 3:
            continue
        # 平滑
        smooth_hull = chaikin_smooth(hull, iterations=2)
        # 转换为 [lat, lng] 格式
        contours[sid] = [[pt[1], pt[0]] for pt in smooth_hull]

    print(f"  计算完成：{len(contours)} 家门店有配送轮廓")
    return contours

def step2_weather(skip=False):
    """抓取城市天气数据"""
    if skip:
        print("\n=== Step 2: 天气数据 [跳过] ===")
        return
    print("\n=== Step 2: 天气数据 ===")

    # 读取已有天气数据（增量更新）
    weather_path = os.path.join(V2_DATA, "weather_data.json")
    existing = {}
    if os.path.exists(weather_path):
        with open(weather_path, 'r', encoding='utf-8') as f:
            existing = json.load(f)

    # 确定需要更新的城市
    stores_path = os.path.join(V2_DATA, "stores.json")
    if not os.path.exists(stores_path):
        print("  [SKIP] stores.json 不存在")
        return
    with open(stores_path, 'r', encoding='utf-8') as f:
        stores = json.load(f)
    cities = sorted(set(s['city'] for s in stores))

    CITY_COORDS = {
        '上海市': (31.2304, 121.4737), '北京市': (39.9042, 116.4074),
        '南京市': (32.0603, 118.7969), '天津市': (39.3434, 117.3616),
        '宁波市': (29.8683, 121.5440), '广州市': (23.1291, 113.2644),
        '成都市': (30.5728, 104.0668), '无锡市': (31.4912, 120.3119),
        '昆山市': (31.3850, 120.9580), '杭州市': (30.2741, 120.1551),
        '武汉市': (30.5928, 114.3055), '深圳市': (22.5431, 114.0579),
        '温州市': (28.0000, 120.6722), '珠海市': (22.2710, 113.5767),
        '苏州市': (31.2989, 120.5853), '西安市': (34.3416, 108.9398),
        '重庆市': (29.4316, 106.9123), '青岛市': (36.0671, 120.3826),
    }

    today = date.today().isoformat()
    start_date = '2026-05-01'
    import urllib.request

    for city in cities:
        if city not in CITY_COORDS: continue
        lat, lng = CITY_COORDS[city]

        # 增量：只拉取已有数据之后的日期
        last_date = start_date
        if city in existing and existing[city]:
            last_date = max(w['date'] for w in existing[city])
            last_date = (date.fromisoformat(last_date) + timedelta(days=1)).isoformat()

        if last_date > today: continue

        url = f'https://archive-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lng}&start_date={last_date}&end_date={today}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&timezone=Asia/Shanghai'
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'WagasDashboard/1.0'})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode('utf-8'))
            daily = data.get('daily', {})
            dates = daily.get('time', [])
            tmax = daily.get('temperature_2m_max', [])
            tmin = daily.get('temperature_2m_min', [])
            precip = daily.get('precipitation_sum', [])
            wcode = daily.get('weathercode', [])

            new_days = []
            for i in range(len(dates)):
                new_days.append({
                    'date': dates[i],
                    'tmax': round(tmax[i], 1) if tmax[i] is not None else None,
                    'tmin': round(tmin[i], 1) if tmin[i] is not None else None,
                    'precip': round(precip[i], 1) if precip[i] is not None else 0,
                    'weathercode': wcode[i] if wcode[i] is not None else 0
                })

            if city in existing:
                existing[city].extend(new_days)
            else:
                existing[city] = new_days
            print(f"  {city}: +{len(new_days)} 天")
        except Exception as e:
            print(f"  {city}: ERROR {e}")
        time.sleep(0.5)

    save_json(existing, os.path.join(V2_DATA, "weather_data.json"), os.path.join(V2_DEPLOY, "weather_data.json"))
    print(f"  weather_data.json 已更新")

def step3_sales_json():
    """从 store_daily_sales.csv 重新生成 sales_data.json"""
    print("\n=== Step 3: 生成 sales_data.json ===")
    csv_path = os.path.join(OUTPUT_DIR, "store_daily_sales.csv")
    if not os.path.exists(csv_path):
        print("  [SKIP] store_daily_sales.csv 不存在")
        return False

    sales = {}
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            # 使用动态键名避免编码问题
            keys = list(row.keys())
            if len(keys) < 3:
                continue
            sid = row.get(keys[1], "").strip()
            od = row.get(keys[0], "").strip()
            val = float(row.get(keys[2], 0) or 0)
            if sid and od:
                sales.setdefault(sid, {})[od] = val

    save_json(sales, os.path.join(V2_DATA, "sales_data.json"), os.path.join(V2_DEPLOY, "sales_data.json"))
    total_dates = set()
    for v in sales.values():
        total_dates.update(v.keys())
    print(f"  sales_data.json 已更新：{len(sales)} 店，{len(total_dates)} 天，最新：{max(total_dates) if total_dates else 'N/A'}")
    return True

def step4_channel_json():
    """从 store_channel_sales.csv 生成 channel_sales.json（前端按日渠道拆分）

    输出格式与线上保持一致（稠密）：
      { sid: { date: {"dine_in": x, "delivery": y} } }
    全局日期范围内每一天都有键，无销售的日期补 0，避免前端图表断档。
    """
    print("\n=== Step 4: 生成 channel_sales.json ===")
    csv_path = os.path.join(OUTPUT_DIR, "store_channel_sales.csv")
    if not os.path.exists(csv_path):
        print("  [SKIP] store_channel_sales.csv 不存在")
        return False

    # 先收集稀疏数据与全局日期范围
    sparse = {}
    all_dates = set()
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sid = row.get("门店ID", "").strip()
            od = row.get("营业日期", "").strip()
            ch = row.get("渠道", "").strip()
            try:
                rev = float(row.get("渠道销售额", 0) or 0)
            except (ValueError, TypeError):
                continue
            if not sid or not od:
                continue
            all_dates.add(od)
            d = sparse.setdefault(sid, {}).setdefault(od, {"dine_in": 0.0, "delivery": 0.0})
            if ch == "店内":
                d["dine_in"] += rev
            elif ch == "外卖":
                d["delivery"] += rev

    if not all_dates:
        print("  [SKIP] 无渠道数据")
        return False

    # 稠密展开：全局日期范围内的连续日期序列，缺失日期补 0（与线上格式一致）
    d0 = date.fromisoformat(min(all_dates))
    d1 = date.fromisoformat(max(all_dates))
    date_list = []
    cur = d0
    while cur <= d1:
        date_list.append(cur.isoformat())
        cur += timedelta(days=1)

    channel = {}
    for sid, days in sparse.items():
        entry = {}
        for ds in date_list:
            v = days.get(ds)
            if v:
                entry[ds] = {"dine_in": round(v["dine_in"], 2), "delivery": round(v["delivery"], 2)}
            else:
                entry[ds] = {"dine_in": 0, "delivery": 0}
        channel[sid] = entry

    save_json(channel, os.path.join(V2_DATA, "channel_sales.json"), os.path.join(V2_DEPLOY, "channel_sales.json"))
    print(f"  channel_sales.json 已更新：{len(channel)} 店，{len(date_list)} 天，最新：{date_list[-1]}")
    return True

def step5_competitor_json():
    """从 competitor_stores.csv 生成 competitor_stores.json（按品牌分组）"""
    print("\n=== Step 5: 竞品门店 → competitor_stores.json ===")
    csv_path = os.path.join(OUTPUT_DIR, "competitor_stores.csv")
    if not os.path.exists(csv_path):
        print("  [SKIP] competitor_stores.csv 不存在（竞品 ETL 未运行过）")
        return False

    grouped = {}
    total = 0
    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            brand = row.get('brand', '').strip()
            if not brand:
                continue
            try:
                lng = float(row.get('lng', 0) or 0)
                lat = float(row.get('lat', 0) or 0)
            except (ValueError, TypeError):
                continue
            if lng == 0 or lat == 0:
                continue
            grouped.setdefault(brand, []).append({
                'name': row.get('name', ''),
                'lng': lng, 'lat': lat,
                'addr': row.get('address', ''),
                'city': row.get('city', ''),
                'district': row.get('district', ''),
                'rating': row.get('rating', ''),
            })
            total += 1

    save_json(grouped, os.path.join(V2_DATA, "competitor_stores.json"), os.path.join(V2_DEPLOY, "competitor_stores.json"))
    summary = ", ".join(f"{b}: {len(v)}" for b, v in grouped.items())
    print(f"  competitor_stores.json 已更新：{total} 家（{summary}）")
    return True

def main():
    parser = argparse.ArgumentParser(description="Wagas 门店网络 v2 每日同步")
    parser.add_argument("--skip-weather", action="store_true", help="跳过天气数据")
    parser.add_argument("--skip-delivery", action="store_true", help="跳过配送点")
    args = parser.parse_args()

    print("=" * 60)
    print("Wagas 门店网络 v2 每日数据同步")
    print(f"运行日期: {date.today().isoformat()}")
    print("=" * 60)

    step1_store_master()
    step3_sales_json()
    step4_channel_json()
    step5_competitor_json()
    step2_weather(skip=args.skip_weather)

    print("\n" + "=" * 60)
    print("每日同步完成!")
    print("=" * 60)

if __name__ == "__main__":
    main()
