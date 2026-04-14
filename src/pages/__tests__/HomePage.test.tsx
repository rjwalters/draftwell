import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/utils";
import { HomePage } from "../HomePage";

describe("HomePage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders main heading", () => {
    renderWithProviders(<HomePage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Draftwell");
  });

  it("renders description text", () => {
    renderWithProviders(<HomePage />);

    expect(screen.getByText(/iterative document refinement/i)).toBeInTheDocument();
  });

  it("shows Get Started button when not authenticated", () => {
    renderWithProviders(<HomePage />);

    expect(screen.getByRole("link", { name: /get started/i })).toBeInTheDocument();
  });

  it("renders feature cards", () => {
    renderWithProviders(<HomePage />);

    expect(screen.getByText("Critical Review")).toBeInTheDocument();
    expect(screen.getByText("Iterative Revision")).toBeInTheDocument();
    expect(screen.getByText("Styleguide Enforcement")).toBeInTheDocument();
  });

  it("links Get Started to login page", () => {
    renderWithProviders(<HomePage />);

    const getStartedLink = screen.getByRole("link", { name: /get started/i });
    expect(getStartedLink).toHaveAttribute("href", "/login");
  });
});
