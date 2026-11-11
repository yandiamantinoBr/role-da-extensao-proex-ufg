'use client';
import Link from 'next/link';
import { FileDown } from 'lucide-react';
import { reportHref, type ReportLink } from '@/lib/report-links';

/**
 * Botão "Exportar" das telas (R3, consolidação de 10/11/2026): não gera arquivo aqui.
 * Abre Relatórios com o assunto, o projeto, o período e a busca já escolhidos; é lá que a pessoa
 * confere o recorte, escolhe colunas e baixa em Excel, PDF, Word ou JSON.
 */
export default function ExportLink({ label = 'Exportar', hint = 'Abre Relatórios com este recorte. Lá você escolhe as colunas e o formato.', className = '', ...link }: ReportLink & { label?: string; hint?: string; className?: string }) {
  return <Link className={`p-button p-button-subtle ${className}`.trim()} href={reportHref(link)} prefetch={false} title={hint} aria-label={`${label}: abrir Relatórios com este recorte`}>
    <FileDown size={16} aria-hidden="true"/>{label}
  </Link>;
}
