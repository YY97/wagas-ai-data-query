#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
post_backfill.py — 回填后重新生成 stores.json 并部署
=====================================================
在 backfill_sales.py 完成后运行，执行:
  1. 从旧版 HTML 提取门店基础数据 (market, channel, dist, overlap)
  2. 用新的 sales_data.json 计算 ADS
  3. 生成 stores.json (GCJ-02 坐标)
  4. 构建并部署到 GitHub Pages

用法:
  python post_backfill.py              # 完整流程
  python post_backfill.py --skip-deploy  # 只生成数据，不部署
"""

import argparse
import csv
import json
import math
import os
import re
import subprocess
import sys
from datetime import date

BASE = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE, "output")
V2_DIR = os.path.join(BASE, "store-network-v2")

R = 6371000

def hd(lat1, lng1, lat2, lng2):
    r1, r2 = math.radians(lat1), math.radians(lat2)
    da, db = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
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


def step1_extract_old_stores():
    """从旧版 HTML 提取门店基础数据"""
    print("\n=== Step 1: 从旧版 HTML 提取门店数据 ===")
    html_path = os.path.join(BASE, "wagas_stores_coverage_v4.html")
    if not os.path.exists(html_path):
        print("  [ERROR] wagas_stores_coverage_v4.html 不存在!")
        return None

    with open(html_path, 'r', encoding='utf-8') as f:
        html = f.read()
    match = re.search(r'var stores=(\[.*?\]);\s*var', html, re.DOTALL)
    if not match:
        print("  [ERROR] 无法从 HTML 提取 stores 数据")
        return None

    old_stores = json.loads(match.group(1))
    print(f"  提取 {len(old_stores)} 家门店")
    return old_stores


def step2_load_sales_data():
    """加载回填后的销售数据"""
    print("\n=== Step 2: 加载销售数据 ===")
    sales_path = os.path.join(V2_DIR, "public", "data", "sales_data.json")
    if not os.path.exists(sales_path):
        # 从 output 目录生成
        csv_path = os.path.join(OUTPUT_DIR, "store_daily_sales.csv")
        if not os.path.exists(csv_path):
            print("  [ERROR] store_daily_sales.csv 不存在!")
            return None
        sales = {}
        with open(csv_path, 'r', encoding='utf-8-sig') as f:
            for row in csv.DictReader(f):
                sid = row["门店ID"]
                od = row["营业日期"]
                val = float(row["当日销售额"])
                if sid not in sales:
                    sales[sid] = {}
                sales[sid][od] = val
        with open(sales_path, 'w', encoding='utf-8') as f:
            json.dump(sales, f, ensure_ascii=False)
        print(f"  从 CSV 生成 sales_data.json: {len(sales)} 店")
    else:
        with open(sales_path, 'r', encoding='utf-8') as f:
            sales = json.load(f)
        print(f"  加载 sales_data.json: {len(sales)} 店")

    # 统计日期范围
    all_dates = set()
    for v in sales.values():
        all_dates.update(v.keys())
    dates = sorted(all_dates)
    print(f"  日期范围: {dates[0]} ~ {dates[-1]} ({len(dates)} 天)")
    return sales


def step3_build_stores_json(old_stores, sales_data):
    """构建 stores.json"""
    print("\n=== Step 3: 构建 stores.json ===")
    new_stores = []
    for s in old_stores:
        gcj_lng, gcj_lat = wgs84_to_gcj02(s['lng'], s['lat'])
        sid = s['sid']

        # ADS 从 sales_data 计算
        ads = 0
        if sid in sales_data and sales_data[sid]:
            vals = [v for v in sales_data[sid].values() if v and v > 0]
            ads = sum(vals) / len(vals) if vals else 0

        ch = s.get('channel')
        if ch and ch.get('dine_in_avg') is None and ch.get('delivery_avg') is None:
            ch = None
        mk = s.get('market')
        if mk and mk.get('poi_count', 0) == 0:
            mk = None

        new_stores.append({
            'sid': sid, 'name': s['name'],
            'brand': s.get('brand', ''), 'city': s.get('city', ''),
            'addr': s.get('addr', ''), 'fmt': s.get('fmt', ''),
            'lng': gcj_lng, 'lat': gcj_lat,
            'ads': ads, 'market': mk,
            'overlap': 0, 'overlap_names': [],
            'channel': ch, 'dist': s.get('dist')
        })

    # 计算重合度
    print("  计算 1km 重合度...")
    for i, s1 in enumerate(new_stores):
        nb = []
        for j, s2 in enumerate(new_stores):
            if i == j: continue
            if hd(s1['lat'], s1['lng'], s2['lat'], s2['lng']) <= 1.0:
                nb.append(s2['name'])
        s1['overlap'] = len(nb)
        s1['overlap_names'] = nb

    # 保存
    for path in [
        os.path.join(V2_DIR, "public", "data", "stores.json"),
        os.path.join(V2_DIR, "data", "stores.json")
    ]:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(new_stores, f, ensure_ascii=False, indent=2)

    print(f"  门店: {len(new_stores)}")
    print(f"  ADS>0: {sum(1 for s in new_stores if s['ads']>0)}")
    print(f"  渠道: {sum(1 for s in new_stores if s['channel'])}")
    print(f"  商圈: {sum(1 for s in new_stores if s['market'])}")
    print(f"  配送距离: {sum(1 for s in new_stores if s['dist'])}")
    print(f"  重合: {sum(1 for s in new_stores if s['overlap']>0)}")
    return new_stores


def step4_build_and_deploy(skip_deploy):
    """构建并部署"""
    print("\n=== Step 4: 构建部署 ===")

    # 恢复 source index.html
    index_path = os.path.join(V2_DIR, "index.html")
    with open(index_path, 'w', encoding='utf-8') as f:
        f.write("""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Wagas 门店网络效率诊断</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
