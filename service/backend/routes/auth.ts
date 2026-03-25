import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
  Router,
} from "express";
import { Router as createRouter } from "express";
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import type { Pool, PoolClient } from "pg";
import type { ExtendedError, Socket } from "socket.io";

const phoneRegex = /^\+?[1-9]\d{7,14}$/;
const otpRegex = /^\d{6}$/;

const defaultAccessTokenTtlSeconds = 2 * 60 * 60;
const defaultRefreshTokenTtlSeconds = 30 * 24 * 60 * 60;

const maxAttemptsPerMinute = 6;
const rateLimitWindowMs = 60_000;

const defaultCountry = "AE";
const defaultLanguage = "ar";

type AuthErrorCode = "AUTH_001" | "AUTH_002" | "AUTH_003" | "AUTH_004" | "AUTH_005";

type OtpVerifier = (request: {
  phone: string;
  otp: string;
  deviceId: string;
}) => Promise<boolean>;

interface OtpSendRequestBody {
  phone_e164?: unknown;
  phone?: unknown;
  device_id?: unknown;
  deviceId?: unknown;
  install_id?: unknown;
  installId?: unknown;
}

interface LoginRequestBody {
  phone_e164?: unknown;
  phone?: unknown;
  otp_code?: unknown;
  otp?: unknown;
  otp_ticket?: unknown;
  otpTicket?: unknown;
  device_id?: unknown;
  deviceId?: unknown;
  install_id?: unknown;
  installId?: unknown;
  country?: unknown;
  language?: unknown;
}

interface RefreshRequestBody {
  refresh_token?: unknown;
  refreshToken?: unknown;
  session_id?: unknown;
  sessionId?: unknown;
  device_id?: unknown;
  deviceId?: unknown;
}

interface LoginIdentity {
  uid: string;
  device_id: string;
  country: string;
  session_id: string;
}

interface VerifiedIdentity extends LoginIdentity {
  refresh_id?: string;
}

interface AuthenticatedSocketData {
  user?: LoginIdentity;
}

interface UserRecord {
  id: number;
  country: string;
  vipLevel: number;
  riskLevel: number;
  firstLogin: boolean;
}

interface WalletRecord {
  walletGold: number;
  walletBonusGold: number;
  frozenGold: number;
  totalSpentGold: number;
  spent30dGold: number;
}

interface WalletSummary {
  wallet_gold: number;
  wallet_bonus_gold: number;
  frozen_gold: number;
  total_spent_gold: number;
  spent_30d_gold: number;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
}

interface MemoryUserEntry {
  id: number;
  phone: string;
  country: string;
  language: string;
  vipLevel: number;
  riskLevel: number;
}

type SessionStatus = "ACTIVE" | "ROTATED";

interface MemoryRefreshSession {
  refreshId: string;
  refreshTokenHash: string;
  sessionId: string;
  ip: string;
  expiresAt: Date;
  status: SessionStatus;
}

const memoryUsersByPhone = new Map<string, MemoryUserEntry>();
const memoryWalletsByUserId = new Map<number, WalletRecord>();
const memoryRefreshSessions = new Map<string, MemoryRefreshSession>();
let memoryUserSequence = 1000;

export interface AuthRouteOptions {
  db?: Pool;
  accessTokenSecret: string;
  refreshTokenSecret: string;
  refreshTokenPepper?: string;
  accessTokenTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
  otpVerifier?: OtpVerifier;
  now?: () => Date;
}

export interface WalletSummaryHandlerOptions {
  db?: Pool;
  accessTokenSecret: string;
}

export interface SocketAuthOptions {
  accessTokenSecret: string;
}

export interface HttpAuthOptions {
  accessTokenSecret: string;
}

