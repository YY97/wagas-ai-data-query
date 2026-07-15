#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
backfill_daemon.py — 带自动重启的回填守护进程
崩溃后自动重启，记录日志，直到全部完成
"""
import os
import sys
import time
import subprocess
import json
from datetime import datetime

# Windows GBK 编码兼容
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

BASE = os.path.dirname(os.path.abspath(__file__))
CHECKPOINT = os.path.join(BASE, "output", "_backfill_checkpoint.json")
LOG_FILE = os.path.join(BASE, "output", "_backfill_daemon.log")
TOTAL_BATCHES = 280

def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")

def get_progress():
    if not os.path.exists(CHECKPOINT):
        return 0, None
    try:
        with open(CHECKPOINT, "r", encoding="utf-8") as f:
            cp = json.load(f)
        return len(cp.get("completed_batches", [])), cp.get("last_date")
    except:
        return 0, None

def main():
    log("=" * 60)
    log("回填守护进程启动")
    log(f"总批次数: {TOTAL_BATCHES}")
    log("=" * 60)

    crash_count = 0
    max_crashes = 50  # 最多自动重启 50 次

    while crash_count < max_crashes:
        done, last_date = get_progress()
        pct = done / TOTAL_BATCHES * 100

        if done >= TOTAL_BATCHES:
            log(f"全部完成! {done}/{TOTAL_BATCHES} (100%)")
            log("清理 checkpoint...")
            if os.path.exists(CHECKPOINT):
                os.remove(CHECKPOINT)
            log("守护进程退出")
            return

        log(f"当前进度: {done}/{TOTAL_BATCHES} ({pct:.1f}%) | 最后日期: {last_date}")
        log(f"启动回填进程 (崩溃次数: {crash_count})...")

        cmd = [
            sys.executable,
            os.path.join(BASE, "backfill_sales.py"),
            "--batch-days", "2",
            "--delay", "3",
            "--resume"
        ]

        try:
            result = subprocess.run(
                cmd,
                cwd=BASE,
                capture_output=True,
                text=True,
                timeout=3600,  # 1 小时超时
                encoding='utf-8',
                errors='replace'
            )

            if result.returncode == 0:
                log("回填进程正常退出")
                done, last_date = get_progress()
                if done >= TOTAL_BATCHES:
                    log("全部完成!")
                    return
                else:
                    log(f"进程退出但未完成 ({done}/{TOTAL_BATCHES})，重启...")
                    crash_count += 1
            else:
                log(f"回填进程异常退出 (code={result.returncode})")
                if result.stderr:
                    # 只记录最后 500 字符
                    err = result.stderr[-500:]
                    log(f"错误信息: {err}")
                crash_count += 1

        except subprocess.TimeoutExpired:
            log("回填进程超时 (1小时)，强制重启...")
            crash_count += 1
        except Exception as e:
            log(f"未知错误: {e}")
            crash_count += 1

        # 崩溃后等待 10 秒再重启
        log(f"等待 10 秒后重启... (崩溃 {crash_count}/{max_crashes})")
        time.sleep(10)

    log(f"达到最大重启次数 ({max_crashes})，守护进程退出")
    done, last_date = get_progress()
    log(f"最终进度: {done}/{TOTAL_BATCHES} ({done/TOTAL_BATCHES*100:.1f}%)")


if __name__ == "__main__":
    main()
