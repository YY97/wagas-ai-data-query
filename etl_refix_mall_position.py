#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修复商场坐标错位：用「商场名称」通过高德 place/text 关键字搜索重新定位
=========================================================================
背景：Excel「地址」列发生系统性串行错位，导致 geocode 用错误地址解析出错误坐标。
但「商场名称」列是可靠的，因此改用名称（POI 关键字搜索）重新定位。

识别错位商场的三类信号：
  1. null 坐标（之前 geocode 失败）
  2. 跨城错配（地址城市名 != key 城市名）
  3. 异常坐标重合（多个不同商场共用同一坐标）

修复方式：place/text 关键字搜索（types=060100 商场），取第一个匹配 POI 的坐标，
  并用名称相似度校验防止搜错。

用法：
  python etl_refix_mall_position.py --excel "商场数据结构化总表.xlsx" \
      --geocode store-network-v2/public/data/malls_geocoded.json \
      --output-dir store-network-v2/public/data
  AMAP_KEY 通过环境变量传入
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

AMAP_TEXT = "https://restapi.amap.com/v3/place/text"
AMAP_GEOCODE = "https://restapi.amap.com/v3/geocode/geo"
SLEEP_BETWEEN = 0.1  # 每秒约 10 次，低于高德 QPS 限制

CITY_LIST = ['上海市', '北京市', '广州市', '深圳市', '成都市', '杭州市', '南京市',
             '苏州市', '宁波市', '武汉市', '西安市', '重庆市', '青岛市', '无锡市', '温州市']


def api_get(url):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def extract_city(addr):
    """从地址开头提取地级市名"""
    if not addr:
        return None
    m1 = re.match(r'^(北京市|上海市|重庆市|天津市)', addr)
    if m1:
        return m1.group(1)
    m2 = re.match(r'^.+?省(.{2,4}?市)', addr)
    if m2:
        return m2.group(1)
    m3 = re.match(r'^.+?自治区(.{2,4}?市)', addr)
    if m3:
        return m3.group(1)
    m4 = re.match(r'^(广州市|深圳市|成都市|杭州市|南京市|苏州市|宁波市|武汉市|西安市|青岛市|无锡市|温州市)', addr)
    if m4:
        return m4.group(1)
    return None


def normalize(s):
    """去掉城市前缀和标点，用于名称相似度比较"""
    if not s:
        return ''
    s = re.sub(r'(上海市|北京市|广州市|深圳市|成都市|杭州市|南京市|苏州市|宁波市|武汉市|西安市|重庆市|青岛市|无锡市|温州市|上海|北京|广州|深圳|成都|杭州|南京|苏州|宁波|武汉|西安|重庆|青岛|无锡|温州)', '', s)
    return re.sub(r'[^a-zA-Z0-9\u4e00-\u9fa5]', '', s).lower()


def name_similar(a, b):
    """名称相似：一个是另一个的子串（去城市前缀+标点后）"""
    na, nb = normalize(a), normalize(b)
    if not na or not nb:
        return False
    return na in nb or nb in na