export const createAuthRouter = (options: AuthRouteOptions): Router => {
  const router = createRouter();
  const rateLimiter = new InMemoryLoginRateLimiter(
    maxAttemptsPerMinute,
    rateLimitWindowMs,
  );
  const otpVerifier = options.otpVerifier;

  const sendOtpHandler = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    const requestId = resolveRequestId(request);
    try {
      const body = request.body as OtpSendRequestBody;
      const parsedBody = parseOtpSendBody(body);
      if (!parsedBody.ok) {
        sendAuthError(response, requestId, 400, "AUTH_001", parsedBody.message);
        return;
      }
      if (otpVerifier === undefined) {
        sendAuthError(
          response,
          requestId,
          503,
          "AUTH_005",
          "OTP provider is unavailable.",
        );
        return;
      }

      const now = options.now?.() ?? new Date();
      const expireAt = new Date(now.getTime() + 5 * 60 * 1000);
      const otpTicket = `otpt_${randomUUID().replaceAll("-", "")}`;
      sendSuccess(response, requestId, {
        otp_ticket: otpTicket,
        expire_at: expireAt.toISOString(),
        resend_after_sec: 60,
      }, {
        requestId,
        message: `OTP request accepted for ${maskPhone(parsedBody.value.phone)}.`,
      });
    } catch (error) {
      next(error);
    }
  };

  const otpLoginHandler = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    const requestId = resolveRequestId(request);
    try {
      const body = request.body as LoginRequestBody;
      const parsedBody = parseLoginBody(body);
      if (!parsedBody.ok) {
        sendAuthError(response, requestId, 400, "AUTH_001", parsedBody.message);
        return;
      }
      if (otpVerifier === undefined) {
        sendAuthError(
          response,
          requestId,
          503,
          "AUTH_005",
          "OTP provider is unavailable.",
        );
        return;
      }

      const ip = request.ip ?? "unknown";
      const rateLimitKey = `${parsedBody.value.phone}:${parsedBody.value.deviceId}:${ip}`;
      if (!rateLimiter.allow(rateLimitKey, options.now?.() ?? new Date())) {
        sendAuthError(
          response,
          requestId,
          429,
          "AUTH_003",
          "Too many login attempts. Please retry later.",
        );
        return;
      }

      const otpPassed = await otpVerifier({
        phone: parsedBody.value.phone,
        otp: parsedBody.value.otp,
        deviceId: parsedBody.value.deviceId,
      });
      if (!otpPassed) {
        sendAuthError(response, requestId, 400, "AUTH_002", "OTP is invalid or expired.");
        return;
      }

      const refreshId = randomUUID();
      const sessionId = randomUUID();
      const accessTokenTtl =
        options.accessTokenTtlSeconds ?? defaultAccessTokenTtlSeconds;
      const refreshTokenTtl =
        options.refreshTokenTtlSeconds ?? defaultRefreshTokenTtlSeconds;
      const now = options.now?.() ?? new Date();

      if (options.db === undefined) {
        const memoryState = upsertMemoryUserAndWallet({
          phone: parsedBody.value.phone,
          country: parsedBody.value.country,
          language: parsedBody.value.language,
        });
        const identity: LoginIdentity = {
          uid: String(memoryState.user.id),
          device_id: parsedBody.value.deviceId,
          country: memoryState.user.country,
          session_id: sessionId,
        };

        const accessToken = signToken(
          identity,
          options.accessTokenSecret,
          accessTokenTtl,
        );
        const refreshToken = signToken(
          { ...identity, refresh_id: refreshId },
          options.refreshTokenSecret,
          refreshTokenTtl,
        );

        const refreshExpiresAt = new Date(now.getTime() + refreshTokenTtl * 1000);
        upsertMemoryRefreshSession({
          userId: memoryState.user.id,
          deviceId: parsedBody.value.deviceId,
          refreshId,
          sessionId,
          refreshToken,
          ip,
          expiresAt: refreshExpiresAt,
          pepper: options.refreshTokenPepper ?? options.refreshTokenSecret,
        });

        const walletSummary = buildWalletSummary(memoryState.wallet, memoryState.user.riskLevel);
        const data = {
          access_token: accessToken,
          expires_in_sec: accessTokenTtl,
          refresh_token: refreshToken,
          refresh_expires_at: refreshExpiresAt.toISOString(),
          session_id: sessionId,
          is_new_user: memoryState.user.firstLogin,
          wallet_summary: walletSummary,
        };

        sendSuccess(response, requestId, data, {
          accessToken,
          refreshToken,
          expiresInSeconds: accessTokenTtl,
          sessionId,
          user: {
            uid: identity.uid,
            country: identity.country,
            vipLevel: memoryState.user.vipLevel,
            riskLevel: memoryState.user.riskLevel,
            firstLogin: memoryState.user.firstLogin,
          },
          wallet: {
            walletGold: memoryState.wallet.walletGold,
            walletBonusGold: memoryState.wallet.walletBonusGold,
            frozenGold: memoryState.wallet.frozenGold,
            totalSpentGold: memoryState.wallet.totalSpentGold,
            spent30dGold: memoryState.wallet.spent30dGold,
          },
        });
        return;
      }

      const client = await options.db.connect();
      try {
        await client.query("BEGIN");

        const user = await upsertUserAndWallet(client, {
          phone: parsedBody.value.phone,
          country: parsedBody.value.country,
          language: parsedBody.value.language,
        });
        const wallet = await readWallet(client, user.id);

        const identity: LoginIdentity = {
          uid: String(user.id),
          device_id: parsedBody.value.deviceId,
          country: user.country,
          session_id: sessionId,
        };
        const accessToken = signToken(
          identity,
          options.accessTokenSecret,
          accessTokenTtl,
        );
        const refreshToken = signToken(
          { ...identity, refresh_id: refreshId },
          options.refreshTokenSecret,
          refreshTokenTtl,
        );

        const refreshExpiresAt = new Date(now.getTime() + refreshTokenTtl * 1000);
        await upsertRefreshSession(client, {
          userId: user.id,
          deviceId: parsedBody.value.deviceId,
          refreshId,
          sessionId,
          refreshToken,
          ip,
          expiresAt: refreshExpiresAt,
          pepper: options.refreshTokenPepper ?? options.refreshTokenSecret,
        });

        await client.query("COMMIT");

        const walletSummary = buildWalletSummary(wallet, user.riskLevel);
        const data = {
          access_token: accessToken,
          expires_in_sec: accessTokenTtl,
          refresh_token: refreshToken,
          refresh_expires_at: refreshExpiresAt.toISOString(),
          session_id: sessionId,
          is_new_user: user.firstLogin,
          wallet_summary: walletSummary,
        };

        sendSuccess(response, requestId, data, {
          accessToken,
          refreshToken,
          expiresInSeconds: accessTokenTtl,
          sessionId,
          user: {
            uid: identity.uid,
            country: identity.country,
            vipLevel: user.vipLevel,
            riskLevel: user.riskLevel,
            firstLogin: user.firstLogin,
          },
          wallet: {
            walletGold: wallet.walletGold,
            walletBonusGold: wallet.walletBonusGold,
            frozenGold: wallet.frozenGold,
            totalSpentGold: wallet.totalSpentGold,
            spent30dGold: wallet.spent30dGold,
          },
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  };

  const refreshTokenHandler = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    const requestId = resolveRequestId(request);
    try {
      const body = request.body as RefreshRequestBody;
      const parsedBody = parseRefreshBody(body);
      if (!parsedBody.ok) {
        sendAuthError(response, requestId, 400, "AUTH_001", parsedBody.message);
        return;
      }

      const refreshIdentity = verifyIdentityToken(
        parsedBody.value.refreshToken,
        options.refreshTokenSecret,
      );
      if (refreshIdentity?.refresh_id === undefined) {
        sendAuthError(response, requestId, 401, "AUTH_001", "Invalid or expired refresh token.");
        return;
      }

      if (
        parsedBody.value.deviceId !== null &&
        parsedBody.value.deviceId !== refreshIdentity.device_id
      ) {
        sendAuthError(response, requestId, 401, "AUTH_001", "Refresh token device mismatch.");
        return;
      }

      if (
        parsedBody.value.sessionId !== null &&
        parsedBody.value.sessionId !== refreshIdentity.session_id
      ) {
        sendAuthError(response, requestId, 401, "AUTH_001", "Refresh token session mismatch.");
        return;
      }

      const now = options.now?.() ?? new Date();
      const pepper = options.refreshTokenPepper ?? options.refreshTokenSecret;
      const refreshTokenHash = hashRefreshToken(parsedBody.value.refreshToken, pepper);
      const validationResult =
        options.db === undefined
          ? verifyMemoryRefreshSession(refreshIdentity, refreshTokenHash, now)
          : await verifyPersistentRefreshSession(
              options.db,
              refreshIdentity,
              refreshTokenHash,
              now,
            );
      if (validationResult === "INVALID") {
        sendAuthError(response, requestId, 401, "AUTH_001", "Refresh session is invalid.");
        return;
      }
      if (validationResult === "REPLAYED") {
        sendAuthError(
          response,
          requestId,
          409,
          "AUTH_004",
          "Refresh token has already been rotated.",
        );
        return;
      }

      const accessTokenTtl =
        options.accessTokenTtlSeconds ?? defaultAccessTokenTtlSeconds;
      const refreshTokenTtl =
        options.refreshTokenTtlSeconds ?? defaultRefreshTokenTtlSeconds;
      const nextRefreshId = randomUUID();
      const accessToken = signToken(
        {
          uid: refreshIdentity.uid,
          device_id: refreshIdentity.device_id,
          country: refreshIdentity.country,
          session_id: refreshIdentity.session_id,
        },
        options.accessTokenSecret,
        accessTokenTtl,
      );
      const rotatedRefreshToken = signToken(
        {
          uid: refreshIdentity.uid,
          device_id: refreshIdentity.device_id,
          country: refreshIdentity.country,
          session_id: refreshIdentity.session_id,
          refresh_id: nextRefreshId,
        },
        options.refreshTokenSecret,
        refreshTokenTtl,
      );
      const ip = request.ip ?? "unknown";
      const nextExpiration = new Date(now.getTime() + refreshTokenTtl * 1000);
      const userId = Number.parseInt(refreshIdentity.uid, 10);
      if (Number.isNaN(userId)) {
        sendAuthError(response, requestId, 401, "AUTH_001", "Refresh token user is invalid.");
        return;
      }

      if (options.db === undefined) {
        upsertMemoryRefreshSession({
          userId,
          deviceId: refreshIdentity.device_id,
          refreshId: nextRefreshId,
          sessionId: refreshIdentity.session_id,
          refreshToken: rotatedRefreshToken,
          ip,
          expiresAt: nextExpiration,
          pepper,
        });
      } else {
        const client = await options.db.connect();
        try {
          await upsertRefreshSession(client, {
            userId,
            deviceId: refreshIdentity.device_id,
            refreshId: nextRefreshId,
            sessionId: refreshIdentity.session_id,
            refreshToken: rotatedRefreshToken,
            ip,
            expiresAt: nextExpiration,
            pepper,
          });
        } finally {
          client.release();
        }
      }

      sendSuccess(response, requestId, {
        access_token: accessToken,
        expires_in_sec: accessTokenTtl,
        refresh_token: rotatedRefreshToken,
        refresh_expires_at: nextExpiration.toISOString(),
        session_id: refreshIdentity.session_id,
        issued_at: now.toISOString(),
      }, {
        accessToken,
        refreshToken: rotatedRefreshToken,
        expiresInSeconds: accessTokenTtl,
        sessionId: refreshIdentity.session_id,
      });
    } catch (error) {
      next(error);
    }
  };

  router.post("/otp/send", sendOtpHandler);
  router.post("/otp/verify", otpLoginHandler);
  router.post("/refresh", refreshTokenHandler);
  router.post("/login/otp", (request, response) => {
    sendAuthError(
      response,
      resolveRequestId(request),
      410,
      "AUTH_001",
      "Legacy auth path is deprecated.",
    );
  });

  return router;
};

export const createWalletSummaryHandler = (
  options: WalletSummaryHandlerOptions,
): RequestHandler => {
  return async (request: Request, response: Response, next: NextFunction) => {
    const requestId = resolveRequestId(request);
    try {
      const token = extractHttpBearerToken(request);
      if (token === null) {
        sendAuthError(response, requestId, 401, "AUTH_001", "Unauthorized request.");
        return;
      }

      const identity = verifyIdentityToken(token, options.accessTokenSecret);
      if (identity === null) {
        sendAuthError(response, requestId, 401, "AUTH_001", "Invalid or expired token.");
        return;
      }

      const userId = Number.parseInt(identity.uid, 10);
      if (Number.isNaN(userId)) {
        sendAuthError(response, requestId, 401, "AUTH_001", "Invalid user identity.");
        return;
      }

      const wallet =
        options.db === undefined
          ? readMemoryWalletSummary(userId)
          : await readPersistentWalletSummary(options.db, userId);
      if (wallet === null) {
        sendAuthError(response, requestId, 404, "AUTH_001", "Wallet was not found.");
        return;
      }

      sendSuccess(response, requestId, wallet, {
        wallet: {
          walletGold: wallet.wallet_gold,
          walletBonusGold: wallet.wallet_bonus_gold,
          frozenGold: wallet.frozen_gold,
          totalSpentGold: wallet.total_spent_gold,
          spent30dGold: wallet.spent_30d_gold,
          riskLevel: wallet.risk_level,
        },
      });
    } catch (error) {
      next(error);
    }
  };
};

export const createSocketAuthMiddleware = (options: SocketAuthOptions) => {
  return (
    socket: Socket<Record<string, never>, Record<string, never>, Record<string, never>, AuthenticatedSocketData>,
    next: (error?: ExtendedError) => void,
  ): void => {
    const token = extractBearerToken(socket);
    if (token === null) {
      next(new Error("Unauthorized socket connection."));
      return;
    }

    const identity = verifyIdentityToken(token, options.accessTokenSecret);
    if (identity === null) {
      next(new Error("Socket token verification failed."));
      return;
    }

    const handshakeDeviceId = normalizeString(socket.handshake.auth?.deviceId);
    if (
      handshakeDeviceId !== null &&
      handshakeDeviceId !== identity.device_id
    ) {
      next(new Error("Socket device_id mismatch."));
      return;
    }

    socket.data.user = {
      uid: identity.uid,
      device_id: identity.device_id,
      country: identity.country,
      session_id: identity.session_id,
    };
    next();
  };
};

export const createHttpAuthMiddleware = (
  options: HttpAuthOptions,
): RequestHandler => {
  return (request: Request, response: Response, next: NextFunction) => {
    const token = extractHttpBearerToken(request);
    if (token === null) {
      response.status(401).json({ message: "Unauthorized request." });
      return;
    }

    const identity = verifyIdentityToken(token, options.accessTokenSecret);
    if (identity === null) {
      response.status(401).json({ message: "Invalid or expired token." });
      return;
    }

    response.locals.user = {
      uid: identity.uid,
      device_id: identity.device_id,
      country: identity.country,
      session_id: identity.session_id,
    };
    next();
  };
};

export const verifyAccessToken = (
  token: string,
  accessTokenSecret: string,
): LoginIdentity | null => {
  const identity = verifyIdentityToken(token, accessTokenSecret);
  if (identity === null) {
    return null;
  }
  return {
    uid: identity.uid,
    device_id: identity.device_id,
    country: identity.country,
    session_id: identity.session_id,
  };
};

export const createEnvOtpVerifier = (devOtpCode?: string): OtpVerifier => {
  if (devOtpCode === undefined || devOtpCode.trim().length < 1) {
    return async () => false;
  }

  const normalized = devOtpCode.trim();
  return async ({ otp }) => {
    if (!otpRegex.test(otp) || otp.length !== normalized.length) {
      return false;
    }
    const left = Buffer.from(otp);
    const right = Buffer.from(normalized);
    return crypto.timingSafeEqual(left, right);
  };
};

const upsertUserAndWallet = async (
  client: PoolClient,
  params: {
    phone: string;
    country: string;
    language: string;
  },
): Promise<UserRecord> => {
  const userResult = await client.query<{
    id: number;
    country: string;
    vip_level: number;
    risk_level: number;
  }>(
    `
      INSERT INTO app_users (
        phone,
        country,
        language,
        vip_level,
        risk_level,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, 0, 0, NOW(), NOW())
      ON CONFLICT (phone)
      DO UPDATE
      SET country = EXCLUDED.country,
          language = EXCLUDED.language,
          updated_at = NOW()
      RETURNING id, country, vip_level, risk_level;
    `,
    [params.phone, params.country, params.language],
  );

  const user = userResult.rows[0];
  const walletInsert = await client.query(
    `
      INSERT INTO user_wallets (
        user_id,
        wallet_gold,
        wallet_bonus_gold,
        frozen_gold,
        total_spent_gold,
        spent_30d_gold,
        created_at,
        updated_at
      ) VALUES ($1, 0, 0, 0, 0, 0, NOW(), NOW())
      ON CONFLICT (user_id) DO NOTHING;
    `,
    [user.id],
  );

  return {
    id: user.id,
    country: user.country,
    vipLevel: user.vip_level,
    riskLevel: user.risk_level,
    firstLogin: (walletInsert.rowCount ?? 0) > 0,
  };
};

const readWallet = async (
  client: PoolClient,
  userId: number,
): Promise<WalletRecord> => {
  const walletResult = await client.query<{
    wallet_gold: number;
    wallet_bonus_gold: number;
    frozen_gold: number;
    total_spent_gold: number;
    spent_30d_gold: number;
  }>(
    `
      SELECT
        wallet_gold,
        wallet_bonus_gold,
        frozen_gold,
        total_spent_gold,
        spent_30d_gold
      FROM user_wallets
      WHERE user_id = $1;
    `,
    [userId],
  );

  const row = walletResult.rows[0];
  return {
    walletGold: row.wallet_gold,
    walletBonusGold: row.wallet_bonus_gold,
    frozenGold: row.frozen_gold,
    totalSpentGold: row.total_spent_gold,
    spent30dGold: row.spent_30d_gold,
  };
};

const readPersistentWalletSummary = async (
  db: Pool,
  userId: number,
): Promise<WalletSummary | null> => {
  const result = await db.query<{
    wallet_gold: number;
    wallet_bonus_gold: number;
    frozen_gold: number;
    total_spent_gold: number;
    spent_30d_gold: number;
    risk_level: number;
  }>(
    `
      SELECT
        w.wallet_gold,
        w.wallet_bonus_gold,
        w.frozen_gold,
        w.total_spent_gold,
        w.spent_30d_gold,
        u.risk_level
      FROM user_wallets w
      JOIN app_users u ON u.id = w.user_id
      WHERE w.user_id = $1
      LIMIT 1;
    `,
    [userId],
  );

  if (result.rowCount !== 1) {
    return null;
  }

  const row = result.rows[0];
  return {
    wallet_gold: row.wallet_gold,
    wallet_bonus_gold: row.wallet_bonus_gold,
    frozen_gold: row.frozen_gold,
    total_spent_gold: row.total_spent_gold,
    spent_30d_gold: row.spent_30d_gold,
    risk_level: normalizeRiskLevel(row.risk_level),
  };
};

const readMemoryWalletSummary = (userId: number): WalletSummary | null => {
  const wallet = memoryWalletsByUserId.get(userId);
  if (wallet === undefined) {
    return null;
  }

  const user = Array.from(memoryUsersByPhone.values()).find((item) => item.id === userId);
  return buildWalletSummary(wallet, user?.riskLevel ?? 0);
};

const upsertRefreshSession = async (
  client: PoolClient,
  input: {
    userId: number;
    deviceId: string;
    refreshId: string;
    sessionId: string;
    refreshToken: string;
    ip: string;
    expiresAt: Date;
    pepper: string;
  },
): Promise<void> => {
  const tokenHash = hashRefreshToken(input.refreshToken, input.pepper);
  await client.query(
    `
      INSERT INTO user_sessions (
        user_id,
        device_id,
        refresh_id,
        refresh_token_hash,
        last_ip,
        expires_at,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (user_id, device_id)
      DO UPDATE
      SET refresh_id = EXCLUDED.refresh_id,
          refresh_token_hash = EXCLUDED.refresh_token_hash,
          last_ip = EXCLUDED.last_ip,
          expires_at = EXCLUDED.expires_at,
          updated_at = NOW();
    `,
    [
      input.userId,
      input.deviceId,
      input.refreshId,
      tokenHash,
      input.ip,
      input.expiresAt,
    ],
  );
};

type RefreshSessionVerification = "ACTIVE" | "INVALID" | "REPLAYED";

const verifyPersistentRefreshSession = async (
  db: Pool,
  identity: VerifiedIdentity,
  refreshTokenHash: string,
  now: Date,
): Promise<RefreshSessionVerification> => {
  const userId = Number.parseInt(identity.uid, 10);
  if (Number.isNaN(userId) || identity.refresh_id === undefined) {
    return "INVALID";
  }

  const session = await db.query<{
    refresh_id: string;
    refresh_token_hash: string;
    expires_at: Date | string;
  }>(
    `
      SELECT
        refresh_id,
        refresh_token_hash,
        expires_at
      FROM user_sessions
      WHERE user_id = $1
        AND device_id = $2
      LIMIT 1;
    `,
    [userId, identity.device_id],
  );
  if (session.rowCount !== 1) {
    return "INVALID";
  }

  const row = session.rows[0];
  const expiresAtMs = new Date(row.expires_at).getTime();
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= now.getTime()) {
    return "INVALID";
  }

  if (row.refresh_id === identity.refresh_id && row.refresh_token_hash === refreshTokenHash) {
    return "ACTIVE";
  }

  return "REPLAYED";
};

