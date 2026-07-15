#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
backfill_sales.py — 从 2025-01-01 回填销售数据到观远 BI
=====================================================
特性:
  - 断点续传: 记录已完成的批次到 checkpoint 文件
  - 小批次: 默认 15 天/批，避免 50K 截断
  - 间隔延迟: 批次间等待，避免 API 限流
  - 增量合并: 与现有 store_daily_sales.csv 合并，不丢失数据
  - 进度日志: 每批完成后记录，中断后可从上次继续

用法:
  python backfill_sales.py                          # 从 2025-01-01 回填
  python backfill_sales.py --start 2025-01-01       # 自定义起始日期
  python backfill_sales.py --batch-days 10          # 更小的批次
  python backfill_sales.py --resume                 # 从 checkpoint 继续
  python backfill_sales.py --dry-run                # 只打印计划，不拉数据
"""

import argparse
import csv
import json
import os
import sys
import time
from datetime import date, datetime, timedelta

# Windows GBK 编码兼容
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# 复用现有 ETL 的 guancli 调用逻辑
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from etl_pull_data import (
    run_guancli, load_json, GUANCLI_PROFILE, DS_HOURLY, HOURLY_COLS,
    _find_node, _find_guancli_js
)

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
CHECKPOINT_FILE = os.path.join(OUTPUT_DIR, "_backfill_checkpoint.json")

# 默认配置
DEFAULT_START = date(2025, 1, 1)
DEFAULT_BATCH_DAYS = 15       # 每批天数（保守值，避免 50K 截断）
BATCH_DELAY = 5               # 批次间等待秒数
PROBE_DELAY = 3               # 探测后等待秒数


def load_checkpoint():
    """加载断点续传记录"""
    if os.path.exists(CHECKPOINT_FILE):
        with open(CHECKPOINT_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {"completed_batches": [], "last_date": None, "total_rows": 0}


def save_checkpoint(cp):
    """保存断点续传记录"""
    with open(CHECKPOINT_FILE, 'w', encoding='utf-8') as f:
        json.dump(cp, f, ensure_ascii=False, indent=2)


def date_range_batches(start, end, batch_days):
    """生成日期批次列表"""
    batches = []
    current = start
    while current <= end:
        batch_end = min(current + timedelta(days=batch_days - 1), end)
        batches.append((current, batch_end))
        current = batch_end + timedelta(days=1)
    return batches


def probe_day_rows(probe_date, output_dir):
    """探测单日行数，用于校准批次大小"""
    probe_out = os.path.join(output_dir, "_probe_backfill.json")
    run_guancli(DS_HOURLY,
                filters=[f"orderDate EQ {probe_date.isoformat()}",
                         "是否子店 EQ 否", "isCancel EQ 0"],
                columns=HOURLY_COLS, limit=50000, out_file=probe_out)
    pdata = load_json(probe_out)
    return len(pdata)


def pull_batch(start_d, end_d, batch_num, total_batches, output_dir):
    """拉取一个批次的小时数据"""
    batch_out = os.path.join(output_dir, f"_backfill_b{batch_num}.json")

    run_guancli(DS_HOURLY,
                filters=[f"orderDate BT {start_d.isoformat()},{end_d.isoformat()}",
                         "是否子店 EQ 否", "isCancel EQ 0"],
                columns=HOURLY_COLS, limit=50000, out_file=batch_out)

    bdata = load_json(batch_out)
    truncated = len(bdata) >= 50000

    if truncated:
        print(f"  ️  批次 {batch_num} 达到 50K 上限! 数据可能被截断")
        print(f"     建议: 用 --batch-days {max(1, DEFAULT_BATCH_DAYS // 2)} 重新运行")

    return bdata, truncated


def aggregate_and_merge(all_raw, output_dir):
    """聚合小时数据为日维度，并合并到现有 CSV"""
    agg = {}
    ch_agg = {}
    for row in all_raw:
        sid = str(row.get("StoreID", ""))
        od = str(row.get("orderDate", ""))
        if not sid or not od:
            continue
        rev = float(row.get("revenue", 0) or 0)
        tc = int(row.get("TC", 0) or 0)

        key = (sid, od)
        if key not in agg:
            agg[key] = {"revenue": 0.0, "orders": 0}
        agg[key]["revenue"] += rev
        agg[key]["orders"] += tc

        ot = str(row.get("orderType_Level1", "")).strip()
        if ot:
            ch_key = (sid, od, ot)
            if ch_key not in ch_agg:
                ch_agg[ch_key] = {"revenue": 0.0, "orders": 0}
            ch_agg[ch_key]["revenue"] += rev
            ch_agg[ch_key]["orders"] += tc

    # 合并到 store_daily_sales.csv
    csv_path = os.path.join(output_dir, "store_daily_sales.csv")
    existing = {}
    if os.path.exists(csv_path):
        with open(csv_path, "r", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                key = (row["营业日期"], row["门店ID"])
                existing[key] = [row["营业日期"], row["门店ID"],
                                 row["当日销售额"], row["当日订单量"]]

    for (sid, od), v in agg.items():
        existing[(od, sid)] = [od, sid, round(v["revenue"], 2), v["orders"]]

    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["营业日期", "门店ID", "当日销售额", "当日订单量"])
        for key in sorted(existing.keys()):
            w.writerow(existing[key])

    # 合并到 store_channel_sales.csv
    ch_csv_path = os.path.join(output_dir, "store_channel_sales.csv")
    ch_existing = {}
    if os.path.exists(ch_csv_path):
        with open(ch_csv_path, "r", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                ch_key = (row["门店ID"], row["营业日期"], row["渠道"])
                ch_existing[ch_key] = {
                    "revenue": float(row["渠道销售额"]),
                    "orders": int(row["渠道订单量"])
                }
    for (sid, od, ot), v in ch_agg.items():
        ch_existing[(sid, od, ot)] = {"revenue": round(v["revenue"], 2), "orders": v["orders"]}

    with open(ch_csv_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["门店ID", "营业日期", "渠道", "渠道销售额", "渠道订单量"])
        for key in sorted(ch_existing.keys()):
            sid, od, ot = key
            w.writerow([sid, od, ot, ch_existing[key]["revenue"], ch_existing[key]["orders"]])

    return len(existing), len(ch_existing)


def generate_sales_json(output_dir):
    """从 store_daily_sales.csv 生成 sales_data.json (供前端用)"""
    csv_path = os.path.join(output_dir, "store_daily_sales.csv")
    sales = {}
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sid = row["门店ID"]
            od = row["营业日期"]
            val = float(row["当日销售额"])
            if sid not in sales:
                sales[sid] = {}
            sales[sid][od] = val

    out_path = os.path.join(output_dir, "store_daily_sales_data.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(sales, f, ensure_ascii=False)

    # 同时复制到 store-network-v2 的 public/data/
    v2_path = os.path.join(output_dir, "..", "store-network-v2", "public", "data", "sales_data.json")
    v2_path = os.path.normpath(v2_path)
    if os.path.exists(os.path.dirname(v2_path)):
        with open(v2_path, "w", encoding="utf-8") as f:
            json.dump(sales, f, ensure_ascii=False)

    total_dates = set()
    for v in sales.values():
        total_dates.update(v.keys())
    print(f"  -> sales_data.json: {len(sales)} 店, {len(total_dates)} 天")
    return sales


def main():
    parser = argparse.ArgumentParser(description="Wagas 销售数据回填 (2025-01-01 起)")
    parser.add_argument("--start", type=str, default="2025-01-01", help="起始日期 (YYYY-MM-DD)")
    parser.add_argument("--end", type=str, default=None, help="结束日期 (默认昨天)")
    parser.add_argument("--batch-days", type=int, default=DEFAULT_BATCH_DAYS, help="每批天数")
    parser.add_argument("--delay", type=int, default=BATCH_DELAY, help="批次间延迟秒数")
    parser.add_argument("--resume", action="store_true", help="从 checkpoint 继续")
    parser.add_argument("--dry-run", action="store_true", help="只打印计划")
    parser.add_argument("--output-dir", default=None, help="输出目录")
    args = parser.parse_args()

    output_dir = args.output_dir or OUTPUT_DIR
    os.makedirs(output_dir, exist_ok=True)

    start_date = datetime.strptime(args.start, "%Y-%m-%d").date()
    end_date = datetime.strptime(args.end, "%Y-%m-%d").date() if args.end else date.today() - timedelta(days=1)

    print("=" * 60)
    print("Wagas 销售数据回填")
    print(f"  范围: {start_date} ~ {end_date}")
    print(f"  批次: {args.batch_days} 天/批, 间隔 {args.delay}s")
    print(f"  输出: {output_dir}")
    print("=" * 60)

    # 探测单日行数
    print("\n[探测] 采样单日数据量...")
    sample_date = end_date - timedelta(days=1)
    day_rows = probe_day_rows(sample_date, output_dir)
    safe_batch = max(1, min(args.batch_days, 48000 // max(day_rows, 1)))
    if safe_batch < args.batch_days:
        print(f"  ⚠️  单日 {day_rows} 行, 建议批次 ≤ {safe_batch} 天 (当前 {args.batch_days})")
    else:
        print(f"  ✓ 单日 {day_rows} 行, {args.batch_days} 天批次安全")
    time.sleep(PROBE_DELAY)

    # 生成批次计划
    batches = date_range_batches(start_date, end_date, args.batch_days)
    print(f"\n[计划] 共 {len(batches)} 批:")
    for i, (s, e) in enumerate(batches):
        print(f"  批次 {i+1}: {s} ~ {e}")

    if args.dry_run:
        print("\n[dry-run] 结束，未拉取数据")
        return

    # 加载 checkpoint
    cp = load_checkpoint() if args.resume else {"completed_batches": [], "last_date": None, "total_rows": 0}
    completed = set(cp["completed_batches"])

    # 执行回填
    all_new_raw = []
    total_new_rows = 0
    truncated_batches = []

    for i, (batch_start, batch_end) in enumerate(batches):
        batch_key = f"{batch_start.isoformat()}_{batch_end.isoformat()}"

        if batch_key in completed:
            print(f"\n[跳过] 批次 {i+1}/{len(batches)}: {batch_start}~{batch_end} (已完成)")
            continue

        print(f"\n[拉取] 批次 {i+1}/{len(batches)}: {batch_start} ~ {batch_end}")
        try:
            bdata, truncated = pull_batch(batch_start, batch_end, i + 1, len(batches), output_dir)
        except Exception as e:
            print(f"   批次 {i+1} 失败: {e}")
            print(f"  修复后使用 --resume 继续")
            save_checkpoint(cp)
            return

        all_new_raw.extend(bdata)
        total_new_rows += len(bdata)

        if truncated:
            truncated_batches.append(i + 1)

        # 标记完成
        completed.add(batch_key)
        cp["completed_batches"] = list(completed)
        cp["last_date"] = batch_end.isoformat()
        cp["total_rows"] = total_new_rows
        save_checkpoint(cp)

        print(f"  ✓ {len(bdata)} 行 (累计 {total_new_rows})")

        # 批次间延迟
        if i < len(batches) - 1:
            time.sleep(args.delay)

    # 聚合并合并
    if all_new_raw:
        print(f"\n[聚合] {len(all_new_raw)} 行原始数据 -> 日维度...")
        sales_rows, channel_rows = aggregate_and_merge(all_new_raw, output_dir)
        print(f"  store_daily_sales.csv: {sales_rows} 行")
        print(f"  store_channel_sales.csv: {channel_rows} 行")

        # 生成 sales_data.json
        print("\n[生成] sales_data.json...")
        generate_sales_json(output_dir)
    else:
        print("\n[跳过] 无新数据需要聚合")

    # 最终统计
    print("\n" + "=" * 60)
    print("回填完成!")
    print(f"  新拉取: {total_new_rows} 行原始数据")
    print(f"  完成批次: {len(completed)}/{len(batches)}")
    if truncated_batches:
        print(f"  ⚠️  截断批次: {truncated_batches}")
    print("=" * 60)

    # 清理 checkpoint
    if len(completed) == len(batches):
        os.remove(CHECKPOINT_FILE)
        print("  checkpoint 已清理 (全部完成)")


if __name__ == "__main__":
    main()
