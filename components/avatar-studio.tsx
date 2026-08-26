"use client";

import { useState } from "react";
import { Avatar } from "@/components/avatar";
import { useSession } from "@/components/session";
import type { Profile } from "@/lib/supabase/types";
import {
  COLORS,
  MARKS,
  MARK_NAMES,
  METALS,
  METAL_TONES,
  PATTERNS,
  PATTERN_NAMES,
  SHAPES,
  SHAPE_NAMES,
  parseAvatar,
  randomAvatar,
  type AvatarSpec,
  type ColorKey,
} from "@/lib/avatar";

const COLOR_KEYS = Object.keys(COLORS) as ColorKey[];

export function AvatarStudio() {
  const { status, profile, error } = useSession();

  if (status === "loading") {
    return <p className="eyebrow py-10">Abrindo a mesa…</p>;
  }
  if (status === "error" || !profile) {
    return (
      <div
        className="mt-6 border-l-2 p-4 text-sm"
        style={{ borderColor: "var(--lacquer)", background: "var(--bg-sunk)" }}
      >
        <p style={{ color: "var(--fg)", fontWeight: 600 }}>Não deu para abrir a sessão.</p>
        <p className="mt-1" style={{ color: "var(--fg-dim)" }}>
          {error ?? "Tente recarregar a página."}
        </p>
      </div>
    );
  }

  // key = id do perfil: se a sessão trocar, o editor renasce com o estado certo
  return <Editor key={profile.id} profile={profile} />;
}

/** O estado nasce das props — sem efeito de sincronização. */
function Editor({ profile }: { profile: Profile }) {
  const { save } = useSession();
  const [spec, setSpec] = useState<AvatarSpec>(() => parseAvatar(profile.avatar));
  const [name, setName] = useState(() =>
    profile.display_name === "Convidado" ? "" : profile.display_name,
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const set = <K extends keyof AvatarSpec>(k: K, v: AvatarSpec[K]) => {
    setSpec({ ...spec, [k]: v });
    setSaved(false);
  };

  const nameOk = name.trim().length >= 2 && name.trim().length <= 16;

  async function onSave() {
    if (!nameOk) return;
    setSaving(true);
    setFailure(null);
    try {
      await save(name.trim(), spec);
      setSaved(true);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-12">
      {/* ── prévia ──────────────────────────────────────────────────────── */}
      <div className="lg:sticky lg:top-8 lg:self-start">
        <div
          className="flex flex-col items-center gap-5 px-6 py-8"
          style={{
            background: "var(--felt-800)",
            border: "1px solid var(--felt-600)",
            boxShadow: "var(--shadow-rest)",
          }}
        >
          <div style={{ filter: "drop-shadow(0 10px 18px rgb(0 0 0 / .45))" }}>
            <Avatar spec={spec} size={176} title="Sua ficha" />
          </div>
          <p
            className="text-center text-2xl leading-tight"
            style={{
              fontFamily: "var(--font-fraunces), Georgia, serif",
              fontVariationSettings: '"SOFT" 8, "WONK" 1, "opsz" 72',
              fontWeight: 700,
              color: "#F2EADA",
            }}
          >
            {name.trim() || "Convidado"}
          </p>
          <p className="eyebrow" style={{ color: "#7B8E82" }}>
            {SHAPE_NAMES[spec.shape]} · {COLORS[spec.color].name} · {MARK_NAMES[spec.mark]}
          </p>
        </div>

        <button
          type="button"
          className="btn btn-ghost mt-3 w-full"
          onClick={() => {
            setSpec(randomAvatar());
            setSaved(false);
          }}
        >
          Sortear ficha
        </button>
      </div>

      {/* ── opções ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-7">
        <div>
          <label htmlFor="nome" className="eyebrow mb-2 block">
            Apelido
          </label>
          <input
            id="nome"
            value={name}
            onChange={(e) => {
              setName(e.target.value.slice(0, 16));
              setSaved(false);
            }}
            placeholder="Como te chamam"
            maxLength={16}
            className="w-full max-w-sm px-4 py-3 text-lg"
            style={{
              background: "var(--bg-sunk)",
              border: "1px solid var(--line-strong)",
              borderRadius: 2,
              color: "var(--fg)",
              boxShadow: "inset 0 2px 6px -3px rgb(0 0 0 / .35)",
            }}
          />
          <p className="mt-2 text-xs" style={{ color: "var(--fg-faint)" }}>
            De 2 a 16 caracteres. Não precisa ser único — só dentro da sala.
          </p>
        </div>

        <Row label="Forma">
          {SHAPES.map((s) => (
            <Chip key={s} active={spec.shape === s} onClick={() => set("shape", s)} label={SHAPE_NAMES[s]}>
              <Avatar spec={{ ...spec, shape: s }} size={40} />
            </Chip>
          ))}
        </Row>

        <Row label="Esmalte">
          {COLOR_KEYS.map((k) => (
            <Chip key={k} active={spec.color === k} onClick={() => set("color", k)} label={COLORS[k].name}>
              <span
                className="block h-9 w-9 rounded-full"
                style={{
                  background: COLORS[k].enamel,
                  boxShadow: `inset 0 -4px 8px ${COLORS[k].deep}, inset 0 3px 5px rgb(255 255 255 / .28)`,
                }}
              />
            </Chip>
          ))}
        </Row>

        <Row label="Hachura">
          {PATTERNS.map((p) => (
            <Chip key={p} active={spec.pattern === p} onClick={() => set("pattern", p)} label={PATTERN_NAMES[p]}>
              <Avatar spec={{ ...spec, pattern: p, mark: "losangos" }} size={40} />
            </Chip>
          ))}
        </Row>

        <Row label="Metal">
          {METALS.map((m) => (
            <Chip key={m} active={spec.metal === m} onClick={() => set("metal", m)} label={METAL_TONES[m].name}>
              <span
                className="block h-9 w-9 rounded-full"
                style={{
                  background: `linear-gradient(135deg, ${METAL_TONES[m].hi}, ${METAL_TONES[m].mid} 40%, ${METAL_TONES[m].lo} 70%, ${METAL_TONES[m].hi})`,
                }}
              />
            </Chip>
          ))}
        </Row>

        <Row label="Brasão">
          {MARKS.map((m) => (
            <Chip key={m} active={spec.mark === m} onClick={() => set("mark", m)} label={MARK_NAMES[m]}>
              <Avatar spec={{ ...spec, mark: m }} size={40} />
            </Chip>
          ))}
        </Row>

        <div className="flex flex-wrap items-center gap-3 border-t pt-6" style={{ borderColor: "var(--line)" }}>
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={!nameOk || saving}>
            {saving ? "Gravando…" : "Salvar ficha"}
          </button>
          {saved && (
            <span className="eyebrow" style={{ color: "var(--jade)" }}>
              Salvo
            </span>
          )}
          {failure && (
            <span className="text-sm" style={{ color: "var(--lacquer)" }}>
              {failure}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── peças de UI ────────────────────────────────────────────────────────── */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow mb-2">{label}</p>
      {/* rolagem horizontal no celular: o polegar arrasta, a página não anda de lado */}
      <div className="-mx-5 flex snap-x gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {children}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className="flex snap-start items-center justify-center p-2 transition-transform active:translate-y-px"
      style={{
        minWidth: 56,
        minHeight: 56,
        flex: "none",
        borderRadius: 2,
        background: active ? "var(--bg-sunk)" : "transparent",
        border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
        boxShadow: active ? "inset 0 0 0 1px var(--accent)" : "none",
      }}
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}
