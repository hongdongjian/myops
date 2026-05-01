import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-primary/30 bg-primary/15 text-primary hover:bg-primary/20',
        secondary:
          'border-border bg-muted text-muted-foreground hover:bg-muted/80',
        destructive:
          'border-destructive/40 bg-destructive/15 text-destructive hover:bg-destructive/20',
        outline:
          'border-border text-foreground hover:bg-foreground/[0.04]',
        success:
          'border-success/30 bg-success/15 text-success',
        warning:
          'border-warning/30 bg-warning/15 text-warning',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
