'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import StockConsumptionPanel from './stock-consumption-panel';
import styles from './project-quick-entry.module.css';
export default function StockUnitDialog({unitId,onClose,onOpenMaterial}:{unitId:string;onClose:()=>void;onOpenMaterial?:(id:string)=>void}){
 const dialog=useRef<HTMLDialogElement>(null),title=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{const node=dialog.current,opener=document.activeElement;node?.showModal();title.current?.focus();return()=>{if(node?.open)node.close();if(opener instanceof HTMLElement&&opener.isConnected)opener.focus({preventScroll:true});};},[]);
 return <dialog ref={dialog} className={styles.dialog} aria-labelledby="stock-unit-title" onCancel={event=>{event.preventDefault();onClose();}}><header className={styles.header}><h2 ref={title} tabIndex={-1} id="stock-unit-title">Relação com a unidade</h2><button className="p-icon-button" type="button" aria-label="Fechar unidade" onClick={onClose}><X size={20}/></button></header><StockConsumptionPanel initialUnitId={unitId} onOpenMaterial={id=>{onClose();onOpenMaterial?.(id);}}/></dialog>;
}
