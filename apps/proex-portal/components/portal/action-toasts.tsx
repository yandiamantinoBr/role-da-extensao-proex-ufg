'use client';
import { Toaster } from 'sonner';
import styles from './action-toasts.module.css';
export default function ActionToasts(){return <Toaster position="top-right" closeButton duration={5000} visibleToasts={2} offset={88} mobileOffset={{top:88,right:12,left:12}} toastOptions={{style:{background:'var(--surface)',color:'var(--ink)',border:'1px solid var(--line)',fontFamily:'inherit'},className:`p-action-toast ${styles.toast}`,closeButtonAriaLabel:'Fechar aviso'}}/>;}
