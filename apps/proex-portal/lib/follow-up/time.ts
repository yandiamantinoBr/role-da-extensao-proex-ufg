/** Current UFG operational dates use Brasília (UTC-03:00), independently of the browser. */
export function serverWorkClock(now=Date.now()) {return{asOf:new Date(now).toISOString(),today:new Date(now-3*60*60*1000).toISOString().slice(0,10)};}
