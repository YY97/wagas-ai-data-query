#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Wagas 竞品门店 ETL — 高德 POI 关键字搜索
抓取竞品品牌（超级碗/星巴克/赛百味/gaga鲜语）在 Wagas 运营城市的门店位置。
输出: output/competitor_stores.csv

用法:
  python etl_competitor_stores.py --key YOUR_AMAP_KEY --output-dir ./output
  AMAP_KEY 也可通过环境变量 AMAP_KEY 传入

说明:
  - 城市列表自动从 output/store_master.csv 提取（Wagas 运营城市）
  - 坐标为 GCJ-02（高德坐标系），与门店主数据一致，可直接叠加显示
  - 建议每月 1 号运行一次（竞品开关店频率低）
"""

import argparse
import csv
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import urllib.error

AMAP_TEXT = "https://restapi.amap.com/v3/place/text"
AMAP_DISTRICT = "https://restapi.amap.com/v3/config/district"
PAGE_SIZE = 25
MAX_PAGE = 40          # 单品牌单城市最多翻页数（兜底防死循环）
CAP_THRESHOLD = 450    # 单城市取回≥此数视为触顶（高德上限约500），需按区县细分
SLEEP_BETWEEN = 0.35   # 秒，控制 QPS

# 竞品品牌配置：name=展示名，keywords=搜索关键词，match=名称校验（小写）
BRANDS = [
    {"name": "超级碗",   "keywords": ["FOODBOWL", "超级碗"],   "match": ["foodbowl", "超级碗"]},
    {"name": "星巴克",   "keywords": ["星巴克"],               "match": ["星巴克", "starbucks"]},
    {"name": "赛百味",   "keywords": ["赛百味", "Subway"],     "match": ["赛百味", "subway"]},
    {"name": "gaga鲜语", "keywords": ["gaga鲜语", "gaga"],     "match": ["gaga"]},
    {"name": "蓝蛙",     "keywords": ["蓝蛙", "bluefrog"],     "match": ["蓝蛙", "bluefrog", "blue frog"]},
    {"name": "Manner",   "keywords": ["Manner", "manner coffee"], "match": ["manner"]},
]


def _api_get(url, retries=3):
    """带重试的 API 请求"""
    for attempt in range(retries):
        try:
            req = urllib.request.urlopen(url, timeout=15)
            data = json.loads(req.read())
            if data.get("status") == "1":
                return data
            # 配额/限流错误提示
            info = data.get("info", "")
            if info and info != "OK":
                print(f"    [WARN] API 返回: {info}")
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2)
            else:
                print(f"    [WARN] API 请求失败: {e}")
    return {}


def load_cities(output_dir):
    """从 store_master.csv 提取 Wagas 运营城市列表"""
    csv_path = os.path.join(output_dir, "store_master.csv")
    cities = []
    if os.path.exists(csv_path):
        with open(csv_path, 'r', encoding='utf-8-sig') as f:
            for row in csv.DictReader(f):
                c = row.get('城市', '').strip()
                if c and c not in cities:
                    cities.append(c)
    if not cities:
        # 兜底：Wagas 主要运营城市
        cities = ["上海市", "北京市", "深圳市", "广州市", "杭州市", "成都市",
                  "南京市", "苏州市", "武汉市", "西安市", "青岛市", "珠海市",
                  "佛山市", "宁波市", "无锡市", "长沙市", "天津市", "中山市"]
    return cities


def _parse_poi(p, brand, fallback_city):
    """解析单个 POI 为记录 dict，无效则返回 None"""
    name = p.get("name", "") or ""
    loc = p.get("location", "") or ""
    if "," not in loc:
        return None
    try:
        lng_s, lat_s = loc.split(",")
        lng, lat = float(lng_s), float(lat_s)
    except (ValueError, TypeError):
        return None
    if lng == 0 or lat == 0:
        return None
    biz = p.get("biz_ext", {}) or {}
    rating = biz.get("rating") or ""
    if rating in ("[]", "null", "None"):
        rating = ""
    return {
        "brand": brand["name"],
        "name": name,
        "province": p.get("pname", ""),
        "city": p.get("cityname", "") or fallback_city,
        "district": p.get("adname", ""),
        "address": p.get("address", "") if isinstance(p.get("address"), str) else "",
        "lng": lng, "lat": lat,
        "rating": rating,
        "tel": p.get("tel", "") if isinstance(p.get("tel"), str) else "",
        "type": p.get("type", ""),
    }


def _search_one(key, kw, city_param, brand, match_lower, seen_ids, fallback_city):
    """对单个城市/区县参数做分页搜索。返回 (pois, 实际取回数, 声称总数)。"""
    pois = []
    retrieved = 0
    claimed = 0
    page = 1
    while page <= MAX_PAGE:
        params = urllib.parse.urlencode({
            "key": key, "keywords": kw, "city": city_param,
            "citylimit": "true", "offset": PAGE_SIZE, "page": page,
            "extensions": "all", "output": "json",
        })
        data = _api_get(f"{AMAP_TEXT}?{params}")
        if page == 1:
            try:
                claimed = int(data.get("count", 0) or 0)
            except (ValueError, TypeError):
                claimed = 0
        batch = data.get("pois", []) or []
        if not batch:
            break
        retrieved += len(batch)
        for p in batch:
            pid = p.get("id", "")
            name_lower = (p.get("name", "") or "").lower()
            # 名称校验：必须包含品牌匹配词，过滤同名无关 POI
            if not any(m in name_lower for m in match_lower):
                continue
            if pid and pid in seen_ids:
                continue
            if pid:
                seen_ids.add(pid)
            rec = _parse_poi(p, brand, fallback_city)
            if rec:
                pois.append(rec)
        if len(batch) < PAGE_SIZE:
            break
        page += 1
        time.sleep(SLEEP_BETWEEN)
    return pois, retrieved, claimed


def get_districts(key, city):
    """获取城市下辖区县的 adcode 列表。

    直辖市（上海/北京/天津/重庆）层级为 省→城区→区，比普通城市多一层，
    因此用 subdistrict=2 并递归收集所有 level=='district' 的节点。
    """
    params = urllib.parse.urlencode({
        "key": key, "keywords": city, "subdistrict": "2", "output": "json",
    })
    data = _api_get(f"{AMAP_DISTRICT}?{params}")
    adcodes = []

    def _walk(node):
        for child in (node.get("districts", []) or []):
            if child.get("level") == "district":
                ac = child.get("adcode", "")
                if ac:
                    adcodes.append(ac)
            _walk(child)

    top = data.get("districts", []) or []
    if top:
        _walk(top[0])
        # 兜底：若没有 district 级节点，退回取顶层的直接子节点
        if not adcodes:
            for child in (top[0].get("districts", []) or []):
                ac = child.get("adcode", "")
                if ac:
                    adcodes.append(ac)
    return adcodes


def search_brand_city(key, brand, city):
    """搜索单品牌单城市的所有门店。

    高德单城市关键字搜索有约 500 条的取回上限（如上海星巴克声称 800 实取 494）。
    检测到触顶后，自动按区县细分搜索并合并，确保拿全。
    """
    match_lower = [m.lower() for m in brand["match"]]
    seen_ids = set()
    all_pois = []
    need_districts = False

    for kw in brand["keywords"]:
        pois, retrieved, claimed = _search_one(key, kw, city, brand, match_lower, seen_ids, city)
        all_pois.extend(pois)
        # 触顶判断：声称总数 > 实际取回，或取回接近上限
        if claimed > retrieved or retrieved >= CAP_THRESHOLD:
            need_districts = True

    if need_districts:
        adcodes = get_districts(key, city)
        if adcodes:
            print(f"    [{city}] 触顶，按 {len(adcodes)} 个区县细分搜索")
            for adcode in adcodes:
                for kw in brand["keywords"]:
                    pois, _, _ = _search_one(key, kw, adcode, brand, match_lower, seen_ids, city)
                    all_pois.extend(pois)
                time.sleep(SLEEP_BETWEEN)

    return all_pois


def main():
    parser = argparse.ArgumentParser(description="竞品门店 ETL")
    parser.add_argument("--key", default=os.environ.get("AMAP_KEY", ""), help="高德 Web 服务 Key")
    parser.add_argument("--output-dir", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "output"))
    args = parser.parse_args()

    if not args.key:
        print("[ERROR] 缺少高德 Key，请用 --key 传入或设置环境变量 AMAP_KEY")
        sys.exit(1)

    os.makedirs(args.output_dir, exist_ok=True)
    cities = load_cities(args.output_dir)
    print(f"竞品门店 ETL | {len(BRANDS)} 个品牌 × {len(cities)} 个城市")
    print(f"城市: {', '.join(cities)}")

    all_pois = []
    for brand in BRANDS:
        brand_pois = []
        print(f"\n=== {brand['name']} ===")
        for city in cities:
            pois = search_brand_city(args.key, brand, city)
            if pois:
                print(f"  {city}: {len(pois)} 家")
            brand_pois.extend(pois)
        # 品牌内按 id 已去重（search_brand_city 内 seen_ids 仅单城市），跨城市再去重一次
        dedup = {}
        for p in brand_pois:
            key = (round(p["lng"], 5), round(p["lat"], 5))
            dedup[key] = p
        brand_pois = list(dedup.values())
        print(f"  小计: {len(brand_pois)} 家（去重后）")
        all_pois.extend(brand_pois)

    # 写 CSV
    out_path = os.path.join(args.output_dir, "competitor_stores.csv")
    fields = ["brand", "name", "province", "city", "district", "address",
              "lng", "lat", "rating", "tel", "type"]
    with open(out_path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for p in all_pois:
            w.writerow(p)

    # 统计
    from collections import Counter
    cnt = Counter(p["brand"] for p in all_pois)
    print(f"\n完成 | 共 {len(all_pois)} 家竞品门店 → {out_path}")
    for b, n in cnt.items():
        print(f"  {b}: {n}")


if __name__ == "__main__":
    main()
