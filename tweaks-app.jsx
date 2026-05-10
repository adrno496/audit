/* global React, ReactDOM, TweaksPanel, TweakSection, TweakRadio, TweakColor, useTweaks */

const DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#0a8478",
  "density": "cozy",
  "theme": "light"
}/*EDITMODE-END*/;

const ACCENT_OPTIONS = [
  ["#0a8478", "#c8eee3", "#0d1612"],
  ["#1d4ed8", "#dbeafe", "#0d1612"],
  ["#db2777", "#fce7f3", "#0d1612"],
  ["#ea580c", "#ffedd5", "#0d1612"]
];

function shade(hex, amt) {
  const c = hex.replace("#","");
  const r = parseInt(c.substring(0,2),16), g = parseInt(c.substring(2,4),16), b = parseInt(c.substring(4,6),16);
  const adj = (v) => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255-v)*amt : v*(1+amt))));
  return "#" + [adj(r),adj(g),adj(b)].map(v=>v.toString(16).padStart(2,"0")).join("");
}

function applyTweaks(t) {
  const root = document.documentElement;
  if (t.theme === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
  root.setAttribute("data-density", t.density);
  const accent = Array.isArray(t.accent) ? t.accent[0] : t.accent;
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-deep", shade(accent, -0.22));
  root.style.setProperty("--accent-soft", shade(accent, 0.65));
}

function App() {
  const [t, setTweak] = useTweaks(DEFAULTS);
  React.useEffect(() => { applyTweaks(t); }, [t]);

  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Apparence">
        <TweakRadio label="Mode" value={t.theme} onChange={v => setTweak("theme", v)} options={[
          { value: "light", label: "Clair" },
          { value: "dark", label: "Sombre" }
        ]} />
        <TweakRadio label="Densité" value={t.density} onChange={v => setTweak("density", v)} options={[
          { value: "cozy", label: "Aérée" },
          { value: "compact", label: "Compacte" }
        ]} />
      </TweakSection>
      <TweakSection label="Couleur d'accent">
        <TweakColor label="Palette" value={t.accent} onChange={v => setTweak("accent", v)} options={ACCENT_OPTIONS} />
      </TweakSection>
    </TweaksPanel>
  );
}

const mount = document.createElement("div");
document.body.appendChild(mount);
ReactDOM.createRoot(mount).render(<App />);
applyTweaks(DEFAULTS);
