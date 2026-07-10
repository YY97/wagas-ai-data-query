#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Wagas 门店渠道销售拆分 ETL
数据源: ads_store_revenue_byHour_prd (x010c246a2e114278808e984)
输出: output/store_channel_sales.csv — 门店×日期×渠道 的销售和订单
"""

import csv
import json
import os
import subprocess
import sys
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
DS_HOURLY = "x010c246a2e114278808e984"
DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 2
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)


def run_guancli(dsid, filters, columns, out_file, limit=50000):
    cmd = [NODE_EXE, GUANCLI_JS, "ds", "preview", dsid, "--profile", "wagas",
           "--columns", ",".join(columns), "--limit", str(limit), "-f", "json"]
    for f in filters:
        cmd.extend(["--filter", f])
    print(f"  [guancli] {out_file} ...")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300, encoding='utf-8', errors='replace')
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(r.stdout or "")
    return json.loads(r.stdout) if r.stdout and r.stdout.strip() else []


print("=" * 60)
print(f"渠道销售 ETL | 回溯 {DAYS} 天")
print("=" * 60)

today = date.today()
start_date = today - timedelta(days=DAYS - 1)

# 逐天拉取
all_rows = []
current = start_date
while current <= today:
    ds = current.isoformat()
    out_file = os.path.join(OUTPUT_DIR, f"_raw_channel_{ds}.json")

    # 按门店×渠道聚合
    data = run_guancli(DS_HOURLY,
                       filters=[f"orderDate EQ {ds}", "isCancel EQ 0"],
                       columns=["StoreID", "orderDate", "orderType_Level1", "revenue", "TC"],
                       out_file=out_file,
                       limit=50000)
    print(f"  {ds}: {len(data)} 行")
    all_rows.extend(data)
    current += timedelta(days=1)

print(f"\n总计: {len(all_rows)} 行")

# 聚合: StoreID × orderDate × orderType_Level1
agg = defaultdict(lambda: {"revenue": 0.0, "orders": 0})
for row in all_rows:
    sid = row.get("StoreID", "").strip()
    od = row.get("orderDate", "").strip()
    ot = row.get("orderType_Level1", "").strip()
    if not sid or not od or not ot:
        continue
    key = (sid, od, ot)
    agg[key]["revenue"] += float(row.get("revenue", 0) or 0)
    agg[key]["orders"] += int(row.get("TC", 0) or 0)

# 读取已有数据并合并
csv_path = os.path.join(OUTPUT_DIR, "store_channel_sales.csv")
existing = {}
if os.path.exists(csv_path):
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            key = (row["门店ID"], row["营业日期"], row["渠道"])
            existing[key] = {
                "revenue": float(row["渠道销售额"]),
                "orders": int(row["渠道订单量"])
            }

for key, val in agg.items():
    existing[key] = val

# 写 CSV
with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f)
    w.writerow(["门店ID", "营业日期", "渠道", "渠道销售额", "渠道订单量"])
    for key in sorted(existing.keys()):
        sid, od, ot = key
        w.writerow([sid, od, ot, round(existing[key]["revenue"], 2), existing[key]["orders"]])

print(f"  -> {csv_path} ({len(existing)} 行)")
print("=" * 60)
