#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Wagas 外卖配送点 — 热力图数据 ETL
数据源: 外卖平台经纬度数据 f95e1fb19f3434625b27a887
输出: output/delivery_points.json — {store_id: [{lat, lng, weight}, ...]}
策略: 按 store_id × (lat,lng) 去重，多天/多单累加权重
"""

import json, os, subprocess, sys
from collections import defaultdict
from datetime import date, timedelta

# ===== 跨平台 guancli 查找 =====
def _find_node():
    import shutil
    n = shutil.which("node") or shutil.which("node.exe")
    if n:
        return n
    if os.name == "nt":
        p = r"C:\Users\alex9\.workbuddy\binaries\node\versions\22.22.2\node.exe"
        if os.path.exists(p):
            return p
    raise FileNotFoundError("node not found")

def _find_guancli_js():
    js = os.environ.get("GUANCLI_JS")
    if js and os.path.exists(js):
        return js
    try:
        r = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True, check=True, timeout=10)
        nm = r.stdout.strip()
        p = os.path.join(nm, "@guandata", "guancli", "bin", "run.js")
        if os.path.exists(p):
            return p
    except:
        pass
    if os.name == "nt":
        p = r"C:\Users\alex9\.workbuddy\binaries\node\versions\22.22.2\node_modules\@guandata\guancli\bin\run.js"
        if os.path.exists(p):
            return p
    raise FileNotFoundError("guancli run.js not found")

NODE_EXE = _find_node()
GUANCLI_JS = _find_guancli_js()
DS_DELIVERY = "f95e1fb19f3434625b27a887"
DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 7
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)


def run(dsid, filters, columns, out_file):
    cmd = [NODE_EXE, GUANCLI_JS, "ds", "preview", dsid, "--profile", "wagas",
           "--columns", ",".join(columns), "--limit", "50000", "-f", "json"]
    for f in filters:
        cmd.extend(["--filter", f])
    print(f"  [guancli] {out_file} ...")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300, encoding='utf-8', errors='replace')
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(r.stdout or "")
    return json.loads(r.stdout) if r.stdout and r.stdout.strip() else []


print("=" * 60)
print(f"外卖配送点 ETL | 回溯 {DAYS} 天")
print("=" * 60)

today = date.today()
start = today - timedelta(days=DAYS - 1)

# 逐天拉取 (单日约 30K, 不截断)
all_rows = []
current = start
while current <= today:
    ds = current.isoformat()
    out_file = os.path.join(OUTPUT_DIR, f"_raw_delivery_{ds}.json")

    if not os.path.exists(out_file) or os.path.getsize(out_file) < 100:
        # 文件不存在或为空，重新拉取
        if os.path.exists(out_file) and os.path.getsize(out_file) < 100:
            os.remove(out_file)
        data = run(DS_DELIVERY,
                   filters=[f"orderDate EQ {ds}"],
                   columns=["StoreID", "latitude", "longitude", "orderType_level2"],
                   out_file=out_file)
    else:
        with open(out_file, "r", encoding="utf-8") as f:
            try:
                data = json.load(f)
            except json.JSONDecodeError:
                os.remove(out_file)
                data = run(DS_DELIVERY,
                           filters=[f"orderDate EQ {ds}"],
                           columns=["StoreID", "latitude", "longitude", "orderType_level2"],
                           out_file=out_file)
        print(f"  [cached] {out_file}")

    print(f"  {ds}: {len(data)} 行{' ⚠️截断' if len(data)>=50000 else ''}")
    all_rows.extend(data)
    current += timedelta(days=1)

print(f"\n总计: {len(all_rows)} 行")

# 按 store_id → (lat, lng) → 去重+累加权重
store_points = defaultdict(lambda: defaultdict(int))  # store_points[sid][(lat,lng)] = weight

for row in all_rows:
    sid = row.get("StoreID", "").strip()
    lat = row.get("latitude", "").strip()
    lng = row.get("longitude", "").strip()
    if not sid or not lat or not lng:
        continue
    try:
        lat = round(float(lat), 4)  # 四舍五入到 4 位小数（~11m 精度，合并相邻地址）
        lng = round(float(lng), 4)
    except (ValueError, TypeError):
        continue
    store_points[sid][(lat, lng)] += 1

# 转换为最终格式
result = {}
total_points = 0
max_weight = 0
for sid, points in store_points.items():
    result[sid] = []
    for (lat, lng), w in points.items():
        result[sid].append({"lat": lat, "lng": lng, "w": w})
        total_points += 1
        max_weight = max(max_weight, w)

print(f"\n聚合结果:")
print(f"  门店数: {len(result)}")
print(f"  唯一点: {total_points} (原始 {len(all_rows)} 行, 去重率 {total_points/len(all_rows)*100:.1f}%)")
print(f"  最大权重: {max_weight}")
print(f"  平均每店点数: {total_points/len(result):.1f}")

# 输出 JSON
out_path = os.path.join(OUTPUT_DIR, "delivery_points.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False)
size_mb = os.path.getsize(out_path) / 1024 / 1024
print(f"  -> {out_path} ({size_mb:.2f} MB)")
print("=" * 60)
