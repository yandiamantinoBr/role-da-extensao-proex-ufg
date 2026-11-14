import type { Metadata } from 'next';
import InviteEntry from './invite-entry';

const title = 'Convite para a equipe · PROEX UFG';
const description = 'Ative seu acesso ao Portal de Gestão da Pró-Reitoria de Extensão da UFG.';
const canonical = 'https://proex-gestao.vercel.app/convite';
const image = 'https://proex-gestao.vercel.app/convite-proex.png';

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    url: canonical,
    title,
    description,
    images: [{ url: image, width: 1200, height: 630, alt: 'Convite para a equipe · Portal PROEX UFG' }],
  },
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function Invite() {
  return <InviteEntry />;
}