const verifyMemoryRefreshSession = (
  identity: VerifiedIdentity,
  refreshTokenHash: string,
  now: Date,
): RefreshSessionVerification => {
  if (identity.refresh_id === undefined) {
    return "INVALID";
  }

  const key = `${identity.uid}:${identity.device_id}`;
  const session = memoryRefreshSessions.get(key);
  if (session === undefined) {
    return "INVALID";
  }
  if (session.expiresAt.getTime() <= now.getTime()) {
    return "INVALID";
  }
  if (
    session.status === "ACTIVE" &&
    session.refreshId === identity.refresh_id &&
    session.refreshTokenHash === refreshTokenHash
  ) {
    return "ACTIVE";
  }
  return "REPLAYED";
};

const parseOtpSendBody = (
  body: OtpSendRequestBody,
):
  | {
      ok: true;
      value: {
        phone: string;
      };
    }
  | {
      ok: false;
      message: string;
    } => {
  const phone = pickString(body.phone_e164, body.phone);
  if (phone === null || !phoneRegex.test(phone)) {
    return {
      ok: false,
      message: "phone_e164 is required and must be E.164 format.",
    };
  }

  const deviceId = pickString(body.device_id, body.deviceId);
  if (deviceId !== null && deviceId.length < 8) {
    return {
      ok: false,
      message: "device_id must be at least 8 chars when provided.",
    };
  }

  return {
    ok: true,
    value: {
      phone,
    },
  };
};

