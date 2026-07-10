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

AMAP_API = "https://restapi.amap.com/v5/place/around"
SEARCH_RADIUS = 3000  # 3km
POI_TYPE = "050000"   # 餐饮服务大类
PAGE_SIZE = 25
SLEEP_BETWEEN = 0.4   # 秒，控制 QPS（免费 3 QPS）


def search_nearby(key, lng, lat, radius=SEARCH_RADIUS, max_pages=4):
    """搜索周边餐饮 POI，自动分页，最多 max_pages 页"""
    all_pois = []
    for page in range(1, max_pages + 1):
        url = (f"{AMAP_API}?key={key}&location={lng},{lat}"
               f"&radius={radius}&types={POI_TYPE}"
               f"&offset={PAGE_SIZE}&page={page}&show_fields=business")
        for attempt in range(3):
            try:
                req = urllib.request.urlopen(url, timeout=15)
                data = json.loads(req.read())
                break
            except Exception as e:
                if attempt < 2:
                    time.sleep(2)
                else:
                    print(f"    [WARN] API 请求失败: {e}")
                    data = {}
        if data.get("status") != "1":
            print(f"    [WARN] API 返回: {data.get('info', 'unknown')}")
            break
        pois = data.get("pois", [])
        all_pois.extend(pois)
        total = int(data.get("count", 0))
        if page * PAGE_SIZE >= total:
            break
        time.sleep(SLEEP_BETWEEN)
    return all_pois


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
    parser.add_argument("--radius", type=int, default=SEARCH_RADIUS,
                        help="搜索半径(米), 默认 1000")
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
    print(f"商圈环境 ETL | {len(stores)} 家门店 | 半径 {args.radius}m")
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
        # 跳过已有数据的门店（增量更新）
        if s["sid"] in existing and existing[s["sid"]].get("poi_count", "0") != "0":
            results.append(existing[s["sid"]])
            if (i + 1) % 50 == 0:
                print(f"  [{i+1}/{len(stores)}] {s['name']} (cached)")
            continue

        pois = search_nearby(args.key, s["lng"], s["lat"], args.radius)
        agg = aggregate(pois)
        row = {
            "门店ID": s["sid"],
            "门店名称": s["name"],
            "城市": s["city"],
            "poi_count": agg["count"],
            "avg_cost": agg["avg_cost"] if agg["avg_cost"] else "",
            "median_cost": agg["median_cost"] if agg["median_cost"] else "",
            "avg_rating": agg["avg_rating"] if agg["avg_rating"] else "",
            "top_categories": agg["top_categories"],
            "business_area": agg["business_area"]
        }
        results.append(row)

        if (i + 1) % 10 == 0 or i == len(stores) - 1:
            print(f"  [{i+1}/{len(stores)}] {s['name']}: {agg['count']} 家餐厅"
                  f" | 人均 {agg['avg_cost'] or 'N/A'}"
                  f" | 评分 {agg['avg_rating'] or 'N/A'}"
                  f" | 商圈 {agg['business_area']}")
        time.sleep(SLEEP_BETWEEN)

    # 写 CSV
    fieldnames = ["门店ID", "门店名称", "城市", "poi_count", "avg_cost",
                  "median_cost", "avg_rating", "top_categories", "business_area"]
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
