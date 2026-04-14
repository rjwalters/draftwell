import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "../[[route]]";

// Mock D1 database
function createMockDb() {
  const mockStatement = {
    bind: vi.fn().mockReturnThis(),
    all: vi.fn(),
    first: vi.fn(),
    run: vi.fn(),
  };

  return {
    prepare: vi.fn().mockReturnValue(mockStatement),
    _statement: mockStatement,
  };
}

function createMockR2Bucket() {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockAi() {
  return {
    run: vi.fn().mockResolvedValue({
      response: JSON.stringify({
        dimensions: [{ name: "Sentence length", observation: "Short", rule: "Keep it short" }],
        summary: "Concise writer",
        escape_clause: "Technical writing may vary",
      }),
    }),
  };
}

function createContext(
  method: string,
  path: string,
  options: {
    body?: unknown;
    db?: ReturnType<typeof createMockDb>;
    appName?: string;
    cookie?: string;
    ai?: ReturnType<typeof createMockAi>;
    r2?: ReturnType<typeof createMockR2Bucket>;
  } = {},
) {
  const url = new URL(path, "http://localhost");
  const route = path.replace("/api/", "").split("/").filter(Boolean);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.cookie) {
    headers.Cookie = options.cookie;
  }

  const request = new Request(url.toString(), {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return {
    request,
    env: {
      DB: options.db ?? createMockDb(),
      APP_NAME: options.appName ?? "test-app",
      AI: options.ai ?? createMockAi(),
      CONTENT_BUCKET: options.r2 ?? createMockR2Bucket(),
      RATE_LIMIT: {},
      AI_GATEWAY: "test-gateway",
    },
    params: { route: route.length ? route : undefined },
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    next: vi.fn(),
    data: {},
  } as unknown as Parameters<typeof onRequest>[0];
}

describe("API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/health", () => {
    it("returns healthy status when database is available", async () => {
      const mockDb = createMockDb();
      mockDb._statement.first.mockResolvedValue({ 1: 1 });

      const context = createContext("GET", "/api/health", { db: mockDb });
      const response = await onRequest(context);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.status).toBe("healthy");
      expect(data.app).toBe("test-app");
      expect(data.timestamp).toBeDefined();
    });

    it("returns unhealthy status when database fails", async () => {
      const mockDb = createMockDb();
      mockDb._statement.first.mockRejectedValue(new Error("DB connection failed"));

      const context = createContext("GET", "/api/health", { db: mockDb });
      const response = await onRequest(context);

      expect(response.status).toBe(503);

      const data = await response.json();
      expect(data.status).toBe("unhealthy");
      expect(data.error).toBe("Database unavailable");
    });
  });

  describe("GET /api/users", () => {
    it("returns list of users", async () => {
      const mockUsers = [
        { id: "1", email: "user1@example.com", name: "User 1", created_at: "2024-01-01" },
        { id: "2", email: "user2@example.com", name: "User 2", created_at: "2024-01-02" },
      ];

      const mockDb = createMockDb();
      mockDb._statement.all.mockResolvedValue({ results: mockUsers });

      const context = createContext("GET", "/api/users", { db: mockDb });
      const response = await onRequest(context);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.users).toEqual(mockUsers);
    });

    it("returns empty array when no users exist", async () => {
      const mockDb = createMockDb();
      mockDb._statement.all.mockResolvedValue({ results: [] });

      const context = createContext("GET", "/api/users", { db: mockDb });
      const response = await onRequest(context);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.users).toEqual([]);
    });
  });

  describe("GET /api/users/:id", () => {
    it("returns user when found", async () => {
      const mockUser = {
        id: "123",
        email: "test@example.com",
        name: "Test User",
        created_at: "2024-01-01",
      };

      const mockDb = createMockDb();
      mockDb._statement.first.mockResolvedValue(mockUser);

      const context = createContext("GET", "/api/users/123", { db: mockDb });
      const response = await onRequest(context);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.user).toEqual(mockUser);
    });

    it("returns 404 when user not found", async () => {
      const mockDb = createMockDb();
      mockDb._statement.first.mockResolvedValue(null);

      const context = createContext("GET", "/api/users/nonexistent", { db: mockDb });
      const response = await onRequest(context);

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toBe("User not found");
    });
  });

  describe("POST /api/users", () => {
    it("creates user with valid data", async () => {
      const mockDb = createMockDb();
      mockDb._statement.run.mockResolvedValue({ success: true });

      const context = createContext("POST", "/api/users", {
        db: mockDb,
        body: {
          email: "new@example.com",
          name: "New User",
          password: "password123",
        },
      });

      const response = await onRequest(context);

      expect(response.status).toBe(201);

      const data = await response.json();
      expect(data.user.email).toBe("new@example.com");
      expect(data.user.name).toBe("New User");
      expect(data.user.id).toBeDefined();
    });

    it("returns 400 for missing email", async () => {
      const mockDb = createMockDb();

      const context = createContext("POST", "/api/users", {
        db: mockDb,
        body: {
          name: "New User",
          password: "password123",
        },
      });

      const response = await onRequest(context);

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe("Email, name, and password are required");
    });

    it("returns 400 for missing password", async () => {
      const mockDb = createMockDb();

      const context = createContext("POST", "/api/users", {
        db: mockDb,
        body: {
          email: "test@example.com",
          name: "Test User",
        },
      });

      const response = await onRequest(context);

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBe("Email, name, and password are required");
    });

    it("returns 409 for duplicate email", async () => {
      const mockDb = createMockDb();
      mockDb._statement.run.mockRejectedValue(new Error("UNIQUE constraint failed: users.email"));

      const context = createContext("POST", "/api/users", {
        db: mockDb,
        body: {
          email: "existing@example.com",
          name: "User",
          password: "password",
        },
      });

      const response = await onRequest(context);

      expect(response.status).toBe(409);

      const data = await response.json();
      expect(data.error).toBe("Email already exists");
    });
  });

  describe("GET /api/voice/profiles", () => {
    it("returns 401 when not authenticated", async () => {
      const context = createContext("GET", "/api/voice/profiles");
      const response = await onRequest(context);

      expect(response.status).toBe(401);
    });

    it("returns profiles when authenticated", async () => {
      const mockDb = createMockDb();
      // Session lookup returns a user
      mockDb._statement.first.mockResolvedValue({
        id: "user-1",
        email: "test@example.com",
        name: "Test",
        created_at: "2024-01-01",
      });
      mockDb._statement.all.mockResolvedValue({
        results: [
          {
            id: "profile-1",
            user_id: "user-1",
            name: "Default",
            profile_data: "{}",
            created_at: "2024-01-01",
            updated_at: "2024-01-01",
          },
        ],
      });

      const context = createContext("GET", "/api/voice/profiles", {
        db: mockDb,
        cookie: "draftwell-session=valid-session-id",
      });
      const response = await onRequest(context);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.profiles).toHaveLength(1);
      expect(data.profiles[0].id).toBe("profile-1");
    });
  });

  describe("POST /api/voice/analyze", () => {
    it("returns 401 when not authenticated", async () => {
      const context = createContext("POST", "/api/voice/analyze", {
        body: { samples: [{ text: "test" }] },
      });
      const response = await onRequest(context);

      expect(response.status).toBe(401);
    });

    it("returns 400 when no samples provided", async () => {
      const mockDb = createMockDb();
      mockDb._statement.first.mockResolvedValue({
        id: "user-1",
        email: "test@example.com",
        name: "Test",
        created_at: "2024-01-01",
      });

      const context = createContext("POST", "/api/voice/analyze", {
        db: mockDb,
        cookie: "draftwell-session=valid-session-id",
        body: { samples: [] },
      });
      const response = await onRequest(context);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("At least one writing sample is required");
    });

    it("returns 400 when sample is too short", async () => {
      const mockDb = createMockDb();
      mockDb._statement.first.mockResolvedValue({
        id: "user-1",
        email: "test@example.com",
        name: "Test",
        created_at: "2024-01-01",
      });

      const context = createContext("POST", "/api/voice/analyze", {
        db: mockDb,
        cookie: "draftwell-session=valid-session-id",
        body: { samples: [{ text: "too short" }] },
      });
      const response = await onRequest(context);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Each writing sample must be at least 50 words");
    });

    it("analyzes voice and creates profile when given valid sample", async () => {
      const mockDb = createMockDb();
      // Session lookup returns user
      mockDb._statement.first.mockResolvedValue({
        id: "user-1",
        email: "test@example.com",
        name: "Test",
        created_at: "2024-01-01",
      });
      mockDb._statement.run.mockResolvedValue({ success: true });

      const sampleText = Array(120).fill("word").join(" ");
      const mockAi = createMockAi();

      const context = createContext("POST", "/api/voice/analyze", {
        db: mockDb,
        ai: mockAi,
        cookie: "draftwell-session=valid-session-id",
        body: { samples: [{ text: sampleText }], name: "My Voice" },
      });
      const response = await onRequest(context);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.profile).toBeDefined();
      expect(data.profile.name).toBe("My Voice");
      expect(mockAi.run).toHaveBeenCalledOnce();
    });
  });

  describe("Unknown routes", () => {
    it("returns 404 for unknown path", async () => {
      const context = createContext("GET", "/api/unknown");
      const response = await onRequest(context);

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toBe("Not found");
    });

    it("returns 404 for wrong method on valid path", async () => {
      const context = createContext("DELETE", "/api/users");
      const response = await onRequest(context);

      expect(response.status).toBe(404);
    });
  });
});
