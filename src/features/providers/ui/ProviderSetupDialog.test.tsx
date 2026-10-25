import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProviderSetupDialog } from "./ProviderSetupDialog";

function scene(required: boolean, onOpenProviders = vi.fn()) {
  return (
    <>
      <button type="button">Previous focus</button>
      <ProviderSetupDialog
        required={required}
        onOpenProviders={onOpenProviders}
      />
    </>
  );
}

describe("ProviderSetupDialog", () => {
  it("waits for a confirmed requirement before opening", () => {
    const { rerender } = render(scene(false));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(scene(true));
    expect(
      screen.getByRole("dialog", { name: "Connect an AI provider" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByRole("button", { name: "Open AI providers" }),
    ).toBeEnabled();
  });

  it.each([
    "Not now",
    "Close",
    "Escape",
  ])("dismisses via %s and restores focus without navigating", async (action) => {
    const user = userEvent.setup();
    const openProviders = vi.fn();
    const { rerender } = render(scene(false, openProviders));
    const previous = screen.getByRole("button", { name: "Previous focus" });
    previous.focus();
    rerender(scene(true, openProviders));
    if (action === "Escape") await user.keyboard("{Escape}");
    else await user.click(screen.getByRole("button", { name: action }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(previous).toHaveFocus());
    expect(openProviders).not.toHaveBeenCalled();
    rerender(scene(true, openProviders));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes and navigates once when provider settings are requested", async () => {
    const user = userEvent.setup();
    const openProviders = vi.fn();
    render(scene(true, openProviders));
    await user.click(screen.getByRole("button", { name: "Open AI providers" }));
    expect(openProviders).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("closes when a connection becomes ready in the background", async () => {
    const onOpenProviders = vi.fn();
    const { rerender } = render(scene(true, onOpenProviders));
    rerender(scene(false, onOpenProviders));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(onOpenProviders).not.toHaveBeenCalled();
  });
});
