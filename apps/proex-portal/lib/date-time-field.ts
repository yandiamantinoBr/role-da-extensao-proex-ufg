import {isCivilDate} from './civil-date';
export function parseClock(text:string):string {const match=/^(\d{2}):?(\d{2})$/.exec(text.trim());return match&&Number(match[1])<24&&Number(match[2])<60?`${match[1]}:${match[2]}`:'';}
export function isLocalDateTime(value:string):boolean {return /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)&&isCivilDate(value.slice(0,10))&&parseClock(value.slice(11))===value.slice(11);}
export function combineLocalDateTime(date:string,time:string):string {const clock=parseClock(time);return isCivilDate(date)&&clock?`${date}T${clock}`:'';}
export function localDateTimeError(date:string,time:string,required=false,min?:string,max?:string):string {
 if(!date&&!time)return required?'Informe a data e a hora.':'';
 if(!isCivilDate(date))return 'Informe uma data válida no formato dia/mês/ano.';
 if(!parseClock(time))return 'Informe uma hora válida entre 00:00 e 23:59.';
 const value=combineLocalDateTime(date,time),display=(s:string)=>`${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)} às ${s.slice(11)}`;
 if(min&&isLocalDateTime(min)&&value<min)return `Escolha ${display(min)} ou um horário posterior.`;
 if(max&&isLocalDateTime(max)&&value>max)return `Escolha ${display(max)} ou um horário anterior.`;
 return '';
}
