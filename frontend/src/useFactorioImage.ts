import { useEffect, useState } from 'react';
import { api } from './api';
import type { FactorioImageInfo } from './types';

/**
 * What the image behind a Factorio tag supports (version, bundled mods, which game
 * modes it can't run). Best-effort: the endpoint never pulls, so an image that
 * hasn't been fetched yet reports `known: false` and the UI simply says nothing.
 * The authoritative check happens server-side at start / Test & Create.
 */
export function useFactorioImage(tag: string): FactorioImageInfo | null {
  const [info, setInfo] = useState<FactorioImageInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    api
      .factorioImageInfo(tag)
      .then((i) => !cancelled && setInfo(i))
      .catch(() => !cancelled && setInfo(null));
    return () => {
      cancelled = true;
    };
  }, [tag]);

  return info;
}
