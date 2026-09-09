import { useEffect, useRef, useState } from 'react';
import type { AppError, Page } from '../../shared/contracts.js';
import { errorOf } from '../../shared/errors.js';
import { api, isPage, type Guard } from '../../shared/client/api-client.js';
export function useQuery<T>(path: string, guard: Guard<T>, revision = 0) {
  const [state, set] = useState<{ data?: T; loading: boolean; error?: AppError }>({ loading: true }); const [retry, setRetry] = useState(0);
  useEffect(() => { let alive = true; const abort = new AbortController(); set({ loading: true }); api.request(path, guard, { signal: abort.signal }).then(data => { if (alive) set({ data, loading: false }); }).catch(e => { if (alive) set({ loading: false, error: errorOf(e) }); }); return () => { alive = false; abort.abort(); }; }, [path, revision, retry]);
  return { ...state, reload: () => setRetry(n => n + 1) };
}
export function usePaged<T>(path: string, guard: Guard<T>, revision = 0) {
  const [state, set] = useState<{ data?: Page<T>; loading: boolean; error?: AppError }>({ loading: true }); const [retry, setRetry] = useState(0); const generation = useRef(0); const busy = useRef(false);
  useEffect(() => { const g = ++generation.current; busy.current = true; set({ loading: true }); api.request(path, isPage(guard)).then(data => { if (g === generation.current) set({ data, loading: false }); }).catch(e => { if (g === generation.current) set({ loading: false, error: errorOf(e) }); }).finally(() => { if (g === generation.current) busy.current = false; }); return () => { generation.current++; }; }, [path, revision, retry]);
  const more = async () => { if (busy.current || !state.data?.nextCursor) return; const g = generation.current; busy.current = true; set(s => ({ ...s, loading: true, error: undefined }));
    try { const next = await api.request(path + (path.includes('?') ? '&' : '?') + 'cursor=' + encodeURIComponent(state.data.nextCursor), isPage(guard)); if (g === generation.current) set(s => ({ data: { ...next, items: [...(s.data?.items ?? []), ...next.items] }, loading: false })); }
    catch (e) { if (g === generation.current) set(s => ({ ...s, loading: false, error: errorOf(e) })); } finally { if (g === generation.current) busy.current = false; }
  };
  return { ...state, more, reload: () => setRetry(n => n + 1) };
}
