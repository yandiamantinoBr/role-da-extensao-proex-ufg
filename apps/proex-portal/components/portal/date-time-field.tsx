'use client';
import {useEffect,useId,useRef,useState,type ChangeEvent,type InputHTMLAttributes} from 'react';
import DateField from './date-field';
import {combineLocalDateTime,isLocalDateTime,localDateTimeError,parseClock} from '../../lib/date-time-field';
import styles from './date-time-field.module.css';
type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'value'|'defaultValue'|'onChange'|'min'|'max'> & {value?:string;defaultValue?:string;min?:string;max?:string;onValueChange?:(value:string)=>void;onChange?:(event:ChangeEvent<HTMLInputElement>)=>void};
/** Brazilian date + 24-hour text clock. Submitted values remain datetime-local
 * YYYY-MM-DDTHH:mm; callers retain their existing local-to-ISO conversion. */
export default function DateTimeField({name,id,value,defaultValue='',min,max,onValueChange,onChange,required=false,disabled,className,...props}:Props){
 const generated=useId(),inputId=id??`datetime-${generated}`,errorId=`${inputId}-clock-error`,initial=isLocalDateTime(defaultValue)?defaultValue:'';
 const [local,setLocal]=useState(initial),[edit,setEdit]=useState<{base:string;date:string;time:string}|null>(null),[touched,setTouched]=useState(false);
 const hidden=useRef<HTMLInputElement>(null),clock=useRef<HTMLInputElement>(null),internal=useRef(false);
 const canonical=value===undefined?local:isLocalDateTime(value)?value:'',date=edit?.base===canonical?edit.date:canonical.slice(0,10),time=edit?.base===canonical?edit.time:canonical.slice(11),error=localDateTimeError(date,time,required,min,max),label=String(props['aria-label']??'Data e hora');
 useEffect(()=>{clock.current?.setCustomValidity(error);},[error]);
 useEffect(()=>{const form=hidden.current?.form;if(!form||value!==undefined)return;const reset=()=>queueMicrotask(()=>{setLocal(initial);setEdit(null);setTouched(false);clock.current?.setCustomValidity(localDateTimeError(initial.slice(0,10),initial.slice(11),required,min,max));});form.addEventListener('reset',reset);return()=>form.removeEventListener('reset',reset);},[initial,required,value,min,max]);
 function commit(nextDate:string,nextTime:string){const next=combineLocalDateTime(nextDate,nextTime);setLocal(next);setEdit({base:next,date:nextDate,time:nextTime});clock.current?.setCustomValidity(localDateTimeError(nextDate,nextTime,required,min,max));if(hidden.current){hidden.current.value=next;internal.current=true;hidden.current.dispatchEvent(new Event('input',{bubbles:true}));internal.current=false;}}
 return <span className={`${styles.field} ${className??''}`}>
  <input ref={hidden} type="hidden" name={name} id={name ? undefined : `${inputId}-valor`} value={canonical} disabled={disabled} data-draft-date="true" onInput={event=>{const next=isLocalDateTime(event.currentTarget.value)?event.currentTarget.value:'';if(!internal.current){setLocal(next);setEdit(null);setTouched(false);clock.current?.setCustomValidity(localDateTimeError(next.slice(0,10),next.slice(11),required,min,max));}onValueChange?.(next);onChange?.(event as unknown as ChangeEvent<HTMLInputElement>);}}/>
  <span className={styles.parts}><DateField {...props} id={inputId} aria-label={`${label}: data`} value={date} min={min?.slice(0,10)} max={max?.slice(0,10)} onValueChange={next=>commit(next,time)} disabled={disabled} required={required||Boolean(time)} onInvalid={event=>{if(!event.currentTarget.value)event.currentTarget.setCustomValidity('Informe a data no formato dia/mês/ano.');setTouched(true);}}/>
   <span className={styles.time}><input ref={clock} id={`${inputId}-hora`} type="text" lang="pt-BR" inputMode="numeric" autoComplete="off" value={time} maxLength={5} placeholder="hh:mm" aria-label={`${label}: hora (24 horas)`} aria-invalid={touched&&error?true:undefined} aria-describedby={touched&&error?errorId:undefined} disabled={disabled} required={required||Boolean(date)} onChange={event=>commit(date,event.target.value)} onBlur={()=>{setTouched(true);const parsed=parseClock(time);if(parsed)commit(date,parsed);}} onInvalid={()=>setTouched(true)}/><small>formato 24 h</small></span>
  </span>{touched&&error&&<small id={errorId} role="alert" className={styles.error}>{error}</small>}
 </span>;
}
