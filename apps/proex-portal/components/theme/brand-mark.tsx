import Image from 'next/image';
/** light renders white marks; dark renders black marks; auto follows the selected theme. */
export function BrandMark({ variant = 'auto', showUfg = true, className = '' }: {
    variant?: 'light' | 'dark' | 'auto';
    showUfg?: boolean;
    className?: string;
}) {
    return <span className={`brand-mark brand-mark-${variant} ${className}`}>
    <Image className="brand-proex" src="/brand/proex.png" alt="PROEX" width={140} height={66} unoptimized/>{showUfg && <>
        <span className="brand-divider" aria-hidden="true"/>
        <Image className="brand-ufg" src="/brand/ufg-white.png" alt="Universidade Federal de Goiás" width={70} height={66} unoptimized/>
        </>}</span>;
}
export default BrandMark;
