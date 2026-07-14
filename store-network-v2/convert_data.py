import csv
import json

# 读取 CSV
stores = []
with open('public/data/store_master.csv', 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    for row in reader:
        stores.append({
            'sid': row['Store_ID'],
            'name': row['门店名称'],
            'brand': row['品牌'],
            'city': row['城市'],
            'addr': row['门店地址'],
            'fmt': row['业态'],
            'lng': float(row['经度']),
            'lat': float(row['纬度']),
            'ads': None,  # 稍后从销售数据计算
            'market': None,
            'overlap': 0,
            'overlap_names': [],
            'channel': None,
            'dist': None
        })

# 保存为 JSON
with open('public/data/stores.json', 'w', encoding='utf-8') as f:
    json.dump(stores, f, ensure_ascii=False, indent=2)

print(f'Converted {len(stores)} stores to JSON')
