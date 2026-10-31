export type DictationEvent = { results: { isFinal: boolean; 0: { transcript: string } }[]; resultIndex: number };
export type DictationRecognition = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((event: DictationEvent) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void; abort: () => void };
export type DictationConstructor = new () => DictationRecognition;
/** Browser speech only stages text. This adapter has no network, submit or action callback. */
export function startReviewedDictation(Recognition: DictationConstructor | undefined, options: { consent: boolean; onText: (text: string) => void; onState: (listening: boolean) => void; onError: () => void; timeoutMs?: number }): { stop: () => void; abort: () => void } {
 if (!options.consent || !Recognition) throw new Error('dictation_unavailable');
 const instance = new Recognition(); let active = true;
 const timer = setTimeout(() => { if (active) { instance.stop(); options.onState(false); } }, Math.min(60000, options.timeoutMs ?? 60000));
 const end = () => { active = false; clearTimeout(timer); options.onState(false); };
 instance.lang = 'pt-BR'; instance.continuous = true; instance.interimResults = false;
 instance.onresult = event => { if (!active) return; let text = ''; for (let i = event.resultIndex; i < event.results.length; i++) if (event.results[i].isFinal) text += event.results[i][0].transcript + ' '; if (text) options.onText(text.slice(0, 4000)); };
 instance.onerror = () => { if (!active) return; end(); instance.abort(); options.onError(); };
 instance.onend = end;
 try { instance.start(); options.onState(true); } catch { end(); options.onError(); }
 return { stop: () => { clearTimeout(timer); if (active) instance.stop(); options.onState(false); }, abort: () => { end(); instance.abort(); } };
}
