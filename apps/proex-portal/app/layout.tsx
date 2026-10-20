import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'PROEX UFG · Gestão e Rolê da Extensão',description:'Projetos, materiais, eventos e empréstimos da PROEX UFG.',icons:{icon:'/favicon.svg'},referrer:'no-referrer',robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
