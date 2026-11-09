/**
 * Prize levels of a dynamic. Client-safe: no server imports, no I/O.
 *
 * A level is configuration only. Moving an option between levels never changes stock,
 * reservations, entitlements or deliveries already registered. The participant chooses ONE
 * option of the level that came out. "Super Super" is a share of the Super results, decided
 * by a visible extra draw at the stand; the share is an explicit, editable premise.
 */
export const PRIZE_TIERS=['brinde','super','super_super'] as const;
export type PrizeTier=typeof PRIZE_TIERS[number];
export const TIER_LABELS:Record<PrizeTier,string>={brinde:'Brinde',super:'Super',super_super:'Super Super'};
export const TIER_HINTS:Record<PrizeTier,string>={brinde:'Resultado Brinde da roleta ou do dado.',super:'Resultado Super Brinde. A pessoa escolhe uma opção.',super_super:'Parte dos resultados Super, no sorteio extra. A pessoa escolhe uma opção.'};
/** Premise used until someone saves another value: 1 in 4 Super results becomes Super Super. */
export const DEFAULT_SUPER_SUPER_PERCENT=25;
export const PRIZE_TIER_ACTIONS=['tier.set','percent.set','option.create'] as const;
export type PrizeTierAction=typeof PRIZE_TIER_ACTIONS[number];
export const PRIZE_TIER_LIMITS={name:120,options:200,components:8,history:40,quantity:1000} as const;

export type PrizeOptionComponent={itemId:string;name:string;unit:string;quantity:number};
export type PrizeOption={offerId:string;name:string;tier:PrizeTier|null;components:PrizeOptionComponent[];updatedAt:string|null;updatedBy:string|null};
export type PrizeHistoryEntry={id:string;kind:'tier'|'percent';offerName:string|null;previousTier:PrizeTier|null;tier:PrizeTier|null;previousPercent:number|null;percent:number|null;actorName:string;createdAt:string};
export type PrizeMaterial={id:string;name:string;unit:string};
export type PrizeTiersWorkspace={
 viewerId:string;campaignId:string;projectId:string;
 campaign:{name:string;status:'draft'|'active'|'paused'|'closed';retryLimit:number|null};
 /** campaigns.manage (owner/manager) on the dynamic's project, live SQL, and the dynamic is not closed. */
 canManage:boolean;
 /** Opaque CAS revision of the whole level configuration. 0 = nothing saved yet. */
 version:number;
 superSuperPercent:number;percentIsDefault:boolean;
 options:PrizeOption[];history:PrizeHistoryEntry[];
 /** Active gift materials of the project, only for managers (to compose a new option). */
 materials:PrizeMaterial[];
 asOf:string;
};
type Base={campaignId:string;expectedVersion:number;operationKey:string};
export type TierSetInput=Base&{action:'tier.set';offerId:string;tier:PrizeTier|null};
export type PercentSetInput=Base&{action:'percent.set';superSuperPercent:number};
export type OptionCreateInput=Base&{action:'option.create';name:string;tier:PrizeTier;components:{itemId:string;quantity:number}[]};
export type PrizeTierActionInput=TierSetInput|PercentSetInput|OptionCreateInput;
export type PrizeTierActionResult={viewerId:string;campaignId:string;entityId:string;version:number;duplicate:boolean};

/** Faces of the 6-sided wheel/dice used by the portal: 3 Brinde, 1 Tente novamente, 1 Não foi, 1 Super. */
export const FACE_WEIGHTS={brinde:3,retry:1,miss:1,super:1} as const;
export type TierOdds={brinde:number;super:number;superSuper:number;nothing:number;retryLimit:number};
/**
 * Final chance per person, including up to `retryLimit` extra spins after "Tente novamente".
 * With one repetition: Brinde 7/12 and Super 7/36 (as in the 6 Nov plan); Super Super is
 * `percent`% of Super.
 */
export function tierOdds(percent:number,retryLimit:number|null):TierOdds{
 const share=Math.max(0,Math.min(100,Math.round(Number.isFinite(percent)?percent:0)))/100,retries=Math.max(0,Math.min(3,retryLimit??1));
 const total=FACE_WEIGHTS.brinde+FACE_WEIGHTS.retry+FACE_WEIGHTS.miss+FACE_WEIGHTS.super,pRetry=FACE_WEIGHTS.retry/total;
 let reach=0;for(let k=0;k<=retries;k++)reach+=pRetry**k;
 const brinde=FACE_WEIGHTS.brinde/total*reach,superAll=FACE_WEIGHTS.super/total*reach;
 return{brinde,super:superAll*(1-share),superSuper:superAll*share,nothing:Math.max(0,1-brinde-superAll),retryLimit:retries};
}
export function percentLabel(value:number):string{return `${(value*100).toLocaleString('pt-BR',{maximumFractionDigits:1})}%`;}
/** Rounded expected count for a group size, never shown as a promise. */
export function expected(value:number,people:number):string{const count=value*people,rounded=Math.round(count);return count>0&&rounded===0?'menos de 1':`cerca de ${rounded}`;}
