'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
export type ThemePreference = 'system' | 'light' | 'dark';
type ThemeContextValue = {
    preference: ThemePreference;
    resolvedTheme: 'light' | 'dark';
    setPreference: (value: ThemePreference) => void;
};
const ThemeContext = createContext<ThemeContextValue>({ preference: 'system', resolvedTheme: 'light', setPreference: () => { } });
const valid = (value: unknown): value is ThemePreference => value === 'system' || value === 'light' || value === 'dark';
export function useTheme() { return useContext(ThemeContext); }
export default function ThemeProvider({ children }: {
    children: ReactNode;
}) {
    const [preference, setState] = useState<ThemePreference>('system');
    const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
    const [ready, setReady] = useState(false);
    useEffect(() => {
        let saved: unknown;
        try {
            saved = localStorage.getItem('proex-theme');
        }
        catch { }
        if (!valid(saved))
            saved = document.cookie.split('; ').find(v => v.startsWith('proex-theme='))?.split('=')[1];
        const next = valid(saved) ? saved : 'system';
        const timer = window.setTimeout(() => { setState(next); setReady(true); }, 0);
        return () => window.clearTimeout(timer);
    }, []);
    useEffect(() => {
        if (!ready)
            return;
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const apply = () => { const resolved = preference === 'system' ? media.matches ? 'dark' : 'light' : preference; document.documentElement.dataset.theme = resolved; document.documentElement.dataset.themePreference = preference; document.documentElement.style.colorScheme = resolved; setResolvedTheme(resolved); };
        const applyTimer = window.setTimeout(apply, 0);
        media.addEventListener('change', apply);
        return () => { window.clearTimeout(applyTimer); media.removeEventListener('change', apply); };
    }, [preference, ready]);
    function setPreference(value: ThemePreference) { setState(value); try {
        localStorage.setItem('proex-theme', value);
    }
    catch { } document.cookie = `proex-theme=${value}; Path=/; Max-Age=31536000; SameSite=Lax`; }
    return <ThemeContext.Provider value={{ preference, resolvedTheme, setPreference }}>{children}</ThemeContext.Provider>;
}