def search_by_name(key, name, city):
    """用商场名称 + 城市，通过 place/text 搜索商场 POI，返回 (lng, lat, poi_name) 或 None"""
    params = urllib.parse.urlencode({
        "key": key, "keywords": name, "city": city,
        "citylimit": "true", "types": "060100", "offset": "3",
        "page": "1", "extensions": "base", "output": "json",
    })
    try:
        data = api_get(f"{AMAP_TEXT}?{params}")
    except Exception as e:
        return None, f"EXCEPTION: {e}"

    if data.get("status") != "1":
        return None, f"API_FAIL: {data.get('info')}"

    pois = data.get("pois", []) or []
    if not pois:
        return None, "NO_RESULT"

    # 优先找名称匹配的 POI
    for p in pois:
        pname = p.get("name", "") or ""
        loc = p.get("location", "") or ""
        if not loc:
            continue
        lng, lat = loc.split(",")
        if name_similar(name, pname):
            return (float(lng), float(lat), pname), None

    # 兜底：取第一个（名称不匹配，但至少是同城商场搜索的第一个结果）
    p = pois[0]
    loc = p.get("location", "") or ""
    if loc:
        lng, lat = loc.split(",")
        return (float(lng), float(lat), p.get("name", "")), "NAME_MISMATCH"
    return None, "NO_LOCATION"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--key", default=os.environ.get("AMAP_KEY", ""))
    parser.add_argument("--excel", required=True)
    parser.add_argument("--geocode", required=True, help="malls_geocoded.json 路径")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--dry-run", action="store_true", help="只测前 5 个，不写缓存")
    parser.add_argument("--limit", type=int, default=0, help="限制修复数量（0=全部）")
    args = parser.parse_args()

    if not args.key:
        print("[ERROR] 缺少高德 Key")
        sys.exit(1)

    # 读缓存
    with open(args.geocode, "r", encoding="utf-8") as f:
        cache = json.load(f)

    # 读 Excel 拿名称
    import openpyxl
    wb = openpyxl.load_workbook(args.excel, data_only=True)
    ws = wb["商场总览"]
    name_map = {}  # {city}_{name} -> name
    for row in ws.iter_rows(min_row=2, values_only=True):
        city = str(row[0]).strip() if row[0] else ""
        name = str(row[1]).strip() if row[1] else ""
        if city and name:
            name_map[f"{city}_{name}"] = name

    # ===== 检测错位商场 =====
    # 1. 坐标重合组
    coord_map = {}
    for k, v in cache.items():
        lat, lng = v.get("lat"), v.get("lng")
        if lat is not None and lng is not None:
            ck = f"{lat:.6f},{lng:.6f}"
            coord_map.setdefault(ck, []).append(k)

    abnormal_keys = set()
    for ck, ks in coord_map.items():
        if len(ks) < 2:
            continue
        names = [name_map.get(k, k.split('_', 1)[1]) for k in ks]
        all_alias = True
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                if not name_similar(names[i], names[j]):
                    all_alias = False
                    break
            if not all_alias:
                break
        if not all_alias:
            abnormal_keys.update(ks)

    # 2. 跨城错配 + null 坐标
    cross_keys = set()
    null_keys = set()
    for k, v in cache.items():
        key_city = k.split('_')[0]
        addr = v.get("address", "") or ""
        if v.get("lat") is None or v.get("lng") is None:
            null_keys.add(k)
            continue
        addr_city = extract_city(addr)
        if addr_city and addr_city != key_city:
            cross_keys.add(k)

    fix_keys = abnormal_keys | cross_keys | null_keys
    print(f"[INFO] 缓存总数: {len(cache)}")
    print(f"[INFO] 待修复: 异常重合 {len(abnormal_keys)}, 跨城 {len(cross_keys)}, null {len(null_keys)}")
    print(f"[INFO] 去重后待修复: {len(fix_keys)}")

    if args.dry_run:
        fix_list = sorted(fix_keys)[:5]
        print(f"[DRY-RUN] 只测前 {len(fix_list)} 个")
    elif args.limit > 0:
        fix_list = sorted(fix_keys)[:args.limit]
    else:
        fix_list = sorted(fix_keys)

    fixed = 0
    failed = 0
    results = []
    for i, k in enumerate(fix_list):
        key_city = k.split('_')[0]
        name = name_map.get(k, k.split('_', 1)[1])
        old = cache.get(k, {})
        old_loc = (old.get("lng"), old.get("lat"))

        res, err = search_by_name(args.key, name, key_city)
        if res is not None:
            lng, lat, poi_name = res
            cache[k] = {"lng": lng, "lat": lat, "address": old.get("address", ""), "poi_name": poi_name}
            fixed += 1
            results.append({"key": k, "old": list(old_loc), "new": [lng, lat], "poi": poi_name, "status": "FIXED"})
            print(f"[{i+1}/{len(fix_list)}] ✅ {k} ({name}) {old_loc} → ({lng},{lat}) [{poi_name}]")
        else:
            failed += 1
            results.append({"key": k, "old": list(old_loc), "status": "FAILED", "err": err})
            print(f"[{i+1}/{len(fix_list)}] ❌ {k} ({name}) {old_loc} → {err}")

        time.sleep(SLEEP_BETWEEN)

    # 保存
    if not args.dry_run:
        out_path = os.path.join(args.output_dir, "malls_geocoded.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
        print(f"\n[DONE] 修复 {fixed} 个, 失败 {failed} 个")
        print(f"  缓存已更新: {out_path}")

        # 保存修复明细
        detail_path = os.path.join(args.output_dir, "mall_refix_detail.json")
        with open(detail_path, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"  修复明细: {detail_path}")
    else:
        print(f"\n[DRY-RUN DONE] 测试 {fixed} 个成功, {failed} 个失败（未写缓存）")


if __name__ == "__main__":
    main()
