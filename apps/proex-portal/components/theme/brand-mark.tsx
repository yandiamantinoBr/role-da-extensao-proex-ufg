import Image from 'next/image';
import styles from './brand-mark.module.css';
/** light renders white marks; dark renders black marks; auto follows the selected theme. */
export function BrandMark({ variant = 'auto', showUfg = true, className = '', compact = false, emphasis }: {
    variant?: 'light' | 'dark' | 'auto';
    showUfg?: boolean;
    className?: string;
    compact?: boolean;
    emphasis?: 'university';
}) {
    return <span className={`${styles.root} brand-mark brand-mark-${variant} ${compact ? 'brand-mark-compact' : ''} ${emphasis ? 'brand-mark-university' : ''} ${className}`}>
      {(!compact || !showUfg) && <span className={`${styles.mark} ${styles.proex} brand-proex`} role="img" aria-label="PROEX · Pró-Reitoria de Extensão"><Image src="/brand/proex.png" alt="" aria-hidden="true" width={140} height={74} unoptimized/></span>}
      {showUfg && <>{!compact && <span className="brand-divider" aria-hidden="true"/>}<span className={`${styles.mark} ${styles.ufg} brand-ufg`} role="img" aria-label="Universidade Federal de Goiás"><Image src="/brand/ufg-white.png" alt="" aria-hidden="true" width={140} height={72} unoptimized/></span>
        </>}
    </span>;
}
export default BrandMark;
