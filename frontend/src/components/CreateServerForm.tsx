import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { DraftSource, DraftState, MapGenSettings } from '../types';
import { toastError, toastSuccess } from '../ui';
import { FactorioTagSelect } from './FactorioTagSelect';
import { MapGenEditor } from './MapGenEditor';
import { DnsNamePreview } from './DnsNamePreview';
import { GameModeSelect } from './GameModeSelect';
import { Collapsible } from './Collapsible';
import { ConfirmDialog } from './ConfirmDialog';
import { IconTerminal, IconUpload, IconWorld } from './icons';

const MODES: {
  source: DraftSource;
  Icon: (props: { size?: number }) => JSX.Element;
  title: string;
  blurb: string;
}[] = [
  {
    source: 'generate',
    Icon: IconWorld,
    title: 'Generate new world',
    blurb: 'Pick a game mode and tune resources, water, and terrain. Preview before you commit.',
  },
  {
    source: 'import',
    Icon: IconTerminal,
    title: 'Import map string',
    blurb: 'Paste a Factorio map exchange string; we decode it and show exactly what it maps to.',
  },
  {
    source: 'save',
    Icon: IconUpload,
    title: 'Load from save',
    blurb: 'Upload an existing save file and start the server straight from it.',
  },
];

/**
 * New-server wizard. Picking a mode lazily creates a draft (a persisted, inactive
 * server row) that autosaves as you go and survives restarts; "Create" finalizes it
 * into a real server. Pass `resumeDraftId` to reopen an in-progress draft.
 */
