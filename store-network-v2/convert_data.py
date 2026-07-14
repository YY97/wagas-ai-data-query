import csv
import json
import math

# WGS-84 到 GCJ-02 坐标转换
def wgs84_to_gcj02(lng, lat):
    """将 WGS-84 坐标转换为 GCJ-02 坐标"""
    a = 6378245.0  # 长半轴
    ee = 0.00669342162296594323  # 偏心率平方
    
    def out_of_china(lng, lat):
        return not (72.004 <= lng <= 137.8347 and 0.8293 <= lat <= 55.8271)
    
    def transform_lat(x, y):
        ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
        ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
        ret += (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3.0
        ret += (160.0 * math.sin(y / 12.0 * math.pi) + 320 * math.sin(y * math.pi / 30.0)) * 2.0 / 3.0
        return ret
    
    def transform_lng(x, y):
        ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
        ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
        ret += (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3.0
        ret += (150.0 * math.sin(x / 12.0 * math.pi) + 320 * math.sin(x * math.pi / 30.0)) * 2.0 / 3.0
        return ret
    
    if out_of_china(lng, lat):
        return lng, lat
    
    dlat = transform_lat(lng - 105.0, lat - 35.0)
    dlng = transform_lng(lng - 105.0, lat - 35.0)
    radlat = lat / 180.0 * math.pi
    magic = math.sin(radlat)
    magic = 1 - ee * magic * magic
    sqrtmagic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((a * (1 - ee)) / (magic * sqrtmagic) * math.pi)
    dlng = (dlng * 180.0) / (a / sqrtmagic * math.cos(radlat) * math.pi)
    mglat = lat + dlat
    mglng = lng + dlng
    
    return mglng, mglat

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
        # 转换坐标从 WGS-84 到 GCJ-02
        wgs_lng = float(row['经度'])
        wgs_lat = float(row['纬度'])
        gcj_lng, gcj_lat = wgs84_to_gcj02(wgs_lng, wgs_lat)
        
        stores.append({
            'sid': store_id,
            'name': row['门店名称'],
            'brand': row['品牌'],
            'city': row['城市'],
            'addr': row['门店地址'],
            'fmt': row['业态'],
            'lng': gcj_lng,  # 使用 GCJ-02 坐标
            'lat': gcj_lat,  # 使用 GCJ-02 坐标
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
