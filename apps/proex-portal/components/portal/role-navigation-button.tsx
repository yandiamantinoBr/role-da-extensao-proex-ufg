'use client';
import { ArrowRight } from 'lucide-react';
import styles from './role-assistant.module.css';

/** "Abrir esta tela" do Rolê: destino interno conferido no servidor (abrir_tela). Só o toque da pessoa navega. */
export type RoleNavigationView = { href: string; label: string; afterUntrusted?: true };

/** Só endereço interno do portal (/?module=...), com os parâmetros que o servidor gera; rótulo curto, numa linha. */
const INTERNAL = /^\/\?module=[a-z-]{2,20}(?:&(?:project|detailProject|demandId|itemId|loanId|campaignId|report|workStatus|gestao)=[A-Za-z0-9._:%-]{1,200}){0,4}$/;
export function roleNavigationFrom(value: unknown): RoleNavigationView | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { href, label, afterUntrusted } = value as Record<string, unknown>;
  if (typeof href !== 'string' || !INTERNAL.test(href)) return undefined;
  if (typeof label !== 'string' || !label.trim() || label.length > 120 || /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/.test(label)) return undefined;
  return { href, label: label.trim(), ...(afterUntrusted === true ? { afterUntrusted: true as const } : {}) };
}

/**
 * Link com cara de botão: o clique passa pelo roteamento do portal (followModuleLink em app/portal-client.tsx,
 * o mesmo das fontes da resposta), sem recarregar a página. onOpen fecha o painel do Rolê. Depois de ler conteúdo
 * de terceiros na mesma resposta, um aviso pequeno diz que é sugestão.
 */
export default function RoleNavigationButton({ navigation, onOpen }: { navigation: RoleNavigationView; onOpen?: () => void }) {
  const link = <a className={`p-button p-button-primary ${styles.navigation}`} href={navigation.href} onClick={() => onOpen?.()}>
    <span>Abrir {navigation.label}</span><ArrowRight size={16} aria-hidden="true"/>
  </a>;
  return navigation.afterUntrusted ? <div className={styles.navigationBox}><small className={styles.navigationNote}>Sugestão do Rolê</small>{link}</div> : link;
}
