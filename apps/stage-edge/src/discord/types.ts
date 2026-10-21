export enum GatewayOpcode {
  DISPATCH = 0,
  HEARTBEAT = 1,
  IDENTIFY = 2,
  PRESENCE_UPDATE = 3,
  VOICE_STATE_UPDATE = 4,
  RESUME = 6,
  RECONNECT = 7,
  REQUEST_GUILD_MEMBERS = 8,
  INVALID_SESSION = 9,
  HELLO = 10,
  HEARTBEAT_ACK = 11,
}

export enum GatewayIntent {
  GUILDS = 1 << 0,
  GUILD_MEMBERS = 1 << 1,
  GUILD_MODERATION = 1 << 2,
  GUILD_EMOJIS_AND_STICKERS = 1 << 3,
  GUILD_INTEGRATIONS = 1 << 4,
  GUILD_WEBHOOKS = 1 << 5,
  GUILD_INVITES = 1 << 6,
  GUILD_VOICE_STATES = 1 << 7,
  GUILD_PRESENCES = 1 << 8,
  GUILD_MESSAGES = 1 << 9,
  GUILD_MESSAGE_REACTIONS = 1 << 10,
  GUILD_MESSAGE_TYPING = 1 << 11,
  DIRECT_MESSAGES = 1 << 12,
  DIRECT_MESSAGE_REACTIONS = 1 << 13,
  DIRECT_MESSAGE_TYPING = 1 << 14,
  MESSAGE_CONTENT = 1 << 15,
}

export interface GatewayPayload<T = unknown> {
  op: number
  d: T
  s?: number | null
  t?: string | null
}

export interface HelloData {
  heartbeat_interval: number
}

export interface ReadyData {
  v: number
  user: {
    id: string
    username: string
    discriminator: string
    global_name?: string | null
    bot?: boolean
  }
  guilds: Array<{ id: string, unavailable?: boolean }>
  session_id: string
  resume_gateway_url: string
}

export interface MessageCreateData {
  id: string
  channel_id: string
  guild_id?: string
  author: {
    id: string
    username: string
    discriminator: string
    global_name?: string | null
    bot?: boolean
  }
  content: string
  timestamp: string
}

export interface GatewayStatus {
  status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'
  botUser: {
    id: string
    username: string
    tag: string
  } | null
  sessionId: string | null
  resumeGatewayUrl: string | null
  lastSeq: number | null
  turnCount: number
  uptimeMs: number
  connectedAt: number | null
  lastHeartbeatSentAt: number | null
  lastHeartbeatAckAt: number | null
  lastErrorMessage: string | null
  activeChannelId?: string | null
}

export interface LoggedMessage {
  id: string
  channelId: string
  authorId: string
  authorName: string
  content: string
  replySent: string | null
  createdAt: number
}
