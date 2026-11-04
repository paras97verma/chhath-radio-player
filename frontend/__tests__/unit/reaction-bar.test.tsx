/**
 * Unit tests for ReactionBar component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import ReactionBar from "@/components/radio/ReactionBar";
import { useRadioStore } from "@/lib/radio-store";

describe("ReactionBar Component", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useRadioStore.setState({ offeringCounts: {} });
  });

  it("renders main FAB with zero initial count", () => {
    render(<ReactionBar />);
    const fab = screen.getByLabelText("Send a reaction");
    expect(fab).toBeDefined();
    // Count badge should not be present when count is 0
    expect(screen.queryByText("1")).toBeNull();
  });

  it("expands radial menu and records an offering on emoji click", async () => {
    const handleReact = vi.fn();
    render(<ReactionBar onReact={handleReact} />);

    const fab = screen.getByLabelText("Send a reaction");
    fireEvent.click(fab);

    // Diya offering button
    const diyaBtn = screen.getByLabelText("React with Diya");
    expect(diyaBtn).toBeDefined();

    await act(async () => {
      fireEvent.click(diyaBtn);
    });

    expect(handleReact).toHaveBeenCalledWith("🪔");
    expect(useRadioStore.getState().getOfferingCount("🪔")).toBe(1);
    expect(useRadioStore.getState().getTotalOfferings()).toBe(1);

    // Verify localStorage persistence
    const raw = localStorage.getItem("chhath_offerings_v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed["🪔"]).toBe(1);
  });

  it("persists offering count across component remounts", () => {
    // Seed localStorage
    localStorage.setItem(
      "chhath_offerings_v1",
      JSON.stringify({ "🪔": 5, "☀️": 3 })
    );
    useRadioStore.setState({ offeringCounts: { "🪔": 5, "☀️": 3 } });

    const { unmount } = render(<ReactionBar />);

    // Total offerings is 8
    expect(screen.getByText("8")).toBeDefined();

    unmount();

    // Re-mount (simulating page navigation or layout switch)
    render(<ReactionBar />);
    expect(screen.getByText("8")).toBeDefined();
  });
});