const parseLoginBody = (
  body: LoginRequestBody,
):
  | {
      ok: true;
      value: {
        phone: string;
        otp: string;
        deviceId: string;
        country: string;
        language: string;
      };
    }
  | {
      ok: false;
      message: string;
    } => {
  const phone = pickString(body.phone_e164, body.phone);
  const otp = pickString(body.otp_code, body.otp);
  const deviceId = pickString(body.device_id, body.deviceId);

  if (phone === null || !phoneRegex.test(phone)) {
    return { ok: false, message: "phone_e164 is required and must be E.164 format." };
  }
  if (otp === null || !otpRegex.test(otp)) {
    return { ok: false, message: "otp_code is required and must be 6 digits." };
  }
  if (deviceId === null || deviceId.length < 8) {
    return { ok: false, message: "device_id is required and must be at least 8 chars." };
  }

  const country = normalizeString(body.country) ?? defaultCountry;
  const language = normalizeString(body.language) ?? defaultLanguage;

  return {
    ok: true,
    value: {
      phone,
      otp,
      deviceId,
      country,
      language,
    },
  };
};

const parseRefreshBody = (
  body: RefreshRequestBody,
):
  | {
      ok: true;
      value: {
        refreshToken: string;
        sessionId: string | null;
        deviceId: string | null;
      };
    }
  | {
      ok: false;
      message: string;
    } => {
  const refreshToken = pickString(body.refresh_token, body.refreshToken);
  if (refreshToken === null) {
    return {
      ok: false,
      message: "refresh_token is required.",
    };
  }

  const deviceId = pickString(body.device_id, body.deviceId);
  const sessionId = pickString(body.session_id, body.sessionId);
  return {
    ok: true,
    value: {
      refreshToken,
      sessionId,
      deviceId,
    },
  };
};

