#!/usr/bin/env python3
"""
预计算城市密度网格
覆盖北京和上海现有门店周围 5km 范围，1km×1km 网格
输出：output/density_grid.json

特性：
- 断点续传：中断后重新运行会自动跳过已完成的点
- 进程锁：防止多实例同时运行导致 API 限流
- 错误日志：API 错误不再静默吞掉
- 重试机制：遇到临时封禁自动重试
"""

import json
import os
import sys
import time
import urllib.request
import urllib.parse
import csv

AMAP_TEXT = "https://restapi.amap.com/v3/place/around"
GRID_SIZE = 1000  # 1km 网格
BUFFER = 5000     # 扩展到门店周围 5km，确保城市完整覆盖
SLEEP = 1.0       # API 限流（每次调用间隔 1s = 1 req/s，更保守）
CHECKPOINT_INTERVAL = 100  # 每 100 个点保存一次进度
STARTUP_DELAY = 30  # 启动前等待 30s，让临时封禁完全解除

def acquire_lock(lock_path):
    """获取进程锁，防止多实例同时运行"""
    if os.path.exists(lock_path):
        with open(lock_path, 'r') as f:
            old_pid = f.read().strip()
        print(f"错误：另一个实例正在运行 (PID: {old_pid})")
        print(f"如果确认没有残留进程，请手动删除 {lock_path}")
        sys.exit(1)
    with open(lock_path, 'w') as f:
        f.write(str(os.getpid()))

def release_lock(lock_path):
    """释放进程锁"""
    if os.path.exists(lock_path):
        os.remove(lock_path)

def query_poi_count(key, lat, lng, radius, poi_type, max_retries=3):
    """查询某点周边某类 POI 数量，返回 (count, error_msg)
    遇到临时封禁 (USERKEY_PLAT_NOMATCH) 会自动重试并退避等待
    """
    # 手动构造 location 参数，避免 urllib.parse.urlencode 编码逗号（高德不接受 %2C）
    location = f"{lng},{lat}"
    params = urllib.parse.urlencode({
        'radius': radius,
        'types': poi_type,
        'output': 'json',
        'offset': 1,
        'page': 1,
    })
    url = f"{AMAP_TEXT}?key={key}&location={location}&{params}"
    
    for attempt in range(max_retries):
        try:
            req = urllib.request.urlopen(url, timeout=15)
            data = json.loads(req.read())
            status = data.get('status')
            if status == '1':
                return int(data.get('count', 0)), None
            else:
                info = data.get('info', 'unknown')
                infocode = data.get('infocode', '')
                # 临时封禁：等待后重试
                if infocode == '10009' and attempt < max_retries - 1:
                    wait_time = (attempt + 1) * 5  # 5s, 10s, 15s
                    print(f"  [临时封禁] 等待 {wait_time}s 后重试...")
                    time.sleep(wait_time)
                    continue
                return 0, f"API 返回错误: status={status}, info={info}, infocode={infocode}"
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(2)
                continue
            return 0, f"请求异常: {e}"
    
    return 0, "重试次数用尽"

