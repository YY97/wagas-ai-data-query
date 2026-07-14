"""
将配送点数据按城市拆分，解决 GitHub Pages 单文件大小限制问题
"""
import csv
import json
import os
from collections import defaultdict

def split_delivery_data_by_city():
    """将 delivery_points.json 按城市拆分为多个文件"""
    
    # 读取门店主数据获取城市信息
    store_city_map = {}
    with open('public/data/store_master.csv', 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            store_id = row['Store_ID']
            city = row['城市']
            store_city_map[store_id] = city
    
    # 读取配送点数据
    with open('public/data/delivery_points.json', 'r', encoding='utf-8') as f:
        delivery_data = json.load(f)
    
    # 按城市分组
    city_data = defaultdict(dict)
    for store_id, points in delivery_data.items():
        city = store_city_map.get(store_id, 'unknown')
        city_data[city][store_id] = points
    
    # 创建输出目录
    output_dir = 'public/data/delivery'
    os.makedirs(output_dir, exist_ok=True)
    
    # 按城市写入文件
    for city, stores in city_data.items():
        output_file = os.path.join(output_dir, f'{city}.json')
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(stores, f, ensure_ascii=False, separators=(',', ':'))
        
        file_size = os.path.getsize(output_file) / (1024 * 1024)
        print(f'{city}.json: {len(stores)} stores, {file_size:.1f}MB')
    
    # 创建索引文件
    index_data = {
        city: {
            'store_count': len(stores),
            'total_points': sum(len(points) for points in stores.values())
        }
        for city, stores in city_data.items()
    }
    
    index_file = os.path.join(output_dir, 'index.json')
    with open(index_file, 'w', encoding='utf-8') as f:
        json.dump(index_data, f, ensure_ascii=False, indent=2)
    
    print(f'Index file: index.json')
    print(f'Split complete: {len(city_data)} cities')

if __name__ == '__main__':
    split_delivery_data_by_city()
