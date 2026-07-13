#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Wagas 商圈环境 ETL — 高德 POI 周边搜索
对每家门店搜索 1km 内餐饮 POI，聚合出商圈指标。
输出: output/store_market_context.csv

用法:
  python etl_market_context.py --key YOUR_AMAP_KEY --output-dir ./output
  AMAP_KEY 也可通过环境变量 AMAP_KEY 传入
"""

import argparse
import csv
import json
import os
import sys
import time
import urllib.request
import urllib.error
from collections import Counter

AMAP_V3 = "https://restapi.amap.com/v3/place/around"
RESTAURANT_RADIUS = 1000  # 1km
EXTRA_RADII = {"office": 1000, "residential": 1000, "metro": 3000}
POI_TYPES = {
    "050100": "中餐厅",
    "050200": "外国餐厅",
    "050300": "快餐厅",
    "050400": "休闲餐饮",
    "050500": "咖啡厅",
}
POI_TYPES_EXTRA = {
    "120200": "office",      # 商务楼宇
    "120300": "residential", # 住宅小区
    "150500": "metro",       # 地铁站
}
PAGE_SIZE = 25
SLEEP_BETWEEN = 0.4   # 秒，控制 QPS（免费 30 QPS，保守用 0.4s）


def haversine(lat1, lng1, lat2, lng2):
    """两点间距离(km)，用 Haversine 公式"""
    import math
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlng / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _api_get(url, retries=3):
    """带重试的 API 请求"""
    for attempt in range(retries):
        try:
            req = urllib.request.urlopen(url, timeout=15)
            data = json.loads(req.read())
            if data.get("status") == "1":
                return data
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2)
            else:
                print(f"    [WARN] API 请求失败: {e}")
    return {}


def _normalize_v3_poi(p):
    """将 v3 POI 字段标准化为 business dict 格式"""
    biz_ext = p.get("biz_ext", {}) or {}
    p["business"] = {
        "cost": biz_ext.get("cost"),
        "rating": biz_ext.get("rating"),
        "business_area": p.get("business_area", "")
    }
    return p


def search_nearby(key, lng, lat, radius=RESTAURANT_RADIUS, max_pages=10):
    """搜索周边餐饮 POI（v3 API），按子品类分别搜索，分页遍历全部数据并去重。
    每品类最多 max_pages 页（250条），覆盖绝大多数门店全量数据。"""
    seen = set()
    all_pois = []
    for type_code, type_name in POI_TYPES.items():
        page = 1
        total = None
        while page <= max_pages:
            url = (f"{AMAP_V3}?key={key}&location={lng},{lat}"
                   f"&radius={radius}&types={type_code}"
                   f"&offset={PAGE_SIZE}&page={page}&extensions=all")
            data = _api_get(url)
            if not data:
                break
            if total is None:
                total = int(data.get("count", 0))
            pois = data.get("pois", [])
            for p in pois:
                dedup_key = (p.get("name",""), p.get("location",""))
                if dedup_key not in seen:
                    seen.add(dedup_key)
                    all_pois.append(_normalize_v3_poi(p))
            if page * PAGE_SIZE >= total:
                break
            page += 1
            time.sleep(SLEEP_BETWEEN)
        time.sleep(SLEEP_BETWEEN)
    return all_pois


def _extract_station_name(name):
    """从 POI 名称提取地铁站名（循环去掉出入口/口/(地铁站)/地铁站/站等后缀）"""
    import re
    name = name.strip()
    suffixes = [r'\(地铁站\)', r'出入口', r'[A-Z]\d?口', r'\d+号口', r'地铁站', r'站$']
    prev = None
    while prev != name:
        prev = name
        for s in suffixes:
            name = re.sub(s + r'$', '', name)
    return name.strip()


def search_extra(key, lng, lat, max_pages=10):
    """搜索写字楼、住宅小区、地铁站（v3 API），分页遍历数据。
    写字楼/住宅 1km，地铁 3km。地铁站按站名去重返回真实站点数。"""
    counts = {"office": 0, "residential": 0, "metro": 0}
    nearest_metro_km = None
    for type_code, category in POI_TYPES_EXTRA.items():
        radius = EXTRA_RADII.get(category, 1000)
        page = 1
        total = None
        metro_pois = []
        while page <= max_pages:
            url = (f"{AMAP_V3}?key={key}&location={lng},{lat}"
                   f"&radius={radius}&types={type_code}"
                   f"&offset={PAGE_SIZE}&page={page}&extensions=all")
            data = _api_get(url)
            if not data:
                break
            if total is None:
                total = int(data.get("count", 0))
            pois = data.get("pois", [])
            if category == "metro":
                metro_pois.extend(pois)
            if page * PAGE_SIZE >= total:
                break
            page += 1
            time.sleep(SLEEP_BETWEEN)
        # 地铁站按站名去重
        if category == "metro" and metro_pois:
            unique_stations = set()
            for p in metro_pois:
                sname = _extract_station_name(p.get("name", ""))
                if sname:
                    unique_stations.add(sname)
            counts[category] = len(unique_stations)
        else:
            counts[category] = total or 0
        # 地铁站算最近距离（遍历全部地铁站）
        if category == "metro" and metro_pois:
            min_dist = float("inf")
            for p in metro_pois:
                loc = p.get("location", "")
                if "," in loc:
                    try:
                        plng, plat = float(loc.split(",")[0]), float(loc.split(",")[1])
                        d = haversine(lat, lng, plat, plng)
                        if d < min_dist:
                            min_dist = d
                    except (ValueError, IndexError):
                        pass
            if min_dist < float("inf"):
                nearest_metro_km = round(min_dist, 2)
        time.sleep(SLEEP_BETWEEN)
    return counts, nearest_metro_km


def aggregate(pois):
    """从 POI 列表聚合出商圈指标"""
    count = len(pois)
    if count == 0:
        return {"count": 0, "avg_cost": None, "avg_rating": None,
                "top_categories": "", "business_area": "", "median_cost": None}

    costs = []
    ratings = []
    categories = Counter()
    biz_areas = Counter()

    for p in pois:
        biz = p.get("business", {})
        # 人均消费
        c = biz.get("cost")
        if c and c != "N/A":
            try:
                costs.append(float(c))
            except (ValueError, TypeError):
                pass
        # 评分
        r = biz.get("rating")
        if r and r != "N/A":
            try:
                ratings.append(float(r))
            except (ValueError, TypeError):
                pass
        # 品类（取二级分类）
        ptype = p.get("type", "")
        parts = ptype.split(";")
        if len(parts) >= 2:
            categories[parts[1]] += 1
        elif parts:
            categories[parts[0]] += 1
        # 商圈
        ba = biz.get("business_area", "")
        if ba:
            biz_areas[ba] += 1

    avg_cost = round(sum(costs) / len(costs), 1) if costs else None
    avg_rating = round(sum(ratings) / len(ratings), 2) if ratings else None
    median_cost = round(sorted(costs)[len(costs) // 2], 1) if costs else None
    top_cats = ", ".join(f"{k}({v})" for k, v in categories.most_common(3))
    top_biz = biz_areas.most_common(1)[0][0] if biz_areas else ""

    return {
        "count": count,
        "avg_cost": avg_cost,
        "avg_rating": avg_rating,
        "median_cost": median_cost,
        "top_categories": top_cats,
        "business_area": top_biz
    }


def main():
    parser = argparse.ArgumentParser(description="商圈环境 ETL")
    parser.add_argument("--key", default=os.environ.get("AMAP_KEY", ""),
                        help="高德 Web 服务 API Key")
    parser.add_argument("--output-dir", default=None, help="输出目录")
    args = parser.parse_args()

    if not args.key:
        print("[ERROR] 需要 --key 参数或 AMAP_KEY 环境变量")
        sys.exit(1)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    if args.output_dir:
        output_dir = args.output_dir
    else:
        output_dir = os.path.join(script_dir, "output")

    sm_csv = os.path.join(output_dir, "store_master.csv")
    out_csv = os.path.join(output_dir, "store_market_context.csv")

    if not os.path.exists(sm_csv):
        print(f"[ERROR] {sm_csv} 不存在，请先运行 etl_pull_data.py")
        sys.exit(1)

    # 读取门店
    stores = []
    with open(sm_csv, "r", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            sid = r.get("Store_ID", "").strip()
            lng = r.get("经度", "").strip()
            lat = r.get("纬度", "").strip()
            if sid and lng and lat:
                try:
                    stores.append({
                        "sid": sid,
                        "name": r.get("门店名称", ""),
                        "city": r.get("城市", ""),
                        "lng": float(lng),
                        "lat": float(lat)
                    })
                except (ValueError, TypeError):
                    pass

    print(f"{'=' * 60}")
    print(f"商圈环境 ETL | {len(stores)} 家门店 | 餐厅/写字楼/住宅 1km, 地铁 3km")
    print(f"{'=' * 60}")

    # 读取已有数据（支持增量更新）
    existing = {}
    if os.path.exists(out_csv):
        with open(out_csv, "r", encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                existing[r["门店ID"]] = r
        print(f"  已有 {len(existing)} 条历史数据")

    # 逐店查询
    results = []
    for i, s in enumerate(stores):
        # 跳过已有完整数据的门店（增量更新，需要包含新字段）
        ex = existing.get(s["sid"])
        if ex and ex.get("poi_count", "0") != "0" and ex.get("office_count", "") != "":
            results.append(ex)
            if (i + 1) % 50 == 0:
                print(f"  [{i+1}/{len(stores)}] {s['name']} (cached)")
            continue

        pois = search_nearby(args.key, s["lng"], s["lat"])
        agg = aggregate(pois)
        extra, nearest_metro = search_extra(args.key, s["lng"], s["lat"])
        row = {
            "门店ID": s["sid"],
            "门店名称": s["name"],
            "城市": s["city"],
            "poi_count": agg["count"],
            "avg_cost": agg["avg_cost"] if agg["avg_cost"] else "",
            "median_cost": agg["median_cost"] if agg["median_cost"] else "",
            "avg_rating": agg["avg_rating"] if agg["avg_rating"] else "",
            "top_categories": agg["top_categories"],
            "business_area": agg["business_area"],
            "office_count": extra["office"],
            "residential_count": extra["residential"],
            "metro_count": extra["metro"],
            "nearest_metro_km": nearest_metro if nearest_metro else ""
        }
        results.append(row)

        if (i + 1) % 10 == 0 or i == len(stores) - 1:
            metro_str = f"{nearest_metro}km" if nearest_metro else "N/A"
            print(f"  [{i+1}/{len(stores)}] {s['name']}: {agg['count']}餐厅"
                  f" | 写字楼{extra['office']} 住宅{extra['residential']}"
                  f" | 地铁{extra['metro']}站(最近{metro_str})"
                  f" | 商圈 {agg['business_area']}")
        time.sleep(SLEEP_BETWEEN)

    # 写 CSV
    fieldnames = ["门店ID", "门店名称", "城市", "poi_count", "avg_cost",
                  "median_cost", "avg_rating", "top_categories", "business_area",
                  "office_count", "residential_count", "metro_count", "nearest_metro_km"]
    os.makedirs(output_dir, exist_ok=True)
    with open(out_csv, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for row in results:
            w.writerow(row)

    print(f"\n  -> {out_csv} ({len(results)} 行)")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
