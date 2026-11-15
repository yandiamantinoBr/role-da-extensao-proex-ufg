'use client';

import { useCallback, useEffect, useRef, type SyntheticEvent } from 'react';

export type RoleLocalMedia = { kind: 'video' | 'audio'; file: File };

/** A URL vive apenas enquanto o controle está na tela. O arquivo fica na conversa em memória. */
export function RoleLocalPlayer({ media, label, className, onLoadedMetadata, onError }: {
  media: RoleLocalMedia;
  label: string;
  className?: string;
  onLoadedMetadata?: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onError?: () => void;
}) {
  const element = useRef<HTMLMediaElement | null>(null);
  const bind = useCallback((player: HTMLMediaElement | null) => { element.current = player; }, []);
  const { file, kind } = media;

  useEffect(() => {
    const player = element.current;
    if (!player) return;
    const url = URL.createObjectURL(file);
    player.src = url;
    return () => {
      player.pause();
      player.removeAttribute('src');
      player.load();
      URL.revokeObjectURL(url);
    };
  }, [file, kind]);

  const props = { ref: bind, className, controls: true, preload: 'metadata', 'aria-label': label, tabIndex: 0, onError };
  return kind === 'audio' ? <audio {...props}/> : <video {...props} playsInline onLoadedMetadata={onLoadedMetadata}/>;
}
