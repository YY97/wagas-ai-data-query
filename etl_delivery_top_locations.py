#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
外卖热门配送地 ETL — 对每家门店取配送量 TOP 10 的位置
用高德逆地理编码反查配送坐标附近的写字楼/小区名称。
输出: output/delivery_top_locations.csv

用法:
  python etl_delivery_top_locations.py --key YOUR_AMAP_KEY --output-dir ./output
"""

import argparse
import csv
import json
import math
import os
import sys
import time
import urllib.request
import urllib.error

REVERSE_GEO_URL = "https://restapi.amap.com/v3/geocode/regeo"
TOP_N = 50
SLEEP_BETWEEN = 0.35  # 秒，控制 QPS

# 目标 POI 类型关键词（写字楼、住宅小区相关）
TARGET_KEYWORDS = ["写字楼", "住宅", "楼宇", "商务", "小区", "公寓", "大厦", "广场", "商场", "购物中心"]


def haversine(lat1, lng1, lat2, lng2):
    """两点间距离(km)"""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlng / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def api_get(url, retries=3):
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


def reverse_geo_name(key, lng, lat):
    """逆地理编码，返回最近的目标地点名称（写字楼/住宅/商场等）"""
    url = (f"{REVERSE_GEO_URL}?key={key}&location={lng},{lat}"
           f"&radius=300&extensions=all")
    data = api_get(url)
    if not data:
        return ""
    regeo = data.get("regeocode", {})
    pois = regeo.get("pois", [])
    # 筛选目标类型 POI，取最近的
    best_name = ""
    best_dist = float("inf")
    for p in pois:
        ptype = p.get("type", "")
        pname = p.get("name", "")
        # 检查类型或名称是否匹配目标关键词
        match = any(kw in ptype or kw in pname for kw in TARGET_KEYWORDS)
        if match:
            try:
                dist = float(p.get("distance", 999))
            except (ValueError, TypeError):
                dist = 999
            if dist < best_dist:
                best_dist = dist
                best_name = pname
    # 如果没有匹配的 POI，用 addressComponent 的 neighborhood
    if not best_name:
        ac = regeo.get("addressComponent", {})
        neighborhood = ac.get("neighborhood", {})
        if isinstance(neighborhood, dict):
            best_name = neighborhood.get("name", "")
        elif isinstance(neighborhood, str):
            best_name = neighborhood
    # 过滤无效名称（空字符串、"[]" 等）
    if best_name in ("", "[]", "null", "undefined"):
        best_name = ""
    return best_name


def main():
    parser = argparse.ArgumentParser(description="外卖热门配送地 ETL")
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
    dlv_json = os.path.join(output_dir, "delivery_points.json")
    out_csv = os.path.join(output_dir, "delivery_top_locations.csv")
    cache_file = os.path.join(output_dir, "delivery_geocode_cache.json")

    if not os.path.exists(sm_csv):
        print(f"[ERROR] {sm_csv} 不存在")
        sys.exit(1)
    if not os.path.exists(dlv_json):
        print(f"[ERROR] {dlv_json} 不存在")
        sys.exit(1)

    # 加载地理编码缓存
    geo_cache = {}
    if os.path.exists(cache_file):
        with open(cache_file, "r", encoding="utf-8") as f:
            geo_cache = json.load(f)
        print(f"  地理编码缓存: {len(geo_cache)} 条")

    # 读取门店坐标
    store_coords = {}
    with open(sm_csv, "r", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            sid = r.get("Store_ID", "").strip()
            lng = r.get("经度", "").strip()
            lat = r.get("纬度", "").strip()
            if sid and lng and lat:
                try:
                    store_coords[sid] = (float(lat), float(lng))
                except (ValueError, TypeError):
                    pass

    # 读取配送点
    with open(dlv_json, "r", encoding="utf-8") as f:
        delivery_data = json.load(f)

    print(f"{'=' * 60}")
    print(f"外卖热门配送地 ETL | {len(store_coords)} 家门店 | TOP {TOP_N}")
    print(f"{'=' * 60}")

    # 读取已有数据（增量更新）
    existing = {}
    if os.path.exists(out_csv):
        with open(out_csv, "r", encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                sid = r["门店ID"]
                if sid not in existing:
                    existing[sid] = []
                existing[sid].append(r)
        print(f"  已有 {len(existing)} 家门店数据")

    # 逐店处理
    results = []
    processed = 0
    cache_hits = 0
    cache_misses = 0
    for sid, (slat, slng) in store_coords.items():
        # 跳过已有数据的门店
        if sid in existing and len(existing[sid]) >= TOP_N:
            results.extend(existing[sid])
            continue

        pts = delivery_data.get(sid, [])
        if not pts:
            continue

        # 按 weight 排序，过滤掉距离 >50km 的异常坐标
        pts_sorted = sorted(pts, key=lambda p: p.get("w", 1), reverse=True)
        pts_valid = []
        for p in pts_sorted:
            d = haversine(slat, slng, p["lat"], p["lng"])
            if d <= 50:
                pts_valid.append(p)
            if len(pts_valid) >= TOP_N:
                break
        pts_sorted = pts_valid

        for rank, p in enumerate(pts_sorted, 1):
            plat, plng = p["lat"], p["lng"]
            weight = p.get("w", 1)
            dist_km = round(haversine(slat, slng, plat, plng), 2)

            # 逆地理编码（先查缓存）
            cache_key = f"{plat},{plng}"
            if cache_key in geo_cache:
                loc_name = geo_cache[cache_key]
                cache_hits += 1
            else:
                loc_name = reverse_geo_name(args.key, plng, plat)
                geo_cache[cache_key] = loc_name
                cache_misses += 1
                time.sleep(SLEEP_BETWEEN)

            results.append({
                "门店ID": sid,
                "排名": rank,
                "地点名称": loc_name,
                "距离(km)": dist_km,
                "配送次数": weight,
                "纬度": plat,
                "经度": plng
            })

        processed += 1
        if processed % 20 == 0 or processed == len(store_coords):
            print(f"  [{processed}/{len(store_coords)}] 已处理")

    # 写 CSV
    fieldnames = ["门店ID", "排名", "地点名称", "距离(km)", "配送次数", "纬度", "经度"]
    os.makedirs(output_dir, exist_ok=True)
    with open(out_csv, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for row in results:
            w.writerow(row)

    # 保存地理编码缓存
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(geo_cache, f, ensure_ascii=False)

    print(f"\n  -> {out_csv} ({len(results)} 行)")
    print(f"  缓存命中: {cache_hits}, 新查询: {cache_misses}, 缓存总量: {len(geo_cache)}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