const maskPhone = (phone: string): string => {
  if (phone.length <= 6) {
    return `${phone.slice(0, 2)}****`;
  }
  return `${phone.slice(0, 4)}****${phone.slice(-2)}`;
};

const pickString = (...values: unknown[]): string | null => {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized !== null) {
      return normalized;
    }
  }
  return null;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const upsertMemoryUserAndWallet = (params: {
  phone: string;
  country: string;
  language: string;
}): {
  user: UserRecord;
  wallet: WalletRecord;
} => {
  const existing = memoryUsersByPhone.get(params.phone);
  if (existing !== undefined) {
    existing.country = params.country;
    existing.language = params.language;
    const wallet = memoryWalletsByUserId.get(existing.id);
    if (wallet === undefined) {
      throw new Error("memory wallet is missing for existing user.");
    }
    return {
      user: {
        id: existing.id,
        country: existing.country,
        vipLevel: existing.vipLevel,
        riskLevel: existing.riskLevel,
        firstLogin: false,
      },
      wallet,
    };
  }

  const nextUserId = ++memoryUserSequence;
  memoryUsersByPhone.set(params.phone, {
    id: nextUserId,
    phone: params.phone,
    country: params.country,
    language: params.language,
    vipLevel: 0,
    riskLevel: 0,
  });
  const wallet: WalletRecord = {
    walletGold: 0,
    walletBonusGold: 0,
    frozenGold: 0,
    totalSpentGold: 0,
    spent30dGold: 0,
  };
  memoryWalletsByUserId.set(nextUserId, wallet);

  return {
    user: {
      id: nextUserId,
      country: params.country,
      vipLevel: 0,
      riskLevel: 0,
      firstLogin: true,
    },
    wallet,
  };
};

