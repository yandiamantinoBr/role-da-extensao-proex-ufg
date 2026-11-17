'use client';
import { ArrowRight } from 'lucide-react';
import styles from './role-assistant.module.css';

/** "Abrir esta tela" do Rolê: destino interno conferido no servidor (abrir_tela). Só o toque da pessoa navega. */
export type RoleNavigationView = { href: string; label: string };

/** Só endereço interno do portal (/?module=...), com parâmetros simples; rótulo curto, numa linha. */
const INTERNAL = /^\/\?module=[a-z-]{2,20}(?:&[A-Za-z]{1,20}=[A-Za-z0-9._:%-]{1,600}){0,6}$/;
export function roleNavigationFrom(value: unknown): RoleNavigationView | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { href, label } = value as Record<string, unknown>;
  if (typeof href !== 'string' || href.length > 900 || !INTERNAL.test(href)) return undefined;
  if (typeof label !== 'string' || !label.trim() || label.length > 120 || /[\u0000-\u001f]/.test(label)) return undefined;
  return { href, label: label.trim() };
}

/**
 * Link com cara de botão: o clique passa pelo roteamento do portal (followModuleLink em app/portal-client.tsx,
 * o mesmo das fontes da resposta), sem recarregar a página. onOpen fecha o painel do Rolê.
 */
export default function RoleNavigationButton({ navigation, onOpen }: { navigation: RoleNavigationView; onOpen?: () => void }) {
  return <a className={`p-button p-button-primary ${styles.navigation}`} href={navigation.href} onClick={() => onOpen?.()}>
    <span>Abrir {navigation.label}</span><ArrowRight size={16} aria-hidden="true"/>
  </a>;
}
