import {toDocx,toXlsx,type ExportColumn,type ExportRow} from './report-export';
import {toPdf,type ReportPdfPresentation} from './report-pdf';
import type {DocumentFormat} from './export-formats';
export async function documentExport(format:DocumentFormat,title:string,columns:ExportColumn[],rows:ExportRow[],display:(row:ExportRow,key:string)=>unknown,info:[string,string][],presentation?:ReportPdfPresentation):Promise<Blob>{
  if(format==='pdf')return toPdf(title,columns,rows,display,info,{presentation});
  return format==='docx'?toDocx(title,columns,rows,display,info):toXlsx(title,columns,rows,display,info);
}