const upsertMemoryRefreshSession = (input: {
  userId: number;
  deviceId: string;
  refreshId: string;
  sessionId: string;
  refreshToken: string;
  ip: string;
  expiresAt: Date;
  pepper: string;
}): void => {
  const key = `${input.userId}:${input.deviceId}`;
  const existing = memoryRefreshSessions.get(key);
  if (existing !== undefined) {
    existing.status = "ROTATED";
  }

  memoryRefreshSessions.set(key, {
    refreshId: input.refreshId,
    refreshTokenHash: hashRefreshToken(input.refreshToken, input.pepper),
    sessionId: input.sessionId,
    ip: input.ip,
    expiresAt: input.expiresAt,
    status: "ACTIVE",
  });
};

const signToken = (
  payload: object,
  secret: string,
  expiresInSeconds: number,
): string => {
  const signOptions: SignOptions = {
    algorithm: "HS256",
    expiresIn: expiresInSeconds,
  };
  return jwt.sign(payload, secret, signOptions);
};

const verifyIdentityToken = (
  token: string,
  secret: string,
): VerifiedIdentity | null => {
  try {
    const decoded = jwt.verify(token, secret) as JwtPayload;
    const uid = typeof decoded.uid === "string" ? decoded.uid : undefined;
    const deviceId =
      typeof decoded.device_id === "string" ? decoded.device_id : undefined;
    const country =
      typeof decoded.country === "string" ? decoded.country : undefined;
    const sessionId =
      typeof decoded.session_id === "string"
        ? decoded.session_id
        : uid !== undefined && deviceId !== undefined
          ? deriveFallbackSessionId(uid, deviceId)
          : undefined;
    if (
      uid === undefined ||
      deviceId === undefined ||
      country === undefined ||
      sessionId === undefined
    ) {
      return null;
    }

    const refreshId =
      typeof decoded.refresh_id === "string" ? decoded.refresh_id : undefined;
    return {
      uid,
      device_id: deviceId,
      country,
      session_id: sessionId,
      refresh_id: refreshId,
    };
  } catch {
    return null;
  }
};

