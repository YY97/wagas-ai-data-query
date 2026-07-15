#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
monthly_sync.py — Wagas 门店网络 v2 月度/季度同步
=====================================================
每月 1 号运行：
  ① 商圈环境数据 → store_market_context.csv（高德 POI API）
  ② 热门配送地 TOP10 → delivery_top_locations.json

每季度（1/4/7/10 月 1 号）运行：
  ③ 商圈环境数据（季度更新更合理）

用法：
  python monthly_sync.py                          # 完整月度同步
  python monthly_sync.py --quarterly              # 仅季度任务
  python monthly_sync.py --market-only            # 仅商圈环境
  python monthly_sync.py --toploc-only            # 仅热门配送地
"""

import argparse
import os
import sys
import subprocess
from datetime import date

if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

BASE = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE, "output")

def get_amap_key():
    """从环境变量或 .env 文件获取高德 API key"""
    key = os.environ.get('AMAP_KEY', '')
    if key: return key
    env_path = os.path.join(BASE, '.env')
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                if line.startswith('AMAP_KEY='):
                    return line.strip().split('=', 1)[1]
    return ''

def run_etl_market():
    """运行商圈环境 ETL"""
    print("\n=== 商圈环境数据 ===")
    key = get_amap_key()
    if not key:
        print("  [SKIP] AMAP_KEY 未配置")
        return False
    cmd = [sys.executable, 'etl_market_context.py', '--key', key, '--output-dir', OUTPUT_DIR]
    result = subprocess.run(cmd, cwd=BASE, capture_output=True, text=True)
    if result.returncode == 0:
        print("  完成")
        return True
    else:
        print(f"  失败: {result.stderr[:200]}")
        return False

def run_etl_toploc():
    """运行热门配送地 ETL"""
    print("\n=== 热门配送地 TOP10 ===")
    key = get_amap_key()
    if not key:
        print("  [SKIP] AMAP_KEY 未配置")
        return False
    cmd = [sys.executable, 'etl_delivery_top_locations.py', '--key', key, '--output-dir', OUTPUT_DIR]
    result = subprocess.run(cmd, cwd=BASE, capture_output=True, text=True)
    if result.returncode == 0:
        print("  完成")
        return True
    else:
        print(f"  失败: {result.stderr[:200]}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Wagas 门店网络 v2 月度/季度同步")
    parser.add_argument("--quarterly", action="store_true", help="仅季度任务")
    parser.add_argument("--market-only", action="store_true", help="仅商圈环境")
    parser.add_argument("--toploc-only", action="store_true", help="仅热门配送地")
    args = parser.parse_args()

    today = date.today()
    is_quarterly = today.month in (1, 4, 7, 10)

    print("=" * 60)
    print("Wagas 门店网络 v2 月度/季度同步")
    print(f"运行日期: {today.isoformat()} (季度月: {is_quarterly})")
    print("=" * 60)

    if args.market_only:
        run_etl_market()
    elif args.toploc_only:
        run_etl_toploc()
    else:
        # 商圈环境：季度月运行
        if args.quarterly or is_quarterly:
            run_etl_market()
        else:
            print("\n=== 商圈环境数据 [跳过，非季度月] ===")

        # 热门配送地：每月运行
        run_etl_toploc()

    print("\n" + "=" * 60)
    print("月度/季度同步完成!")
    print("=" * 60)

if __name__ == "__main__":
    main()
