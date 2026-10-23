'use client';
import { useEffect, useRef, useState } from 'react';
import { isModuleId, type ModuleId } from './navigation-model';
type Usage = {
    count: number;
    lastUsed: number;
};
type Preferences = {
    version: 1;
    sidebarCollapsed: boolean | null;
    pinned: ModuleId[];
    usage: Partial<Record<ModuleId, Usage>>;
};
const empty = (): Preferences => ({ version: 1, sidebarCollapsed: null, pinned: [], usage: {} });
function parse(raw: string | null): Preferences {
    if (!raw || raw.length > 10000)
        return empty();
    try {
        const value = JSON.parse(raw);
        if (value?.version !== 1 || typeof value !== 'object')
            return empty();
        const usage: Preferences['usage'] = {};
        for (const [key, row] of Object.entries(value.usage ?? {})) {
            if (!isModuleId(key) || !row || typeof row !== 'object')
                continue;
            const entry = row as Record<string, unknown>;
            if (typeof entry.count === 'number' && Number.isFinite(entry.count) && typeof entry.lastUsed === 'number' && Number.isFinite(entry.lastUsed))
                usage[key] = { count: Math.max(0, Math.min(1000000, Math.floor(entry.count))), lastUsed: entry.lastUsed };
        }
        return { version: 1, sidebarCollapsed: typeof value.sidebarCollapsed === 'boolean' ? value.sidebarCollapsed : null, pinned: [...new Set(Array.isArray(value.pinned) ? value.pinned.filter(isModuleId) : [])] as ModuleId[], usage };
    }
    catch {
        return empty();
    }
}
/** Stores only UI choices and module-use counters, isolated by the canonical user id. */
export function useNavigationPreferences(userId: string, allowedIds: ModuleId[]) {
    const [stored, setStored] = useState<{
        userId: string;
        value: Preferences;
    } | null>(null);
    const [compactViewport, setCompactViewport] = useState(false);
    const current = useRef<{
        userId: string;
        value: Preferences;
    } | null>(null);
    const storageKey = userId ? `proex:navigation:v1:${encodeURIComponent(userId)}` : '';
    useEffect(() => {
        const media = window.matchMedia('(max-width: 1100px)');
        const viewport = () => setCompactViewport(media.matches);
        const restore = () => { let value = empty(); try {
            if (storageKey)
                value = parse(localStorage.getItem(storageKey));
        }
        catch { } const next = { userId, value }; current.current = next; setStored(next); };
        const timer = window.setTimeout(() => { viewport(); restore(); }, 0);
        const sync = (event: StorageEvent) => { if (event.key === storageKey)
            restore(); };
        media.addEventListener('change', viewport);
        window.addEventListener('storage', sync);
        return () => { window.clearTimeout(timer); media.removeEventListener('change', viewport); window.removeEventListener('storage', sync); };
    }, [storageKey, userId]);
    const value = stored?.userId === userId ? stored.value : empty();
    function update(change: (value: Preferences) => Preferences) {
        if (!userId)
            return;
        let base = current.current?.userId === userId ? current.current.value : empty();
        if (current.current?.userId !== userId) {
            try {
                base = parse(localStorage.getItem(storageKey));
            }
            catch { }
        }
        const next = { userId, value: change(base) };
        current.current = next;
        setStored(next);
        try {
            localStorage.setItem(storageKey, JSON.stringify(next.value));
        }
        catch { /* These preferences remain usable for this visit. */ }
    }
    const allowed = new Set(allowedIds);
    const pinned = value.pinned.filter(id => id !== 'overview' && allowed.has(id));
    const frequent = (Object.entries(value.usage) as [
        ModuleId,
        Usage
    ][]).filter(([id, row]) => allowed.has(id) && id !== 'overview' && id !== 'profile' && row.count > 0).sort((a, b) => b[1].count - a[1].count || b[1].lastUsed - a[1].lastUsed).map(([id]) => id);
    const collapsed = value.sidebarCollapsed ?? compactViewport;
    return { collapsed, pinned, frequent, ready: stored?.userId === userId,
        toggleCollapsed: () => update(previous => ({ ...previous, sidebarCollapsed: !collapsed })),
        togglePin: (id: ModuleId) => { if (!allowed.has(id) || id === 'overview')
            return; update(previous => ({ ...previous, pinned: previous.pinned.includes(id) ? previous.pinned.filter(item => item !== id) : [...previous.pinned, id] })); },
        recordVisit: (id: ModuleId) => { if (!allowed.has(id) || id === 'overview')
            return; update(previous => ({ ...previous, usage: { ...previous.usage, [id]: { count: Math.min(1000000, (previous.usage[id]?.count ?? 0) + 1), lastUsed: Date.now() } } })); },
    };
}