export function CreateServerForm({
  onClose,
  onCreated,
  dnsEnabled,
  baseDomain,
  resumeDraftId,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  dnsEnabled: boolean;
  baseDomain: string | null;
  resumeDraftId?: string;
}) {
  const [phase, setPhase] = useState<'mode' | 'config'>(resumeDraftId ? 'config' : 'mode');
  const [draftId, setDraftId] = useState<string | null>(resumeDraftId ?? null);
  const [source, setSource] = useState<DraftSource>('generate');

  const [name, setName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(0);
  const [description, setDescription] = useState('');
  const [factorioTag, setFactorioTag] = useState('stable');
  const [gameMode, setGameMode] = useState('space_age');
  const [mapGen, setMapGen] = useState<MapGenSettings | null>(null);
  const [mapGenEdited, setMapGenEdited] = useState(false);
  const [exchangeString, setExchangeString] = useState('');

  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmChange, setConfirmChange] = useState(false);
  const finalized = useRef(false);

  // Whether the form holds anything worth warning about before discarding on "Change".
  // (Loading map-gen defaults by opening the drawer doesn't count — only real edits.)
  const isDirty =
    name.trim() !== '' ||
    subdomain.trim() !== '' ||
    description.trim() !== '' ||
    exchangeString.trim() !== '' ||
    maxPlayers !== 0 ||
    gameMode !== 'space_age' ||
    factorioTag !== 'stable' ||
    mapGenEdited;

  // Resume an existing draft: hydrate the form from its saved state.
  useEffect(() => {
    if (!resumeDraftId) return;
    void (async () => {
      try {
        const { state } = await api.getDraft(resumeDraftId);
        setSource(state.source);
        setName(state.name ?? '');
        setSubdomain(state.subdomain ?? '');
        setMaxPlayers(state.maxPlayers ?? 0);
        setDescription(state.description ?? '');
        setFactorioTag(state.factorioTag ?? 'stable');
        setGameMode(state.gameMode ?? 'space_age');
        if (state.mapGen) setMapGen(state.mapGen);
        if (state.exchangeString) setExchangeString(state.exchangeString);
      } catch (err) {
        toastError((err as Error).message);
      }
    })();
  }, [resumeDraftId]);

  const patch = useMemo<Partial<DraftState>>(
    () => ({
      name,
      subdomain,
      maxPlayers,
      description,
      factorioTag,
      gameMode,
      ...(source === 'generate' && mapGen ? { mapGen } : {}),
      ...(source === 'import' ? { exchangeString } : {}),
    }),
    [name, subdomain, maxPlayers, description, factorioTag, gameMode, mapGen, exchangeString, source],
  );

  // Debounced autosave to the draft as fields change.
  useEffect(() => {
    if (!draftId || phase !== 'config' || finalized.current) return;
    const t = setTimeout(() => void api.updateDraft(draftId, patch).catch(() => {}), 600);
    return () => clearTimeout(t);
  }, [draftId, phase, patch]);

  const pickMode = async (src: DraftSource) => {
    setBusy(true);
    try {
      const { draft } = await api.createDraft({ source: src, gameMode });
      setSource(src);
      setDraftId(draft.id);
      setPhase('config');
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const initMapGen = async () => {
    if (mapGen) return;
    try {
      setMapGen((await api.mapGenDefaults()).settings);
    } catch (err) {
      toastError((err as Error).message);
    }
  };

  const discardIfDraft = async () => {
    if (draftId && !finalized.current) await api.discardDraft(draftId).catch(() => {});
  };

  // "Change" mode discards the current draft. Confirm first only if there's content
  // to lose; a pristine draft switches silently.
  const back = () => {
    if (isDirty) setConfirmChange(true);
    else void doBack();
  };
  const doBack = async () => {
    setConfirmChange(false);
    await discardIfDraft();
    setDraftId(null);
    setMapGenEdited(false);
    setPhase('mode');
  };

  // Dismiss keeps the draft (resume later from "Continue new server").
  const close = () => onClose();

  // Explicit abandon — remove the draft.
  const discard = async () => {
    await discardIfDraft();
    onClose();
  };

  const create = async () => {
    if (!draftId) return;
    setCreating(true);
    try {
      await api.updateDraft(draftId, patch); // flush latest field values first
      const { server } = await api.finalizeDraft(draftId);
      finalized.current = true;
      toastSuccess(`Created "${server.name}"`);
      onCreated(server.id);
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  // Import/save flows can't finalize yet (decode / upload land in later slices).
  const finalizeReady = source === 'generate';
  const canCreate = finalizeReady && name.trim().length > 0 && subdomain.trim().length > 0;

  return (
    <>
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 60,
        zIndex: 10,
      }}
      onClick={() => void close()}
    >
      <div
        className="panel"
        style={{ width: 520, maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {phase === 'mode' ? (
          <>
            <h2 style={{ marginTop: 0 }}>New server</h2>
            <div className="small muted" style={{ marginBottom: 14 }}>
              How do you want to start this world?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {MODES.map((m) => (
                <button
                  key={m.source}
                  className="ghost"
                  disabled={busy}
                  onClick={() => void pickMode(m.source)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    textAlign: 'left',
                    padding: '14px 16px',
                    height: 'auto',
                  }}
                >
                  <span style={{ color: 'var(--accent)', display: 'flex', flex: '0 0 auto', marginTop: 1 }}>
                    <m.Icon size={22} />
                  </span>
                  <span>
                    <span style={{ fontWeight: 600, display: 'block' }}>{m.title}</span>
                    <span className="small muted">{m.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="ghost" onClick={() => void close()}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="spread" style={{ marginBottom: 4 }}>
              <h2 style={{ margin: 0 }}>
                {MODES.find((m) => m.source === source)?.title ?? 'New server'}
              </h2>
              <button className="ghost small" onClick={back}>
                ← Change
              </button>
            </div>

            <label>Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />

            <label>Subdomain * (DNS label — lowercase, digits, hyphens)</label>
            <input
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
              placeholder="factory1"
              required
            />
            <DnsNamePreview subdomain={subdomain} baseDomain={baseDomain} enabled={dnsEnabled} />

            <label>Max players (0 = unlimited)</label>
            <input
              type="number"
              min={0}
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Number(e.target.value))}
            />

            <label>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />

            <FactorioTagSelect value={factorioTag} onChange={setFactorioTag} />
            <div className="small muted" style={{ marginTop: 4 }}>
              Mods & public listing use the global <strong>Factorio.com account</strong> (Settings) —
              one account for every server.
            </div>

            {source === 'generate' && (
              <>
                <div style={{ marginTop: 12 }}>
                  <GameModeSelect value={gameMode} onChange={setGameMode} />
                </div>
                <Collapsible
                  title="Map generation"
                  hint="Optional — tune ore, water & terrain. Closed uses the game's defaults."
                  onOpenChange={(open) => {
                    if (open) void initMapGen();
                  }}
                  style={{ marginTop: 12 }}
                >
                  <div className="small muted" style={{ marginBottom: 10 }}>
                    Applied when this server generates its first map. A live preview lands in a
                    follow-up.
                  </div>
                  {mapGen ? (
                    <MapGenEditor
                      value={mapGen}
                      onChange={(v) => {
                        setMapGen(v);
                        setMapGenEdited(true);
                      }}
                      mode={gameMode}
                    />
                  ) : (
                    <div className="muted small">Loading defaults…</div>
                  )}
                </Collapsible>
              </>
            )}

            {source === 'import' && (
              <div style={{ marginTop: 12 }}>
                <label>Map exchange string</label>
                <textarea
                  className="mono"
                  rows={4}
                  value={exchangeString}
                  onChange={(e) => setExchangeString(e.target.value)}
                  placeholder=">>>eNpj..."
                />
                <div className="small muted" style={{ marginTop: 4 }}>
                  Paste a string from Factorio's map-generation screen.{' '}
                  <a
                    href="https://wiki.factorio.com/Map_exchange_string_format"
                    target="_blank"
                    rel="noreferrer"
                  >
                    What's a map exchange string?
                  </a>
                </div>
                <div className="small" style={{ marginTop: 10, color: 'var(--accent)' }}>
                  Decoding this string into an editable, previewable map — and creating from it —
                  arrives in the next step of this feature.
                </div>
              </div>
            )}

            {source === 'save' && (
              <div style={{ marginTop: 12 }}>
                <div className="small" style={{ color: 'var(--accent)' }}>
                  Uploading a save (and smart-loading its mods) arrives in a follow-up. The wizard
                  shell and this draft are saved in the meantime.
                </div>
              </div>
            )}

            <div className="row" style={{ marginTop: 18, justifyContent: 'space-between' }}>
              <span className="small muted" style={{ alignSelf: 'center' }}>
                Saved as a draft — close to resume later from “Continue new server”.
              </span>
              <div className="row">
                <button className="danger ghost" onClick={() => void discard()}>
                  Discard
                </button>
                <button
                  className="primary"
                  disabled={creating || !canCreate}
                  title={finalizeReady ? undefined : 'Available once this flow is wired up'}
                  onClick={() => void create()}
                >
                  {creating ? 'Creating…' : 'Create server'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
      {confirmChange && (
        <ConfirmDialog
          title="Discard this draft?"
          body="Switching flow deletes this draft and everything you've entered."
          confirmLabel="Discard & change"
          onConfirm={() => void doBack()}
          onCancel={() => setConfirmChange(false)}
        />
      )}
    </>
  );
}