const extractHttpBearerToken = (request: Request): string | null => {
  const authorizationHeader = request.header("authorization");
  if (authorizationHeader === undefined) {
    return null;
  }
  if (!authorizationHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authorizationHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
};

const extractBearerToken = (
  socket: Socket<Record<string, never>, Record<string, never>, Record<string, never>, AuthenticatedSocketData>,
): string | null => {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.trim().length > 0) {
    return authToken.trim();
  }

  const authorizationHeader = socket.handshake.headers.authorization;
  if (typeof authorizationHeader !== "string") {
    return null;
  }
  if (!authorizationHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
};

const normalizeRiskLevel = (riskLevel: number): "LOW" | "MEDIUM" | "HIGH" => {
  if (riskLevel >= 2) {
    return "HIGH";
  }
  if (riskLevel === 1) {
    return "MEDIUM";
  }
  return "LOW";
};

const buildWalletSummary = (
  wallet: WalletRecord,
  riskLevel: number,
): WalletSummary => {
  return {
    wallet_gold: wallet.walletGold,
    wallet_bonus_gold: wallet.walletBonusGold,
    frozen_gold: wallet.frozenGold,
    total_spent_gold: wallet.totalSpentGold,
    spent_30d_gold: wallet.spent30dGold,
    risk_level: normalizeRiskLevel(riskLevel),
  };
};

const hashRefreshToken = (token: string, pepper: string): string => {
  return crypto.createHash("sha256").update(`${token}:${pepper}`).digest("hex");
};

const deriveFallbackSessionId = (uid: string, deviceId: string): string => {
  return `sess_${uid}_${deviceId}`;
};

const resolveRequestId = (request: Request): string => {
  const header = normalizeString(request.header("x-request-id"));
  return header ?? `req_${randomUUID().replaceAll("-", "")}`;
};

const sendSuccess = (
  response: Response,
  requestId: string,
  data: object,
  legacy: object,
): void => {
  response.status(200).json({
    request_id: requestId,
    code: "OK",
    message: "success",
    data,
    ...legacy,
  });
};

const sendAuthError = (
  response: Response,
  requestId: string,
  status: number,
  code: AuthErrorCode,
  message: string,
): void => {
  response.status(status).json({
    request_id: requestId,
    code,
    message,
  });
};

class InMemoryLoginRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now: Date): boolean {
    const nowMs = now.getTime();
    const threshold = nowMs - this.windowMs;

    const history = this.buckets.get(key) ?? [];
    const filteredHistory = history.filter((timestamp) => timestamp >= threshold);

    if (filteredHistory.length >= this.maxAttempts) {
      this.buckets.set(key, filteredHistory);
      return false;
    }

    filteredHistory.push(nowMs);
    this.buckets.set(key, filteredHistory);
    return true;
  }
}
