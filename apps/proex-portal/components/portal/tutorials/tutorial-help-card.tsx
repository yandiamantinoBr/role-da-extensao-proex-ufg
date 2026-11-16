'use client';
import { useEffect } from 'react';
import { LifeBuoy } from 'lucide-react';
import ChapterList from './chapter-list';
import { getTutorialState, loadTutorials } from './tutorial-store';
import styles from './tutorials.module.css';

/** "Ajuda e tutoriais" na Conta: os mesmos capítulos da janela de ajuda, dentro da página. */
export default function TutorialHelpCard() {
  useEffect(() => { if (!getTutorialState().data) void loadTutorials(); }, []);
  return <section className={`p-card ${styles.helpCard}`} aria-labelledby="tutorial-help-title">
    <div className="p-card-title">
      <span className="p-icon-tile"><LifeBuoy size={19} aria-hidden="true"/></span>
      <div><h2 id="tutorial-help-title">Ajuda e tutoriais</h2><p>Passo a passo guiado pelo Rolê, com o que o seu acesso permite.</p></div>
    </div>
    <ChapterList/>
  </section>;
}
