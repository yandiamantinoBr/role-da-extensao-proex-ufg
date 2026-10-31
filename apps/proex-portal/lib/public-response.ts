/** Best-effort timing floor; the public response never discloses account or delivery state. */
export async function waitForPublicEnvelope(started:number){const remaining=1800-(Date.now()-started);if(remaining>0)await new Promise<void>(resolve=>setTimeout(resolve,remaining));}
