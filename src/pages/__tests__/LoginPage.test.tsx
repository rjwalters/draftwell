import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { LoginPage } from "../LoginPage";

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no session (GET /api/auth/me returns 401)
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }),
    );
  });

  it("renders login form by default", () => {
    renderWithProviders(<LoginPage />);

    expect(screen.getByRole("heading", { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("toggles to registration form", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    const toggleButton = screen.getByRole("button", {
      name: /don't have an account/i,
    });
    await user.click(toggleButton);

    expect(screen.getByRole("heading", { name: /create account/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
  });

  it("toggles back to login form", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    // Toggle to register
    await user.click(screen.getByRole("button", { name: /don't have an account/i }));

    // Toggle back to login
    await user.click(screen.getByRole("button", { name: /already have an account/i }));

    expect(screen.getByRole("heading", { name: /welcome back/i })).toBeInTheDocument();
  });

  it("submits login form with valid credentials", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    // Mock successful login response
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ user: { id: "1", email: "test@example.com", name: "Test" } }), {
        status: 200,
      }),
    );

    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.type(screen.getByLabelText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("requires email and password fields", () => {
    renderWithProviders(<LoginPage />);

    expect(screen.getByLabelText(/email/i)).toBeRequired();
    expect(screen.getByLabelText(/password/i)).toBeRequired();
  });

  it("email input has correct type", () => {
    renderWithProviders(<LoginPage />);

    expect(screen.getByLabelText(/email/i)).toHaveAttribute("type", "email");
  });

  it("password input has correct type", () => {
    renderWithProviders(<LoginPage />);

    expect(screen.getByLabelText(/password/i)).toHaveAttribute("type", "password");
  });

  it("name field appears in registration mode", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.click(screen.getByRole("button", { name: /don't have an account/i }));

    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toBeRequired();
  });

  it("shows the Google sign-in button in login mode", () => {
    renderWithProviders(<LoginPage />);

    const googleButton = screen.getByRole("link", { name: /sign in with google/i });
    expect(googleButton).toBeInTheDocument();
    expect(googleButton).toHaveAttribute("href", "/api/auth/google");
  });

  it("shows the Google sign-in button in registration mode", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.click(screen.getByRole("button", { name: /don't have an account/i }));

    const googleButton = screen.getByRole("link", { name: /sign in with google/i });
    expect(googleButton).toBeInTheDocument();
    expect(googleButton).toHaveAttribute("href", "/api/auth/google");
  });

  it("renders an error message when ?error=oauth is present", () => {
    window.history.pushState({}, "", "/login?error=oauth");
    renderWithProviders(<LoginPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(/google sign-in failed/i);

    // Reset the URL so it doesn't leak into other tests.
    window.history.pushState({}, "", "/");
  });

  it("does not render the oauth error message without the query param", () => {
    window.history.pushState({}, "", "/login");
    renderWithProviders(<LoginPage />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    window.history.pushState({}, "", "/");
  });

  it("submits registration form with valid data", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    // Switch to registration
    await user.click(screen.getByRole("button", { name: /don't have an account/i }));

    // Mock successful registration response
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ user: { id: "new", email: "newuser@example.com", name: "New User" } }),
        { status: 201 },
      ),
    );

    await user.type(screen.getByLabelText(/name/i), "New User");
    await user.type(screen.getByLabelText(/email/i), "newuser@example.com");
    await user.type(screen.getByLabelText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
    });
  });
});
