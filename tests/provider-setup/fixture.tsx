import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import settings from "../../src/shared/i18n/locales/en/settings.json";
import common from "../../src/shared/i18n/locales/en/common.json";
import { ThemeProvider } from "../../src/shared/theme/ThemeProvider";
import { ProviderSetupDialog } from "../../src/features/providers/ui/ProviderSetupDialog";
import { Button } from "../../src/shared/ui/button";
import "../../src/shared/styles/globals.css";

const translations = createInstance();
await translations.init({ lng: "en", resources: { en: { settings, common } } });

function Fixture() {
  const [required, setRequired] = useState(false);
  const [backgroundClicks, setBackgroundClicks] = useState(0);
  const [settingsOpened, setSettingsOpened] = useState(false);
  useEffect(() => {
    const ready = () => setRequired(false);
    window.addEventListener("fixture:provider-ready", ready);
    return () => window.removeEventListener("fixture:provider-ready", ready);
  }, []);
  return (
    <main className="relative h-dvh overflow-hidden bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-20 w-20 bg-card p-3">
        <Button
          variant="outline"
          onClick={() => setBackgroundClicks((value) => value + 1)}
        >
          Nav
        </Button>
      </aside>
      <section className="mx-auto grid max-w-md gap-4 pt-20">
        <Button onClick={() => setRequired(true)}>Show setup</Button>
        <output aria-label="Background clicks">{backgroundClicks}</output>
        {settingsOpened && <h1>AI providers settings</h1>}
      </section>
      <div className="fixed right-4 bottom-4 z-40 rounded-composer bg-card p-4">
        <Button
          variant="outline"
          onClick={() => setBackgroundClicks((value) => value + 1)}
        >
          Composer
        </Button>
      </div>
      <ProviderSetupDialog
        required={required}
        onOpenProviders={() => {
          setSettingsOpened(true);
          setRequired(false);
        }}
      />
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
  <I18nextProvider i18n={translations}>
    <ThemeProvider>
      <Fixture />
    </ThemeProvider>
  </I18nextProvider>,
);