def main():
    key = os.environ.get('AMAP_KEY', '94a6344759a6220ed7bb30e1e9bd3026')
    output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'output')
    os.makedirs(output_dir, exist_ok=True)

    lock_path = os.path.join(output_dir, '.density_grid.lock')
    checkpoint_path = os.path.join(output_dir, 'density_grid_checkpoint.json')
    output_path = os.path.join(output_dir, 'density_grid.json')

    # 获取进程锁
    acquire_lock(lock_path)

    try:
        # 调试信息
        print(f"Python 可执行文件: {sys.executable}")
        print(f"Python 版本: {sys.version}")
        print(f"当前工作目录: {os.getcwd()}")
        
        # 启动延迟：等待临时封禁解除
        print(f"启动延迟 {STARTUP_DELAY}s（让临时封禁解除）...")
        time.sleep(STARTUP_DELAY)
        
        # API 连通性测试
        print("API 连通性测试...")
        test_count, test_err = query_poi_count(key, 31.193, 121.315, 3000, '120200')
        if test_err:
            print(f"API 测试失败: {test_err}")
            print("请检查 API Key 或等待封禁解除后重试")
            
            # 尝试直接请求看是否能成功
            print("\n尝试直接请求...")
            import urllib.request as ur
            test_url = "https://restapi.amap.com/v3/place/around?key=94a6344759a6220ed7bb30e1e9bd3026&location=121.315,31.193&radius=3000&types=120200&output=json&offset=1&page=1"
            try:
                resp = ur.urlopen(test_url, timeout=15)
                data = json.loads(resp.read())
                print(f"直接请求结果: status={data.get('status')}, info={data.get('info')}, count={data.get('count')}")
            except Exception as e:
                print(f"直接请求异常: {e}")
            
            return
        else:
            print(f"API 测试成功: 查询到 {test_count} 个写字楼")
        
        # 读取门店数据
        stores_path = os.path.join(output_dir, 'store_master.csv')
        if not os.path.exists(stores_path):
            print("错误：store_master.csv 不存在")
            return

        stores = []
        with open(stores_path, 'r', encoding='utf-8-sig') as f:
            for row in csv.DictReader(f):
                if row.get('是否子店', '').strip() == '是':
                    continue
                try:
                    lat = float(row.get('纬度', 0) or 0)
                    lng = float(row.get('经度', 0) or 0)
                    city = row.get('城市', '')
                except:
                    continue
                if lat == 0 or lng == 0:
                    continue
                if '北京' not in city and '上海' not in city:
                    continue
                stores.append((lat, lng, city))

        print(f"读取 {len(stores)} 家门店（仅北京和上海）")

        # 生成网格点
        points_set = set()
        for lat, lng, city in stores:
            min_lat = lat - BUFFER / 111000
            max_lat = lat + BUFFER / 111000
            min_lng = lng - BUFFER / 111000
            max_lng = lng + BUFFER / 111000

            lat_idx = int(min_lat / (GRID_SIZE / 111000))
            while lat_idx * (GRID_SIZE / 111000) <= max_lat:
                lng_idx = int(min_lng / (GRID_SIZE / 111000))
                while lng_idx * (GRID_SIZE / 111000) <= max_lng:
                    point_lat = round(lat_idx * (GRID_SIZE / 111000), 6)
                    point_lng = round(lng_idx * (GRID_SIZE / 111000), 6)
                    points_set.add((point_lat, point_lng))
                    lng_idx += 1
                lat_idx += 1

        grid_points = [{'lat': lat, 'lng': lng} for lat, lng in sorted(points_set)]
        total = len(grid_points)
        print(f"生成 {total} 个网格点 (1km 网格，门店周围 5km)")
        print(f"预计 API 调用：{total * 2} 次")
        print(f"预计时间：{total * 2 * SLEEP / 60:.0f} 分钟")

        # 加载断点（如果有）
        grid_data = []
        start_idx = 0
        if os.path.exists(checkpoint_path):
            with open(checkpoint_path, 'r', encoding='utf-8') as f:
                checkpoint = json.load(f)
            grid_data = checkpoint.get('data', [])
            start_idx = checkpoint.get('next_idx', 0)
            if start_idx > 0:
                print(f"发现断点：从第 {start_idx} 个点继续（已完成 {start_idx}/{total}）")

        # 逐个查询
        error_count = 0
        for i in range(start_idx, total):
            p = grid_points[i]

            office_count, err1 = query_poi_count(key, p['lat'], p['lng'], 3000, '120200')
            time.sleep(SLEEP)
            residential_count, err2 = query_poi_count(key, p['lat'], p['lng'], 3000, '120300')
            time.sleep(SLEEP)

            if err1:
                error_count += 1
                if error_count <= 5:
                    print(f"  [警告] 点 {i} 写字楼查询失败: {err1}")
            if err2:
                error_count += 1
                if error_count <= 5:
                    print(f"  [警告] 点 {i} 住宅查询失败: {err2}")

            grid_data.append({
                'lat': p['lat'],
                'lng': p['lng'],
                'office_count': office_count,
                'residential_count': residential_count,
            })

            # 进度报告
            if (i + 1) % 50 == 0:
                pct = (i + 1) / total * 100
                print(f"  进度：{i + 1}/{total} ({pct:.1f}%) | 错误：{error_count}")

            # 定期保存断点
            if (i + 1) % CHECKPOINT_INTERVAL == 0:
                with open(checkpoint_path, 'w', encoding='utf-8') as f:
                    json.dump({'data': grid_data, 'next_idx': i + 1}, f, ensure_ascii=False)

        # 保存最终结果
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(grid_data, f, ensure_ascii=False, indent=2)

        # 清理断点文件
        if os.path.exists(checkpoint_path):
            os.remove(checkpoint_path)

        # 统计
        non_zero = sum(1 for p in grid_data if p['office_count'] > 0 or p['residential_count'] > 0)
        print(f"\n完成！密度网格已保存到 {output_path}")
        print(f"总计 {len(grid_data)} 个网格点，其中 {non_zero} 个有数据")
        print(f"API 错误总数：{error_count}")

    finally:
        release_lock(lock_path)

if __name__ == '__main__':
    main()
