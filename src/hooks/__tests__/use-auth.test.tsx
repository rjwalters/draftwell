import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../use-auth";

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe("useAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no session (GET /api/auth/me returns 401)
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }),
    );
  });

  it("throws when used outside AuthProvider", () => {
    expect(() => {
      renderHook(() => useAuth());
    }).toThrow("useAuth must be used within an AuthProvider");
  });

  it("starts with no user after initial load", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toBeNull();
  });

  it("restores user from existing session on mount", async () => {
    const sessionUser = {
      id: "stored-id",
      email: "stored@example.com",
      name: "Stored User",
    };
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ user: sessionUser }), { status: 200 }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toEqual(sessionUser);
  });

  it("logs in user successfully", async () => {
    const user = { id: "1", email: "test@example.com", name: "test" };

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Mock login response
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ user }), { status: 200 }));

    await act(async () => {
      await result.current.login("test@example.com", "password123");
    });

    expect(result.current.user).toEqual(user);
  });

  it("registers new user successfully", async () => {
    const user = { id: "new-id", email: "new@example.com", name: "New User" };

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ user }), { status: 201 }));

    await act(async () => {
      await result.current.register("new@example.com", "password123", "New User");
    });

    expect(result.current.user).toEqual(user);
  });

  it("clears user on logout", async () => {
    const user = { id: "1", email: "test@example.com", name: "Test" };

    // Start with authenticated session
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ user }), { status: 200 }));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.user).toEqual(user);
    });

    // Mock logout response
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.user).toBeNull();
  });

  it("throws error on login failure", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Invalid email or password" }), { status: 401 }),
    );

    let error: Error | null = null;
    try {
      await act(async () => {
        await result.current.login("bad@example.com", "wrong");
      });
    } catch (e) {
      error = e as Error;
    }

    expect(error).not.toBeNull();
    expect(error?.message).toBe("Invalid email or password");
  });
});
