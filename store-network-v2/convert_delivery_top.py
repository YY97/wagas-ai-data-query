"""
将 delivery_top_locations.csv 转换为 JSON
"""
import csv
import json
from collections import defaultdict

def convert():
    # 读取 CSV
    store_locations = defaultdict(list)
    with open('public/data/delivery_top_locations.csv', 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            store_id = row['门店ID']
            store_locations[store_id].append({
                'rank': int(row['排名']),
                'name': row['地点名称'],
                'dist': float(row['距离(km)']),
                'count': int(row['配送次数'])
            })
    
    # 保存为 JSON
    with open('public/data/delivery_top_locations.json', 'w', encoding='utf-8') as f:
        json.dump(store_locations, f, ensure_ascii=False, indent=2)
    
    print(f'Converted {len(store_locations)} stores to JSON')

if __name__ == '__main__':
    convert()
