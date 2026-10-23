import Image from 'next/image';
/** light renders white marks; dark renders black marks; auto follows the selected theme. */
export function BrandMark({ variant = 'auto', showUfg = true, className = '', compact = false, emphasis }: {
    variant?: 'light' | 'dark' | 'auto';
    showUfg?: boolean;
    className?: string;
    compact?: boolean;
    emphasis?: 'university';
}) {
    return <span className={`brand-mark brand-mark-${variant} ${compact ? 'brand-mark-compact' : ''} ${emphasis ? 'brand-mark-university' : ''} ${className}`}>
      {(!compact || !showUfg) && <Image className="brand-proex" src="/brand/proex.png" alt="PROEX" width={140} height={74} unoptimized/>}
      {showUfg && <>{!compact && <span className="brand-divider" aria-hidden="true"/>}<Image className="brand-ufg" src="/brand/ufg-white.png" alt="Universidade Federal de Goiás" width={140} height={72} unoptimized/>
        </>}
    </span>;
}
export default BrandMark;
