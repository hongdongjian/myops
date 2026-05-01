import { Input } from './ui/input';

export interface ModelSelectProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
}

export function ModelSelect({ value, onChange, placeholder = 'Enter model name' }: ModelSelectProps) {
  return (
    <Input
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
    />
  );
}
