// @vitest-environment jsdom
// RTL coverage for LeaderboardsScreen — fetches on mount (port of ui.js's
// screenChange("leaderboards") handler) and on metric/scope change, writing
// results into useUiStore.leaderboard (the store this PR's components read
// directly, replacing wireLegacyUiToStores' DOM-bridge role under ?ui=react).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { LeaderboardsScreen } from "./LeaderboardsScreen";
import { useUiStore } from "../../../store/useUiStore";
import * as supabase from "../../../supabase.js";
import * as leaderboardApi from "../../../leaderboard.js";

beforeEach(() => {
  useUiStore.setState({ leaderboard: { rows: [], metric: "wins", scope: "global" } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LeaderboardsScreen", () => {
  it("shows the disabled notice and no table rows when Supabase is off", () => {
    vi.spyOn(supabase, "isEnabled").mockReturnValue(false);
    render(<LeaderboardsScreen />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Connect a Supabase project/);
    expect(screen.getByText("No data yet — play some matches!")).toBeInTheDocument();
  });

  it("fetches wins/global on mount and renders rows", async () => {
    vi.spyOn(supabase, "isEnabled").mockReturnValue(true);
    const fetchSpy = vi.spyOn(leaderboardApi, "fetchLeaderboard").mockResolvedValue([
      { wins: 12, kd: 2.1, round_wins: 40, rating: 1500, region: "sea", username: "Ember", userId: "u1" },
    ] as never);

    render(<LeaderboardsScreen />);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith({ region: null, metric: "wins", limit: 20 }));
    expect(await screen.findByText("Ember")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("re-fetches with the new metric when the segmented control changes", async () => {
    vi.spyOn(supabase, "isEnabled").mockReturnValue(true);
    const fetchSpy = vi.spyOn(leaderboardApi, "fetchLeaderboard").mockResolvedValue([]);

    render(<LeaderboardsScreen />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("radio", { name: "K/D" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenLastCalledWith({ region: null, metric: "kd", limit: 20 }));
  });

  it("scopes the fetch to the player's region when scope is switched to My Region", async () => {
    vi.spyOn(supabase, "isEnabled").mockReturnValue(true);
    const fetchSpy = vi.spyOn(leaderboardApi, "fetchLeaderboard").mockResolvedValue([]);

    render(<LeaderboardsScreen />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("radio", { name: "My Region" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenLastCalledWith(expect.objectContaining({ metric: "wins" })));
    const lastCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][0];
    expect(lastCall!.region).not.toBeNull();
  });
});
