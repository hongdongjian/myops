import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

export interface ModelSelectProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
}

interface ModelsResponse {
  models?: string[];
}

export function ModelSelect({ value, onChange, placeholder = '选择模型' }: ModelSelectProps) {
  const { data, isLoading } = useQuery<ModelsResponse | string[]>({
    queryKey: ['server-models'],
    queryFn: () => apiGet<ModelsResponse | string[]>('/api/server/models'),
    staleTime: Infinity,
  });

  const models = Array.isArray(data) ? data : (data?.models ?? []);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={isLoading ? '加载中...' : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {models.map((m) => (
          <SelectItem key={m} value={m}>
            {m}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
