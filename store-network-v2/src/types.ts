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
  comp?: Record<string, CompetitorNearStats>;
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

// 竞品门店类型
export interface CompetitorStore {
  name: string;
  lng: number;
  lat: number;
  addr: string;
  city: string;
  district: string;
  rating: string;
}

// 竞品数据：品牌名 → 门店列表
export type CompetitorData = Record<string, CompetitorStore[]>;

// 单品牌在门店周边的竞品统计（1km 内）
export interface CompetitorNearStats {
  n1: number;          // 1km 内数量
  med: number | null;  // 1km 内评分中位数
}

// 密度网格数据类型
export interface DensityGridPoint {
  lat: number;
  lng: number;
  office_count: number;
  residential_count: number;
}

// 美团商场候选点数据
export interface MeituanMallData {
  store_id: string;
  store_name: string;
  lat: number;
  lng: number;
  city: string;
  district: string;
  delivery_orders_all_3km: number | null;
  delivery_pop_all_3km: number | null;
  delivery_orders_target_3km: number | null;
  catering_spending: number | null;
  work_population: number | null;
  residential_percentile: number | null;
}

// 选址评分结果
export interface SiteSelectionScore {
  score: number;
  baseScore: number;
  maxScore: number;
  percentage: number;
  demandScore: number;
  cannibScore: number;
  compScore: number;
  meituanScore: number;
  recommendation: string;
  insights: string[];
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

// 商场数据类型
export interface MallIndexItem {
  name: string;
  city: string;
  lat: number;
  lng: number;
  score: number | null;
  type: string;
  open_date: string;
}

export interface MallDetail {
  name: string;
  city: string;
  address: string;
  lat: number;
  lng: number;
  overview: {
    score: number | null;
    score_rank: string;
    population_score: number | null;
    area_score: number | null;
    consumption_score: number | null;
    industry_score: number | null;
    annual_sales: string;
    annual_sales_unit: string;
    area_size_sqm: number | null;
    open_date: string;
    operator: string;
    brand: string;
    type: string;
    floors: string;
  };
  traffic: {
    annual_daily: number | null;
    annual_daily_unit: string;
    jun_total: number | null;
    jun_daily_avg: number | null;
    jun_daily_unit: string;
    weekday_avg: number | null;
    holiday_avg: number | null;
  };
  population: {
    residential: { '500m': number | null; '1_5km': number | null; '3km': number | null };
    office: { '500m': number | null; '1_5km': number | null; '3km': number | null };
    permanent: { '500m': number | null; '1_5km': number | null; '3km': number | null };
  };
  business: {
    competitors: number | null;
    food: number | null;
    shopping: number | null;
    leisure: number | null;
    education: number | null;
    hotel: number | null;
    services: number | null;
    fitness: number | null;
    auto: number | null;
    total_stores: number | null;
    old_store_3yr_pct: number | null;
  };
  demographics: {
    male_pct: number | null;
    education: Record<string, number | null>;
    has_children_pct: number | null;
  };
  nearby_poi: {
    business: number | null;
    community: number | null;
    office: number | null;
    school: number | null;
    hospital: number | null;
    transport: number | null;
    scenic: number | null;
  };
  nearby_communities?: NearbyCommunity[];
  avg_housing_price?: number;
  total_households?: number;
  community_count?: number;
  nearby_malls: NearbyMallItem[];
  nearby_restaurants: NearbyRestaurantItem[];
  business_survival: BusinessSurvivalItem[];
  scraped_at: string;
}

export interface NearbyMallItem {
  name: string;
  open_date: string;
  area: string;
  jun_daily_avg: string;
  weekday_avg: string;
  holiday_avg: string;
}

export interface NearbyRestaurantItem {
  brand: string;
  address: string;
  distance: string;
}

export interface BusinessSurvivalItem {
  type: string;
  count: number | null;
  within_1yr_pct: number;
  '1_3yr_pct': number;
  over_3yr_pct: number;
}

export interface NearbyCommunity {
  name: string;
  households: number | null;
  residents: string | null;
  year: string | null;
}
