import {ThemeSwitch} from '@/components/theme/theme-switch';
import {BrandMark} from '@/components/theme/brand-mark';
import Link from 'next/link';
export default function NotFound(){return <main id="conteudo-principal" className="entry-page"><section className="entry-card"><BrandMark variant="auto" showUfg/><ThemeSwitch/><p className="eyebrow">GESTÃO PROEX</p><h1>Página não encontrada.</h1><p>O endereço pode ter mudado. Volte ao painel para continuar.</p><Link className="primary-button" href="/">Abrir o painel</Link></section></main>;}
