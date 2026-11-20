import type { ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';

export type GradientVariant = 'teal' | 'saffron' | 'navy';

const VARIANT_SEQUENCE: GradientVariant[] = ['teal', 'saffron', 'navy'];

export function getVariantByIndex(index: number): GradientVariant {
  return VARIANT_SEQUENCE[Math.abs(index) % VARIANT_SEQUENCE.length];
}

const GRADIENT_CLASS: Record<GradientVariant, string> = {
  teal: 'ad-grad-teal',
  saffron: 'ad-grad-saffron',
  navy: 'ad-grad-navy',
};

const ICON_COLOR_CLASS: Record<GradientVariant, string> = {
  teal: 'text-[#0D5C58]',
  saffron: 'text-[#EA580C]',
  navy: 'text-[#134E4A]',
};

export function BrandLogo({
  size = 'md',
}: {
  size?: 'sm' | 'md';
}) {
  return (
    <img
      src="/assets/aarogya-drishti-logo.png"
      alt="Aarogya Drishti - Healthy People, Healthy Villages, Healthy India"
      width={size === 'sm' ? 128 : 168}
      height={size === 'sm' ? 85 : 112}
      className={`block h-auto w-full object-contain object-left shrink-0 ${
        size === 'sm' ? 'max-w-[128px]' : 'max-w-[168px]'
      }`}
    />
  );
}

export interface SignatureMetric {
  icon?: ReactNode;
  value: string | number;
  label: string;
}

export interface SignatureFooterConfig {
  label: string;
  value: string;
  dotTone?: 'emerald' | 'amber' | 'rose';
  dotBlink?: boolean;
  ctaLabel?: string;
  onCtaClick?: () => void;
  ctaDisabled?: boolean;
  ctaVariant?: 'teal' | 'ghost' | 'danger';
  rightSlot?: ReactNode;
}

interface SignatureCardProps {
  variant?: GradientVariant;
  topRightBadge?: ReactNode;
  icon: ReactNode;
  pillLabel: string;
  pillIcon?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  tags?: string[];
  metrics?: SignatureMetric[];
  children?: ReactNode;
  footer?: SignatureFooterConfig;
  className?: string;
  bodyClassName?: string;
  onClick?: () => void;
  highlighted?: boolean;
}

export function SignatureCard({
  variant = 'teal',
  topRightBadge,
  icon,
  pillLabel,
  pillIcon,
  title,
  meta,
  tags,
  metrics,
  children,
  footer,
  className = '',
  bodyClassName = '',
  onClick,
  highlighted = false,
}: SignatureCardProps) {
  const dotBg =
    footer?.dotTone === 'amber'
      ? 'bg-amber-500'
      : footer?.dotTone === 'rose'
      ? 'bg-rose-500'
      : 'bg-emerald-500';

  const rowBg =
    footer?.dotTone === 'amber'
      ? 'bg-amber-50/75 border-amber-200/70'
      : footer?.dotTone === 'rose'
      ? 'bg-rose-50/75 border-rose-200/70'
      : 'bg-[#ECFDF5]/80 border-emerald-200/60';

  return (
    <div
      onClick={onClick}
      className={`ad-card rounded-3xl overflow-hidden flex flex-col transition-all duration-200 ${
        highlighted ? 'ring-2 ring-[#0D5C58] ring-offset-2 ring-offset-[#FBFBFA]' : ''
      } ${onClick ? 'cursor-pointer hover:-translate-y-0.5' : ''} ${className}`}
    >
      {/* Part A: Gradient Header Banner */}
      <div
        className={`h-36 relative overflow-hidden rounded-t-3xl px-5 py-4 flex flex-col justify-between shrink-0 ${GRADIENT_CLASS[variant]}`}
      >
        {/* Subtle 1px Grid Lines */}
        <div className="ad-banner-grid absolute inset-0 pointer-events-none opacity-80" />

        {/* Concentric Geometric Circle Accent */}
        <div
          aria-hidden="true"
          className="w-40 h-40 rounded-full border-[18px] border-white/15 -right-8 -top-8 absolute pointer-events-none"
        />
        <div
          aria-hidden="true"
          className="w-24 h-24 rounded-full border border-white/20 right-2 top-2 absolute pointer-events-none"
        />

        {/* Top-Right Badge */}
        <div className="relative z-10 flex items-center justify-end min-h-[26px]">
          {topRightBadge && (
            <span className="bg-white/95 text-gray-900 font-bold text-xs px-2.5 py-1 rounded-full shadow-sm whitespace-nowrap inline-flex items-center gap-1 tabular-nums">
              {topRightBadge}
            </span>
          )}
        </div>

        {/* Bottom-Left Floating Square Icon & Verified/Category Pill */}
        <div className="relative z-10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-12 h-12 rounded-2xl bg-white shadow-md grid place-items-center shrink-0 ${ICON_COLOR_CLASS[variant]}`}
            >
              {icon}
            </div>
            <span className="rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-gray-800 flex items-center gap-1.5 shadow-sm whitespace-nowrap truncate max-w-[230px]">
              {pillIcon ?? <CheckCircle2 className="w-3.5 h-3.5 text-[#0D9488] shrink-0" />}
              <span className="truncate">{pillLabel}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Part B: Clean Crisp White Card Body */}
      <div
        className={`p-6 bg-white rounded-b-3xl flex-1 flex flex-col justify-between gap-4 ${bodyClassName}`}
      >
        <div className="space-y-3.5">
          <div>
            <h3 className="font-bold text-lg sm:text-xl text-gray-900 font-display leading-snug">
              {title}
            </h3>
            {meta && (
              <div className="text-sm text-gray-500 mt-1 flex items-center gap-1.5 leading-snug">
                {meta}
              </div>
            )}
          </div>

          {tags && tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag, i) => (
                <span
                  key={`${tag}-${i}`}
                  className="rounded-full bg-gray-100 text-gray-600 text-xs font-medium px-2.5 py-1"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {metrics && metrics.length > 0 && (
            <div className="grid grid-cols-3 gap-2.5 pt-0.5">
              {metrics.slice(0, 3).map((m, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-gray-200/80 bg-[#FBFBFA] py-2.5 px-2 text-center"
                >
                  <div className="flex items-center justify-center gap-1 text-xs font-bold text-gray-900 tabular-nums">
                    {m.icon && <span className="text-[#0D5C58] shrink-0">{m.icon}</span>}
                    <span className="truncate">{m.value}</span>
                  </div>
                  <p className="text-[11px] font-medium text-gray-500 mt-0.5 truncate">
                    {m.label}
                  </p>
                </div>
              ))}
            </div>
          )}

          {children && <div className="space-y-3">{children}</div>}
        </div>

        {/* Footer Slot / Soft Mint Live CTA Row */}
        {footer && (
          <div
            className={`rounded-2xl border px-4 py-3 flex items-center justify-between gap-3 ${rowBg}`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                <span className={`ad-ping-ring absolute inline-flex h-full w-full rounded-full ${dotBg}`} />
                <span
                  className={`relative inline-flex rounded-full h-2.5 w-2.5 ${dotBg} ${
                    footer.dotBlink ? 'ad-status-dot-blink' : ''
                  }`}
                />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-gray-500 truncate leading-tight">
                  {footer.label}
                </p>
                <p className="text-xs font-bold text-gray-900 truncate leading-tight mt-0.5">
                  {footer.value}
                </p>
              </div>
            </div>

            {footer.rightSlot ? (
              footer.rightSlot
            ) : footer.ctaLabel && footer.onCtaClick ? (
              <button
                type="button"
                disabled={footer.ctaDisabled}
                onClick={(e) => {
                  e.stopPropagation();
                  footer.onCtaClick?.();
                }}
                className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-all disabled:opacity-50 ${
                  footer.ctaVariant === 'danger'
                    ? 'bg-gradient-to-br from-rose-600 to-red-700 text-white shadow-sm'
                    : footer.ctaVariant === 'ghost'
                    ? 'bg-white border border-gray-200 text-gray-800 hover:bg-gray-50'
                    : 'ad-btn-teal text-white'
                }`}
              >
                {footer.ctaLabel}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
