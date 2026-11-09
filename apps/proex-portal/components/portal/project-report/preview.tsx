'use client';
// Prévia do relatório: desenha o mesmo documento que vai para o PDF, o DOCX e o XLSX.
import Image from 'next/image';
import BrandMark from '@/components/theme/brand-mark';
import type { Block, ReportDocument } from './document';
import styles from './project-report.module.css';

const SERIES = ['#54216c', '#c25e00'];

function Chart({ block }: { block: Extract<Block, { kind: 'chart' }> }) {
  // Barras em HTML: o texto fica no tamanho real em qualquer largura (o SVG escalado ficava ilegível no celular).
  const max = Math.max(1, ...block.series.flatMap(series => series.values));
  const every = Math.max(1, Math.ceil(block.categories.length / 8));
  const summary = `${block.title}. ${block.series.map(series => `${series.label}: ${block.categories.map((category, index) => `${category} ${series.values[index]}`).join(', ')}`).join('. ')}.`;
  return <figure className={styles.chart}>
    <figcaption>{block.title}</figcaption>
    <div className={`${styles.bars} ${block.categories.length < 3 ? styles.barsFew : ''}`} role="img" aria-label={summary}>
      <span className={styles.barsMax} aria-hidden="true">{max}</span>
      <span className={styles.barsZero} aria-hidden="true">0</span>
      <div className={styles.barsPlot} aria-hidden="true">
        {block.categories.map((category, index) => <div key={category} className={styles.barGroup}>
          {block.series.map((series, serie) => { const value = series.values[index] ?? 0; return <span key={series.label} className={styles.bar} style={{ height: `${value / max * 100}%`, background: SERIES[serie % SERIES.length] }}>{value > 0 && <b>{value}</b>}</span>; })}
        </div>)}
      </div>
      <div className={styles.barsAxis} aria-hidden="true">{block.categories.map((category, index) => <span key={category}>{index % every === 0 ? category : ''}</span>)}</div>
    </div>
    <ul className={styles.legend}>{block.series.map((series, index) => <li key={series.label}><i style={{ background: SERIES[index % SERIES.length] }}/>{series.label} ({series.values.reduce((sum, value) => sum + value, 0)})</li>)}</ul>
    {block.note && <p className={styles.paperNote}>{block.note}</p>}
  </figure>;
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'paragraph': return <p className={styles.paperText}>{block.text}</p>;
    case 'note': return <p className={styles.paperNote}>{block.text}</p>;
    case 'facts': return <dl className={styles.facts}>{block.items.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>;
    case 'metrics': return <dl className={styles.metrics}>{block.items.map(item => <div key={item.label}><dd className={styles.metricValue}>{item.value}</dd><dt>{item.label}</dt>{item.detail && <dd className={styles.metricDetail}>{item.detail}</dd>}</div>)}</dl>;
    case 'table': return <div className={styles.tableBlock}>
      {block.title && <h5>{block.title}</h5>}
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={block.title ?? 'Tabela'}>
        <table><thead><tr>{block.columns.map(column => <th key={column.label} scope="col" className={column.numeric ? styles.numeric : undefined}>{column.label}</th>)}</tr></thead>
          <tbody>{block.rows.map((row, index) => <tr key={index}>{row.map((value, column) => <td key={column} data-label={block.columns[column]?.label} className={block.columns[column]?.numeric ? styles.numeric : undefined}>{value || '—'}</td>)}</tr>)}</tbody></table>
      </div>
      {block.note && <p className={styles.paperNote}>{block.note}</p>}
    </div>;
    case 'chart': return <Chart block={block}/>;
    case 'timeline': {
      const months: { month: string; items: typeof block.items }[] = [];
      for (const item of block.items) { const last = months.at(-1); if (last && last.month === item.month) last.items.push(item); else months.push({ month: item.month, items: [item] }); }
      return <div className={styles.timelineBlock}>
        {months.map(group => <section key={group.month} aria-label={group.month}>
          <h6 className={styles.timelineMonth}>{group.month}</h6>
          <ol className={styles.timeline}>{group.items.map((item, index) => <li key={index}><span className={styles.timelineDate}>{index > 0 && group.items[index - 1].date === item.date ? <span className={styles.srOnly}>{item.date}</span> : item.date}</span><span className={`${styles.timelineDot} ${item.date ? '' : styles.timelineDotSummary}`} aria-hidden="true"/><span className={styles.timelineText}><span className={styles.timelineTag}>{item.tag}</span>{item.title}{item.detail && <small>{item.detail}</small>}</span></li>)}</ol>
        </section>)}
        {block.note && <p className={styles.paperNote}>{block.note}</p>}
      </div>;
    }
    case 'callout': return <aside className={styles.callout}>{block.title && <strong>{block.title}</strong>}{block.text.split(/\n{2,}/).map((part, index) => <p key={index}>{part}</p>)}</aside>;
    case 'references': return <ol className={styles.references}>{block.items.map(item => <li key={item.number}>
      <strong>[{item.number}] {item.title}</strong><span>{item.type} · {item.source}</span>
      <a href={item.url} target="_blank" rel="noopener noreferrer">{item.url}</a>
    </li>)}</ol>;
  }
}

export default function ReportPreview({ doc, brand }: { doc: ReportDocument; brand?: 'role-da-extensao' | 'conpeex-2026' }) {
  return <article className={styles.paper} aria-label={`Prévia: ${doc.title}`}>
    <header className={styles.cover}>
      <div className={styles.coverBand}>
        <div className={styles.coverMarks}><BrandMark variant="light" emphasis="university" className={styles.coverBrand}/><div className={styles.coverText}><span>PRÓ-REITORIA DE EXTENSÃO</span><small>Universidade Federal de Goiás</small></div></div>
        {brand && <Image src={brand === 'role-da-extensao' ? '/brand/role-da-extensao.png' : '/brand/conpeex-2026.png'} alt={brand === 'role-da-extensao' ? 'Rolê da Extensão' : '23º CONPEEX'} width={96} height={56} unoptimized className={brand === 'conpeex-2026' ? styles.coverMarkLight : styles.coverMark}/>}
      </div>
      <p className={styles.coverKicker}>Relatório do projeto</p>
      <h4 className={styles.coverTitle}>{doc.title}</h4>
      <p className={styles.coverProject}>{doc.projectName}</p>
      {doc.subtitle && <p className={styles.coverSubtitle}>{doc.subtitle}</p>}
      <dl className={styles.coverFacts}><div><dt>Período</dt><dd>{doc.period}</dd></div><div><dt>Gerado em</dt><dd>{doc.generatedAt}</dd></div><div><dt>Seções</dt><dd>{doc.sections.length}</dd></div></dl>
    </header>
    {doc.sections.length > 0 ? <>
      <nav className={styles.contents} aria-label="Sumário da prévia">
        <h5>Sumário</h5>
        <ol>{doc.sections.map(section => <li key={section.id}><a href={`#previa-secao-${section.id}`}><span>{section.number}.</span>{section.title}</a></li>)}</ol>
      </nav>
      {doc.sections.map(section => <section key={section.id} id={`previa-secao-${section.id}`} className={styles.paperSection} aria-labelledby={`previa-titulo-${section.id}`}>
        <h5 className={styles.sectionHeading} id={`previa-titulo-${section.id}`}><span aria-hidden="true">{section.number}</span>{section.title}</h5>
        {section.blocks.map((block, index) => <BlockView key={index} block={block}/>)}
      </section>)}
    </> : <p className={styles.paperEmpty}>Marque ao menos uma seção para montar o relatório.</p>}
  </article>;
}
