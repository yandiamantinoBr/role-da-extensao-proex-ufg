'use client';
import {DayPicker} from 'react-day-picker';
import {ptBR} from 'react-day-picker/locale';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {calendarDate,calendarCivilDate,calendarOpeningDay} from '../../lib/date-field';
import styles from './date-field.module.css';
export default function DateCalendar({value,min,max,onSelect}:{value:string;min?:string;max?:string;onSelect:(iso:string)=>void}){
  const selected=calendarDate(value);
  return <DayPicker mode="single" locale={ptBR} selected={selected} defaultMonth={calendarDate(calendarOpeningDay(value,min,max))} autoFocus
    startMonth={calendarDate(min??'')} endMonth={calendarDate(max??'')} showOutsideDays
    disabled={[...(min&&calendarDate(min)?[{before:calendarDate(min)!}]:[]),...(max&&calendarDate(max)?[{after:calendarDate(max)!}]:[])]}
    onSelect={date=>{if(date)onSelect(calendarCivilDate(date));}}
    classNames={{root:styles.calendar,months:styles.months,month:styles.month,month_caption:styles.caption,caption_label:styles.captionLabel,nav:styles.nav,
      button_previous:styles.navigation,button_next:styles.navigation,month_grid:styles.grid,weekdays:styles.weekdays,weekday:styles.weekday,week:styles.week,
      day:styles.day,day_button:styles.dayButton,selected:styles.selected,today:styles.today,outside:styles.outside,disabled:styles.disabled,hidden:styles.hidden}}
    components={{Chevron:({orientation})=>orientation==='left'?<ChevronLeft size={18} aria-hidden="true"/>:<ChevronRight size={18} aria-hidden="true"/>}}/>;
}
