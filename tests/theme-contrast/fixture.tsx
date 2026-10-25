import { createRoot } from "react-dom/client";
import { ThemeProvider, useTheme } from "../../src/shared/theme/ThemeProvider";
import { Button } from "../../src/shared/ui/button";
import { Switch } from "../../src/shared/ui/switch";
import { Checkbox } from "../../src/shared/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "../../src/shared/ui/radio-group";
import { ColorPicker } from "../../src/shared/ui/color-picker";
import { Input } from "../../src/shared/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../src/shared/ui/popover";
import "../../src/shared/styles/globals.css";

function Controls() {
  const {
    themeMode,
    setThemeMode,
    customPrimaryColor,
    setPrimaryColor,
    resetPrimaryColor,
  } = useTheme();
  return (
    <main className="mx-auto grid max-w-3xl gap-6 p-8">
      <label>
        Theme{" "}
        <select
          aria-label="Theme"
          value={themeMode}
          onChange={(event) =>
            setThemeMode(event.target.value as "system" | "light" | "dark")
          }
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label>
        Accent seed{" "}
        <input
          aria-label="Accent seed"
          value={customPrimaryColor ?? ""}
          onChange={(event) => setPrimaryColor(event.target.value)}
        />
      </label>
      <Button variant="outline" onClick={resetPrimaryColor}>
        Reset accent
      </Button>
      <section
        data-testid="surface"
        className="grid gap-6 rounded-md bg-card p-6 text-card-foreground"
      >
        <h1>Behavior controls</h1>
        <div className="flex gap-4">
          <Button aria-pressed="true">Primary action</Button>
          <Button variant="ghost">Alternative</Button>
        </div>
        <div className="flex gap-4">
          <Switch checked aria-label="Checked switch" />
          <Switch checked={false} aria-label="Unchecked switch" />
        </div>
        <div className="flex gap-4">
          <Checkbox checked aria-label="Checked checkbox" />
          <Checkbox checked={false} aria-label="Unchecked checkbox" />
        </div>
        <RadioGroup value="checked">
          <RadioGroupItem value="checked" aria-label="Checked radio" />
          <RadioGroupItem value="unchecked" aria-label="Unchecked radio" />
        </RadioGroup>
        <Input aria-label="Sample input" />
        <a href="#focus-target">Focusable link</a>
        <div data-testid="muted-surface" className="bg-muted p-4">
          <p data-testid="primary-on-muted" className="text-primary">
            Primary text on muted
          </p>
          <p
            data-testid="primary-on-tint"
            className="bg-primary/10 text-primary"
          >
            Primary text on accent tint
          </p>
        </div>
        <p className="text-muted-foreground">
          Supporting text stays readable on the card.
        </p>
        <ColorPicker
          value={customPrimaryColor ?? "#1a1a1a"}
          onChange={setPrimaryColor}
          variant="swatches"
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">Open inverse popover</Button>
          </PopoverTrigger>
          <PopoverContent variant="tooltip" data-testid="inverse-surface">
            <Button variant="ghost">Inverse popover action</Button>
          </PopoverContent>
        </Popover>
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing contrast fixture root");
createRoot(root).render(
  <ThemeProvider>
    <Controls />
  </ThemeProvider>,
);
