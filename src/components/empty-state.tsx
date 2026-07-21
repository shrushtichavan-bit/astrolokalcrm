import * as React from "react";
import { Button } from "@/components/ui/button";

export function EmptyState({
  icon: Icon,
  title,
  description,
  ctaLabel,
  onCta,
  ctaHref,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  ctaLabel?: string;
  onCta?: () => void;
  ctaHref?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {ctaLabel && ctaHref && (
        <Button asChild size="sm" className="mt-2">
          <a href={ctaHref}>{ctaLabel}</a>
        </Button>
      )}
      {ctaLabel && onCta && (
        <Button size="sm" className="mt-2" onClick={onCta}>
          {ctaLabel}
        </Button>
      )}
    </div>
  );
}
