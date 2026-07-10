#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Wagas 门店网络效率 — 从观远 BI 拉取数据 ETL
=====================================================
数据源：
  ① StoreMaster Report     → b39bc457c678f4596aac4bda
  ② ads_store_revenue_byHour_prd → x010c246a2e114278808e984

输出：
  output/store_master.csv           — 门店主数据
  output/store_daily_sales.csv      — 门店日销售额 (粒度: store × day)
  output/store_daily_latest_ads.csv — 最新一天各店日均销售额 (供地图用)

用法：
  python etl_pull_data.py --days 35
"""

import argparse
import csv
import json
import math
import os
import subprocess
import sys
import time
from datetime import date, timedelta

# ============================================================
# 配置
# ============================================================
GUANCLI_PROFILE = "wagas"
DS_STOREMASTER = "b39bc457c678f4596aac4bda"
DS_HOURLY = "x010c246a2e114278808e984"

SM_COLS = [
    "Store ID", "门店名称(中文)", "品牌", "城市(中文)",
    "区域(中文)", "门店位置类型L1", "经度", "纬度",
    "是否为子店", "门店状态", "开业日期", "门店地址(中文)",
]

HOURLY_COLS = ["StoreID", "orderDate", "revenue", "TC"]


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
    # 通过 npm 全局目录查找
    try:
        r = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True, check=True, timeout=10)
        nm = r.stdout.strip()
        p = os.path.join(nm, "@guandata", "guancli", "bin", "run.js")
        if os.path.exists(p):
            return p
    except:
        pass
    # Windows 回退
    if os.name == "nt":
        p = r"C:\Users\alex9\.workbuddy\binaries\node\versions\22.22.2\node_modules\@guandata\guancli\bin\run.js"
        if os.path.exists(p):
            return p
    raise FileNotFoundError("guancli run.js not found")

GUANCLI_EXE = _find_node()
GUANCLI_SCRIPT = _find_guancli_js()

def run_guancli(ds_id, filters, columns, limit=50000, out_file=None):
    cmd = [GUANCLI_EXE, GUANCLI_SCRIPT, "ds", "preview", ds_id,
           "--profile", GUANCLI_PROFILE,
           "--columns", ",".join(columns),
           "--limit", str(limit), "-f", "json"]
    for f in filters:
        cmd.extend(["--filter", f])
    if out_file is None:
        out_file = os.path.join(os.environ.get("TEMP", "."),
                               f"guancli_{ds_id[:8]}.json")

    print(f"  [guancli] pulling {len(columns)} cols to {os.path.basename(out_file)} ...")

    for attempt in range(3):
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300, encoding='utf-8', errors='replace')
        if result.returncode == 0 and result.stdout and result.stdout.strip():
            break
        print(f"  [RETRY {attempt+1}/3] guancli exit={result.returncode}" + (f" err={result.stderr[:60]}" if result.stderr else ""))
        if attempt < 2:
            time.sleep(5)

    with open(out_file, "w", encoding="utf-8") as fout:
        fout.write(result.stdout or "")
    if result.returncode != 0:
        print(f"  [WARN] guancli exit code={result.returncode}")
    return out_file


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read().strip()
    if not content:
        return []
    return json.loads(content)


def haversine_km(lat1, lng1, lat2, lng2):
    R = 6371000
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)) / 1000


# ============================================================
# Step 1: 拉取 StoreMaster
# ============================================================
def pull_store_master(output_dir):
    print("\n=== Step 1: 拉取 StoreMaster ===")
    out = os.path.join(output_dir, "_raw_storemaster.json")
    run_guancli(DS_STOREMASTER,
                filters=["门店状态 EQ 已开业"],
                columns=SM_COLS, limit=50000, out_file=out)
    rows = load_json(out)
    print(f"  原始已开业门店: {len(rows)} 行")

    valid = []
    for r in rows:
        lng = str(r.get("经度", "")).strip()
        lat = str(r.get("纬度", "")).strip()
        if lng and lat and lng != "None" and lat != "None":
            try:
                r["_lng"] = float(lng)
                r["_lat"] = float(lat)
                valid.append(r)
            except ValueError:
                pass
    print(f"  有效坐标门店: {len(valid)} 行")

    # 写 CSV（空数据时不覆盖旧文件）
    csv_path = os.path.join(output_dir, "store_master.csv")
    if not valid and os.path.exists(csv_path) and os.path.getsize(csv_path) > 200:
        print(f"  [WARN] 拉到 0 家门店，保留已有 store_master.csv")
        return []
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["Store_ID", "门店名称", "品牌", "城市", "商圈", "业态",
                    "经度", "纬度", "是否子店", "门店状态", "开店日期", "门店地址"])
        for s in valid:
            w.writerow([
                s.get("Store ID", ""), s.get("门店名称(中文)", ""),
                s.get("品牌", ""), s.get("城市(中文)", ""),
                s.get("区域(中文)", ""), s.get("门店位置类型L1", ""),
                s.get("经度", ""), s.get("纬度", ""),
                s.get("是否为子店", ""), s.get("门店状态", ""),
                s.get("开业日期", ""), s.get("门店地址(中文)", ""),
            ])
    print(f"  -> {csv_path}")
    return valid


# ============================================================
# Step 2: 拉取小时销售并聚合为 store × day
# ============================================================
def pull_daily_sales(days_back, output_dir):
    print(f"\n=== Step 2: 拉取小时销售 (近 {days_back} 天) ===")
    today = date.today()
    start_date = today - timedelta(days=days_back)  # 从昨天往回算 N 天（今天数据还没产生）

    # 探测单日行数
    probe_date = today - timedelta(days=1)
    probe_out = os.path.join(output_dir, "_probe_hourly.json")
    run_guancli(DS_HOURLY,
                filters=[f"orderDate EQ {probe_date.isoformat()}",
                         "是否子店 EQ 否", "isCancel EQ 0"],
                columns=HOURLY_COLS, limit=50000, out_file=probe_out)
    pdata = load_json(probe_out)
    day_rows = len(pdata)
    batch_days = max(1, min(30, 48000 // max(day_rows, 1)))
    total_batches = (days_back + batch_days - 1) // batch_days
    print(f"  单日约 {day_rows} 行 -> 每 {batch_days} 天一批 -> 共 {total_batches} 批")

    all_raw = []
    current = start_date
    batch_num = 0
    while current <= today:
        batch_end = min(current + timedelta(days=batch_days - 1), today)
        batch_num += 1
        batch_out = os.path.join(output_dir, f"_raw_hourly_b{batch_num}.json")

        run_guancli(DS_HOURLY,
                    filters=[f"orderDate BT {current.isoformat()},{batch_end.isoformat()}",
                             "是否子店 EQ 否", "isCancel EQ 0"],
                    columns=HOURLY_COLS, limit=50000, out_file=batch_out)
        bdata = load_json(batch_out)

        if len(bdata) >= 50000:
            print(f"  [WARN] 批次 {batch_num} 截断! 需要缩小 batch_days")
        all_raw.extend(bdata)
        print(f"  批次 {batch_num}/{total_batches}: {len(bdata)} 行 ({current} ~ {batch_end})")
        current = batch_end + timedelta(days=1)

    print(f"  总计拉取: {len(all_raw)} 行")

    # 聚合: StoreID x orderDate
    agg = {}
    for row in all_raw:
        sid = str(row.get("StoreID", ""))
        od = str(row.get("orderDate", ""))
        if not sid or not od:
            continue
        key = (sid, od)
        if key not in agg:
            agg[key] = {"revenue": 0.0, "orders": 0}
        agg[key]["revenue"] += float(row.get("revenue", 0) or 0)
        agg[key]["orders"] += int(row.get("TC", 0) or 0)

    result = []
    for (sid, od), v in sorted(agg.items()):
        result.append({
            "StoreID": sid, "orderDate": od,
            "daily_sales": round(v["revenue"], 2),
            "daily_orders": v["orders"],
        })

    unique_dates = sorted(set(r["orderDate"] for r in result))
    stores_set = set(r["StoreID"] for r in result)
    print(f"  聚合后: {len(result)} 行 ({len(stores_set)} 店 x {len(unique_dates)} 天)")

    # 写 CSV（合并已有数据，防止空跑覆盖）
    csv_path = os.path.join(output_dir, "store_daily_sales.csv")
    existing = {}
    if os.path.exists(csv_path):
        with open(csv_path, "r", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                key = (row["营业日期"], row["门店ID"])
                existing[key] = [row["营业日期"], row["门店ID"], row["当日销售额"], row["当日订单量"]]
    for r in result:
        existing[(r["orderDate"], r["StoreID"])] = [r["orderDate"], r["StoreID"], r["daily_sales"], r["daily_orders"]]

    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["营业日期", "门店ID", "当日销售额", "当日订单量"])
        for key in sorted(existing.keys()):
            w.writerow(existing[key])
    print(f"  -> {csv_path} ({len(existing)} 行)")

    # 最新一天各店 ADS (供地图)
    latest = max(unique_dates, key=lambda d: d) if unique_dates else ""
    latest_rows = [r for r in result if r["orderDate"] == latest]
    ads_csv = os.path.join(output_dir, "store_daily_latest_ads.csv")
    with open(ads_csv, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["门店ID", "数据日期", "当日销售额", "当日订单量"])
        for r in latest_rows:
            w.writerow([r["StoreID"], r["orderDate"], r["daily_sales"], r["daily_orders"]])
    print(f"  -> {ads_csv} ({len(latest_rows)} 店, 日期={latest})")

    return result, latest


# ============================================================
# Main
# ============================================================
def main():
    parser = argparse.ArgumentParser(description="Wagas 门店网络效率 ETL - 数据拉取")
    parser.add_argument("--days", type=int, default=35, help="回溯天数 (默认 35)")
    parser.add_argument("--output-dir", default=None, help="输出目录")
    args = parser.parse_args()

    if args.output_dir is None:
        args.output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
    os.makedirs(args.output_dir, exist_ok=True)

    print("=" * 60)
    print(f"Wagas 门店网络效率 ETL — 数据拉取")
    print(f"回溯: {args.days} 天 | 输出: {args.output_dir}")
    print(f"运行日期: {date.today().isoformat()}")
    print("=" * 60)

    stores = pull_store_master(args.output_dir)
    daily_sales, latest_date = pull_daily_sales(args.days, args.output_dir)

    print("\n" + "=" * 60)
    print("ETL 拉取完成!")
    print(f"  门店主数据: {len(stores)} 行")
    print(f"  日销售数据: {len(daily_sales)} 行")
    print(f"  最新数据日期: {latest_date}")
    print("=" * 60)


if __name__ == "__main__":
    main()
