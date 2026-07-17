// 门店数据类型
export interface Store {
  sid: string;
  name: string;
  brand: string;
  city: string;
  addr: string;
  fmt: string;
  lng: number;
  lat: number;
  ads: number | null;
  market: MarketData | null;
  overlap: number;
  overlap_names: string[];
  channel: ChannelData | null;
  dist: DistanceData | null;
  top_locations?: TopLocation[];
  delivery_contour?: [number, number][];
}

export interface MarketData {
  poi_count: number;
  avg_cost: number | null;
  median_cost: number | null;
  avg_rating: number | null;
  top_categories: string;
  business_area: string;
  office_count: number;
  residential_count: number;
  metro_count: number;
  nearest_metro_km: number | null;
}

export interface ChannelData {
  dine_in_avg: number;
  delivery_avg: number;
  dine_in_pct: number;
  delivery_pct: number;
  days: number;
}

export interface DistanceData {
  d1_pct: number | null;
  d2_pct: number | null;
  d3_pct: number | null;
  d4_pct: number | null;
  d5_pct: number | null;
  total_orders: number;
}

export interface TopLocation {
  rank: number;
  name: string;
  dist: number;
  count: number;
  lat: number;
  lng: number;
}

// 销售数据类型
export type SalesData = Record<string, Record<string, number>>;

// 筛选状态
export interface Filters {
  brand: string;
  city: string;
  adsRange: string;
  fmt: string;
  storeNames: string[];
  storeIds: string[];
  dateStart: string;
  dateEnd: string;
}
