import { useQuery } from '@tanstack/react-query';
import { apiGet } from './api';

export function useStatusPolling<T>(key: readonly unknown[], path: string, intervalMs = 5000) {
  return useQuery<T>({
    queryKey: key,
    queryFn: () => apiGet<T>(path),
    refetchInterval: intervalMs,
  });
}