""")

    # 清理旧 assets
    assets_dir = os.path.join(V2_DIR, "assets")
    for f in os.listdir(assets_dir):
        if f.startswith("index-") and (f.endswith(".js") or f.endswith(".css")):
            os.remove(os.path.join(assets_dir, f))

    # 构建
    print("  构建中...")
    result = subprocess.run(
        ["npx", "vite", "build"],
        cwd=V2_DIR, capture_output=True, text=True, timeout=120
    )
    if result.returncode != 0:
        print(f"  [ERROR] 构建失败:\n{result.stderr}")
        return False
    print("  构建成功")

    # 复制 dist 到 source tree
    dist_dir = os.path.join(V2_DIR, "dist")
    dist_index = os.path.join(dist_dir, "index.html")
    with open(dist_index, 'r', encoding='utf-8') as f:
        deployed_html = f.read()

    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(deployed_html)

    for f in os.listdir(os.path.join(dist_dir, "assets")):
        src = os.path.join(dist_dir, "assets", f)
        dst = os.path.join(assets_dir, f)
        import shutil
        shutil.copy2(src, dst)

    import shutil
    shutil.rmtree(dist_dir, ignore_errors=True)
    print("  部署文件已准备")

    if skip_deploy:
        print("  [跳过] 部署 (--skip-deploy)")
        return True

    # Git commit & push
    print("  Git commit & push...")
    subprocess.run(["git", "add", "store-network-v2/"], cwd=BASE, check=True)
    subprocess.run([
        "git", "commit", "-m",
        f"data: 回填销售数据至 {date.today().isoformat()}, 重新生成 stores.json"
    ], cwd=BASE, check=True)
    result = subprocess.run(["git", "push"], cwd=BASE, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        print(f"  [WARN] git push 失败: {result.stderr}")
    else:
        print("  推送成功")

    return True


def main():
    parser = argparse.ArgumentParser(description="回填后处理: 生成 stores.json + 部署")
    parser.add_argument("--skip-deploy", action="store_true", help="跳过 git 部署")
    args = parser.parse_args()

    print("=" * 60)
    print("Wagas 回填后处理")
    print("=" * 60)

    old_stores = step1_extract_old_stores()
    if not old_stores:
        print("[ERROR] 无法提取旧版门店数据")
        sys.exit(1)

    sales_data = step2_load_sales_data()
    if not sales_data:
        print("[ERROR] 无法加载销售数据")
        sys.exit(1)

    step3_build_stores_json(old_stores, sales_data)
    step4_build_and_deploy(args.skip_deploy)

    print("\n" + "=" * 60)
    print("全部完成!")
    print("=" * 60)


if __name__ == "__main__":
    main()
