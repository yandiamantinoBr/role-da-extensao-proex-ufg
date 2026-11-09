'use client';
import { useId } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from './theme-provider';
export function ThemeSwitch({ className = '' }: {
    className?: string;
}) {
    const { preference, resolvedTheme, setPreference } = useTheme();
    // id evita o aviso do navegador de campo sem id/name, sem entrar em formulários.
    const id = useId();
    return <label className={`theme-switch ${className}`}>
    <span aria-hidden="true">{resolvedTheme === 'dark' ? <Moon size={17}/> : <Sun size={17}/>}</span>
    <span className="visually-hidden">Aparência do portal</span>
    <select id={`theme-${id}`} aria-label="Aparência do portal" value={preference} onChange={e => setPreference(e.target.value as ThemePreference)}>
    <option value="system">Sistema</option>
    <option value="light">Claro</option>
    <option value="dark">Escuro</option>
    </select>
    </label>;
}
export default ThemeSwitch;
