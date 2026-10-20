'use client';
import { Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from './theme-provider';
export function ThemeSwitch({ className = '' }: {
    className?: string;
}) {
    const { preference, resolvedTheme, setPreference } = useTheme();
    return <label className={`theme-switch ${className}`}>
    <span aria-hidden="true">{resolvedTheme === 'dark' ? <Moon size={17}/> : <Sun size={17}/>}</span>
    <span className="visually-hidden">Aparência do portal</span>
    <select aria-label="Aparência do portal" value={preference} onChange={e => setPreference(e.target.value as ThemePreference)}>
    <option value="system">Sistema</option>
    <option value="light">Claro</option>
    <option value="dark">Escuro</option>
    </select>
    </label>;
}
export default ThemeSwitch;
