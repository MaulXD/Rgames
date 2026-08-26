"use client";

import { useState } from "react";
import { Avatar } from "@/components/avatar";
import { useSession } from "@/components/session";
import type { Profile } from "@/lib/supabase/types";
import {
  BODIES,
  BODY_NAMES,
  COLORS,
  COLOR_KEYS,
  EYES,
  EYES_NAMES,
  HATS,
  HAT_NAMES,
  MOUTHS,
  MOUTH_NAMES,
  parseAvatar,
  randomAvatar,
  type AvatarSpec,
} from "@/lib/avatar";

export function AvatarStudio() {
  const { status, profile, error } = useSession();

  if (status === "loading") {
    return <p className="eyebrow py-10">Abrindo a mesa…</p>;
  }
  if (status === "error" || !profile) {
    return (
      <div
        className="mt-6 border-l-2 p-4 text-sm"
        style={{ borderColor: "var(--vivo-vermelho)", background: "var(--bg-sunk)" }}
      >
        <p style={{ color: "var(--fg)", fontWeight: 600 }}>Não deu para abrir a sessão.</p>
        <p className="mt-1" style={{ color: "var(--fg-dim)" }}>
          {error ?? "Tente recarregar a página."}
        </p>
      </div>
    );
  }

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
    <div className="grid gap-8 lg:grid-cols-[minmax(0,20rem)_1fr] lg:gap-12">
      {/* ── prévia ──────────────────────────────────────────────────────── */}
      <div className="lg:sticky lg:top-8 lg:self-start">
        <div className="stage">
          <div className="stage-glow" aria-hidden />
          <Avatar spec={spec} size={168} title="Seu bichinho" />
          <p className="stage-name">{name.trim() || "Convidado"}</p>
          <p className="stage-sub">
            {BODY_NAMES[spec.body]} · {COLORS[spec.color].name}
          </p>
        </div>

        <button
          type="button"
          className="btn btn-vivo mt-3 w-full"
          onClick={() => {
            setSpec(randomAvatar());
            setSaved(false);
          }}
        >
          Sortear outro
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
            className="field w-full max-w-sm"
          />
          <p className="mt-2 text-xs" style={{ color: "var(--fg-faint)" }}>
            De 2 a 16 caracteres. Não precisa ser único — só dentro da sala.
          </p>
        </div>

        <Row label="Cor">
          {COLOR_KEYS.map((k) => (
            <Chip key={k} active={spec.color === k} onClick={() => set("color", k)} label={COLORS[k].name}>
              <span
                className="swatch"
                style={{
                  background: COLORS[k].enamel,
                  boxShadow: `inset 0 -6px 0 ${COLORS[k].deep}, inset 0 4px 0 ${COLORS[k].light}`,
                }}
              />
            </Chip>
          ))}
        </Row>

        <Row label="Corpo">
          {BODIES.map((b) => (
            <Chip key={b} active={spec.body === b} onClick={() => set("body", b)} label={BODY_NAMES[b]}>
              <Avatar spec={{ ...spec, body: b, hat: "nenhum" }} size={46} />
            </Chip>
          ))}
        </Row>

        <Row label="Olhos">
          {EYES.map((e) => (
            <Chip key={e} active={spec.eyes === e} onClick={() => set("eyes", e)} label={EYES_NAMES[e]}>
              <Avatar spec={{ ...spec, eyes: e, hat: "nenhum" }} size={46} />
            </Chip>
          ))}
        </Row>

        <Row label="Boca">
          {MOUTHS.map((m) => (
            <Chip key={m} active={spec.mouth === m} onClick={() => set("mouth", m)} label={MOUTH_NAMES[m]}>
              <Avatar spec={{ ...spec, mouth: m, hat: "nenhum" }} size={46} />
            </Chip>
          ))}
        </Row>

        <Row label="Enfeite">
          {HATS.map((h) => (
            <Chip key={h} active={spec.hat === h} onClick={() => set("hat", h)} label={HAT_NAMES[h]}>
              <Avatar spec={{ ...spec, hat: h }} size={46} />
            </Chip>
          ))}
        </Row>

        <div
          className="flex flex-wrap items-center gap-3 border-t pt-6"
          style={{ borderColor: "var(--line)" }}
        >
          <button type="button" className="btn btn-vivo" onClick={onSave} disabled={!nameOk || saving}>
            {saving ? "Gravando…" : "Salvar"}
          </button>
          {saved && (
            <span className="eyebrow" style={{ color: "var(--vivo-limao)" }}>
              Salvo
            </span>
          )}
          {failure && (
            <span className="text-sm" style={{ color: "var(--vivo-vermelho)" }}>
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
    <button type="button" onClick={onClick} aria-pressed={active} title={label} className="chip" data-on={active}>
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}
