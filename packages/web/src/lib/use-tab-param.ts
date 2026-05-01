import { useSearchParams } from 'react-router-dom';

export function useTabParam<T extends string>(values: readonly T[], fallback: T): [T, (next: string) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const active: T = (values as readonly string[]).includes(raw ?? '') ? (raw as T) : fallback;
  const setTab = (next: string) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };
  return [active, setTab];
}
