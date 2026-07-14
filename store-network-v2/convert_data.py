import csv
import json

# 读取销售数据
print('Loading sales data...')
sales_data = {}
with open('public/data/sales_data.json', 'r', encoding='utf-8') as f:
    sales_data = json.load(f)

# 计算每家店的日均销售额 (ADS)
print('Calculating ADS...')
ads_by_store = {}
for store_id, daily_sales in sales_data.items():
    if daily_sales:
        total_sales = sum(daily_sales.values())
        num_days = len(daily_sales)
        ads_by_store[store_id] = total_sales / num_days if num_days > 0 else 0

# 读取 CSV
stores = []
with open('public/data/store_master.csv', 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    for row in reader:
        store_id = row['Store_ID']
        stores.append({
            'sid': store_id,
            'name': row['门店名称'],
            'brand': row['品牌'],
            'city': row['城市'],
            'addr': row['门店地址'],
            'fmt': row['业态'],
            'lng': float(row['经度']),
            'lat': float(row['纬度']),
            'ads': ads_by_store.get(store_id, 0),  # 从销售数据计算的 ADS
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
print(f'Stores with ADS data: {sum(1 for s in stores if s["ads"] > 0)}')
