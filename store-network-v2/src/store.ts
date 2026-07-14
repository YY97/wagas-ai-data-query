import { create } from 'zustand';
import type { Store, SalesData, Filters } from './types';

interface AppState {
  // 数据
  stores: Store[];
  salesData: SalesData;
  dateRange: { start: string; end: string };
  
  // 筛选
  filters: Filters;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  
  // UI 状态
  selectedStore: Store | null;
  setSelectedStore: (store: Store | null) => void;
  
  // 加载状态
  loading: boolean;
  setLoading: (loading: boolean) => void;
  
  // 初始化数据
  initData: (stores: Store[], salesData: SalesData, dateRange: { start: string; end: string }) => void;
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

export const useAppStore = create<AppState>((set) => ({
  stores: [],
  salesData: {},
  dateRange: { start: '', end: '' },
  filters: defaultFilters,
  selectedStore: null,
  loading: true,
  
  setFilter: (key, value) => set((state) => ({
    filters: { ...state.filters, [key]: value }
  })),
  
  setSelectedStore: (store) => set({ selectedStore: store }),
  setLoading: (loading) => set({ loading }),
  
  initData: (stores, salesData, dateRange) => set({
    stores,
    salesData,
    dateRange,
    loading: false,
    filters: {
      ...defaultFilters,
      dateStart: dateRange.start,
      dateEnd: dateRange.end,
    }
  }),
}));
