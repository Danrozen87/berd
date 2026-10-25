import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

interface ProviderSetupDialogProps {
  required: boolean;
  onOpenProviders: () => void;
}

export function ProviderSetupDialog({
  required,
  onOpenProviders,
}: ProviderSetupDialogProps) {
  const { t } = useTranslation(["settings", "common"]);
  // Browsing the app remains possible without a provider. Do not nag again
  // after dismissal during this shell session; chat creation still checks setup.
  const [dismissed, setDismissed] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const openingSettings = useRef(false);

  return (
    <Dialog
      open={required && !dismissed}
      onOpenChange={(open) => {
        if (!open) setDismissed(true);
      }}
    >
      <DialogContent
        aria-modal="true"
        size="md"
        surface="solid"
        closeLabel={t("common:actions.close")}
        onOpenAutoFocus={() => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }}
        onCloseAutoFocus={(event) => {
          if (!openingSettings.current && returnFocus.current?.isConnected) {
            event.preventDefault();
            returnFocus.current.focus();
          }
        }}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{t("providers.setupRequired.title")}</DialogTitle>
          <DialogDescription>
            {t("providers.setupRequired.body")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDismissed(true)}
          >
            {t("providers.setupRequired.notNow")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              openingSettings.current = true;
              setDismissed(true);
              onOpenProviders();
            }}
          >
            {t("providers.setupRequired.openProviders")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
