import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  IconArrowLeft,
  IconArrowRight,
  IconLayoutSidebar,
} from "@tabler/icons-react";
import { BerdIcon } from "../../src/shared/ui/icons/BerdIcon";
import { TopBarIconButton } from "../../src/shared/ui/top-bar-icon-button";
import { Button } from "../../src/shared/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../src/shared/ui/tooltip";
import { ThemeProvider } from "../../src/shared/theme/ThemeProvider";
import "../../src/shared/styles/globals.css";

function Fixture() {
  const [clicks, setClicks] = useState(0);
  useEffect(() => {
    let last = "";
    const states: string[] = [];
    document.documentElement.dataset.tooltipStates = "[]";
    const observer = new MutationObserver(() => {
      const content = document.querySelector(
        '[data-slot="tooltip-content"][data-state$="open"]',
      );
      const current = content?.firstChild?.textContent ?? "";
      if (current === last) return;
      last = current;
      states.push(current);
      document.documentElement.dataset.tooltipStates = JSON.stringify(states);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    return () => observer.disconnect();
  }, []);
  return (
    <main className="h-dvh bg-background text-foreground">
      <header
        className="flex h-[var(--spacing-app-top-bar)] items-center gap-1 pl-4"
        data-tauri-drag-region="deep"
      >
        <TopBarIconButton
          aria-label="Berd home"
          tooltip="Berd home"
          onClick={() => setClicks((value) => value + 1)}
        >
          <BerdIcon />
        </TopBarIconButton>
        <TopBarIconButton
          aria-label="Sidebar"
          tooltip="Sidebar"
          onClick={() => setClicks((value) => value + 1)}
        >
          <IconLayoutSidebar />
        </TopBarIconButton>
        <TopBarIconButton
          aria-label="Back"
          tooltip="Back"
          onClick={() => setClicks((value) => value + 1)}
        >
          <IconArrowLeft />
        </TopBarIconButton>
        <TopBarIconButton aria-label="Forward" tooltip="Forward" disabled>
          <IconArrowRight />
        </TopBarIconButton>
      </header>
      <div className="absolute bottom-4 left-4">
        <Button tooltip="Bottom action tooltip">Bottom action</Button>
      </div>
      <div className="absolute left-4 top-40">
        <Tooltip disableHoverableContent={false}>
          <TooltipTrigger asChild>
            <Button>Hoverable help</Button>
          </TooltipTrigger>
          <TooltipContent>Readable help</TooltipContent>
        </Tooltip>
      </div>
      <output aria-label="Clicks" className="absolute bottom-4 right-4">
        {clicks}
      </output>
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing tooltip fixture root");
createRoot(root).render(
  <ThemeProvider>
    <TooltipProvider>
      <Fixture />
    </TooltipProvider>
  </ThemeProvider>,
);
