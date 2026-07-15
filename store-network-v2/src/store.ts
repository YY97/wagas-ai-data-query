import { create } from 'zustand';
import type { Store, SalesData, Filters } from './types';

export interface LayerToggles {
  showMarkers: boolean;
  showCircles1km: boolean;
  showCircles3km: boolean;
  highlightOverlap: boolean;
  colorByAds: boolean;
}

interface AppState {
  stores: Store[];
  salesData: SalesData;
  channelSales: Record<string, Record<string, { dine_in: number; delivery: number }>>;
  dateRange: { start: string; end: string };
  allDates: string[];
  filters: Filters;
  layers: LayerToggles;
  selectedStore: Store | null;
  loading: boolean;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  setDateRange: (range: { start: string; end: string }) => void;
  setLayer: <K extends keyof LayerToggles>(key: K, value: boolean) => void;
  setSelectedStore: (store: Store | null) => void;
  setLoading: (loading: boolean) => void;
  getAds: (sid: string) => number | null;
  initData: (stores: Store[], salesData: SalesData, channelSales: any, dateRange: { start: string; end: string }) => void;
}

const defaultFilters: Filters = {
  brand: 'all',
  city: 'all',
  adsRange: 'all',
  fmt: 'all',
  storeNames: [],
  storeIds: [],
  dateStart: '',
  dateEnd: '',
};

const defaultLayers: LayerToggles = {
  showMarkers: true,
  showCircles1km: true,
  showCircles3km: false,
  highlightOverlap: false,
  colorByAds: true,
};

export const useAppStore = create<AppState>((set, get) => ({
  stores: [],
  salesData: {},
  channelSales: {},
  dateRange: { start: '', end: '' },
  allDates: [],
  filters: defaultFilters,
  layers: defaultLayers,
  selectedStore: null,
  loading: true,

  setFilter: (key, value) => set((state) => ({
    filters: { ...state.filters, [key]: value }
  })),

  setDateRange: (range) => set((state) => ({
    dateRange: range,
    filters: { ...state.filters, dateStart: range.start, dateEnd: range.end }
  })),

  setLayer: (key, value) => set((state) => ({
    layers: { ...state.layers, [key]: value }
  })),

  setSelectedStore: (store) => set({ selectedStore: store }),
  setLoading: (loading) => set({ loading }),

  getAds: (sid: string) => {
    const state = get();
    const dd = state.salesData[sid];
    if (!dd) return null;
    const { dateStart, dateEnd } = state.filters;
    const ds = dateStart || state.dateRange.start;
    const de = dateEnd || state.dateRange.end;
    const values: number[] = [];
    for (const k in dd) {
      if (dd[k] != null && dd[k] > 0 && k >= ds && k <= de) {
        values.push(dd[k]);
      }
    }
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  },

  initData: (stores, salesData, channelSales, dateRange) => {
    const allDates = new Set<string>();
    Object.values(salesData).forEach(storeSales => {
      Object.keys(storeSales).forEach(date => allDates.add(date));
    });
    const sortedDates = Array.from(allDates).sort();

    // 默认显示最近 7 天
    const lastDate = sortedDates[sortedDates.length - 1];
    const sevenDaysAgo = new Date(lastDate);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const defaultStart = sevenDaysAgo.toISOString().split('T')[0];
    const clampedStart = sortedDates.includes(defaultStart) ? defaultStart : sortedDates[0];

    set({
      stores,
      salesData,
      channelSales,
      dateRange,
      allDates: sortedDates,
      loading: false,
      filters: {
        ...defaultFilters,
        dateStart: clampedStart,
        dateEnd: lastDate,
      }
    });
  },
}));
